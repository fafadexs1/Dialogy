'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  BarChart3,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  Loader2,
  ImageIcon,
  Link2,
  MessageCircle,
  Newspaper,
  Radio,
  Rocket,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Video,
  UsersRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import {
  addProductUpdateCommentAction,
  deleteProductUpdateCommentAction,
  getProductUpdateCommentsAction,
  reactToProductUpdateAction,
  voteProductUpdatePollAction,
} from '@/actions/product-updates';
import {
  addCommunityPostCommentAction,
  createCommunityPostAction,
  deleteCommunityPostAction,
  deleteCommunityPostCommentAction,
  getCommunityPostCommentsAction,
  reactCommunityPostAction,
} from '@/actions/community';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import {
  PRODUCT_UPDATES_COMMUNITY_TOPIC,
  type ProductUpdateAccent,
  type ProductUpdateComment,
  type ProductUpdateContentBlock,
  type ProductUpdateFeedItem,
  type ProductUpdatePoll,
  type ProductUpdateReaction,
} from '@/lib/product-updates';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

const accentStyles: Record<ProductUpdateAccent, {
  badge: string;
  icon: string;
  glow: string;
  cover: string;
}> = {
  emerald: {
    badge: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    glow: 'from-emerald-500/20 via-cyan-500/5 to-transparent',
    cover: 'from-emerald-500 via-teal-500 to-cyan-500',
  },
  blue: {
    badge: 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    icon: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
    glow: 'from-blue-500/20 via-cyan-500/5 to-transparent',
    cover: 'from-blue-600 via-cyan-500 to-sky-400',
  },
  violet: {
    badge: 'border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    icon: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
    glow: 'from-violet-500/20 via-fuchsia-500/5 to-transparent',
    cover: 'from-violet-600 via-fuchsia-500 to-pink-500',
  },
  amber: {
    badge: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    glow: 'from-amber-500/20 via-orange-500/5 to-transparent',
    cover: 'from-amber-500 via-orange-500 to-rose-500',
  },
  rose: {
    badge: 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    icon: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    glow: 'from-rose-500/20 via-pink-500/5 to-transparent',
    cover: 'from-rose-600 via-pink-500 to-violet-500',
  },
};

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value));
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function RichContent({ blocks, fallback }: { blocks: ProductUpdateContentBlock[]; fallback: string }) {
  if (!blocks.length) {
    return (
      <div className="space-y-4 text-[15px] leading-7 text-slate-600 dark:text-zinc-400">
        {fallback.split(/\n{2,}/).map((paragraph, index) => <p key={index} className="whitespace-pre-line">{paragraph}</p>)}
      </div>
    );
  }

  return (
    <div className="space-y-6 text-[15px] leading-7 text-slate-600 dark:text-zinc-400">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const className = block.level === 3
            ? 'pt-2 text-xl font-black tracking-tight text-slate-950 dark:text-white'
            : 'pt-3 text-2xl font-black tracking-[-0.025em] text-slate-950 dark:text-white sm:text-3xl';
          return block.level === 3
            ? <h3 key={index} className={className}>{block.text}</h3>
            : <h2 key={index} className={className}>{block.text}</h2>;
        }
        if (block.type === 'paragraph') return <p key={index} className="whitespace-pre-line">{block.text}</p>;
        if (block.type === 'divider') return <div key={index} className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent dark:via-white/10" />;
        if (block.type === 'quote') {
          return (
            <blockquote key={index} className="relative overflow-hidden rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.06] px-5 py-5 text-lg font-semibold leading-8 text-slate-800 dark:text-zinc-100 sm:px-7">
              <div className="absolute bottom-0 left-0 top-0 w-1 bg-gradient-to-b from-emerald-400 to-cyan-500" />
              “{block.text}”
              {block.attribution ? <footer className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">— {block.attribution}</footer> : null}
            </blockquote>
          );
        }
        if (block.type === 'image') {
          return (
            <figure key={index} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/[0.03]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={block.url} alt={block.alt} loading="lazy" className="max-h-[560px] w-full object-cover" />
              {block.caption ? <figcaption className="px-4 py-3 text-center text-xs text-slate-500 dark:text-zinc-500">{block.caption}</figcaption> : null}
            </figure>
          );
        }
        if (block.type === 'video') {
          const isEmbed = /(?:youtube\.com\/embed|player\.vimeo\.com)/i.test(block.url);
          return (
            <figure key={index} className="overflow-hidden rounded-2xl border border-slate-200 bg-black dark:border-white/10">
              {isEmbed ? (
                <iframe
                  src={block.url}
                  title={block.caption || 'Vídeo da publicação'}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="aspect-video w-full"
                />
              ) : (
                <video src={block.url} poster={block.poster} controls preload="metadata" className="aspect-video w-full object-contain" />
              )}
              {block.caption ? <figcaption className="bg-white px-4 py-3 text-center text-xs text-slate-500 dark:bg-[#101216] dark:text-zinc-500">{block.caption}</figcaption> : null}
            </figure>
          );
        }
        return null;
      })}
    </div>
  );
}

