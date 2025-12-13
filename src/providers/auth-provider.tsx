'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
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

    useEffect(() => {
        const supabase = createClient();
        let mounted = true;

        // 1. Initial fetch - ONLY ONE CALL
        const initAuth = async () => {
            try {
                // Strictly following user requirement:
                // "No carregamento inicial do app, execute exatamente uma chamada: const { data: { user } } = await supabase.auth.getUser();"
                const { data: { user: initialUser }, error } = await supabase.auth.getUser();

                if (mounted) {
                    if (initialUser) {
                        setUser(initialUser);
                        // We also need the session for the context. 
                        // getUser() validates the token, so getSession() should return the cached session immediately without network request.
                        const { data: { session: currentSession } } = await supabase.auth.getSession();
                        setSession(currentSession);
                    }
                }
            } catch (error) {
                console.error('[AUTH_PROVIDER] Error initializing auth:', error);
            } finally {
                if (mounted) setIsLoading(false);
            }
        };

        initAuth();

        // 2. Listen for changes - NO NEW CALLS, just updates
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, newSession) => {
            // console.log('[AUTH_PROVIDER] Auth state change:', event);
            if (mounted) {
                setSession(newSession);
                setUser(newSession?.user ?? null);
                setIsLoading(false);
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

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
