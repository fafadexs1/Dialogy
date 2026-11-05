'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, MessageCircle, Send, X } from 'lucide-react';

type Config = { name: string; title: string; welcomeMessage: string; primaryColor: string; position: 'left' | 'right'; requireName: boolean; requireEmail: boolean };
type ChatMessage = { id: string; content: string; fromMe: boolean; createdAt: string };

export function WebchatClient({ publicKey, parentOrigin, currentUrl, referrer }: { publicKey: string; parentOrigin: string; currentUrl: string; referrer: string }) {
  const storageKey = `dialogy:webchat:${publicKey}`;
  const [config, setConfig] = useState<Config | null>(null);
  const [identity, setIdentity] = useState({ name: '', email: '' });
  const [session, setSession] = useState<{ sessionId: string; token: string; visitorId: string } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const messagesRequestRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    messagesRef.current = [];
    setMessages([]);
  }, [session?.sessionId]);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const edgeEndpoint = supabaseUrl
      ? `${supabaseUrl}/functions/v1/webchat-widget/${encodeURIComponent(publicKey)}?origin=${encodeURIComponent(parentOrigin)}`
      : null;
    const fallbackEndpoint = `/api/webchat/widgets/${encodeURIComponent(publicKey)}?origin=${encodeURIComponent(parentOrigin)}`;

    const fetchConfig = async () => {
      if (edgeEndpoint) {
        try {
          const res = await fetch(edgeEndpoint);
          if (res.ok) return await res.json();
        } catch {
          // Silenciosamente tenta fallback
        }
      }
      const fallbackRes = await fetch(fallbackEndpoint);
      if (!fallbackRes.ok) throw new Error('Widget indisponível.');
      return await fallbackRes.json();
    };

    fetchConfig()
      .then((loaded) => {
        setConfig(loaded);
        parent.postMessage({ type: 'dialogy:webchat:config', primaryColor: loaded.primaryColor, position: loaded.position }, '*');
      })
      .catch((err) => setError(err.message));

    try { const saved = localStorage.getItem(storageKey); if (saved) setSession(JSON.parse(saved)); } catch {}
  }, [parentOrigin, publicKey, storageKey]);

  const authHeaders = useMemo<Record<string, string>>(
    () => {
      const headers: Record<string, string> = {};
      if (session) headers.Authorization = `Bearer ${session.token}`;
      return headers;
    },
    [session],
  );
  const loadMessages = useCallback(async () => {
    if (!session) return;
    if (messagesRequestRef.current) return messagesRequestRef.current;
    const request = (async () => {
      const latestMessage = messagesRef.current.at(-1);
      const params = new URLSearchParams();
      if (latestMessage?.createdAt) params.set('after', latestMessage.createdAt);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const response = await fetch(`/api/webchat/sessions/${session.sessionId}/messages${suffix}`, { headers: authHeaders });
      if (response.status === 401) { localStorage.removeItem(storageKey); setSession(null); return; }
      if (!response.ok) return;
      const incoming = ((await response.json()).messages ?? []) as ChatMessage[];
      if (!incoming.length) return;
      setMessages((current) => {
        const byId = new Map(current.map((message) => [message.id, message]));
        incoming.forEach((message) => byId.set(message.id, message));
        return [...byId.values()].sort((a, b) => {
          const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          return timeDiff || a.id.localeCompare(b.id);
        });
      });
    })();
    messagesRequestRef.current = request;
    try {
      await request;
    } finally {
      if (messagesRequestRef.current === request) messagesRequestRef.current = null;
    }
  }, [authHeaders, session, storageKey]);

  useEffect(() => {
    if (!session) return;
    void loadMessages();
    const timer = window.setInterval(() => void loadMessages(), 1800);
    return () => window.clearInterval(timer);
  }, [loadMessages, session]);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  async function begin(event: FormEvent) {
    event.preventDefault(); setError('');
    const query = new URLSearchParams(currentUrl.split('?')[1] || '');
    const utm = Object.fromEntries([...query.entries()].filter(([key]) => key.startsWith('utm_')));
    const response = await fetch(`/api/webchat/widgets/${encodeURIComponent(publicKey)}/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...identity, origin: parentOrigin, currentUrl, referrer, visitorId: crypto.randomUUID(), utm }),
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error === 'origin_not_allowed' ? 'Este domínio não está autorizado.' : 'Não foi possível iniciar o atendimento.'); return; }
    localStorage.setItem(storageKey, JSON.stringify(data)); setSession(data);
  }

  async function send(event: FormEvent) {
    event.preventDefault(); if (!session || !content.trim() || sending) return;
    const value = content.trim(); setContent(''); setSending(true); setError('');
    const response = await fetch(`/api/webchat/sessions/${session.sessionId}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders }, body: JSON.stringify({ content: value }),
    });
    if (!response.ok) { setContent(value); setError('Não foi possível enviar. Tente novamente.'); }
    else await loadMessages();
    setSending(false);
  }

  if (error && !config) return <div className="flex h-screen items-center justify-center p-8 text-center text-sm text-slate-600">{error}</div>;
  if (!config) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>;
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-white text-slate-900">
      <header className="flex items-center gap-3 px-4 py-4 text-white" style={{ backgroundColor: config.primaryColor }}>
        {session ? <button onClick={() => setSession(null)} className="rounded-full p-1 hover:bg-white/15" aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></button> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><MessageCircle className="h-5 w-5" /></span>}
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{config.name}</p><p className="text-xs text-white/80">Atendimento pelo site</p></div>
        <button onClick={() => parent.postMessage({ type: 'dialogy:webchat:close' }, '*')} className="rounded-full p-1 hover:bg-white/15" aria-label="Fechar"><X className="h-5 w-5" /></button>
      </header>
      {!session ? (
        <form onSubmit={begin} className="flex flex-1 flex-col justify-center gap-4 p-6">
          <div><h1 className="text-xl font-bold">{config.title}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{config.welcomeMessage}</p></div>
          {(config.requireName || config.requireEmail) && <div className="space-y-3">
            {config.requireName && <input required value={identity.name} onChange={(e) => setIdentity((v) => ({ ...v, name: e.target.value }))} placeholder="Seu nome" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500" />}
            {config.requireEmail && <input required type="email" value={identity.email} onChange={(e) => setIdentity((v) => ({ ...v, email: e.target.value }))} placeholder="Seu e-mail" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500" />}
          </div>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button className="rounded-xl px-4 py-3 text-sm font-semibold text-white" style={{ backgroundColor: config.primaryColor }}>Iniciar conversa</button>
          <p className="text-center text-[11px] text-slate-400">Ao continuar, você concorda com o tratamento dos dados enviados.</p>
        </form>
      ) : (
        <>
          <section className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
            <div className="max-w-[86%] rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm shadow-sm"><p>{config.welcomeMessage}</p></div>
            {messages.map((message) => <div key={message.id} className={`flex ${message.fromMe ? 'justify-start' : 'justify-end'}`}><div className={`max-w-[86%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${message.fromMe ? 'rounded-tl-md bg-white' : 'rounded-tr-md text-white'}`} style={message.fromMe ? undefined : { backgroundColor: config.primaryColor }}><p className="whitespace-pre-wrap break-words">{message.content}</p><p className={`mt-1 text-[10px] ${message.fromMe ? 'text-slate-400' : 'text-white/70'}`}>{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p></div></div>)}
            <div ref={bottomRef} />
          </section>
          <form onSubmit={send} className="border-t border-slate-100 bg-white p-3"><div className="flex items-end gap-2 rounded-2xl bg-slate-100 p-2"><textarea rows={1} maxLength={4000} value={content} onChange={(e) => setContent(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Digite sua mensagem..." className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none" /><button disabled={sending || !content.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl text-white disabled:opacity-50" style={{ backgroundColor: config.primaryColor }}><Send className="h-4 w-4" /></button></div>{error && <p className="mt-1 text-xs text-red-600">{error}</p>}</form>
        </>
      )}
    </main>
  );
}
