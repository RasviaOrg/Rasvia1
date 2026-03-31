/**
 * Notifications Context
 *
 * - Persists notification events (table ready, seated, joined) in AsyncStorage
 * - Watches the current user's active waitlist entries in real-time via Supabase
 * - Provides both the notification history and live waitlist widgets
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { useAuth } from "./auth-context";
import { schedulePushNotification } from "./push-notifications";

// ==========================================
// TYPES
// ==========================================

export type NotificationEventType =
  | "joined"
  | "table_ready"
  | "seated"
  | "left"
  | "removed"
  | "group_created"
  | "group_joined"
  | "group_item_added"
  | "group_submitted"
  | "group_ended";

export interface NotificationEvent {
  id: string;
  type: NotificationEventType;
  restaurantName: string;
  restaurantId: string;
  entryId: string;
  partySize: number;
  timestamp: string; // ISO string
  read: boolean;
}

export interface ActiveWaitlistEntry {
  entryId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantImage: string;
  address: string;
  position: number | null;
  totalInQueue: number;
  waitTime: number;
  partySize: number;
  status: "waiting" | "notified" | "seated";
  joinedAt: string;
  notifiedAt: string | null;
  seatedAt: string | null;
}

export interface TableReadyAlert {
  restaurantName: string;
  entryId: string;
}

export interface SeatedAlert {
  restaurantName: string;
  entryId: string;
}

interface NotificationsContextValue {
  events: NotificationEvent[];
  activeEntries: ActiveWaitlistEntry[];
  unreadCount: number;
  /** Includes unread events plus active “table ready” widgets when the event row is missing */
  notificationBadgeCount: number;
  tableReadyAlert: TableReadyAlert | null;
  clearTableReadyAlert: () => void;
  seatedAlert: SeatedAlert | null;
  clearSeatedAlert: () => void;
  addEvent: (event: Omit<NotificationEvent, "id" | "read">) => Promise<void>;
  removeEvent: (id: string) => Promise<void>;
  dismissEntry: (entryId: string) => void;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  refreshActive: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  events: [],
  activeEntries: [],
  unreadCount: 0,
  notificationBadgeCount: 0,
  tableReadyAlert: null,
  clearTableReadyAlert: () => {},
  seatedAlert: null,
  clearSeatedAlert: () => {},
  addEvent: async () => {},
  removeEvent: async () => {},
  dismissEntry: () => {},
  markAllRead: async () => {},
  clearAll: async () => {},
  refreshActive: async () => {},
});

const STORAGE_KEY = "rasvia:notifications:v2";
const DISMISSED_KEY = "rasvia:dismissed-entries:v1";

// ==========================================
// HELPERS
// ==========================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadStoredEvents(): Promise<NotificationEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as NotificationEvent[];
  } catch {
    return [];
  }
}

async function saveEvents(events: NotificationEvent[]): Promise<void> {
  try {
    const trimmed = events.slice(0, 100);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // silently ignore
  }
}

async function loadDismissedIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function saveDismissedIds(ids: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // silently ignore
  }
}

