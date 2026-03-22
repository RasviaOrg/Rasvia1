/**
 * Restaurant Hours Utility
 *
 * Determines if a restaurant is Open, Closed (between shifts), or Closed (end of day)
 * based on its hours in the Central Time Zone (America/Chicago).
 *
 * Handles split shifts (e.g., Lunch 11:30–14:30, Dinner 17:30–22:00).
 */

// ================================================
// TYPES
// ================================================

export interface RestaurantHour {
  id?: number;
  restaurant_id?: number;
  /** 0 = Sunday, 1 = Monday, ..., 6 = Saturday */
  day_of_week: number;
  /** Format: 'HH:MM:SS', e.g. '11:30:00' */
  open_time: string;
  /** Format: 'HH:MM:SS', e.g. '14:30:00' */
  close_time: string;
}

export type RestaurantOpenStatus = "open" | "closed" | "opening_soon" | "closing_soon";

export interface RestaurantStatusResult {
  status: RestaurantOpenStatus;
  /** Human-readable label, e.g. "Open until 2:30 PM" or "Closed • Opens Wed at 11:30 AM" */
  label: string;
  /** Minutes until next change (open → close or closed → open), null if no further shifts found */
  minutesUntilChange: number | null;
}

// ================================================
// HELPERS
// ================================================

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Parse 'HH:MM:SS' into total minutes since midnight */
function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/** Format total minutes since midnight to "12:30 PM" style */
function formatMinutesToAmPm(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// ================================================
// DEBUG TIME OVERRIDE (admin use only, in-memory)
// ================================================

let _debugTimeISO: string | null = null;

/** Set a fake ISO timestamp to override the app's perceived time. Pass null to reset. */
export function setDebugTime(iso: string | null): void {
  _debugTimeISO = iso;
}

/** Get the currently active debug ISO string, or null if none is set. */
export function getDebugTime(): string | null {
  return _debugTimeISO;
}

/**
 * Get the current time in Central Time (America/Chicago).
 * Returns { dayOfWeek, minutesSinceMidnight }.
 * Falls back to local device time if Intl.DateTimeFormat is unavailable.
 * If a debug time override is set, uses that instead of real time.
 */
function getCentralTime(): {
  dayOfWeek: number;
  minutesSinceMidnight: number;
  now: Date;
} {
  const now = _debugTimeISO ? new Date(_debugTimeISO) : new Date();

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";

    const weekdayStr = get("weekday"); // 'Sun', 'Mon', etc.
    const dayOfWeek = DAY_NAMES.indexOf(weekdayStr);

    const hour = parseInt(get("hour"), 10) % 24; // Intl may return '24' for midnight
    const minute = parseInt(get("minute"), 10);
    const minutesSinceMidnight = hour * 60 + minute;

    return { dayOfWeek, minutesSinceMidnight, now };
  } catch {
    // Fallback: use local device time
    const dayOfWeek = now.getDay();
    const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
    return { dayOfWeek, minutesSinceMidnight, now };
  }
}

// ================================================
// CORE STATUS FUNCTION
// ================================================

/**
 * Given an array of RestaurantHour rows from Supabase, compute the restaurant's
 * current open/closed status and a human-readable label.
 */
export function getRestaurantStatus(
  hours: RestaurantHour[],
): RestaurantStatusResult {
  if (!hours || hours.length === 0) {
    return {
      status: "closed",
      label: "Hours unavailable",
      minutesUntilChange: null,
    };
  }

  const { dayOfWeek, minutesSinceMidnight } = getCentralTime();

  // Sort: by day, then by open_time
  const sorted = [...hours].sort((a, b) => {
    if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
    return parseTimeToMinutes(a.open_time) - parseTimeToMinutes(b.open_time);
  });

  // ── Step 1: Check if we're currently inside any shift today ──
  const todayShifts = sorted.filter((h) => h.day_of_week === dayOfWeek);

  for (const shift of todayShifts) {
    const openMin = parseTimeToMinutes(shift.open_time);
    const closeMin = parseTimeToMinutes(shift.close_time);

    const isOvernight = closeMin <= openMin;
    const isInShift = isOvernight
      ? (minutesSinceMidnight >= openMin || minutesSinceMidnight < closeMin)
      : (minutesSinceMidnight >= openMin && minutesSinceMidnight < closeMin);

    if (isInShift) {
      const minutesLeft = isOvernight
        ? (minutesSinceMidnight >= openMin
            ? (1440 - minutesSinceMidnight) + closeMin
            : closeMin - minutesSinceMidnight)
        : closeMin - minutesSinceMidnight;
      const isClosingSoon = minutesLeft <= 30;
      return {
        status: isClosingSoon ? "closing_soon" : "open",
        label: isClosingSoon
          ? `Closing soon \u2022 ${formatMinutesToAmPm(closeMin)}`
          : `Open until ${formatMinutesToAmPm(closeMin)}`,
        minutesUntilChange: minutesLeft,
      };
    }
  }

  // ── Step 2: Closed — find the next upcoming shift ──

  // Check remaining shifts TODAY (after current time)
  const nextTodayShift = todayShifts.find(
    (h) => parseTimeToMinutes(h.open_time) > minutesSinceMidnight,
  );

  if (nextTodayShift) {
    const openMin = parseTimeToMinutes(nextTodayShift.open_time);
    const minutesUntil = openMin - minutesSinceMidnight;
    const isOpeningSoon = minutesUntil <= 60; // within the next hour
    return {
      status: isOpeningSoon ? "opening_soon" : "closed",
      label: `Closed • Opens at ${formatMinutesToAmPm(openMin)}`,
      minutesUntilChange: minutesUntil,
    };
  }

  // Look ahead up to 7 days for the next shift
  for (let daysAhead = 1; daysAhead <= 7; daysAhead++) {
    const targetDay = (dayOfWeek + daysAhead) % 7;
    const futureShifts = sorted.filter((h) => h.day_of_week === targetDay);

    if (futureShifts.length > 0) {
      const next = futureShifts[0];
      const openMin = parseTimeToMinutes(next.open_time);
      const dayLabel = daysAhead === 1 ? "Tomorrow" : DAY_NAMES[targetDay];
      return {
        status: "closed",
        label: `Closed • Opens ${dayLabel} at ${formatMinutesToAmPm(openMin)}`,
        minutesUntilChange: daysAhead * 1440 + openMin - minutesSinceMidnight,
      };
    }
  }

  // No shifts found at all
  return { status: "closed", label: "Closed", minutesUntilChange: null };
}
