'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, BadgeCheck, ImageIcon, Link2, Loader2, MessageCircle, Send, ThumbsUp, Trash2, UsersRound, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState, useTransition } from 'react';

import {
  addCommunityPostCommentAction,
  createCommunityPostAction,
  deleteCommunityPostAction,
  deleteCommunityPostCommentAction,
  getCommunityPostCommentsAction,
  reactCommunityPostAction,
} from '@/actions/community';
import { addProductUpdateCommentAction, deleteProductUpdateCommentAction, getProductUpdateCommentsAction, reactToProductUpdateAction } from '@/actions/product-updates';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { ProductUpdateComment, ProductUpdateContentBlock, ProductUpdateFeedItem } from '@/lib/product-updates';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function ArticleBlocks({ blocks, fallback }: { blocks: ProductUpdateContentBlock[]; fallback: string }) {
  if (!blocks.length) return <p className="whitespace-pre-line text-[15px] leading-7 text-slate-600 dark:text-zinc-300">{fallback}</p>;
  return <div className="space-y-5 text-[15px] leading-7 text-slate-600 dark:text-zinc-300">{blocks.map((block, index) => {
    if (block.type === 'heading') return block.level === 3 ? <h3 key={index} className="text-xl font-black text-slate-950 dark:text-white">{block.text}</h3> : <h2 key={index} className="text-2xl font-black text-slate-950 dark:text-white">{block.text}</h2>;
    if (block.type === 'paragraph') return <p key={index} className="whitespace-pre-line">{block.text}</p>;
    if (block.type === 'quote') return <blockquote key={index} className="rounded-2xl border-l-4 border-emerald-500 bg-emerald-500/[0.06] p-5 text-lg font-semibold">“{block.text}”{block.attribution ? <footer className="mt-2 text-xs text-emerald-600">— {block.attribution}</footer> : null}</blockquote>;
    if (block.type === 'divider') return <hr key={index} className="border-slate-200 dark:border-white/10" />;
    if (block.type === 'image') return <figure key={index}><img src={block.url} alt={block.alt} referrerPolicy="no-referrer" className="max-h-[560px] w-full rounded-2xl object-cover" />{block.caption ? <figcaption className="mt-2 text-center text-xs text-slate-400">{block.caption}</figcaption> : null}</figure>;
    if (block.type === 'video') return <div key={index} className="overflow-hidden rounded-2xl bg-black"><video src={block.url} poster={block.poster} controls preload="metadata" className="aspect-video w-full" /></div>;
    return null;
  })}</div>;
}

function ExternalMedia({ item }: { item: ProductUpdateFeedItem }) {
  const media = item.media;
  if (media?.type === 'image' || (!media && item.kind === 'update' && item.imageUrl)) {
    return <img src={media?.url || item.imageUrl || ''} alt="Mídia da publicação" loading="lazy" referrerPolicy="no-referrer" className="mt-4 max-h-[620px] w-full rounded-xl border border-slate-100 object-cover dark:border-white/[0.07]" />;
  }
  if (media?.type === 'youtube' || media?.type === 'vimeo') {
    return <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-black dark:border-white/10"><iframe src={media.url} title="Vídeo da publicação" className="aspect-video w-full" loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>;
  }
  return null;
}

