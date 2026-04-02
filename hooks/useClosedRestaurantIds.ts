import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
    getRestaurantStatus,
    subscribeDebugTimeChanges,
    isInWaitlistEarlyWindow,
    type RestaurantHour,
} from '@/lib/restaurant-hours';

type RestaurantRow = {
    id: number;
    waitlist_open: boolean | null;
    waitlist_early_open_enabled?: boolean | null;
    waitlist_early_open_minutes?: number | null;
};

/**
 * Restaurant IDs that should appear "closed" on discovery, map, and search.
 * - Waitlist off → closed.
 * - No hours → closed.
 * - Hours say closed or opening_soon → closed, except during optional pre-open
 *   waitlist window (when enabled) so those venues still look active on the map.
 * Re-evaluates every 60s and when admin debug time changes.
 */
export function useClosedRestaurantIds(): Set<string> {
    const [closedIds, setClosedIds] = useState<Set<string>>(new Set());

    async function fetchAndCompute() {
        try {
            const [restaurantsRes, hoursRes] = await Promise.all([
                supabase
                    .from('restaurants')
                    .select(
                        'id, waitlist_open, waitlist_early_open_enabled, waitlist_early_open_minutes',
                    )
                    .or('is_enabled.eq.true,is_enabled.is.null'),
                supabase.from('restaurant_hours').select('restaurant_id, day_of_week, open_time, close_time'),
            ]);

            const restaurantsList = (restaurantsRes.data ?? []) as RestaurantRow[];

            const grouped: Record<number, RestaurantHour[]> = {};
            for (const row of hoursRes.data ?? []) {
                if (!grouped[row.restaurant_id]) grouped[row.restaurant_id] = [];
                grouped[row.restaurant_id].push(row as RestaurantHour);
            }

            const closed = new Set<string>();

            for (const r of restaurantsList) {
                const id = String(r.id);
                if (r.waitlist_open === false) {
                    closed.add(id);
                    continue;
                }

                const hours = grouped[Number(id)];
                if (!hours || hours.length === 0) {
                    closed.add(id);
                    continue;
                }

                const statusResult = getRestaurantStatus(hours);
                if (statusResult.status !== 'closed' && statusResult.status !== 'opening_soon') {
                    continue;
                }

                if (statusResult.status === 'closed') {
                    const earlyMins = Math.max(
                        0,
                        Math.min(24 * 60, Number(r.waitlist_early_open_minutes) || 30),
                    );
                    if (
                        isInWaitlistEarlyWindow(
                            hours,
                            r.waitlist_early_open_enabled === true,
                            earlyMins,
                        )
                    ) {
                        continue;
                    }
                }

                closed.add(id);
            }

            setClosedIds(closed);
        } catch (err) {
            console.error('useClosedRestaurantIds error:', err);
        }
    }

    useEffect(() => {
        fetchAndCompute();
        const interval = setInterval(fetchAndCompute, 60_000);
        const unsubscribe = subscribeDebugTimeChanges(() => {
            fetchAndCompute();
        });
        return () => {
            clearInterval(interval);
            unsubscribe();
        };
    }, []);

    return closedIds;
}
