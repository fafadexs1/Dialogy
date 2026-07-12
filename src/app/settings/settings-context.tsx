
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User } from '@/lib/types';
import { useCurrentUser } from '@/hooks/use-online-status';

interface SettingsContextType {
  user: User | null;
  loading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <SettingsContext.Provider value={{ user, loading: !mounted }}>
      {children}
    </SettingsContext.Provider>
  );
}



export function useSettings() {
  const context = useContext(SettingsContext);
  const currentUser = useCurrentUser();
  return context ?? { user: currentUser, loading: currentUser === null };
}