// ==========================================
// PROVIDER
// ==========================================

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [activeEntries, setActiveEntries] = useState<ActiveWaitlistEntry[]>([]);
  const [tableReadyAlert, setTableReadyAlert] = useState<TableReadyAlert | null>(null);
  const [seatedAlert, setSeatedAlert] = useState<SeatedAlert | null>(null);

  // Track entry IDs we're already watching to avoid duplicate subscriptions
  const watchedEntryIds = useRef<Set<string>>(new Set());
  const channelsRef = useRef<any[]>([]);
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  // Track last-known state per entry to avoid relying on oldRow (REPLICA IDENTITY may not be FULL)
  const entryStateRef = useRef<Record<string, { status: string; notified_at: string | null }>>({});

  // ==========================================
  // Load persisted events + dismissed IDs on mount
  // ==========================================
  useEffect(() => {
    loadStoredEvents().then(setEvents);
    loadDismissedIds().then((ids) => { dismissedIdsRef.current = ids; });
  }, []);

  // ==========================================
  // Fetch + watch active waitlist entries
  // ==========================================
  const refreshActive = useCallback(async () => {
    if (!session?.user?.id) {
      setActiveEntries([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("waitlist_entries")
        .select(`
          id,
          restaurant_id,
          party_size,
          status,
          created_at,
          notified_at,
          restaurants (
            id,
            name,
            image_url,
            address,
            current_wait_time
          )
        `)
        .eq("user_id", session.user.id)
        .in("status", ["waiting", "notified", "seated"])
        .order("created_at", { ascending: false });

      if (error || !data) return;

      // Batch-fetch position data: get all "waiting" entries for the
      // restaurants the user has active entries in (avoids N+1 queries).
      const restaurantIds = [...new Set(data.map((r: any) => r.restaurant_id))];
      let waitingByRestaurant: Record<number, { id: string; created_at: string }[]> = {};
      if (restaurantIds.length > 0) {
        try {
          const { data: waitingRows } = await supabase
            .from("waitlist_entries")
            .select("id, restaurant_id, created_at")
            .in("restaurant_id", restaurantIds)
            .eq("status", "waiting")
            .order("created_at", { ascending: true });
          for (const w of waitingRows ?? []) {
            if (!waitingByRestaurant[w.restaurant_id]) waitingByRestaurant[w.restaurant_id] = [];
            waitingByRestaurant[w.restaurant_id].push({ id: w.id, created_at: w.created_at });
          }
        } catch { /* ignore */ }
      }

      const entries: ActiveWaitlistEntry[] = data.map((row: any) => {
        const rest = row.restaurants;
        const waitingList = waitingByRestaurant[row.restaurant_id] ?? [];
        const total = waitingList.length;
        const idx = waitingList.findIndex((w) => w.id === row.id);
        const position = idx >= 0 ? idx + 1 : null;

        return {
          entryId: row.id,
          restaurantId: String(row.restaurant_id),
          restaurantName: rest?.name ?? "Restaurant",
          restaurantImage:
            rest?.image_url ??
            "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80",
          address: rest?.address ?? "",
          position,
          totalInQueue: total,
          waitTime: rest?.current_wait_time ?? 0,
          partySize: row.party_size ?? 1,
          status: row.status,
          joinedAt: row.created_at,
          notifiedAt: row.notified_at ?? null,
          seatedAt: row.status === "seated" ? (row.notified_at ?? row.created_at) : null,
        };
      });

      // Seed tracked state for reliable change detection in realtime handler
      for (const row of data) {
        entryStateRef.current[row.id] = {
          status: row.status,
          notified_at: row.notified_at ?? null,
        };
      }

      // Filter out manually dismissed entries
      const visible = entries.filter((e) => !dismissedIdsRef.current.has(e.entryId));
      setActiveEntries(visible);

      // Subscribe to any new entry IDs we haven't watched yet
      entries.forEach((entry) => {
        if (!watchedEntryIds.current.has(entry.entryId)) {
          watchedEntryIds.current.add(entry.entryId);
          subscribeToEntry(entry.entryId, entry.restaurantName, entry.restaurantId, entry.partySize);
        }
      });
    } catch {
      // silently ignore
    }
  }, [session]);

  // ==========================================
  // Subscribe to a single entry for status changes
  // ==========================================
  const subscribeToEntry = useCallback(
    (entryId: string, restaurantName: string, restaurantId: string, partySize: number) => {
      const channel = supabase
        .channel(`notif-entry:${entryId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "waitlist_entries",
            filter: `id=eq.${entryId}`,
          },
          (payload) => {
            const newRow = payload.new as any;
            const prev = entryStateRef.current[entryId] ?? { status: "waiting", notified_at: null };

            if (newRow.notified_at && !prev.notified_at) {
              addEvent({
                type: "table_ready",
                restaurantName,
                restaurantId,
                entryId,
                partySize,
                timestamp: new Date().toISOString(),
              });
              setTableReadyAlert({ restaurantName, entryId });
              schedulePushNotification(
                "🎉 Your Table is Ready!",
                `${restaurantName} — your table is ready! Head over now.`,
                { type: "table_ready", entryId, restaurantId },
              );
              setActiveEntries((prevEntries) =>
                prevEntries.map((e) =>
                  e.entryId === entryId
                    ? { ...e, status: "notified", notifiedAt: newRow.notified_at }
                    : e
                )
              );
            }

            if (newRow.status === "seated" && prev.status !== "seated") {
              addEvent({
                type: "seated",
                restaurantName,
                restaurantId,
                entryId,
                partySize,
                timestamp: new Date().toISOString(),
              });
              setSeatedAlert({ restaurantName, entryId });
              schedulePushNotification(
                "🍽️ You're Seated!",
                `Enjoy your meal at ${restaurantName}!`,
                { type: "seated", entryId, restaurantId },
              );
              setActiveEntries((prevEntries) =>
                prevEntries.map((e) =>
                  e.entryId === entryId
                    ? { ...e, status: "seated", seatedAt: new Date().toISOString() }
                    : e
                )
              );
            }

            if (newRow.status === "removed" && prev.status !== "removed") {
              addEvent({
                type: "removed",
                restaurantName,
                restaurantId,
                entryId,
                partySize,
                timestamp: new Date().toISOString(),
              });
              setActiveEntries((prevEntries) => prevEntries.filter((e) => e.entryId !== entryId));
            }

            if (newRow.status === "cancelled" && prev.status !== "cancelled") {
              // Guest self-cancel already records a "left" event in-app; staff cancel uses the same status.
              // Only "removed" rows get a dedicated removed notification below.
              setActiveEntries((prevEntries) => prevEntries.filter((e) => e.entryId !== entryId));
            }

            // Update tracked state
            entryStateRef.current[entryId] = {
              status: newRow.status,
              notified_at: newRow.notified_at ?? null,
            };
          }
        )
        .subscribe();

      channelsRef.current.push(channel);
    },
    [session]
  );

  // ==========================================
  // Refresh when session changes
  // ==========================================
  useEffect(() => {
    channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
    channelsRef.current = [];
    watchedEntryIds.current.clear();

    refreshActive();
  }, [session?.user?.id, refreshActive]);

  // Also refresh every 60s to catch any missed updates
  useEffect(() => {
    const interval = setInterval(refreshActive, 60_000);
    return () => clearInterval(interval);
  }, [refreshActive]);

  // ==========================================
  // Cleanup on unmount
  // ==========================================
  useEffect(() => {
    return () => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
    };
  }, []);

  // ==========================================
  // Event management
  // ==========================================
  const addEvent = useCallback(
    async (event: Omit<NotificationEvent, "id" | "read">) => {
      const newEvent: NotificationEvent = {
        ...event,
        id: generateId(),
        read: false,
      };
      setEvents((prev) => {
        const updated = [newEvent, ...prev];
        saveEvents(updated);
        return updated;
      });
    },
    []
  );

  const clearTableReadyAlert = useCallback(() => {
    setTableReadyAlert(null);
  }, []);

  const clearSeatedAlert = useCallback(() => {
    setSeatedAlert(null);
  }, []);

  const removeEvent = useCallback(async (id: string) => {
    setEvents((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      saveEvents(updated);
      return updated;
    });
  }, []);

  const dismissEntry = useCallback((entryId: string) => {
    dismissedIdsRef.current.add(entryId);
    saveDismissedIds(dismissedIdsRef.current);
    setActiveEntries((prev) => prev.filter((e) => e.entryId !== entryId));
  }, []);

  const markAllRead = useCallback(async () => {
    setEvents((prev) => {
      const updated = prev.map((e) => ({ ...e, read: true }));
      saveEvents(updated);
      return updated;
    });
  }, []);

  const clearAll = useCallback(async () => {
    setActiveEntries((prev) => {
      prev.forEach((e) => dismissedIdsRef.current.add(e.entryId));
      return [];
    });
    saveDismissedIds(dismissedIdsRef.current);
    setEvents([]);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const unreadCount = events.filter((e) => !e.read).length;

  const unreadTableReadyEvents = events.filter(
    (e) => !e.read && e.type === "table_ready"
  ).length;
  const notifiedWithoutUnreadEvent = Math.max(
    0,
    activeEntries.filter((e) => e.status === "notified").length - unreadTableReadyEvents
  );
  const notificationBadgeCount = unreadCount + notifiedWithoutUnreadEvent;

  return (
    <NotificationsContext.Provider
      value={{
        events,
        activeEntries,
        unreadCount,
        notificationBadgeCount,
        tableReadyAlert,
        clearTableReadyAlert,
        seatedAlert,
        clearSeatedAlert,
        addEvent,
        removeEvent,
        dismissEntry,
        markAllRead,
        clearAll,
        refreshActive,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
