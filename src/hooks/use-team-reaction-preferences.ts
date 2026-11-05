'use client';
import { useEffect, useState } from 'react';
import { getTeamReactionPreference } from '@/actions/reaction-sound-preference';
import { REACTION_PREFERENCE_EVENT, REACTION_SOUND_EVENT, reactionPreferenceKey, type TeamReactionPreference } from '@/lib/team-reactions/preferences';

export function useTeamReactionPreferences(userId?: string) {
  const [preference, setPreference] = useState<TeamReactionPreference | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setPreference(null);
    setError('');
    if (!userId) return;
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const request = ++revision;
      try {
        const result = await getTeamReactionPreference();
        if (active && request === revision && result.userId === userId) { setPreference(result); setError(''); }
      } catch {
        if (active && request === revision) { setPreference(null); setError('Não foi possível carregar esta preferência.'); }
      }
    };
    const sync = (event: Event) => {
      const value = (event as CustomEvent<TeamReactionPreference>).detail;
      if (value?.userId !== userId) return;
      revision++;
      setPreference(value);
      setError('');
    };
    const storage = (event: StorageEvent) => { if (event.key === reactionPreferenceKey(userId)) void refresh(); };
    const visibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    window.addEventListener(REACTION_PREFERENCE_EVENT, sync);
    window.addEventListener(REACTION_SOUND_EVENT, refresh);
    window.addEventListener('storage', storage);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      window.removeEventListener(REACTION_PREFERENCE_EVENT, sync);
      window.removeEventListener(REACTION_SOUND_EVENT, refresh);
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [userId]);
  const current = preference?.userId === userId ? preference : null;
  return { enabled: current?.enabled === true, muted: current?.muted !== false, ready: !!current, error };
}
