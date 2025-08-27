
'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import type { User } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { type User as SupabaseUser } from '@supabase/supabase-js';

// A new context to provide the user object throughout the client components
const AuthContext = createContext<User | null>(null);

export function useAuth(): User | null {
  return useContext(AuthContext);
}

export const AuthProvider = ({ user, children }: { user: User | null, children: React.ReactNode }) => {
    return (
        <AuthContext.Provider value={user}>
            {children}
        </AuthContext.Provider>
    )
}
