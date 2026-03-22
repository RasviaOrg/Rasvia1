import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { upsertProfileFromAuthUser } from './profile-sync';

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

const AUTH_TIMEOUT_MS = 6000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [needsOnboarding, setNeedsOnboarding] = useState(false);
    const initialised = useRef(false);

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
            if (!cancelled && loading) {
                console.warn('Auth initialisation timed out – unblocking UI');
                setLoading(false);
            }
        }, AUTH_TIMEOUT_MS);

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, newSession) => {
            if (cancelled) return;

            setSession(newSession);

            if (newSession?.user?.id) {
                try {
                    await upsertProfileFromAuthUser(newSession.user);
                } catch (error: any) {
                    console.log('Profile sync skipped:', error?.message ?? 'unknown');
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
