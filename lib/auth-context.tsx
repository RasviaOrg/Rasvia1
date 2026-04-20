import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase, purgeStoredSupabaseSession } from './supabase';
import { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { upsertProfileFromAuthUser } from './profile-sync';
import { withTimeout } from './with-timeout';

interface AuthContextType {
    session: Session | null;
    loading: boolean;
    needsOnboarding: boolean;
    setNeedsOnboarding: (val: boolean) => void;
    profile: {
        full_name: string | null;
        phone_number: string | null;
        phone_verified: boolean | null;
        avatar_url: string | null;
        created_at: string | null;
        saved_address: string | null;
        home_lat: number | null;
        home_long: number | null;
        location_city: string | null;
    } | null;
    profileLoading: boolean;
    refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    session: null,
    loading: true,
    needsOnboarding: false,
    setNeedsOnboarding: () => { },
    profile: null,
    profileLoading: false,
    refreshProfile: async () => {},
});

const AUTH_TIMEOUT_MS = 15000;
const ONBOARDING_LOOKUP_TIMEOUT_MS = 3500;
const PROFILE_LOOKUP_TIMEOUT_MS = 4500;

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [needsOnboarding, setNeedsOnboarding] = useState(false);
    const [profile, setProfile] = useState<AuthContextType["profile"]>(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const bootstrapDone = useRef(false);

    const loadProfile = useCallback(async (userId: string) => {
        try {
            const profileResp: any = await withTimeout(
                (supabase
                    .from('profiles')
                    .select('full_name, phone_number, phone_verified, avatar_url, created_at, saved_address, home_lat, home_long, location_city')
                    .eq('id', userId)
                    .maybeSingle()) as any,
                PROFILE_LOOKUP_TIMEOUT_MS,
                'Profile lookup timed out'
            );
            const { data, error } = profileResp ?? {};
            if (error) throw error;
            setProfile((data as any) ?? null);
        } catch {
            // keep last-known profile when this lookup is slow/unavailable
        } finally {
            setProfileLoading(false);
        }
    }, []);

    const clearBrokenLocalSession = useCallback(async () => {
        try {
            await supabase.auth.signOut({ scope: 'local' });
        } catch {
            // no-op: best-effort local cleanup
        }
        // Belt-and-suspenders: if signOut couldn't run (e.g. the internal
        // refresh promise already rejected), remove the persisted key so the
        // next launch doesn't repeat the failing refresh attempt.
        await purgeStoredSupabaseSession();
    }, []);

    const checkOnboarding = useCallback(async (userId: string): Promise<boolean> => {
        try {
            const profileResp: any = await withTimeout(
                (supabase
                    .from('profiles')
                    .select('onboarding_completed')
                    .eq('id', userId)
                    .maybeSingle()) as any,
                ONBOARDING_LOOKUP_TIMEOUT_MS,
                'Onboarding lookup timed out'
            );
            const { data, error } = profileResp ?? {};
            if (error || !data) return true; // needs onboarding
            return !data.onboarding_completed;
        } catch {
            // We used to return false here, which silently let users into the
            // app even if their profile wasn't actually set up — the home tab
            // would flash and onboarding would never run. Treat ambiguous
            // failures as "still needs onboarding" so the gate keeps them on
            // the onboarding flow until we successfully read their profile.
            return true;
        }
    }, []);

    const refreshProfile = useCallback(async () => {
        const userId = session?.user?.id;
        if (!userId) {
            setProfile(null);
            setProfileLoading(false);
            return;
        }
        setProfileLoading(true);
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('full_name, phone_number, phone_verified, avatar_url, created_at, saved_address, home_lat, home_long, location_city')
                .eq('id', userId)
                .maybeSingle();
            if (error) throw error;
            setProfile((data as any) ?? null);
        } catch {
            // keep last-known profile if refresh fails
        } finally {
            setProfileLoading(false);
        }
    }, [session?.user?.id]);

    useEffect(() => {
        let cancelled = false;

        // Hard safety timeout — guarantees loading=false no matter what
        const timeout = setTimeout(() => {
            if (!cancelled && !bootstrapDone.current) {
                console.warn('Auth init timed out, forcing ready');
                bootstrapDone.current = true;
                setLoading(false);
            }
        }, AUTH_TIMEOUT_MS);

        // 1. One-shot bootstrap via getSession
        (async () => {
            try {
                const { data, error } = await supabase.auth.getSession();
                if (cancelled) return;

                if (error) {
                    const msg = (error.message || '').toLowerCase();
                    const isInvalidRefresh =
                        msg.includes('invalid refresh token') ||
                        msg.includes('refresh token not found') ||
                        msg.includes('refresh_token_not_found');

                    if (isInvalidRefresh) {
                        await clearBrokenLocalSession();
                    } else {
                        console.warn('getSession error:', error.message);
                    }
                    setSession(null);
                    setNeedsOnboarding(false);
                } else {
                    const s = data?.session ?? null;
                    setSession(s);

                    if (s?.user?.id) {
                        const needs = await checkOnboarding(s.user.id);
                        if (!cancelled) setNeedsOnboarding(needs);
                        // Non-blocking profile sync
                        upsertProfileFromAuthUser(s.user).catch(() => {});
                        if (!cancelled) {
                            setProfileLoading(true);
                            await loadProfile(s.user.id);
                        }
                    } else {
                        setNeedsOnboarding(false);
                        setProfile(null);
                        setProfileLoading(false);
                    }
                }
            } catch (err) {
                console.warn('Bootstrap error:', err);
                if (!cancelled) {
                    setSession(null);
                    setNeedsOnboarding(false);
                }
            } finally {
                if (!cancelled) {
                    bootstrapDone.current = true;
                    setLoading(false);
                }
            }
        })();

        // 2. Listen for subsequent auth changes (login, logout, token refresh)
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, newSession) => {
            if (cancelled) return;

            // Skip INITIAL_SESSION — we handle that in the IIFE above
            if (event === 'INITIAL_SESSION') return;

            // Signed out: immediately clear everything
            if (event === 'SIGNED_OUT') {
                setSession(null);
                setNeedsOnboarding(false);
                setProfile(null);
                setProfileLoading(false);
                setLoading(false);
                return;
            }

            // supabase-js fires TOKEN_REFRESHED with a null session when the
            // stored refresh token is invalid. Treat that identically to a
            // local sign-out and purge the stored key so the next boot is
            // clean.
            if (event === 'TOKEN_REFRESHED' && !newSession) {
                await clearBrokenLocalSession();
                setSession(null);
                setNeedsOnboarding(false);
                setProfile(null);
                setProfileLoading(false);
                setLoading(false);
                return;
            }

            // Signed in / Token refreshed
            setSession(newSession);

            if (newSession?.user?.id) {
                try {
                    const needs = await checkOnboarding(newSession.user.id);
                    if (!cancelled) setNeedsOnboarding(needs);
                } catch {
                    if (!cancelled) setNeedsOnboarding(false);
                }
                // Non-blocking profile sync
                upsertProfileFromAuthUser(newSession.user).catch(() => {});
                if (!cancelled) {
                    setProfileLoading(true);
                    await loadProfile(newSession.user.id);
                }
            } else {
                setNeedsOnboarding(false);
                setProfile(null);
                setProfileLoading(false);
            }

            if (!cancelled) setLoading(false);
        });

        return () => {
            cancelled = true;
            clearTimeout(timeout);
            subscription.unsubscribe();
        };
    }, [checkOnboarding, clearBrokenLocalSession, loadProfile]);

    return (
        <AuthContext.Provider value={{ session, loading, needsOnboarding, setNeedsOnboarding, profile, profileLoading, refreshProfile }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
