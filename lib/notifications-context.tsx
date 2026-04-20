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
  useMemo,
  useRef,
} from "react";
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  | "order_placed"
  | "group_created"
  | "group_joined"
  | "group_item_added"
  | "group_submitted"
  | "group_ended"
  | "review_report_submitted"
  | "review_report_new"
  | "review_report_declined"
  | "review_report_deleted"
  | "menu_image_submitted"
  | "menu_image_request_new"
  | "menu_image_approved"
  | "menu_image_rejected";

type NotificationEventSource = "local" | "server";

export interface NotificationEvent {
  id: string;
  type: NotificationEventType;
  source?: NotificationEventSource;
  serverId?: number;
  title?: string;
  message?: string | null;
  metadata?: Record<string, any> | null;
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

const STORAGE_KEY = "rasvia.notifications.v2";
const DISMISSED_KEY = "rasvia.dismissed_entries.v1";
const LEGACY_STORAGE_KEY = "rasvia:notifications:v2";

// ==========================================
// HELPERS
// ==========================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadStoredEvents(): Promise<NotificationEvent[]> {
  try {
    let raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // One-time migration path from old SecureStore storage key.
      raw = await SecureStore.getItemAsync(LEGACY_STORAGE_KEY);
      if (raw) {
        await AsyncStorage.setItem(STORAGE_KEY, raw);
      }
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<NotificationEvent>[];
    return parsed.map((event) => ({
      id: event.id ?? generateId(),
      type: (event.type ?? "joined") as NotificationEventType,
      source: event.source ?? "local",
      serverId: event.serverId,
      title: event.title,
      message: event.message ?? null,
      metadata: event.metadata ?? null,
      restaurantName: event.restaurantName ?? "Rasvia",
      restaurantId: event.restaurantId ?? "",
      entryId: event.entryId ?? "",
      partySize: event.partySize ?? 0,
      timestamp: event.timestamp ?? new Date().toISOString(),
      read: !!event.read,
    }));
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
    const raw = await SecureStore.getItemAsync(DISMISSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function saveDismissedIds(ids: Set<string>): Promise<void> {
  try {
    await SecureStore.setItemAsync(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // silently ignore
  }
}

// ==========================================
// PROVIDER
// ==========================================

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [localEvents, setLocalEvents] = useState<NotificationEvent[]>([]);
  const [serverEvents, setServerEvents] = useState<NotificationEvent[]>([]);
  const [activeEntries, setActiveEntries] = useState<ActiveWaitlistEntry[]>([]);
  const [tableReadyAlert, setTableReadyAlert] = useState<TableReadyAlert | null>(null);
  const [seatedAlert, setSeatedAlert] = useState<SeatedAlert | null>(null);

  // Track entry IDs we're already watching to avoid duplicate subscriptions
  const watchedEntryIds = useRef<Set<string>>(new Set());
  const channelsRef = useRef<any[]>([]);
  // Separate map so we can remove a specific entry's channel when it reaches
  // a terminal status (cancelled/seated/removed/completed). Previously the
  // anonymous-list pattern meant these channels accumulated for the life of
  // the provider, even though the waitlist row was no longer relevant —
  // contributing to per-navigation realtime churn and eventual crashes on
  // long sessions.
  const entryChannelsRef = useRef<Map<string, any>>(new Map());
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  const restaurantNameCacheRef = useRef<Record<string, string>>({});
  // Track last-known state per entry to avoid relying on oldRow (REPLICA IDENTITY may not be FULL)
  const entryStateRef = useRef<Record<string, { status: string; notified_at: string | null }>>({});
  // Hard cap on how many per-entry states we keep resident in memory. Older
  // non-active entries are evicted when the cap is exceeded so this map never
  // grows unbounded across long sessions.
  const ENTRY_STATE_HARD_CAP = 50;

  // ==========================================
  // Load persisted events + dismissed IDs on mount
  // ==========================================
  useEffect(() => {
    loadStoredEvents().then(setLocalEvents);
    loadDismissedIds().then((ids) => { dismissedIdsRef.current = ids; });
  }, []);

  const refreshServerEvents = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setServerEvents([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("app_notifications")
        .select("id, type, title, message, metadata, created_at, read_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return;
      const mapped: NotificationEvent[] = (data ?? []).map((row: any) => {
        const meta = (row.metadata as Record<string, any> | null) ?? {};
        return {
          id: `server-${row.id}`,
          source: "server",
          serverId: row.id,
          type: row.type as NotificationEventType,
          title: row.title ?? "",
          message: row.message ?? null,
          metadata: meta,
          restaurantName: String(meta.restaurantName ?? row.title ?? "Rasvia"),
          restaurantId: String(meta.restaurantId ?? ""),
          entryId: String(meta.entryId ?? row.id),
          partySize: Number(meta.partySize ?? 0),
          timestamp: row.created_at,
          read: !!row.read_at,
        };
      });
      setServerEvents(mapped);
    } catch {
      // silently ignore
    }
  }, [session?.user?.id]);

  const upsertOrderEvent = useCallback((payload: {
    orderId: string;
    restaurantId?: string | number | null;
    restaurantName?: string | null;
    status?: string | null;
    createdAt?: string | null;
  }) => {
    const orderId = String(payload.orderId || "").trim();
    if (!orderId) return;
    const restaurantId = String(payload.restaurantId ?? "");
    const status = String(payload.status ?? "pending").toLowerCase();
    const statusLabel =
      status === "pending_payment"
        ? "Pending"
        : status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const resolvedRestaurantName =
      String(payload.restaurantName ?? "").trim() ||
      (restaurantId ? restaurantNameCacheRef.current[restaurantId] : "") ||
      "Restaurant";

    if (restaurantId) restaurantNameCacheRef.current[restaurantId] = resolvedRestaurantName;

    setLocalEvents((prev) => {
      const idx = prev.findIndex((e) => e.type === "order_placed" && e.entryId === orderId);
      const timestamp = payload.createdAt || new Date().toISOString();
      const message =
        status === "pending" || status === "pending_payment"
          ? `Order placed at ${resolvedRestaurantName}`
          : `Order at ${resolvedRestaurantName}: ${statusLabel}`;
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          restaurantId: restaurantId || next[idx].restaurantId,
          restaurantName: resolvedRestaurantName,
          message,
          metadata: {
            ...(next[idx].metadata ?? {}),
            status,
          },
          timestamp,
        };
        saveEvents(next);
        return next;
      }

      const newEvent: NotificationEvent = {
        id: generateId(),
        source: "local",
        type: "order_placed",
        title: "Order Alert",
        message,
        metadata: { status },
        restaurantName: resolvedRestaurantName,
        restaurantId: restaurantId || "",
        entryId: orderId,
        partySize: 0,
        timestamp,
        read: false,
      };
      const next = [newEvent, ...prev];
      saveEvents(next);
      return next;
    });
  }, []);

  // Release the realtime channel + tracked state for a single entry once it
  // reaches a terminal status. Safe to call multiple times.
  const releaseEntrySubscription = useCallback((entryId: string) => {
    const ch = entryChannelsRef.current.get(entryId);
    if (ch) {
      try { supabase.removeChannel(ch); } catch { /* ignore */ }
      entryChannelsRef.current.delete(entryId);
      const idx = channelsRef.current.indexOf(ch);
      if (idx >= 0) channelsRef.current.splice(idx, 1);
    }
    watchedEntryIds.current.delete(entryId);
    delete entryStateRef.current[entryId];
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
      const activeIds = new Set<string>();
      for (const row of data) {
        entryStateRef.current[row.id] = {
          status: row.status,
          notified_at: row.notified_at ?? null,
        };
        activeIds.add(String(row.id));
      }

      // Enforce a hard cap: if we've accumulated too many stale (non-active)
      // entries over long sessions, evict anything not in the current active
      // set. This keeps the memory footprint bounded regardless of how many
      // waitlists the user has joined.
      const stateKeys = Object.keys(entryStateRef.current);
      if (stateKeys.length > ENTRY_STATE_HARD_CAP) {
        for (const id of stateKeys) {
          if (!activeIds.has(id)) {
            delete entryStateRef.current[id];
            // Also drop any lingering channel for this entry.
            releaseEntrySubscription(id);
          }
        }
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
  }, [session, releaseEntrySubscription]);

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

            // Release the per-entry realtime channel once it reaches a
            // terminal state so channels don't accumulate across the session.
            const terminal = ["cancelled", "removed", "completed", "seated"];
            if (terminal.includes(String(newRow.status))) {
              // Defer so any listeners reacting to the same payload finish first.
              setTimeout(() => releaseEntrySubscription(entryId), 0);
            }
          }
        )
        .subscribe();

