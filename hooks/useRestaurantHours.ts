import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
    getRestaurantStatus,
    subscribeDebugTimeChanges,
    type RestaurantHour,
    type RestaurantStatusResult,
} from '@/lib/restaurant-hours';

interface UseRestaurantHoursResult {
    hours: RestaurantHour[];
    statusResult: RestaurantStatusResult | null;
    loading: boolean;
    error: string | null;
    /** Call to manually re-fetch hours from Supabase */
    refetch: () => void;
}

/**
 * Fetches hours for a given restaurant from the `restaurant_hours` table
 * and computes the current open/closed status.
 *
 * Automatically re-evaluates status every 60 seconds so the badge stays current.
 */
export function useRestaurantHours(restaurantId: string | number | undefined): UseRestaurantHoursResult {
    const [hours, setHours] = useState<RestaurantHour[]>([]);
    const [statusResult, setStatusResult] = useState<RestaurantStatusResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchHours = useCallback(async () => {
        if (!restaurantId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const { data, error: fetchError } = await supabase
                .from('restaurant_hours')
                .select('*')
                .eq('restaurant_id', Number(restaurantId))
                .order('day_of_week')
                .order('open_time');

            if (fetchError) throw fetchError;

            const fetched = (data ?? []) as RestaurantHour[];
            setHours(fetched);
            setStatusResult(getRestaurantStatus(fetched));
            setError(null);
        } catch (err: any) {
            console.error('useRestaurantHours error:', err);
            setError(err?.message ?? 'Failed to load hours');
        } finally {
            setLoading(false);
        }
    }, [restaurantId]);

    // Fetch on mount and when restaurantId changes
    useEffect(() => {
        fetchHours();
    }, [fetchHours]);

    // Re-evaluate status every 60 seconds (hours rarely change, status can)
    useEffect(() => {
        const interval = setInterval(() => {
            setStatusResult(getRestaurantStatus(hours));
        }, 60_000);

        return () => clearInterval(interval);
    }, [hours]);

    // Immediately re-evaluate when admin debug-time override changes.
    useEffect(() => {
        return subscribeDebugTimeChanges(() => {
            setStatusResult(getRestaurantStatus(hours));
        });
    }, [hours]);

    return { hours, statusResult, loading, error, refetch: fetchHours };
}