export function CommunityFeed({ initialItems, unavailable }: { initialItems: ProductUpdateFeedItem[]; unavailable: boolean }) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<'all' | 'community' | 'updates'>('all');
  const [body, setBody] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [posting, setPosting] = useState(false);
  const [article, setArticle] = useState<ProductUpdateFeedItem | null>(null);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, ProductUpdateComment[]>>({});
  const [commentText, setCommentText] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [, startTransition] = useTransition();
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => setItems(initialItems), [initialItems]);
  const filtered = useMemo(() => items.filter((item) => tab === 'all' || (tab === 'updates' ? item.kind === 'update' : item.kind === 'community')), [items, tab]);
  const interactions = items.reduce((total, item) => total + item.reactions.likes + item.commentsCount + (item.poll?.totalVotes || 0), 0);

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    const result = await createCommunityPostAction({ body, media: mediaType && mediaUrl.trim() ? { type: mediaType, url: mediaUrl } : null });
    setPosting(false);
    if (!result.success) return toast({ title: 'Publicação não enviada', description: result.error, variant: 'destructive' });
    setBody(''); setMediaType(null); setMediaUrl('');
    toast({ title: 'Publicado na comunidade' });
    startTransition(() => router.refresh());
  };

  const react = async (item: ProductUpdateFeedItem) => {
    const before = item.reactions;
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, reactions: { ...candidate.reactions, likes: Math.max(0, candidate.reactions.likes + (candidate.reactions.mine === 'like' ? -1 : 1)), mine: candidate.reactions.mine === 'like' ? null : 'like' } } : candidate));
    const result = item.kind === 'community' ? await reactCommunityPostAction(item.id) : await reactToProductUpdateAction(item.id, 'like');
    if (!result.success) {
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, reactions: before } : candidate));
      toast({ title: 'Não foi possível curtir', description: result.error, variant: 'destructive' });
    }
  };

  const toggleComments = async (item: ProductUpdateFeedItem) => {
    if (openComments === item.id) return setOpenComments(null);
    setOpenComments(item.id); setCommentText('');
    if (comments[item.id]) return;
    setCommentLoading(true);
    const result = item.kind === 'community' ? await getCommunityPostCommentsAction(item.id) : await getProductUpdateCommentsAction(item.id);
    setCommentLoading(false);
    if (result.success) setComments((current) => ({ ...current, [item.id]: result.comments || [] }));
  };

  const submitComment = async (event: FormEvent, item: ProductUpdateFeedItem) => {
    event.preventDefault();
    if (!commentText.trim()) return;
    const result = item.kind === 'community' ? await addCommunityPostCommentAction(item.id, commentText) : await addProductUpdateCommentAction(item.id, commentText);
    if (!result.success || !result.comment) return toast({ title: 'Comentário não enviado', description: result.error, variant: 'destructive' });
    setComments((current) => ({ ...current, [item.id]: [...(current[item.id] || []), result.comment!] }));
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, commentsCount: candidate.commentsCount + 1 } : candidate));
    setCommentText('');
  };

  const removeComment = async (item: ProductUpdateFeedItem, comment: ProductUpdateComment) => {
    const result = item.kind === 'community' ? await deleteCommunityPostCommentAction(comment.id) : await deleteProductUpdateCommentAction(comment.id);
    if (!result.success) return;
    setComments((current) => ({ ...current, [item.id]: (current[item.id] || []).filter((candidate) => candidate.id !== comment.id) }));
  };

  const removePost = async (id: string) => {
    const result = await deleteCommunityPostAction(id);
    if (result.success) setItems((current) => current.filter((item) => item.id !== id));
  };

  return <div className="min-h-full bg-[#f4f5f7] text-slate-950 dark:bg-[#08090b] dark:text-white">
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0b0d10]/90"><div className="mx-auto flex max-w-[1120px] items-center justify-between px-4 py-3 sm:px-6"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/20"><UsersRound className="h-5 w-5" /></div><div><h1 className="text-lg font-black">Comunidade</h1><p className="text-[11px] text-slate-500">Ideias, memes e updates da Dialogy</p></div></div><div className="hidden text-xs text-slate-500 sm:block">{items.length} publicações · {interactions} interações</div></div></header>
    <main className="mx-auto grid max-w-[1120px] gap-6 px-3 py-5 sm:px-6 lg:grid-cols-[minmax(0,700px)_280px]">
      <section className="min-w-0 space-y-4">
        <form onSubmit={publish} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.09] dark:bg-[#111318]"><div className="flex gap-3 p-4 sm:p-5"><Avatar className="h-10 w-10 shrink-0"><AvatarImage src={user?.user_metadata?.avatar_url} alt="" /><AvatarFallback>{initials(user?.user_metadata?.full_name || user?.email || 'Você')}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><Textarea value={body} onChange={(event) => setBody(event.target.value.slice(0, 5000))} placeholder="Compartilhe uma ideia, descoberta ou meme..." className="min-h-[82px] resize-none border-0 bg-transparent p-0 text-[15px] shadow-none focus-visible:ring-0" />{mediaType ? <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]"><div className="mb-2 flex justify-between text-xs font-semibold"><span>{mediaType === 'image' ? 'URL da imagem ou meme' : 'URL do YouTube ou Vimeo'}</span><button type="button" onClick={() => { setMediaType(null); setMediaUrl(''); }} className="text-slate-400">Remover</button></div><input type="url" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://..." className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500 dark:border-white/10 dark:bg-[#0d0f13]" /></div> : null}</div></div><div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-white/[0.07]"><div className="flex"><button type="button" onClick={() => setMediaType('image')} className="flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-emerald-500/10 hover:text-emerald-600"><ImageIcon className="h-4 w-4" /> Imagem</button><button type="button" onClick={() => setMediaType('video')} className="flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-violet-500/10 hover:text-violet-600"><Video className="h-4 w-4" /> Vídeo</button></div><Button type="submit" disabled={posting || !body.trim()} className="h-9 rounded-xl bg-emerald-600 px-5 text-white">{posting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Publicar'}</Button></div></form>
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-white/[0.08] dark:bg-[#111318]">{([['all', 'Para você'], ['community', 'Comunidade'], ['updates', 'Updates']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={cn('flex-1 rounded-lg px-3 py-2 text-sm font-semibold', tab === value ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-500')}>{label}</button>)}</div>
        <AnimatePresence mode="popLayout">{filtered.map((item, index) => <motion.article layout key={item.id} id={item.slug} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(index * 0.025, 0.12) }} className="scroll-mt-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.09] dark:bg-[#111318]"><div className="p-4 sm:p-5"><div className="flex items-start gap-3"><Avatar className="h-11 w-11"><AvatarImage src={item.author?.avatarUrl || (item.kind === 'update' ? '/logo.png' : undefined)} alt="" /><AvatarFallback>{initials(item.author?.name || 'Dialogy')}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><span className="truncate text-sm font-bold">{item.author?.name || 'Time Dialogy'}</span>{item.kind === 'update' ? <BadgeCheck className="h-4 w-4 fill-violet-500 text-white" /> : null}{item.author?.workspaceName ? <span className="truncate text-xs text-slate-400">· {item.author.workspaceName}</span> : null}<span className="text-xs text-slate-400">· {dateLabel(item.publishedAt)}</span></div>{item.kind === 'update' ? <span className="mt-1 inline-flex rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-black uppercase text-violet-600">Update oficial</span> : null}</div>{item.isMine && item.kind === 'community' ? <button type="button" onClick={() => void removePost(item.id)} className="rounded-lg p-2 text-slate-300 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button> : null}</div>{item.kind === 'update' ? <button type="button" onClick={() => setArticle(item)} className="mt-4 block w-full text-left"><h2 className="text-xl font-black sm:text-2xl">{item.title}</h2><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-zinc-300">{item.summary || item.content}</p></button> : <p className="mt-4 whitespace-pre-line break-words text-[15px] leading-6 text-slate-700 dark:text-zinc-200">{item.content}</p>}<ExternalMedia item={item} />{item.kind === 'update' ? <button type="button" onClick={() => setArticle(item)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-500/10 px-4 py-2.5 text-sm font-bold text-violet-700 dark:text-violet-300">Ler atualização <ArrowUpRight className="h-4 w-4" /></button> : null}<div className="mt-4 flex border-t border-slate-100 pt-3 dark:border-white/[0.07]"><button type="button" onClick={() => void react(item)} className={cn('flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold', item.reactions.mine === 'like' ? 'bg-emerald-500/10 text-emerald-600' : 'text-slate-500')}><ThumbsUp className={cn('h-4 w-4', item.reactions.mine === 'like' && 'fill-current')} /> {item.reactions.likes || 'Curtir'}</button><button type="button" onClick={() => void toggleComments(item)} className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-500"><MessageCircle className="h-4 w-4" /> {item.commentsCount || 'Comentar'}</button><button type="button" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/comunidade#${item.slug}`); toast({ title: 'Link copiado' }); }} className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-500"><Link2 className="h-4 w-4" /><span className="hidden sm:inline">Compartilhar</span></button></div></div>
          {openComments === item.id ? <div className="border-t border-slate-100 bg-slate-50/70 p-4 dark:border-white/[0.07] dark:bg-white/[0.02]">{commentLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : <div className="space-y-3">{(comments[item.id] || []).map((comment) => <div key={comment.id} className="flex gap-2"><Avatar className="h-8 w-8"><AvatarImage src={comment.author.avatarUrl || undefined} /><AvatarFallback className="text-[9px]">{initials(comment.author.name)}</AvatarFallback></Avatar><div className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-sm dark:bg-white/[0.05]"><div className="font-bold">{comment.author.name}</div><p className="mt-0.5 whitespace-pre-line text-slate-600 dark:text-zinc-300">{comment.content}</p></div>{comment.isMine ? <button type="button" onClick={() => void removeComment(item, comment)} className="text-slate-300 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button> : null}</div>)}</div>}<form onSubmit={(event) => void submitComment(event, item)} className="mt-3 flex gap-2"><input value={commentText} onChange={(event) => setCommentText(event.target.value.slice(0, 1200))} placeholder="Escreva um comentário..." className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none dark:border-white/10 dark:bg-white/[0.04]" /><Button type="submit" disabled={!commentText.trim()} className="h-10 w-10 rounded-xl p-0"><Send className="h-4 w-4" /></Button></form></div> : null}
        </motion.article>)}</AnimatePresence>
        {!filtered.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-white/15 dark:bg-white/[0.025]"><UsersRound className="mx-auto h-8 w-8 text-slate-300" /><h2 className="mt-4 font-bold">{unavailable ? 'Não foi possível carregar a comunidade' : 'Seja a primeira pessoa a publicar'}</h2></div> : null}
      </section>
      <aside className="hidden space-y-4 lg:block"><div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/[0.09] dark:bg-[#111318]"><UsersRound className="h-6 w-6 text-emerald-600" /><h2 className="mt-3 font-black">Sobre a comunidade</h2><p className="mt-2 text-sm leading-6 text-slate-500">Troque experiências, publique memes e acompanhe os updates oficiais da Dialogy.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/[0.09] dark:bg-[#111318]"><h3 className="font-black">Mídia sustentável</h3><p className="mt-2 text-sm leading-6 text-slate-500">Imagens e vídeos entram somente por URL externa. A Dialogy não armazena esses arquivos.</p></div></aside>
    </main>
    <Dialog open={Boolean(article)} onOpenChange={(open) => { if (!open) setArticle(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">{article ? <><DialogHeader><span className="mb-2 w-fit rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-black uppercase text-violet-600">Update oficial</span><DialogTitle className="text-2xl font-black sm:text-3xl">{article.title}</DialogTitle><DialogDescription>{article.summary}</DialogDescription></DialogHeader>{article.imageUrl ? <img src={article.imageUrl} alt="" className="mt-4 max-h-[460px] w-full rounded-2xl object-cover" /> : null}<div className="mt-5"><ArticleBlocks blocks={article.contentBlocks} fallback={article.content} /></div></> : null}</DialogContent></Dialog>
  </div>;
}