      channelsRef.current.push(channel);
      entryChannelsRef.current.set(entryId, channel);
    },
    [session, releaseEntrySubscription]
  );

  // ==========================================
  // Refresh when session changes
  // ==========================================
  useEffect(() => {
    channelsRef.current.forEach((ch) => {
      try { supabase.removeChannel(ch); } catch { /* ignore */ }
    });
    channelsRef.current = [];
    entryChannelsRef.current.clear();
    watchedEntryIds.current.clear();
    entryStateRef.current = {};

    refreshActive();
    refreshServerEvents();
  }, [session?.user?.id, refreshActive, refreshServerEvents]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    const topicSuffix = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`app-notifications:${userId}:${topicSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refreshServerEvents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [session?.user?.id, refreshServerEvents]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    const resolveRestaurantName = async (restaurantId: number | null | undefined) => {
      const rid = Number(restaurantId);
      if (!Number.isFinite(rid)) return "Restaurant";
      const cacheKey = String(rid);
      if (restaurantNameCacheRef.current[cacheKey]) return restaurantNameCacheRef.current[cacheKey];
      try {
        const { data } = await supabase
          .from("restaurants")
          .select("name")
          .eq("id", rid)
          .maybeSingle();
        const name = String((data as any)?.name ?? "Restaurant");
        restaurantNameCacheRef.current[cacheKey] = name;
        return name;
      } catch {
        return "Restaurant";
      }
    };

    const ordersTopicSuffix = Math.random().toString(36).slice(2, 8);
    const channel = supabase
      .channel(`notif-orders:${userId}:${ordersTopicSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `created_by=eq.${userId}`,
        },
        async (payload) => {
          const row = (payload.new ?? payload.old) as any;
          if (!row?.id) return;
          const restaurantName = await resolveRestaurantName(Number(row.restaurant_id ?? NaN));
          upsertOrderEvent({
            orderId: String(row.id),
            restaurantId: row.restaurant_id,
            restaurantName,
            status: row.status ?? "pending",
            createdAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, upsertOrderEvent]);

  // Also refresh every 60s to catch any missed updates
  useEffect(() => {
    const interval = setInterval(() => {
      void refreshActive();
      void refreshServerEvents();
    }, 60_000);
    return () => clearInterval(interval);
  }, [refreshActive, refreshServerEvents]);

  // ==========================================
  // Cleanup on unmount
  // ==========================================
  useEffect(() => {
    return () => {
      channelsRef.current.forEach((ch) => {
        try { supabase.removeChannel(ch); } catch { /* ignore */ }
      });
      channelsRef.current = [];
      entryChannelsRef.current.clear();
      watchedEntryIds.current.clear();
      entryStateRef.current = {};
    };
  }, []);

  // ==========================================
  // Event management
  // ==========================================
  const addEvent = useCallback(
    async (event: Omit<NotificationEvent, "id" | "read">) => {
      if (event.type === "order_placed" && event.entryId) {
        upsertOrderEvent({
          orderId: event.entryId,
          restaurantId: event.restaurantId,
          restaurantName: event.restaurantName,
          status: String(event.metadata?.status ?? "pending"),
          createdAt: event.timestamp,
        });
        return;
      }
      const newEvent: NotificationEvent = {
        ...event,
        source: event.source ?? "local",
        id: generateId(),
        read: false,
      };
      setLocalEvents((prev) => {
        const updated = [newEvent, ...prev];
        saveEvents(updated);
        return updated;
      });
    },
    [upsertOrderEvent]
  );

  const clearTableReadyAlert = useCallback(() => {
    setTableReadyAlert(null);
  }, []);

  const clearSeatedAlert = useCallback(() => {
    setSeatedAlert(null);
  }, []);

  const events = useMemo(() => {
    return [...serverEvents, ...localEvents].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [serverEvents, localEvents]);

  const removeEvent = useCallback(async (id: string) => {
    const serverEvent = serverEvents.find((e) => e.id === id);
    if (serverEvent?.serverId && session?.user?.id) {
      await supabase
        .from("app_notifications")
        .delete()
        .eq("id", serverEvent.serverId)
        .eq("user_id", session.user.id);
      setServerEvents((prev) => prev.filter((e) => e.id !== id));
      return;
    }

    setLocalEvents((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      saveEvents(updated);
      return updated;
    });
  }, [serverEvents, session?.user?.id]);

  const dismissEntry = useCallback((entryId: string) => {
    dismissedIdsRef.current.add(entryId);
    saveDismissedIds(dismissedIdsRef.current);
    setActiveEntries((prev) => prev.filter((e) => e.entryId !== entryId));
  }, []);

  const markAllRead = useCallback(async () => {
    setLocalEvents((prev) => {
      const updated = prev.map((e) => ({ ...e, read: true }));
      saveEvents(updated);
      return updated;
    });

    if (session?.user?.id) {
      const unreadServerIds = serverEvents
        .filter((e) => !e.read && e.serverId != null)
        .map((e) => e.serverId as number);
      if (unreadServerIds.length > 0) {
        await supabase
          .from("app_notifications")
          .update({ read_at: new Date().toISOString() })
          .in("id", unreadServerIds)
          .eq("user_id", session.user.id);
      }
      setServerEvents((prev) => prev.map((e) => ({ ...e, read: true })));
    }
  }, [serverEvents, session?.user?.id]);

  const clearAll = useCallback(async () => {
    setActiveEntries((prev) => {
      prev.forEach((e) => dismissedIdsRef.current.add(e.entryId));
      return [];
    });
    saveDismissedIds(dismissedIdsRef.current);
    setLocalEvents([]);
    setServerEvents([]);
    await AsyncStorage.removeItem(STORAGE_KEY);
    // Best-effort cleanup of legacy key; ignore unsupported-key failures.
    try { await SecureStore.deleteItemAsync(LEGACY_STORAGE_KEY); } catch {}
    if (session?.user?.id) {
      await supabase.from("app_notifications").delete().eq("user_id", session.user.id);
    }
  }, [session?.user?.id]);

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
