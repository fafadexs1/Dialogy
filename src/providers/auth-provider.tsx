'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
    user: User | null;
    session: Session | null;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    session: null,
    isLoading: true,
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const pathname = usePathname();
    const lastPathRef = useRef(pathname);

    useEffect(() => {
        const supabase = createClient();
        let mounted = true;
        let initCompleted = false;

        // 1. Initial fetch - ONLY ONE CALL
        const initAuth = async () => {
            try {
                console.log('[AUTH_PROVIDER] Starting initAuth...');
                const { data: { user: initialUser }, error } = await supabase.auth.getUser();

                if (error) {
                    console.warn('[AUTH_PROVIDER] getUser returned error:', error.message);

                    // 🔧 CRITICAL FIX: If getUser fails but we're on a protected route,
                    // the server-side login set cookies that the client hasn't read yet.
                    // Force a getSession() call which will re-read the cookies.
                    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
                        console.log('[AUTH_PROVIDER] On protected route, trying getSession() as fallback...');
                        const { data: { session: fallbackSession } } = await supabase.auth.getSession();
                        if (fallbackSession?.user && mounted && !initCompleted) {
                            console.log('[AUTH_PROVIDER] getSession fallback found user:', fallbackSession.user.id);
                            setUser(fallbackSession.user);
                            setSession(fallbackSession);
                            initCompleted = true;
                            setIsLoading(false);
                            return;
                        }
                    }
                }

                if (mounted && !initCompleted) {
                    if (initialUser) {
                        console.log('[AUTH_PROVIDER] initAuth found user:', initialUser.id);
                        setUser(initialUser);
                        const { data: { session: currentSession } } = await supabase.auth.getSession();
                        setSession(currentSession);
                    } else {
                        console.log('[AUTH_PROVIDER] initAuth: No user found');
                    }
                }
            } catch (error) {
                console.error('[AUTH_PROVIDER] Error initializing auth:', error);
            } finally {
                if (mounted) {
                    initCompleted = true;
                    setIsLoading(false);
                    console.log('[AUTH_PROVIDER] initAuth completed, isLoading = false');
                }
            }
        };

        initAuth();

        // 2. Listen for changes - This may fire before or after initAuth
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, newSession) => {
            console.log('[AUTH_PROVIDER] Auth state change:', event, newSession?.user?.id);
            if (mounted) {
                // If we get a valid session from onAuthStateChange, use it immediately
                // This handles the case where the redirect sets cookies and the listener fires
                setSession(newSession);
                setUser(newSession?.user ?? null);
                // Only set loading to false if we have a definitive state
                if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || !initCompleted) {
                    setIsLoading(false);
                    initCompleted = true;
                }
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    // 🔧 CRITICAL FIX: Detect route changes from /login to protected routes
    // When server action login redirects, the AuthProvider doesn't remount
    // So we need to manually check for session on route change
    const hasCheckedAfterLoginRef = useRef(false);

    useEffect(() => {
        const wasOnLogin = lastPathRef.current?.startsWith('/login');
        const isNowProtected = pathname && !pathname.startsWith('/login');
        lastPathRef.current = pathname;

        // If we just navigated FROM login TO a protected route AND we don't have a user
        // AND we haven't already checked (prevent duplicate calls)
        if (wasOnLogin && isNowProtected && !user && !isLoading && !hasCheckedAfterLoginRef.current) {
            hasCheckedAfterLoginRef.current = true; // Mark as checked
            console.log('[AUTH_PROVIDER] Route changed from /login to protected route, re-checking session...');
            const supabase = createClient();

            // Force a session refresh
            supabase.auth.getSession().then(({ data: { session: newSession } }) => {
                if (newSession?.user) {
                    console.log('[AUTH_PROVIDER] Route change found session:', newSession.user.id);
                    setUser(newSession.user);
                    setSession(newSession);
                } else {
                    console.log('[AUTH_PROVIDER] Route change: still no session, may need page refresh');
                }
            });
        }

        // Reset the flag if we're back on login (for next login cycle)
        if (pathname?.startsWith('/login')) {
            hasCheckedAfterLoginRef.current = false;
        }
    }, [pathname, user, isLoading]);

    const contextValue = React.useMemo(() => ({
        user,
        session,
        isLoading
    }), [user, session, isLoading]);

    return (
        <AuthContext.Provider value={contextValue}>
            {children}
        </AuthContext.Provider>
    );
}