function PollCard({ poll, voting, onVote }: { poll: ProductUpdatePoll; voting: boolean; onVote: (optionId: string) => void }) {
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.08] via-white to-blue-500/[0.05] p-5 dark:via-[#12141a] sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">Enquete da comunidade</span>
          <h3 className="mt-1 text-lg font-black text-slate-950 dark:text-white sm:text-xl">{poll.question}</h3>
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        {poll.options.map((option) => {
          const selected = poll.selectedOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={!poll.isActive || voting}
              onClick={() => onVote(option.id)}
              className={cn(
                'relative flex w-full items-center justify-between overflow-hidden rounded-xl border px-4 py-3 text-left text-sm font-semibold transition active:scale-[0.995]',
                selected
                  ? 'border-violet-500/30 bg-violet-500/10 text-violet-800 dark:text-violet-200'
                  : 'border-slate-200 bg-white/80 text-slate-700 hover:border-violet-400/30 dark:border-white/10 dark:bg-white/[0.035] dark:text-zinc-300'
              )}
            >
              <span className="absolute inset-y-0 left-0 bg-violet-500/[0.08] transition-all" style={{ width: `${option.percentage}%` }} />
              <span className="relative flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full border-2', selected ? 'border-violet-500 bg-violet-500' : 'border-slate-300 dark:border-zinc-600')} />
                {option.label}
              </span>
              <span className="relative tabular-nums text-xs text-slate-500 dark:text-zinc-400">{option.percentage}%</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-500">
        <span>{poll.totalVotes} {poll.totalVotes === 1 ? 'voto' : 'votos'}</span>
        <span>{voting ? 'Registrando voto...' : poll.selectedOptionId ? 'Você pode alterar seu voto' : 'Escolha uma opção'}</span>
      </div>
    </section>
  );
}

function CommentPanel({
  update,
  comments,
  loading,
  sending,
  onSubmit,
  onDelete,
}: {
  update: ProductUpdateFeedItem;
  comments: ProductUpdateComment[];
  loading: boolean;
  sending: boolean;
  onSubmit: (content: string) => Promise<boolean>;
  onDelete: (comment: ProductUpdateComment) => Promise<void>;
}) {
  const [content, setContent] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim()) return;
    if (await onSubmit(content)) setContent('');
  };

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden"
    >
      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-5 dark:border-white/[0.07] dark:bg-white/[0.02] sm:px-8">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">Conversa da comunidade</h3>
            <p className="text-xs text-slate-500 dark:text-zinc-500">Troque ideias com usuários de outras operações.</p>
          </div>
          <div className="flex -space-x-2">
            {comments.slice(0, 3).map((comment) => (
              <Avatar key={comment.id} className="h-7 w-7 border-2 border-white dark:border-[#111318]">
                <AvatarImage src={comment.author.avatarUrl || undefined} alt="" />
                <AvatarFallback className="text-[9px]">{initials(comment.author.name)}</AvatarFallback>
              </Avatar>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex h-24 items-center justify-center text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : comments.length ? (
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {comments.map((comment) => (
              <div key={comment.id} className="group flex gap-3 rounded-2xl border border-slate-200/70 bg-white p-3.5 dark:border-white/[0.08] dark:bg-white/[0.035]">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={comment.author.avatarUrl || undefined} alt={comment.author.name} />
                  <AvatarFallback className="bg-slate-100 text-[11px] font-bold dark:bg-white/10">{initials(comment.author.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{comment.author.name}</span>
                    {comment.author.workspaceName ? <span className="truncate text-[11px] text-slate-400">{comment.author.workspaceName}</span> : null}
                    <time className="text-[11px] text-slate-400">{timeLabel(comment.createdAt)}</time>
                  </div>
                  <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-slate-600 dark:text-zinc-300">{comment.content}</p>
                </div>
                {comment.isMine ? (
                  <button
                    type="button"
                    onClick={() => void onDelete(comment)}
                    className="h-8 w-8 shrink-0 rounded-lg text-slate-300 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-500 group-hover:opacity-100 focus:opacity-100"
                    aria-label="Remover comentário"
                  >
                    <Trash2 className="mx-auto h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-7 text-center dark:border-white/10">
            <MessageCircle className="mx-auto h-6 w-6 text-slate-300 dark:text-zinc-600" />
            <p className="mt-2 text-sm font-medium text-slate-600 dark:text-zinc-300">Comece a conversa sobre esta novidade.</p>
          </div>
        )}

        <form onSubmit={submit} className="mt-4 flex items-end gap-2">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value.slice(0, 1200))}
            placeholder="O que você achou? Compartilhe uma ideia..."
            rows={2}
            className="min-h-[52px] resize-none rounded-2xl border-slate-200 bg-white text-sm dark:border-white/10 dark:bg-white/[0.04]"
          />
          <Button
            type="submit"
            disabled={sending || !content.trim()}
            className="h-[52px] w-[52px] shrink-0 rounded-2xl bg-slate-950 p-0 text-white hover:bg-emerald-600 dark:bg-white dark:text-slate-950 dark:hover:bg-emerald-300"
            aria-label={`Comentar em ${update.title}`}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
        <p className="mt-1.5 text-right text-[10px] text-slate-400">{content.length}/1.200</p>
      </div>
    </motion.div>
  );
}

export function ProductUpdatesFeed({
  initialUpdates,
  unavailable,
  communityEnabled,
}: {
  initialUpdates: ProductUpdateFeedItem[];
  unavailable: boolean;
  communityEnabled: boolean;
}) {
  const [updates, setUpdates] = useState(initialUpdates);
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [composerBody, setComposerBody] = useState('');
  const [mediaMode, setMediaMode] = useState<'image' | 'video' | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [posting, setPosting] = useState(false);
  const [articleUpdate, setArticleUpdate] = useState<ProductUpdateFeedItem | null>(null);
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const openCommentsRef = useRef(openComments);
  const [comments, setComments] = useState<Record<string, ProductUpdateComment[]>>({});
  const [commentsLoading, setCommentsLoading] = useState<Record<string, boolean>>({});
  const [sendingComment, setSendingComment] = useState<Record<string, boolean>>({});
  const [reacting, setReacting] = useState<Record<string, boolean>>({});
  const [votingPoll, setVotingPoll] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();
  const { session, user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => setUpdates(initialUpdates), [initialUpdates]);
  useEffect(() => { openCommentsRef.current = openComments; }, [openComments]);

  const categories = ['Todos', 'Comunidade', 'Updates'];
  const filteredUpdates = selectedCategory === 'Todos'
    ? updates
    : updates.filter((update) => selectedCategory === 'Updates' ? update.kind === 'update' : update.kind === 'community');
  const communityTotal = updates.reduce((total, update) => total + update.reactions.likes + update.reactions.dislikes + update.commentsCount + (update.poll?.totalVotes || 0), 0);

  const loadComments = useCallback(async (updateId: string, silent = false) => {
    const demoUpdate = initialUpdates.find((update) => update.id === updateId && update.isDemo);
    if (demoUpdate) {
      setComments((current) => ({ ...current, [updateId]: current[updateId] || demoUpdate.demoComments || [] }));
      setCommentsLoading((current) => ({ ...current, [updateId]: false }));
      return;
    }
    if (!silent) setCommentsLoading((current) => ({ ...current, [updateId]: true }));
    const target = updates.find((update) => update.id === updateId);
    const result = target?.kind === 'community'
      ? await getCommunityPostCommentsAction(updateId)
      : await getProductUpdateCommentsAction(updateId);
    if (result.success && result.comments) {
      setComments((current) => ({ ...current, [updateId]: result.comments! }));
    } else if (!silent) {
      toast({ title: 'Comentários indisponíveis', description: result.error, variant: 'destructive' });
    }
    setCommentsLoading((current) => ({ ...current, [updateId]: false }));
  }, [initialUpdates, toast, updates]);

  useEffect(() => {
    if (!communityEnabled || initialUpdates.some((update) => update.isDemo)) return;
    const accessToken = session?.access_token;
    if (!accessToken) return;
    const supabase = createClient();
    supabase.realtime.setAuth(accessToken);

    const refreshCommunity = () => {
      startTransition(() => router.refresh());
      openCommentsRef.current.forEach((updateId) => void loadComments(updateId, true));
    };
    const channel = supabase
      .channel(PRODUCT_UPDATES_COMMUNITY_TOPIC, { config: { private: true } })
      .on('broadcast', { event: 'INSERT' }, refreshCommunity)
      .on('broadcast', { event: 'UPDATE' }, refreshCommunity)
      .on('broadcast', { event: 'DELETE' }, refreshCommunity)
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [communityEnabled, initialUpdates, loadComments, router, session?.access_token]);

  const toggleComments = (updateId: string) => {
    const willOpen = !openComments.has(updateId);
    setOpenComments((current) => {
      const next = new Set(current);
      if (next.has(updateId)) next.delete(updateId); else next.add(updateId);
      return next;
    });
    if (willOpen && !comments[updateId]) void loadComments(updateId);
  };

  const react = async (update: ProductUpdateFeedItem, reaction: ProductUpdateReaction) => {
    if (reacting[update.id]) return;
    const previous = update.reactions;
    const optimisticMine = previous.mine === reaction ? null : reaction;
    setReacting((current) => ({ ...current, [update.id]: true }));
    setUpdates((current) => current.map((item) => item.id === update.id ? {
      ...item,
      reactions: {
        likes: previous.likes + (reaction === 'like' && previous.mine !== 'like' ? 1 : 0) - (previous.mine === 'like' ? 1 : 0),
        dislikes: previous.dislikes + (reaction === 'dislike' && previous.mine !== 'dislike' ? 1 : 0) - (previous.mine === 'dislike' ? 1 : 0),
        mine: optimisticMine,
      },
    } : item));

    if (update.isDemo) {
      setReacting((current) => ({ ...current, [update.id]: false }));
      return;
    }

    if (update.kind === 'community') {
      const result = await reactCommunityPostAction(update.id);
      if (!result.success) {
        setUpdates((current) => current.map((item) => item.id === update.id ? { ...item, reactions: previous } : item));
        toast({ title: 'Não foi possível curtir', description: result.error, variant: 'destructive' });
      } else {
        setUpdates((current) => current.map((item) => item.id === update.id ? {
          ...item,
          reactions: { likes: result.likes ?? 0, dislikes: 0, mine: result.liked ? 'like' : null },
        } : item));
      }
      setReacting((current) => ({ ...current, [update.id]: false }));
      return;
    }

    const result = await reactToProductUpdateAction(update.id, reaction);
    if (!result.success) {
      setUpdates((current) => current.map((item) => item.id === update.id ? { ...item, reactions: previous } : item));
      toast({ title: 'Não foi possível reagir', description: result.error, variant: 'destructive' });
    } else {
      setUpdates((current) => current.map((item) => item.id === update.id ? {
        ...item,
        reactions: { likes: result.likes!, dislikes: result.dislikes!, mine: result.reaction ?? null },
      } : item));
    }
    setReacting((current) => ({ ...current, [update.id]: false }));
  };

  const addComment = async (updateId: string, content: string): Promise<boolean> => {
    const demoUpdate = updates.find((update) => update.id === updateId && update.isDemo);
    if (demoUpdate) {
      const comment: ProductUpdateComment = {
        id: crypto.randomUUID(),
        updateId,
        content: content.trim(),
        createdAt: new Date().toISOString(),
        isEdited: false,
        isMine: true,
        author: { id: 'local-user', name: 'Você', avatarUrl: null, workspaceName: 'Prévia local' },
      };
      setComments((current) => ({ ...current, [updateId]: [...(current[updateId] || demoUpdate.demoComments || []), comment] }));
      setUpdates((current) => current.map((item) => item.id === updateId ? { ...item, commentsCount: item.commentsCount + 1 } : item));
      return true;
    }
    setSendingComment((current) => ({ ...current, [updateId]: true }));
    const target = updates.find((update) => update.id === updateId);
    const result = target?.kind === 'community'
      ? await addCommunityPostCommentAction(updateId, content)
      : await addProductUpdateCommentAction(updateId, content);
    setSendingComment((current) => ({ ...current, [updateId]: false }));
    if (!result.success || !result.comment) {
      toast({ title: 'Comentário não publicado', description: result.error, variant: 'destructive' });
      return false;
    }
    setComments((current) => {
      const existing = current[updateId] || [];
      return existing.some((comment) => comment.id === result.comment!.id)
        ? current
        : { ...current, [updateId]: [...existing, result.comment!] };
    });
    setUpdates((current) => current.map((item) => item.id === updateId ? { ...item, commentsCount: item.commentsCount + 1 } : item));
    return true;
  };

  const deleteComment = async (comment: ProductUpdateComment) => {
    const demoUpdate = updates.find((update) => update.id === comment.updateId && update.isDemo);
    if (demoUpdate) {
      setComments((current) => ({ ...current, [comment.updateId]: (current[comment.updateId] || []).filter((item) => item.id !== comment.id) }));
      setUpdates((current) => current.map((item) => item.id === comment.updateId ? { ...item, commentsCount: Math.max(0, item.commentsCount - 1) } : item));
      return;
    }
    const target = updates.find((update) => update.id === comment.updateId);
    const result = target?.kind === 'community'
      ? await deleteCommunityPostCommentAction(comment.id)
      : await deleteProductUpdateCommentAction(comment.id);
    if (!result.success) {
      toast({ title: 'Não foi possível remover', description: result.error, variant: 'destructive' });
      return;
    }
    setComments((current) => ({ ...current, [comment.updateId]: (current[comment.updateId] || []).filter((item) => item.id !== comment.id) }));
    setUpdates((current) => current.map((item) => item.id === comment.updateId ? { ...item, commentsCount: Math.max(0, item.commentsCount - 1) } : item));
  };

  const vote = async (updateId: string, poll: ProductUpdatePoll, optionId: string) => {
    if (votingPoll[poll.id]) return;
    const demoUpdate = updates.find((update) => update.id === updateId && update.isDemo);
    if (demoUpdate) {
      const previousOptionId = poll.selectedOptionId;
      const nextOptions = poll.options.map((option) => ({
        ...option,
        votes: Math.max(0, option.votes + (option.id === optionId && previousOptionId !== optionId ? 1 : 0) - (option.id === previousOptionId && previousOptionId !== optionId ? 1 : 0)),
      }));
      const totalVotes = previousOptionId ? poll.totalVotes : poll.totalVotes + 1;
      nextOptions.forEach((option) => { option.percentage = totalVotes ? Math.round((option.votes / totalVotes) * 100) : 0; });
      setUpdates((current) => current.map((item) => item.id === updateId ? {
        ...item,
        poll: { ...poll, selectedOptionId: optionId, totalVotes, options: nextOptions },
      } : item));
      return;
    }
    setVotingPoll((current) => ({ ...current, [poll.id]: true }));
    const result = await voteProductUpdatePollAction(poll.id, optionId);
    setVotingPoll((current) => ({ ...current, [poll.id]: false }));
    if (!result.success || !result.poll) {
      toast({ title: 'Voto não registrado', description: result.error, variant: 'destructive' });
      return;
    }
    setUpdates((current) => current.map((item) => item.id === updateId ? { ...item, poll: result.poll! } : item));
  };

  const publishPost = async (event: FormEvent) => {
    event.preventDefault();
    if (!composerBody.trim() || posting) return;
    setPosting(true);
    const result = await createCommunityPostAction({
      body: composerBody,
      media: mediaMode && mediaUrl.trim() ? { type: mediaMode, url: mediaUrl } : null,
    });
    setPosting(false);
    if (!result.success) {
      toast({ title: 'Publicação não enviada', description: result.error, variant: 'destructive' });
      return;
    }
    setComposerBody('');
    setMediaMode(null);
    setMediaUrl('');
    toast({ title: 'Publicado na comunidade' });
    startTransition(() => router.refresh());
  };

  const removePost = async (postId: string) => {
    const result = await deleteCommunityPostAction(postId);
    if (!result.success) {
      toast({ title: 'Não foi possível remover', description: result.error, variant: 'destructive' });
      return;
    }
    setUpdates((current) => current.filter((item) => item.id !== postId));
  };

  return (
    <div className="min-h-full bg-[#f7f8fa] text-slate-950 dark:bg-[#080a0d] dark:text-white">
      <header className="relative isolate overflow-hidden border-b border-slate-200/80 bg-white dark:border-white/[0.08] dark:bg-[#0b0d11]">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-32 -top-56 h-[520px] w-[520px] rounded-full bg-emerald-400/15 blur-[110px]" />
          <div className="absolute -right-28 top-0 h-[420px] w-[420px] rounded-full bg-blue-500/10 blur-[100px]" />
          <div className="absolute inset-0 opacity-[0.035] [background-image:radial-gradient(currentColor_1px,transparent_1px)] [background-size:22px_22px]" />
        </div>
        <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-9">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                <Radio className="h-3.5 w-3.5 animate-pulse" />
                Comunidade Dialogy
              </div>
              <h1 className="max-w-2xl text-2xl font-black tracking-[-0.035em] sm:text-3xl lg:text-[34px]">
                O que estamos <span className="bg-gradient-to-r from-emerald-500 via-teal-400 to-blue-500 bg-clip-text text-transparent">construindo juntos.</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-zinc-400">
                Lançamentos, bastidores e melhorias da plataforma. Reaja, converse e ajude a definir os próximos passos.
              </p>
            </div>
            <div className="flex gap-2">
              <div className="flex min-w-28 items-center gap-2.5 rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.04]">
                <Newspaper className="h-4 w-4 shrink-0 text-emerald-500" />
                <div><span className="text-lg font-black leading-none">{updates.length}</span><span className="ml-1.5 text-[10px] font-medium text-slate-500">publicações</span></div>
              </div>
              <div className="flex min-w-28 items-center gap-2.5 rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.04]">
                <UsersRound className="h-4 w-4 shrink-0 text-blue-500" />
                <div><span className="text-lg font-black leading-none">{communityTotal}</span><span className="ml-1.5 text-[10px] font-medium text-slate-500">interações</span></div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
        {updates.length > 0 ? (
          <>
            <div className="mb-8 flex items-center gap-2 overflow-x-auto pb-1">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setSelectedCategory(category)}
                  className={cn(
                    'shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition',
                    selectedCategory === category
                      ? 'border-slate-950 bg-slate-950 text-white shadow-lg shadow-slate-950/10 dark:border-white dark:bg-white dark:text-slate-950'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.035] dark:text-zinc-400 dark:hover:text-white'
                  )}
                >
                  {category}
                </button>
              ))}
            </div>

            <motion.div layout className="space-y-7">
              <AnimatePresence mode="popLayout">
                {filteredUpdates.map((update, index) => {
                  const styles = accentStyles[update.accentColor];
                  const isCommentsOpen = openComments.has(update.id);
                  return (
                    <motion.article
                      layout
                      key={update.id}
                      id={update.slug}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.2) }}
                      className="group scroll-mt-6 overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_70px_-48px_rgba(15,23,42,0.45)] transition-shadow hover:shadow-[0_30px_80px_-42px_rgba(15,23,42,0.38)] dark:border-white/[0.09] dark:bg-[#101216] dark:shadow-black/30"
                    >
                      <div className={cn('relative overflow-hidden bg-gradient-to-br p-5 sm:p-8', styles.glow)}>
                        <div className={cn('absolute right-[-70px] top-[-90px] h-56 w-56 rounded-full bg-gradient-to-br opacity-20 blur-2xl', styles.cover)} />
                        <div className="relative flex flex-wrap items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl', styles.icon)}>
                              {index === 0 ? <Rocket className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                            </div>
                            <div>
                              <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em]', styles.badge)}>{update.category}</span>
                              <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">{dateLabel(update.publishedAt)}</p>
                            </div>
                          </div>
                          {index === 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white dark:bg-white dark:text-slate-950">
                              <Radio className="h-3 w-3" /> Mais recente
                            </span>
                          ) : null}
                        </div>
                        <div className="relative mt-7 max-w-4xl">
                          <h2 className="text-2xl font-black tracking-[-0.03em] sm:text-3xl lg:text-4xl">{update.title}</h2>
                          {update.summary ? <p className="mt-3 max-w-3xl text-base font-medium leading-7 text-slate-600 dark:text-zinc-300">{update.summary}</p> : null}
                        </div>
                      </div>

                      <div className="px-5 pb-5 sm:px-8 sm:pb-7">
                        {update.highlights.length ? (
                          <div className="-mt-1 mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {update.highlights.map((highlight) => (
                              <div key={highlight} className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-zinc-300">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                {highlight}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <RichContent blocks={update.contentBlocks} fallback={update.content} />
                        {update.poll ? (
                          <PollCard
                            poll={update.poll}
                            voting={votingPoll[update.poll.id] || false}
                            onVote={(optionId) => void vote(update.id, update.poll!, optionId)}
                          />
                        ) : null}

                        <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-5 dark:border-white/[0.07]">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void react(update, 'like')}
                              className={cn('inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition active:scale-95', update.reactions.mine === 'like' ? 'border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5')}
                            >
                              <ThumbsUp className={cn('h-4 w-4', update.reactions.mine === 'like' && 'fill-current')} /> {update.reactions.likes}
                            </button>
                            <button
                              type="button"
                              onClick={() => void react(update, 'dislike')}
                              className={cn('inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition active:scale-95', update.reactions.mine === 'dislike' ? 'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5')}
                            >
                              <ThumbsDown className={cn('h-4 w-4', update.reactions.mine === 'dislike' && 'fill-current')} /> {update.reactions.dislikes}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleComments(update.id)}
                              className={cn('inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition', isCommentsOpen ? 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5')}
                            >
                              <MessageCircle className="h-4 w-4" /> {update.commentsCount}
                              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isCommentsOpen && 'rotate-180')} />
                            </button>
                          </div>
                          {update.author ? (
                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-500">
                              <Avatar className="h-7 w-7">
                                <AvatarImage src={update.author.avatarUrl || undefined} alt="" />
                                <AvatarFallback className="text-[9px]">{initials(update.author.name)}</AvatarFallback>
                              </Avatar>
                              Publicado por <span className="font-semibold text-slate-700 dark:text-zinc-300">{update.author.name}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <AnimatePresence>
                        {isCommentsOpen ? (
                          <CommentPanel
                            update={update}
                            comments={comments[update.id] || []}
                            loading={commentsLoading[update.id] || false}
                            sending={sendingComment[update.id] || false}
                            onSubmit={(content) => addComment(update.id, content)}
                            onDelete={deleteComment}
                          />
                        ) : null}
                      </AnimatePresence>
                    </motion.article>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          </>
        ) : (
          <div className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-[32px] border border-dashed border-slate-300 bg-white px-6 text-center dark:border-white/15 dark:bg-white/[0.025]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.08),transparent_45%)]" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-xl shadow-emerald-500/20">
              {unavailable ? <ArrowUpRight className="h-7 w-7" /> : <Newspaper className="h-7 w-7" />}
            </div>
            <h2 className="relative mt-6 text-2xl font-black">{unavailable ? 'A comunidade está chegando' : 'A primeira novidade está a caminho'}</h2>
            <p className="relative mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-zinc-400">
              {unavailable ? 'Este espaço está sendo preparado. Tente novamente em alguns instantes.' : 'Quando publicarmos o próximo lançamento, você será avisado e poderá conversar com toda a comunidade por aqui.'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
