import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { upsertProfileFromAuthUser } from './profile-sync';
import * as SecureStore from 'expo-secure-store';

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

const AUTH_TIMEOUT_MS = 3000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [needsOnboarding, setNeedsOnboarding] = useState(false);
    const initialised = useRef(false);
    const loadingRef = useRef(true);
    /** Prevents the listener and the IIFE from both processing the initial session. */
    const bootstrapResolved = useRef(false);

    useEffect(() => {
        loadingRef.current = loading;
    }, [loading]);

    async function checkOnboardingStatus(userId: string) {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('onboarding_completed')
                .eq('id', userId)
                .maybeSingle();

            if (error) {
                console.log('Profiles check skipped:', error.message);
                setNeedsOnboarding(false);
                return;
            }

            if (!data) {
                setNeedsOnboarding(true);
                return;
            }

            setNeedsOnboarding(!data.onboarding_completed);
        } catch {
            setNeedsOnboarding(false);
        }
    }

    useEffect(() => {
        let cancelled = false;

        const safetyTimeout = setTimeout(() => {
            if (!cancelled && loadingRef.current) {
                console.warn('Auth initialisation timed out – unblocking UI');
                setLoading(false);
            }
        }, AUTH_TIMEOUT_MS);

        // ── Handle invalid refresh token errors on listener errors ──
        const handleInvalidToken = async (err: any) => {
            const msg: string = err?.message ?? '';
            if (
                msg.toLowerCase().includes('refresh token') ||
                msg.toLowerCase().includes('invalid_grant')
            ) {
                await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
                if (!cancelled) {
                    setSession(null);
                    setNeedsOnboarding(false);
                    initialised.current = true;
                    setLoading(false);
                }
            }
        };

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, newSession) => {
            if (cancelled) return;

            // If Supabase fires SIGNED_OUT due to token errors, just clear state
            if (event === 'SIGNED_OUT' && !newSession) {
                setSession(null);
                setNeedsOnboarding(false);
                if (!cancelled) {
                    initialised.current = true;
                    setLoading(false);
                }
                return;
            }

            // Skip duplicated INITIAL_SESSION events — the IIFE handles bootstrap
            if ((event === 'INITIAL_SESSION' || (event === 'SIGNED_IN' && !initialised.current)) && bootstrapResolved.current) {
                return;
            }

            setSession(newSession);

            if (newSession?.user?.id) {
                // Profile sync is non-blocking during initial bootstrap to avoid stalls
                if (!initialised.current) {
                    upsertProfileFromAuthUser(newSession.user).catch((e: any) => {
                        console.log('Profile sync skipped:', e?.message ?? 'unknown');
                    });
                } else {
                    try {
                        await upsertProfileFromAuthUser(newSession.user);
                    } catch (error: any) {
                        await handleInvalidToken(error);
                        if (!newSession) return;
                        console.log('Profile sync skipped:', error?.message ?? 'unknown');
                    }
                }

                if (event === 'SIGNED_IN' && initialised.current) {
                    // Give Postgres trigger updates a brief window to settle.
                    setLoading(true);
                    await new Promise(r => setTimeout(r, 250));
                }
                if (!cancelled) await checkOnboardingStatus(newSession.user.id);
            } else {
                setNeedsOnboarding(false);
            }

            if (!cancelled) {
                initialised.current = true;
                setLoading(false);
            }
        });

        // Deterministic bootstrap: always resolve initial session state on mount
        // instead of relying purely on INITIAL_SESSION auth event delivery timing.
        (async () => {
            try {
                const { data, error } = await supabase.auth.getSession();
                if (error) {
                    await handleInvalidToken(error);
                    return;
                }

                if (cancelled) return;
                const initialSession = data?.session ?? null;
                setSession(initialSession);

                if (initialSession?.user?.id) {
                    // Non-blocking profile sync during bootstrap — don't let it stall loading
                    upsertProfileFromAuthUser(initialSession.user).catch((profileErr: any) => {
                        handleInvalidToken(profileErr);
                    });
                    if (!cancelled) {
                        await checkOnboardingStatus(initialSession.user.id);
                    }
                } else {
                    setNeedsOnboarding(false);
                }
            } catch (err) {
                await handleInvalidToken(err);
            } finally {
                if (!cancelled) {
                    bootstrapResolved.current = true;
                    initialised.current = true;
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
            clearTimeout(safetyTimeout);
            subscription.unsubscribe();
        };
    }, []);

    return (
        <AuthContext.Provider value={{ session, loading, needsOnboarding, setNeedsOnboarding }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
