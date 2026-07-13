'use client';

import { motion } from 'framer-motion';
import { ArrowRight, BellRing, Radio, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getUnreadProductUpdateAnnouncementAction,
  markProductUpdateReadAction,
} from '@/actions/product-updates';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import {
  PRODUCT_UPDATES_REALTIME_TOPIC,
  type ProductUpdateAccent,
  type ProductUpdateAnnouncement,
} from '@/lib/product-updates';
import {
  isProductUpdatesLocalPreviewHostname,
  LEGACY_LOCAL_PRODUCT_UPDATE_READ_KEY,
  productUpdateReadReceiptKey,
} from '@/lib/product-update-announcement-receipt';
import { LOCAL_PRODUCT_UPDATE_DEMO_ID, localProductUpdateAnnouncement } from '@/lib/product-updates-demo';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

const accentStyles: Record<ProductUpdateAccent, { gradient: string; glow: string; badge: string }> = {
  emerald: { gradient: 'from-emerald-500 via-teal-500 to-cyan-500', glow: 'bg-emerald-400/30', badge: 'bg-emerald-400/15 text-emerald-100' },
  blue: { gradient: 'from-blue-600 via-cyan-500 to-sky-400', glow: 'bg-blue-400/30', badge: 'bg-blue-400/15 text-blue-100' },
  violet: { gradient: 'from-violet-600 via-fuchsia-500 to-pink-500', glow: 'bg-violet-400/30', badge: 'bg-violet-400/15 text-violet-100' },
  amber: { gradient: 'from-amber-500 via-orange-500 to-rose-500', glow: 'bg-amber-400/30', badge: 'bg-amber-400/15 text-amber-50' },
  rose: { gradient: 'from-rose-600 via-pink-500 to-violet-500', glow: 'bg-rose-400/30', badge: 'bg-rose-400/15 text-rose-100' },
};

export function ProductUpdateAnnouncementModal() {
  const [announcement, setAnnouncement] = useState<ProductUpdateAnnouncement | null>(null);
  const [open, setOpen] = useState(false);
  const loadedForUserRef = useRef<string | null>(null);
  const { user, session, isLoading } = useAuth();
  const router = useRouter();

  const refreshAnnouncement = useCallback(async (userId: string) => {
    const isLocalhost = typeof window !== 'undefined'
      && isProductUpdatesLocalPreviewHostname(window.location.hostname);
    if (isLocalhost) {
      const receiptKey = productUpdateReadReceiptKey(userId, LOCAL_PRODUCT_UPDATE_DEMO_ID);
      if (
        localStorage.getItem(LEGACY_LOCAL_PRODUCT_UPDATE_READ_KEY) !== '1'
        && localStorage.getItem(receiptKey) !== '1'
      ) {
        setAnnouncement(localProductUpdateAnnouncement);
        setOpen(true);
      }
      return;
    }
    if (process.env.NEXT_PUBLIC_PRODUCT_UPDATES_ENABLED !== 'true') return;
    const next = await getUnreadProductUpdateAnnouncementAction();
    if (!next) return;
    const receiptKey = productUpdateReadReceiptKey(userId, next.id);
    if (localStorage.getItem(receiptKey) === '1') {
      await markProductUpdateReadAction(next.id);
      return;
    }
    setAnnouncement(next);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (isLoading || !user?.id || loadedForUserRef.current === user.id) return;
    loadedForUserRef.current = user.id;
    void refreshAnnouncement(user.id);
  }, [isLoading, refreshAnnouncement, user?.id]);

  useEffect(() => {
    if (isProductUpdatesLocalPreviewHostname(window.location.hostname)) return;
    if (process.env.NEXT_PUBLIC_PRODUCT_UPDATES_ENABLED !== 'true') return;
    const accessToken = session?.access_token;
    const userId = user?.id;
    if (!accessToken || !userId) return;
    const supabase = createClient();
    supabase.realtime.setAuth(accessToken);
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const handlePublication = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refreshAnnouncement(userId), 350);
    };

    const channel = supabase
      .channel(PRODUCT_UPDATES_REALTIME_TOPIC, { config: { private: true } })
      .on('broadcast', { event: 'INSERT' }, handlePublication)
      .on('broadcast', { event: 'UPDATE' }, handlePublication)
      .subscribe((status, error) => {
        if (error) console.error('[PRODUCT_UPDATES] Announcement subscription error:', error);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') void refreshAnnouncement(userId);
      });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [refreshAnnouncement, session?.access_token, user?.id]);

  const dismiss = useCallback(async () => {
    const current = announcement;
    setOpen(false);
    setAnnouncement(null);
    if (!current || !user?.id) return;

    localStorage.setItem(productUpdateReadReceiptKey(user.id, current.id), '1');
    if (isProductUpdatesLocalPreviewHostname(window.location.hostname)) {
      localStorage.setItem(LEGACY_LOCAL_PRODUCT_UPDATE_READ_KEY, '1');
    } else {
      await markProductUpdateReadAction(current.id);
    }
  }, [announcement, user?.id]);

  const readUpdate = async () => {
    if (!announcement) return;
    const slug = announcement.slug;
    await dismiss();
    router.push(`/comunidade#${encodeURIComponent(slug)}`);
  };

  if (!announcement) return null;
  const styles = accentStyles[announcement.accentColor];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) void dismiss(); else setOpen(true); }}>
      <DialogContent className="overflow-hidden border-0 bg-transparent p-0 shadow-[0_35px_100px_-20px_rgba(0,0,0,0.75)] sm:max-w-xl sm:rounded-[30px] [&>button]:right-5 [&>button]:top-5 [&>button]:z-20 [&>button]:rounded-full [&>button]:bg-black/20 [&>button]:p-2 [&>button]:text-white [&>button]:opacity-100 [&>button]:backdrop-blur hover:[&>button]:bg-black/35">
        <div className={cn('relative isolate overflow-hidden bg-gradient-to-br px-6 pb-7 pt-8 text-white sm:px-8 sm:pb-8', styles.gradient)}>
          <div className={cn('pointer-events-none absolute -right-16 -top-20 -z-10 h-64 w-64 rounded-full blur-3xl', styles.glow)} />
          <div className="pointer-events-none absolute inset-0 -z-10 opacity-15 [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:18px_18px]" />

          <motion.div
            initial={{ scale: 0.75, rotate: -10, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-white/15 shadow-xl backdrop-blur"
          >
            <BellRing className="h-6 w-6" />
          </motion.div>

          <DialogHeader className="relative space-y-3 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] backdrop-blur', styles.badge)}>
                <Sparkles className="h-3 w-3" /> {announcement.category}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">
                <Radio className="h-3 w-3 animate-pulse" /> Acabou de chegar
              </span>
            </div>
            <DialogTitle className="max-w-md text-3xl font-black leading-[1.08] tracking-[-0.035em] sm:text-4xl">
              {announcement.title}
            </DialogTitle>
            <DialogDescription className="max-w-lg text-[15px] leading-7 text-white/80 sm:text-base">
              {announcement.excerpt}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              onClick={() => void readUpdate()}
              className="h-12 flex-1 rounded-2xl bg-white font-bold text-slate-950 shadow-lg hover:bg-white/90"
            >
              Ver novidade e participar
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void dismiss()}
              className="h-12 rounded-2xl border border-white/15 bg-black/10 px-5 font-semibold text-white hover:bg-black/20 hover:text-white"
            >
              Agora não
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
