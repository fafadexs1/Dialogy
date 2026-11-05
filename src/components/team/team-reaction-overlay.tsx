'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Volume2, VolumeX, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/providers/auth-provider';
import { useCurrentUser } from '@/hooks/use-online-status';
import { REACTIONS, isReactionKind, reactionTopic, type TeamReaction } from '@/lib/team-reactions/catalog';

import { isSafeGifUrl, gifPlaybackUrl } from '@/lib/team-reactions/gifs';
import { keepTeamReactionVisible } from '@/actions/team-reactions';
import { playReactionSound } from '@/lib/team-reactions/sound';

import { saveReactionSoundPreference } from '@/actions/reaction-sound-preference';
import { notifyReactionSoundPreference } from '@/lib/team-reactions/preferences';
import { useTeamReactionPreferences } from '@/hooks/use-team-reaction-preferences';
export function TeamReactionOverlay() {
  const user = useCurrentUser();
  const { session } = useAuth();
  const reduced = useReducedMotion();
  const [reaction, setReaction] = useState<TeamReaction | null>(null);
  const { enabled, muted } = useTeamReactionPreferences(user?.id);
  const enabledRef = useRef(false);
  enabledRef.current = enabled;
  const [soundBlocked, setSoundBlocked] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const mutedRef = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
    if (!enabled) {
      visibleRef.current = false;
      setReaction(null);
      if (timer.current) clearTimeout(timer.current);
      if (audio.current?.state === 'running') void audio.current.suspend().catch(() => undefined);
    }
  }, [enabled, muted]);
  useEffect(() => {
    if (!enabled) return;
    const unlock = () => {
      try {
        if (!audio.current && typeof AudioContext !== 'undefined') audio.current = new AudioContext();
        if (audio.current?.state === 'suspended') void audio.current.resume().catch(() => undefined);
      } catch { /* Audio is optional when unavailable. */ }
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => { document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); if (audio.current) void audio.current.close(); audio.current = null; };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !user?.id || !user.activeWorkspaceId || !session?.access_token) return;
    const client = createClient(); client.realtime.setAuth(session.access_token);
    const channel = client.channel(reactionTopic(user.id), { config: { private: true } })
      .on('broadcast', { event: 'team_reaction' }, ({ payload }) => {
        if (!enabledRef.current || visibleRef.current) return;
        if (!payload || payload.workspaceId !== user.activeWorkspaceId || typeof payload.id !== 'string' || typeof payload.senderName !== 'string') return;
        if (payload.kind === 'gif') {
          if (!payload.gif || !isSafeGifUrl(payload.gif.url) || typeof payload.gif.name !== 'string' || !(payload.gif.sound === 'none' || isReactionKind(payload.gif.sound))) return;
        } else if (!isReactionKind(payload.kind)) return;
        const gif = payload.kind === 'gif' ? {url:payload.gif.url,name:payload.gif.name.slice(0,60),sound:payload.gif.sound} : undefined;
        visibleRef.current = true;
        setReaction({ id: payload.id, kind: payload.kind, senderName: payload.senderName.slice(0,80), workspaceId: payload.workspaceId, gif, message: typeof payload.message === 'string' ? payload.message.slice(0,140) : undefined });
        const sound = gif ? gif.sound : payload.kind;
        setSoundBlocked(false);
        if (!mutedRef.current && isReactionKind(sound)) {
          if (audio.current?.state === 'running') { try { playReactionSound(audio.current, sound); } catch { setSoundBlocked(true); } }
          else { setSoundBlocked(true); }
        }
        if (timer.current) clearTimeout(timer.current);
        if (payload.kind !== 'gif') timer.current = setTimeout(() => { visibleRef.current=false; setReaction(null); }, 5500);
      }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [enabled, user?.id, user?.activeWorkspaceId, session?.access_token]);
  useEffect(() => {
    visibleRef.current=false; setReaction(null);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [user?.id, user?.activeWorkspaceId]);
  useEffect(() => {
    if (!reaction || reaction.kind !== 'gif') return;
    const renew = () => { void keepTeamReactionVisible(reaction.id).catch(() => undefined); };
    renew();
    const interval = setInterval(renew, 3000);
    return () => clearInterval(interval);
  }, [reaction]);
  const toggleSound = useCallback(async () => { const next = !mutedRef.current; try { await saveReactionSoundPreference(next); mutedRef.current=next; notifyReactionSoundPreference(next); } catch { /* Keep the existing preference when saving fails. */ } }, []);
  const playBlockedSound = useCallback(async () => {
    if (!enabledRef.current) return;
    const sound = reaction?.kind === 'gif' ? reaction.gif?.sound : reaction?.kind;
    if (!isReactionKind(sound)) return;
    try {
      if (!audio.current && typeof AudioContext !== 'undefined') audio.current = new AudioContext();
      if (!audio.current) return;
      if (audio.current.state === 'suspended') await audio.current.resume();
      playReactionSound(audio.current, sound); setSoundBlocked(false);
    } catch { setSoundBlocked(true); }
  }, [reaction]);
  if (!enabled) return null;
  return <AnimatePresence>{enabled && reaction && <motion.div key={reaction.id} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center p-4" aria-live="polite">
    <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-[2px]" />
    <motion.div initial={reduced ? {opacity:0} : {opacity:0,scale:.65,rotate:-8,y:35}} animate={reduced ? {opacity:1} : {opacity:1,scale:1,rotate:0,y:0}} exit={{opacity:0,scale:.9}} transition={{type:'spring',bounce:.5,duration:.65}} className={`pointer-events-auto relative w-full ${reaction.kind === 'gif' ? 'max-w-[calc(45vw+3.5rem)] max-h-[90vh] overflow-y-auto' : 'max-w-sm overflow-hidden'} rounded-[2rem] border border-white/80 bg-white p-7 text-center text-slate-900 shadow-[0_24px_100px_rgba(12,70,54,.3)] dark:border-white/10 dark:bg-zinc-900 dark:text-white`}>
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-emerald-100 via-lime-50 to-amber-100 dark:from-emerald-900/40 dark:via-zinc-900 dark:to-amber-900/30" />
      <div className="absolute right-4 top-4 z-10 flex gap-1"><button type="button" onClick={() => void toggleSound()} aria-label={muted?'Ativar som das brincadeiras':'Silenciar brincadeiras'} className="rounded-full bg-white/80 p-2 text-slate-500 dark:bg-zinc-800 dark:text-zinc-300">{muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button><button type="button" onClick={()=>{visibleRef.current=false;setReaction(null);}} aria-label="Fechar brincadeira" className="rounded-full bg-white/80 p-2 text-slate-500 dark:bg-zinc-800 dark:text-zinc-300"><X size={16}/></button></div>
      {!reduced && <div className="pointer-events-none absolute inset-x-0 top-12 h-36 overflow-hidden" aria-hidden="true">{[-1, -0.55, 0, 0.55, 1].map((offset, index) => <motion.span key={offset} initial={{opacity:0,x:0,y:58,scale:.3}} animate={{opacity:[0,1,0],x:offset * 135,y:-35-Math.abs(offset)*20,scale:[.3,1.1,.7],rotate:offset*70}} transition={{duration:1.5,delay:index*.07,repeat:2,repeatDelay:.4}} className="absolute left-1/2 text-2xl">{reaction.kind === 'pum' ? '💨' : reaction.kind === 'party' ? '✨' : reaction.kind === 'applause' ? '👏' : '☕'}</motion.span>)}</div>}
      <motion.div aria-hidden="true" animate={reduced?{}:{rotate:[-12,12,-8,8,0],scale:[.8,1.25,1,1.15,1]}} transition={{duration:1.2}} className={`relative mx-auto mt-6 flex items-center justify-center rounded-[2rem] bg-white text-7xl shadow-xl shadow-emerald-900/10 dark:bg-zinc-800 ${reaction.kind === 'gif' ? 'h-[45vh] max-h-[45vh] w-full' : 'h-[157px] w-[157px]'}`}>{reaction.kind === 'gif' ? (reduced ? '🎞️' : <img src={reaction.gif ? gifPlaybackUrl(reaction.gif.url,reaction.id) : ''} alt="" referrerPolicy="no-referrer" onError={event => { if (reaction.gif && !event.currentTarget.dataset.fallback) { event.currentTarget.dataset.fallback='true'; event.currentTarget.src = reaction.gif.url; } }} className="h-full w-full rounded-[2rem] object-contain" />) : REACTIONS[reaction.kind].emoji}</motion.div>
      <p className="relative mt-7 text-[10px] font-bold uppercase tracking-[.22em] text-emerald-600">Uma surpresa para você</p><h2 className="mt-2 text-3xl font-black tracking-tight">{reaction.kind === 'gif' ? reaction.gif?.name : REACTIONS[reaction.kind].title}</h2><p className="mt-2 text-sm text-slate-500 dark:text-zinc-400"><strong className="text-slate-700 dark:text-zinc-200">{reaction.senderName}</strong> mandou essa para você ✨</p>{reaction.kind === 'gif' && <p className="mt-2 text-xs text-slate-400">O GIF fica aberto até você fechar.</p>}{soundBlocked && !muted && <button type="button" onClick={() => void playBlockedSound()} className="mt-4 rounded-full bg-emerald-100 px-4 py-2 text-xs font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100">🔊 Ativar e ouvir o som</button>}{reaction.message && <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">{reaction.message}</p>}
    </motion.div></motion.div>}</AnimatePresence>;
}
