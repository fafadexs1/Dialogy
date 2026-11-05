'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Eye,
  Flame,
  Hash,
  Heart,
  ImageIcon,
  Link2,
  Loader2,
  MessageCircle,
  Radio,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import {
  addCommunityPostCommentAction,
  createCommunityPostAction,
  deleteCommunityPostAction,
  deleteCommunityPostCommentAction,
  getCommunityPostCommentsAction,
  getPostViewersAction,
  reactCommunityPostAction,
  recordPostViewAction,
} from '@/actions/community';
import {
  addProductUpdateCommentAction,
  deleteProductUpdateCommentAction,
  getProductUpdateCommentsAction,
  reactToProductUpdateAction,
} from '@/actions/product-updates';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type {
  PostViewer,
  ProductUpdateComment,
  ProductUpdateContentBlock,
  ProductUpdateFeedItem,
} from '@/lib/product-updates';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function dateLabel(value: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function timeAgo(dateString: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
    if (diff < 60) return 'agora há pouco';
    if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
    return `há ${Math.floor(diff / 86400)}d`;
  } catch {
    return dateString;
  }
}

function formatViews(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
}

function estimateReadingTime(text: string): string {
  const words = text.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.ceil(words / 180));
  return `${minutes} min de leitura`;
}

function ArticleBlocks({
  blocks,
  fallback,
}: {
  blocks: ProductUpdateContentBlock[];
  fallback: string;
}) {
  if (!blocks || !blocks.length) {
    return (
      <div className="prose prose-slate max-w-none text-base leading-[1.8] dark:prose-invert sm:text-lg">
        <p className="whitespace-pre-line text-slate-800 dark:text-zinc-200">{fallback}</p>
      </div>
    );
  }

  return (
    <div className="space-y-7 text-base leading-[1.8] text-slate-800 dark:text-zinc-200 sm:text-[18px]">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const id = `section-${index}-${block.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
          return block.level === 3 ? (
            <h3
              key={index}
              id={id}
              className="scroll-mt-24 pt-4 text-xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-2xl"
            >
              {block.text}
            </h3>
          ) : (
            <h2
              key={index}
              id={id}
              className="scroll-mt-24 border-b border-slate-100 pb-3 pt-6 text-2xl font-black tracking-tight text-slate-950 dark:border-white/10 dark:text-white sm:text-3xl"
            >
              {block.text}
            </h2>
          );
        }
        if (block.type === 'paragraph') {
          return (
            <p key={index} className="whitespace-pre-line leading-[1.85] text-slate-700 dark:text-zinc-300">
              {block.text}
            </p>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote
              key={index}
              className="relative my-6 rounded-2xl border-l-4 border-violet-500 bg-gradient-to-r from-violet-500/[0.08] via-indigo-500/[0.04] to-transparent p-6 text-lg font-medium italic text-slate-900 dark:text-zinc-100 sm:text-xl"
            >
              “{block.text}”
              {block.attribution ? (
                <footer className="mt-3 text-xs font-bold uppercase tracking-wider not-italic text-violet-600 dark:text-violet-400">
                  — {block.attribution}
                </footer>
              ) : null}
            </blockquote>
          );
        }
        if (block.type === 'divider') {
          return <hr key={index} className="my-8 border-slate-200/80 dark:border-white/10" />;
        }
        if (block.type === 'image') {
          return (
            <figure key={index} className="my-6 overflow-hidden rounded-2xl border border-slate-200/80 shadow-md dark:border-white/10">
              <img
                src={block.url}
                alt={block.alt}
                referrerPolicy="no-referrer"
                className="max-h-[560px] w-full object-cover"
              />
              {block.caption ? (
                <figcaption className="bg-slate-50 px-4 py-2 text-center text-xs text-slate-500 dark:bg-white/[0.03] dark:text-zinc-400">
                  {block.caption}
                </figcaption>
              ) : null}
            </figure>
          );
        }
        if (block.type === 'video') {
          return (
            <div
              key={index}
              className="my-6 overflow-hidden rounded-2xl bg-black shadow-xl"
            >
              <video
                src={block.url}
                poster={block.poster}
                controls
                preload="metadata"
                className="aspect-video w-full"
              />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function ExternalMedia({ item }: { item: ProductUpdateFeedItem }) {
  const media = item.media;
  if (media?.type === 'image' || (!media && item.kind === 'update' && item.imageUrl)) {
    const src = media?.url || item.imageUrl || '';
    return (
      <div className="mt-3.5 overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100 dark:border-white/[0.08] dark:bg-black/40">
        <img
          src={src}
          alt="Mídia da publicação"
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-[520px] w-full object-cover transition-transform duration-300 hover:scale-[1.01]"
        />
      </div>
    );
  }
  if (media?.type === 'youtube' || media?.type === 'vimeo') {
    return (
      <div className="mt-3.5 overflow-hidden rounded-2xl border border-slate-200 bg-black shadow-md dark:border-white/10">
        <iframe
          src={media.url}
          title="Vídeo da publicação"
          className="aspect-video w-full"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-presentation"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    );
  }
  return null;
}

// ----------------------------------------------------------------------------------
// COMPONENTE PRINCIPAL: FEED SOCIAL COM LEITURA EXPANSÍVEL INLINE (ZERO MODAIS / ZERO TROCA DE GUIA)
// ----------------------------------------------------------------------------------
export function CommunityFeed({
  initialItems,
  unavailable,
  isSuperAdmin = false,
}: {
  initialItems: ProductUpdateFeedItem[];
  unavailable: boolean;
  isSuperAdmin?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<'all' | 'community' | 'updates' | 'trending'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [posting, setPosting] = useState(false);

  // Artigos expandidos diretamente no feed (inline, sem abrir nova guia nem modal)
  const [expandedArticleIds, setExpandedArticleIds] = useState<Set<string>>(new Set());

  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, ProductUpdateComment[]>>({});
  const [commentText, setCommentText] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);

  // Modal restrito ao Superadmin para auditoria de visualizadores
  const [viewersModalItem, setViewersModalItem] = useState<ProductUpdateFeedItem | null>(null);
  const [viewersList, setViewersList] = useState<PostViewer[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);

  const [, startTransition] = useTransition();
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const viewedPostsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // Expandir artigo automaticamente se presente na URL query param ou hash
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const targetSlug = urlParams.get('article') || window.location.hash.replace('#', '');
    if (targetSlug) {
      const found = initialItems.find(
        (it) => it.slug === targetSlug || it.id === targetSlug
      );
      if (found) {
        setExpandedArticleIds((prev) => new Set(prev).add(found.id));
      }
    }
  }, [initialItems]);

  // Alternar expansão do artigo no próprio feed (inline, sem saltos de tela)
  const toggleExpandArticle = async (item: ProductUpdateFeedItem) => {
    const isCurrentlyExpanded = expandedArticleIds.has(item.id);
    const willExpand = !isCurrentlyExpanded;

    setExpandedArticleIds((prev) => {
      const next = new Set(prev);
      if (willExpand) {
        next.add(item.id);
      } else {
        next.delete(item.id);
      }
      return next;
    });

    if (willExpand) {
      void recordPostViewAction({ id: item.id, kind: item.kind });

      // Carregar comentários automaticamente caso ainda não carregados
      if (!comments[item.id]) {
        setCommentLoading(true);
        const res = await getProductUpdateCommentsAction(item.id);
        setCommentLoading(false);
        if (res.success && res.comments) {
          setComments((current) => ({ ...current, [item.id]: res.comments || [] }));
        }
      }
    }
  };

  // Gravação automática de visualização ao renderizar
  useEffect(() => {
    if (!user?.id) return;
    initialItems.forEach((item) => {
      if (!viewedPostsRef.current.has(item.id)) {
        viewedPostsRef.current.add(item.id);
        void recordPostViewAction({ id: item.id, kind: item.kind });
      }
    });
  }, [initialItems, user?.id]);

  const trendingTags = useMemo(
    () => [
      { tag: 'LIA-1', label: '#LIA-1', desc: 'IA Adaptativa' },
      { tag: 'IA', label: '#InteligênciaArtificial', desc: 'Agentes' },
      { tag: 'EvolutionAPI', label: '#EvolutionAPI', desc: 'WhatsApp' },
      { tag: 'NexusFlow', label: '#NexusFlow', desc: 'Fluxos Visuais' },
      { tag: 'SGP', label: '#SGP', desc: 'Telecom' },
      { tag: 'Vendas', label: '#Vendas', desc: 'Alta Conversão' },
    ],
    []
  );

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (selectedTag) {
        const query = selectedTag.toLowerCase();
        const matchesContent = item.content.toLowerCase().includes(query);
        const matchesTitle = item.title.toLowerCase().includes(query);
        const matchesCat = item.category?.toLowerCase().includes(query);
        if (!matchesContent && !matchesTitle && !matchesCat) return false;
      }

      if (tab === 'updates') return item.kind === 'update';
      if (tab === 'community') return item.kind === 'community';
      if (tab === 'trending') {
        return (
          item.reactions.likes > 0 || item.commentsCount > 0 || (item.viewsCount || 0) > 5
        );
      }
      return true;
    });
  }, [items, tab, selectedTag]);

  const totalInteractions = useMemo(
    () =>
      items.reduce(
        (acc, curr) =>
          acc + curr.reactions.likes + curr.commentsCount + (curr.poll?.totalVotes || 0),
        0
      ),
    [items]
  );

  const totalViews = useMemo(
    () => items.reduce((acc, curr) => acc + (curr.viewsCount || 0), 0),
    [items]
  );

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    const result = await createCommunityPostAction({
      body,
      media: mediaType && mediaUrl.trim() ? { type: mediaType, url: mediaUrl } : null,
    });
    setPosting(false);
    if (!result.success) {
      return toast({
        title: 'Publicação não enviada',
        description: result.error,
        variant: 'destructive',
      });
    }
    setBody('');
    setMediaType(null);
    setMediaUrl('');
    toast({ title: 'Publicado na rede da Dialogy' });
    startTransition(() => router.refresh());
  };

  const react = async (item: ProductUpdateFeedItem) => {
    const before = item.reactions;
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? {
              ...candidate,
              reactions: {
                ...candidate.reactions,
                likes: Math.max(
                  0,
                  candidate.reactions.likes + (candidate.reactions.mine === 'like' ? -1 : 1)
                ),
                mine: candidate.reactions.mine === 'like' ? null : 'like',
              },
            }
          : candidate
      )
    );

    const result =
      item.kind === 'community'
        ? await reactCommunityPostAction(item.id)
        : await reactToProductUpdateAction(item.id, 'like');
    if (!result.success) {
      setItems((current) =>
        current.map((candidate) => (candidate.id === item.id ? { ...candidate, reactions: before } : candidate))
      );
      toast({
        title: 'Não foi possível registrar reação',
        description: result.error,
        variant: 'destructive',
      });
    }
  };

  const toggleComments = async (item: ProductUpdateFeedItem) => {
    if (openComments === item.id) return setOpenComments(null);
    setOpenComments(item.id);
    setCommentText('');
    if (comments[item.id]) return;
    setCommentLoading(true);
    const result =
      item.kind === 'community'
        ? await getCommunityPostCommentsAction(item.id)
        : await getProductUpdateCommentsAction(item.id);
    setCommentLoading(false);
    if (result.success) {
      setComments((current) => ({ ...current, [item.id]: result.comments || [] }));
    }
  };

  const submitComment = async (event: FormEvent, item: ProductUpdateFeedItem) => {
    event.preventDefault();
    if (!commentText.trim()) return;
    const result =
      item.kind === 'community'
        ? await addCommunityPostCommentAction(item.id, commentText)
        : await addProductUpdateCommentAction(item.id, commentText);
    if (!result.success || !result.comment) {
      return toast({
        title: 'Comentário não enviado',
        description: result.error,
        variant: 'destructive',
      });
    }
    setComments((current) => ({
      ...current,
      [item.id]: [...(current[item.id] || []), result.comment!],
    }));
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, commentsCount: candidate.commentsCount + 1 }
          : candidate
      )
    );
    setCommentText('');
  };

  const removeComment = async (item: ProductUpdateFeedItem, comment: ProductUpdateComment) => {
    const result =
      item.kind === 'community'
        ? await deleteCommunityPostCommentAction(comment.id)
        : await deleteProductUpdateCommentAction(comment.id);
    if (!result.success) return;
    setComments((current) => ({
      ...current,
      [item.id]: (current[item.id] || []).filter((candidate) => candidate.id !== comment.id),
    }));
  };

  const removePost = async (id: string) => {
    const result = await deleteCommunityPostAction(id);
    if (result.success) {
      setItems((current) => current.filter((item) => item.id !== id));
      toast({ title: 'Publicação excluída' });
    }
  };

  const inspectViewers = async (item: ProductUpdateFeedItem) => {
    if (!isSuperAdmin) return;
    setViewersModalItem(item);
    setLoadingViewers(true);
    try {
      const res = await getPostViewersAction({ id: item.id, kind: item.kind });
      if (res.success && res.viewers) {
        setViewersList(res.viewers);
      } else {
        setViewersList([]);
        if (res.error) toast({ title: 'Aviso', description: res.error });
      }
    } catch {
      setViewersList([]);
    } finally {
      setLoadingViewers(false);
    }
  };

  // Visualização padrão do Feed da Comunidade
  return (
    <div className="min-h-full bg-[#f8f9fb] text-slate-950 dark:bg-[#07080a] dark:text-white">
      {/* Header Social Inovador */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#090b0e]/85">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between px-4 py-3 sm:px-6">
          {/* Switcher de Abas no Header (Design pill conforme print do usuário) */}
          <div className="flex items-center gap-1 sm:gap-2 rounded-full border border-slate-200/80 bg-white p-1.5 shadow-xs dark:border-white/10 dark:bg-[#0c0e12]">
            {[
              { id: 'all', label: 'Tudo', icon: Radio },
              { id: 'community', label: 'Comunidade', icon: Users },
              { id: 'updates', label: 'Novidades Oficiais', icon: Sparkles },
              { id: 'trending', label: 'Em Alta', icon: TrendingUp },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id as any)}
                className={cn(
                  'flex items-center gap-2 rounded-full px-3.5 py-1.5 sm:px-5 sm:py-2 text-xs font-bold transition-all',
                  tab === id
                    ? 'bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950'
                    : 'text-slate-600 hover:text-slate-950 dark:text-zinc-400 dark:hover:text-white'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4 text-xs font-semibold text-slate-500 dark:text-zinc-400">
            <div className="hidden sm:flex items-center gap-3 border-r border-slate-200 pr-4 dark:border-white/10">
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-indigo-500" />
                {items.length} publicações
              </span>
              <span className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-cyan-500" />
                {formatViews(totalViews)} views
              </span>
            </div>

            {selectedTag ? (
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className="flex items-center gap-1 rounded-lg bg-indigo-500/10 px-2.5 py-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20"
              >
                #{selectedTag} <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* Grid Principal */}
      <main className="mx-auto grid max-w-[1240px] gap-7 px-3 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Coluna Central: Feed */}
        <section className="min-w-0 space-y-5">
          {/* Composer Moderno */}
          <form
            onSubmit={publish}
            className="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm transition-all focus-within:border-indigo-500/50 focus-within:shadow-md focus-within:shadow-indigo-500/5 dark:border-white/[0.08] dark:bg-[#0f1116] sm:p-5"
          >
            <div className="flex gap-3.5">
              <Avatar className="h-10 w-10 shrink-0 border border-slate-200 dark:border-white/10">
                <AvatarImage src={user?.user_metadata?.avatar_url} alt="" />
                <AvatarFallback className="bg-gradient-to-tr from-slate-100 to-slate-200 text-xs font-bold text-slate-800 dark:from-zinc-800 dark:to-zinc-700 dark:text-zinc-200">
                  {initials(user?.user_metadata?.full_name || user?.email || 'Você')}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <Textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value.slice(0, 5000))}
                  placeholder="Compartilhe uma inovação, dúvida ou resultado com a comunidade..."
                  className="min-h-[75px] resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus-visible:ring-0 dark:text-white dark:placeholder:text-zinc-500"
                />

                {mediaType ? (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-zinc-300">
                      <span>
                        {mediaType === 'image'
                          ? 'URL direta da imagem (PNG, JPG, GIF)'
                          : 'URL do vídeo (YouTube ou Vimeo)'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setMediaType(null);
                          setMediaUrl('');
                        }}
                        className="text-slate-400 hover:text-rose-500"
                      >
                        Remover
                      </button>
                    </div>
                    <input
                      type="url"
                      value={mediaUrl}
                      onChange={(event) => setMediaUrl(event.target.value)}
                      placeholder="https://..."
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-indigo-500 dark:border-white/10 dark:bg-[#07080a]"
                    />
                  </motion.div>
                ) : null}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-white/[0.06]">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMediaType('image')}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
                    mediaType === 'image'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
                  )}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Imagem
                </button>
                <button
                  type="button"
                  onClick={() => setMediaType('video')}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
                    mediaType === 'video'
                      ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
                  )}
                >
                  <Video className="h-3.5 w-3.5" />
                  Vídeo
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] text-slate-400">
                  {body.length > 0 ? `${body.length}/5000` : ''}
                </span>
                <Button
                  type="submit"
                  disabled={posting || !body.trim()}
                  className="h-8 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 text-xs font-bold text-white shadow-sm hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50"
                >
                  {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Publicar'}
                </Button>
              </div>
            </div>
          </form>

          {/* Lista de Publicações */}
          <div className="space-y-5">
            {filtered.map((item) => (
              <article
                key={item.id}
                id={item.slug || `post-${item.id}`}
                className={cn(
                  'overflow-hidden rounded-2xl border bg-white p-5 shadow-sm transition-all dark:bg-[#0f1116]',
                  item.kind === 'update'
                    ? expandedArticleIds.has(item.id)
                      ? 'border-violet-500/50 shadow-md ring-1 ring-violet-500/20'
                      : 'border-violet-500/25 dark:border-violet-500/20'
                    : 'border-slate-200/80 dark:border-white/[0.08]'
                )}
              >
                {/* Cabeçalho do Post */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border border-slate-200/80 dark:border-white/10">
                      <AvatarImage
                        src={
                          item.author?.avatarUrl ||
                          (item.kind === 'update' ? '/logo.png' : undefined)
                        }
                        alt=""
                      />
                      <AvatarFallback className="bg-gradient-to-tr from-violet-600 to-indigo-600 text-xs font-black text-white">
                        {initials(item.author?.name || 'Dialogy')}
                      </AvatarFallback>
                    </Avatar>

                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-950 dark:text-white">
                          {item.author?.name || 'Dialogy'}
                        </span>
                        {item.kind === 'update' ? (
                          <BadgeCheck className="h-4 w-4 fill-violet-500 text-white" />
                        ) : null}
                        {item.author?.workspaceName ? (
                          <span className="text-xs text-slate-400">· {item.author.workspaceName}</span>
                        ) : null}
                        <span className="text-xs text-slate-400">· {timeAgo(item.publishedAt)}</span>
                      </div>

                      <div className="mt-0.5 flex items-center gap-2">
                        {item.kind === 'update' ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-violet-600 dark:text-violet-400">
                            <Sparkles className="h-3 w-3" /> Update oficial
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[11px] text-slate-400">
                            Membro da comunidade
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {item.isMine && item.kind === 'community' ? (
                    <button
                      type="button"
                      onClick={() => void removePost(item.id)}
                      className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                      title="Excluir publicação"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>

                {/* Conteúdo do Post */}
                {item.kind === 'update' ? (
                  <div className="mt-4">
                    {!expandedArticleIds.has(item.id) ? (
                      <div>
                        <button
                          type="button"
                          onClick={() => void toggleExpandArticle(item)}
                          className="group/title block w-full text-left"
                        >
                          <h2 className="text-lg font-black tracking-tight text-slate-950 transition-colors group-hover/title:text-violet-600 dark:text-white dark:group-hover/title:text-violet-400 sm:text-xl">
                            {item.title}
                          </h2>
                          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
                            {item.summary || item.content}
                          </p>
                        </button>

                        <ExternalMedia item={item} />

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => void toggleExpandArticle(item)}
                            className="inline-flex items-center gap-2 rounded-xl bg-violet-500/10 px-4 py-2 text-xs font-bold text-violet-700 transition-all hover:bg-violet-500/20 dark:bg-violet-500/15 dark:text-violet-300 dark:hover:bg-violet-500/25"
                          >
                            <BookOpen className="h-4 w-4" />
                            Expandir & Ler Artigo
                            <ChevronDown className="h-4 w-4" />
                          </button>

                          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Clock className="h-3 w-3" />
                            {estimateReadingTime(item.content)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6 pt-2">
                        {/* Banner de Leitura Expandida */}
                        <div className="flex items-center justify-between rounded-xl bg-violet-500/10 px-4 py-2.5 text-xs font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4" />
                            <span>Leitura Expandida</span>
                            <span className="text-slate-300 dark:text-zinc-600">·</span>
                            <span className="font-medium text-slate-500 dark:text-zinc-400">
                              {estimateReadingTime(item.content)}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => void toggleExpandArticle(item)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1 text-xs font-bold text-violet-700 shadow-2xs transition-colors hover:bg-white dark:bg-black/30 dark:text-violet-300 dark:hover:bg-black/50"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                            Recolher
                          </button>
                        </div>

                        {/* Título Principal Expandido */}
                        <div>
                          <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                            {item.title}
                          </h2>
                          {item.summary ? (
                            <p className="mt-3 text-base leading-relaxed text-slate-600 dark:text-zinc-300">
                              {item.summary}
                            </p>
                          ) : null}
                        </div>

                        {/* Imagem de Capa do Artigo */}
                        {item.imageUrl ? (
                          <div className="overflow-hidden rounded-2xl border border-slate-200/80 shadow-md dark:border-white/10">
                            <img
                              src={item.imageUrl}
                              alt=""
                              className="max-h-[480px] w-full object-cover"
                            />
                          </div>
                        ) : null}

                        {/* Destaques / Pontos de Ruptura */}
                        {item.highlights && item.highlights.length > 0 ? (
                          <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-indigo-500/5 to-transparent p-5">
                            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-violet-600 dark:text-violet-400">
                              <Sparkles className="h-4 w-4" />
                              Pontos de Ruptura & Destaques da Arquitetura
                            </div>
                            <ul className="mt-3.5 space-y-2.5">
                              {item.highlights.map((hl, i) => (
                                <li
                                  key={i}
                                  className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-700 dark:text-zinc-200"
                                >
                                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                  <span>{hl}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {/* Corpo do Artigo Formatado */}
                        <div className="rounded-2xl border border-slate-200/70 bg-slate-50/50 p-5 dark:border-white/[0.06] dark:bg-white/[0.02] sm:p-8">
                          <ArticleBlocks blocks={item.contentBlocks} fallback={item.content} />
                        </div>

                        {/* Rodapé da Leitura com Ações */}
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void toggleExpandArticle(item)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition-colors hover:bg-slate-100 dark:bg-[#151820] dark:text-zinc-200 dark:hover:bg-[#1d222d]"
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                              Recolher artigo
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const url = `${window.location.origin}/comunidade?article=${item.slug}`;
                                void navigator.clipboard.writeText(url);
                                toast({ title: 'Link do artigo copiado!' });
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-2xs hover:bg-slate-100 dark:bg-[#151820] dark:text-zinc-300"
                            >
                              <Share2 className="h-3.5 w-3.5" />
                              Compartilhar Link
                            </button>
                          </div>

                          <span className="text-xs text-slate-400">
                            Fim do artigo · Participe da discussão abaixo
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3">
                    <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-slate-800 dark:text-zinc-200">
                      {item.content}
                    </p>
                    <ExternalMedia item={item} />
                  </div>
                )}

                {/* Barra de Métricas e Ações Sociais */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  <div className="flex items-center gap-1 sm:gap-2">
                    {/* Botão de Curtir */}
                    <button
                      type="button"
                      onClick={() => void react(item)}
                      className={cn(
                        'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
                        item.reactions.mine === 'like'
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-white'
                      )}
                    >
                      <Heart
                        className={cn(
                          'h-4 w-4 transition-transform active:scale-125',
                          item.reactions.mine === 'like' && 'fill-rose-500 text-rose-500'
                        )}
                      />
                      <span>{item.reactions.likes || 'Curtir'}</span>
                    </button>

                    {/* Botão de Comentários */}
                    <button
                      type="button"
                      onClick={() => void toggleComments(item)}
                      className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-white"
                    >
                      <MessageCircle className="h-4 w-4" />
                      <span>{item.commentsCount || 'Comentar'}</span>
                    </button>

                    {/* Botão de Compartilhar */}
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          `${window.location.origin}/comunidade?article=${item.slug}`
                        );
                        toast({ title: 'Link copiado para a área de transferência' });
                      }}
                      className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-white"
                      title="Compartilhar link"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Visualizações: Apenas o número para usuários normais; quem viu para superadmin */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 text-xs text-slate-400 dark:text-zinc-400">
                      <Eye className="h-3.5 w-3.5 text-slate-400" />
                      <span className="font-semibold text-slate-600 dark:text-zinc-300">
                        {formatViews(item.viewsCount || 0)}
                      </span>
                      <span className="hidden sm:inline">visualizações</span>
                    </div>

                    {isSuperAdmin ? (
                      <button
                        type="button"
                        onClick={() => void inspectViewers(item)}
                        className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 text-[10px] font-black uppercase text-indigo-600 transition-colors hover:bg-indigo-500/20 dark:text-indigo-400"
                        title="Ver quem visualizou (Exclusivo Administrador do Sistema)"
                      >
                        <ShieldCheck className="h-3 w-3" />
                        Admin: Quem viu
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Área Expansível de Comentários */}
                {openComments === item.id || expandedArticleIds.has(item.id) ? (
                  <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
                    {commentLoading ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {(comments[item.id] || []).length === 0 ? (
                          <p className="py-2 text-center text-xs text-slate-400">
                            Nenhum comentário ainda. Seja o primeiro a responder!
                          </p>
                        ) : (
                          (comments[item.id] || []).map((comment) => (
                            <div key={comment.id} className="group/comment flex items-start gap-2.5">
                              <div className="relative shrink-0">
                                <Avatar className={cn(
                                  "h-8 w-8 border transition-all",
                                  comment.author.isSuperAdmin 
                                    ? "border-violet-500 ring-2 ring-violet-500/20 shadow-xs shadow-violet-500/10" 
                                    : "border-slate-200 dark:border-white/10"
                                )}>
                                  <AvatarImage src={comment.author.avatarUrl || undefined} />
                                  <AvatarFallback className={cn(
                                    "text-[9px] font-bold",
                                    comment.author.isSuperAdmin 
                                      ? "bg-gradient-to-tr from-violet-600 to-indigo-600 text-white" 
                                      : "bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200"
                                  )}>
                                    {initials(comment.author.name)}
                                  </AvatarFallback>
                                </Avatar>
                                {comment.author.isSuperAdmin ? (
                                  <span 
                                    title="Administrador da Dialogy"
                                    className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-violet-600 text-white shadow-2xs ring-1 ring-white dark:ring-[#0f1116]"
                                  >
                                    <ShieldCheck className="h-2.5 w-2.5" />
                                  </span>
                                ) : null}
                              </div>

                              <div className={cn(
                                "min-w-0 flex-1 rounded-2xl p-3 text-xs shadow-2xs transition-all",
                                comment.author.isSuperAdmin 
                                  ? "border border-violet-500/25 bg-gradient-to-br from-violet-500/[0.04] via-white to-white dark:from-violet-950/20 dark:via-[#0f1116] dark:to-[#0f1116] dark:border-violet-500/30" 
                                  : "border border-slate-200/80 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]"
                              )}>
                                <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-bold text-slate-950 dark:text-white">
                                      {comment.author.name}
                                    </span>

                                    {/* Badge de Admin da Dialogy */}
                                    {comment.author.isSuperAdmin ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-600/15 to-indigo-600/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-violet-700 dark:from-violet-500/25 dark:to-indigo-500/25 dark:text-violet-300 border border-violet-500/30 shadow-2xs">
                                        <ShieldCheck className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                                        Admin Dialogy
                                      </span>
                                    ) : null}

                                    {/* Badge da Workspace com Ícone/Avatar */}
                                    {comment.author.workspaceName ? (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
                                        {comment.author.workspaceAvatarUrl ? (
                                          <img
                                            src={comment.author.workspaceAvatarUrl}
                                            alt=""
                                            className="h-3 w-3 rounded-full object-cover"
                                          />
                                        ) : (
                                          <Building2 className="h-3 w-3 text-indigo-500 dark:text-indigo-400" />
                                        )}
                                        <span>{comment.author.workspaceName}</span>
                                      </span>
                                    ) : null}
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-slate-400">
                                      {timeAgo(comment.createdAt)}
                                    </span>

                                    {comment.isMine ? (
                                      <button
                                        type="button"
                                        onClick={() => void removeComment(item, comment)}
                                        className="rounded p-0.5 text-slate-300 transition-colors hover:text-rose-500 dark:text-zinc-500"
                                        title="Excluir comentário"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    ) : null}
                                  </div>
                                </div>

                                <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-700 dark:text-zinc-200">
                                  {comment.content}
                                </p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    <form
                      onSubmit={(event) => void submitComment(event, item)}
                      className="mt-3 flex gap-2"
                    >
                      <input
                        value={commentText}
                        onChange={(event) => setCommentText(event.target.value.slice(0, 1200))}
                        placeholder="Escreva uma resposta construtiva..."
                        className="h-9 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-white/[0.04]"
                      />
                      <Button
                        type="submit"
                        disabled={!commentText.trim()}
                        className="h-9 w-9 rounded-xl bg-slate-950 p-0 text-white dark:bg-white dark:text-slate-950"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          {!filtered.length ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-white/15 dark:bg-white/[0.02]">
              <Flame className="mx-auto h-8 w-8 text-slate-300 dark:text-zinc-600" />
              <h2 className="mt-3 font-bold text-slate-900 dark:text-white">
                {unavailable
                  ? 'Não foi possível carregar o feed agora'
                  : 'Nenhuma publicação encontrada para este filtro'}
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Seja a primeira pessoa a compartilhar um insight com a rede.
              </p>
            </div>
          ) : null}
        </section>

        {/* Coluna Lateral Direita (Aside Renovada e Inteligente) */}
        <aside className="hidden space-y-5 lg:block">
          {/* Card Destaque: Radar de Inovação LIA-1 */}
          <div className="relative overflow-hidden rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/40 via-[#0f1118] to-violet-950/40 p-5 shadow-lg shadow-indigo-500/5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-indigo-300">
                <Sparkles className="h-3 w-3" /> Sistema de Fronteira
              </span>
            </div>

            <h3 className="mt-3 text-base font-black tracking-tight text-white">
              LIA-1: Learning Inteligency Accuracy 1
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-300">
              Nosso novo sistema de IA adaptativa que acabou de sair do forno para sistemas autônomos. Ledgers imutáveis, detecção causal e memória BGE-M3.
            </p>

            {items.find((it) => it.slug.includes('lia-1')) ? (
              <button
                type="button"
                onClick={() => {
                  const lia = items.find((it) => it.slug.includes('lia-1'));
                  if (lia) {
                    void toggleExpandArticle(lia);
                  }
                }}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-2.5 text-xs font-bold text-white shadow-md transition-all hover:opacity-95"
              >
                Expandir Artigo no Feed <ChevronDown className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* Tópicos em Alta (#Trending) */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-white/[0.08] dark:bg-[#0f1116]">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400 dark:text-zinc-400">
              <TrendingUp className="h-3.5 w-3.5 text-indigo-500" />
              Tópicos em Alta
            </div>

            <div className="mt-3.5 space-y-2">
              {trendingTags.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => setSelectedTag(selectedTag === item.tag ? null : item.tag)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors',
                    selectedTag === item.tag
                      ? 'bg-indigo-500/15 font-bold text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-zinc-300 dark:hover:bg-white/[0.04]'
                  )}
                >
                  <span className="font-semibold">{item.label}</span>
                  <span className="text-[10px] text-slate-400">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Comunidade Ativa */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-white/[0.08] dark:bg-[#0f1116]">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400 dark:text-zinc-400">
              <Users className="h-3.5 w-3.5 text-cyan-500" />
              Construtores em Destaque
            </div>

            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
              Engenheiros, analistas e líderes operacionais criando a próxima geração de atendimento com a Dialogy.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300">
                ⚡ Agentes Autônomos
              </Badge>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300">
                🔬 Pesquisa Causal
              </Badge>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300">
                🛡️ Governança em IA
              </Badge>
            </div>
          </div>
        </aside>
      </main>

      {/* Modal Exclusivo Superadmin: Visualizadores do Post */}
      <Dialog
        open={Boolean(viewersModalItem)}
        onOpenChange={(open) => {
          if (!open) {
            setViewersModalItem(null);
            setViewersList([]);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-[#0c0e12]">
          <DialogHeader>
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-xs font-black uppercase tracking-wider">
                Auditoria de Visualizações
              </span>
            </div>
            <DialogTitle className="text-xl font-black text-slate-950 dark:text-white">
              Quem visualizou esta publicação
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-zinc-400">
              Métrica restrita ao Administrador do Sistema. Usuários comuns de workspace vêem apenas o total numérico.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            {loadingViewers ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                <p className="mt-2 text-xs font-medium">Carregando lista de acessos...</p>
              </div>
            ) : viewersList.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Nenhum registro de visualização autenticado até o momento.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs font-bold text-slate-400 dark:border-white/10">
                  <span>Usuário</span>
                  <span>Data / Hora</span>
                </div>
                {viewersList.map((viewer) => (
                  <div
                    key={viewer.id}
                    className="flex items-center justify-between rounded-xl bg-slate-50/80 p-2.5 dark:bg-white/[0.03]"
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-8 w-8 border border-slate-200 dark:border-white/10">
                        <AvatarImage src={viewer.avatarUrl || undefined} />
                        <AvatarFallback className="bg-indigo-600 text-[10px] font-bold text-white">
                          {initials(viewer.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          {viewer.name}
                        </div>
                        {viewer.email ? (
                          <div className="text-[10px] text-slate-400">{viewer.email}</div>
                        ) : null}
                      </div>
                    </div>

                    <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">
                      {dateLabel(viewer.viewedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
