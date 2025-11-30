
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User } from '@/lib/types';

interface SettingsContextType {
  user: User | null;
  loading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

import { useCurrentUser } from '@/hooks/use-online-status';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const loading = user === undefined; // or handle loading state if needed, but useCurrentUser returns null if not found or user object. 
  // Actually useCurrentUser returns User | null. 
  // If we want a loading state, we might need to check if PresenceContext is loading, but currently it doesn't expose loading.
  // However, the original code had a loading state. 
  // Let's assume if user is null, it might be loading or not logged in.
  // But for now, let's just pass user. 

  // The original code set loading to false after fetch.
  // We can simulate loading if we want, or just pass false if we assume user is already loaded by the time we get here (since it's in a provider inside MainAppLayout usually).
  // But SettingsProvider might be used elsewhere?
  // Let's check where it is used.

  // If I look at `src/hooks/use-online-status.tsx`, `useCurrentUser` just returns `context.currentUser`.
  // `currentUser` is initialized as `null` or `initialUser`.

  // Let's just use `user` and set `loading` to false for now, as `PresenceProvider` handles the fetching.

  return (
    <SettingsContext.Provider value={{ user, loading: false }}>
      {children}
    </SettingsContext.Provider>
  );
}



export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
