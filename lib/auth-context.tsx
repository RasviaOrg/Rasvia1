import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { upsertProfileFromAuthUser } from './profile-sync';
import { withTimeout } from './with-timeout';

interface AuthContextType {
    session: Session | null;
    loading: boolean;
    needsOnboarding: boolean;
    setNeedsOnboarding: (val: boolean) => void;
}

const AuthContext = createContext<AuthContextType>({
    session: null,
    loading: true,
    needsOnboarding: false,
    setNeedsOnboarding: () => { },
});

const AUTH_TIMEOUT_MS = 8000;
const ONBOARDING_LOOKUP_TIMEOUT_MS = 3500;

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [needsOnboarding, setNeedsOnboarding] = useState(false);
    const bootstrapDone = useRef(false);

    const clearBrokenLocalSession = useCallback(async () => {
        try {
            await supabase.auth.signOut({ scope: 'local' });
        } catch {
            // no-op: best-effort local cleanup
        }
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
            return false;
        }
    }, []);

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
                    } else {
                        setNeedsOnboarding(false);
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
            } else {
                setNeedsOnboarding(false);
            }

            if (!cancelled) setLoading(false);
        });

        return () => {
            cancelled = true;
            clearTimeout(timeout);
            subscription.unsubscribe();
        };
    }, [checkOnboarding, clearBrokenLocalSession]);

    return (
        <AuthContext.Provider value={{ session, loading, needsOnboarding, setNeedsOnboarding }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
