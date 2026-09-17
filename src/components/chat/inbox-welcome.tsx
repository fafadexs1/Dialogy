'use client';

import { ArrowUpRight, MessageCircle, Search, Sparkles, UsersRound } from 'lucide-react';

export function InboxWelcome({ name }: { name?: string }) {
  const firstName = name?.trim().split(/\s+/)[0];
  return (
    <section className="inbox-welcome" aria-label="Boas-vindas ao Inbox">
      <div className="inbox-welcome-top"><span><span className="inbox-brand-dot" /> DIALOGY / INBOX</span><span>Feito para conectar.</span></div>
      <div className="inbox-welcome-body">
        <div className="inbox-conversation-art" aria-hidden="true">
          <div className="inbox-art-orbit" />
          <div className="inbox-art-chip inbox-art-people"><UsersRound size={22} strokeWidth={1.5} /></div>
          <div className="inbox-art-back"><span /><span /><span /></div>
          <div className="inbox-art-front"><MessageCircle size={46} strokeWidth={1.2} /><i /><i /><i /></div>
          <div className="inbox-art-chip inbox-art-ai"><Sparkles size={23} strokeWidth={1.5} /></div>
        </div>
        <p className="inbox-welcome-eyebrow">{firstName ? `SEU ESPAÇO, ${firstName.toLocaleUpperCase('pt-BR')}.` : 'SEU ESPAÇO DE CONVERSAS.'}</p>
        <h1>Mais presença.<br /><span>Melhores conversas.</span></h1>
        <p className="inbox-welcome-description">Pessoas, contexto e inteligência, juntos.<br />Escolha uma conversa e faça a diferença no próximo atendimento.</p>
        <button className="inbox-welcome-search" type="button" onClick={() => {
          document.querySelector<HTMLInputElement>('.inbox-chat-list input[aria-label="Pesquisar conversas"]')?.focus();
        }}><Search size={16} /> Encontrar uma conversa <ArrowUpRight size={16} /></button>
      </div>
      <div className="inbox-welcome-principles">
        <div><MessageCircle size={17} /><span><strong>Cada pessoa importa</strong><small>Conversas com contexto.</small></span></div>
        <div><UsersRound size={17} /><span><strong>O seu time, junto</strong><small>Atendimento em sintonia.</small></span></div>
        <div><Sparkles size={17} /><span><strong>Inteligência por perto</strong><small>IA no seu ritmo.</small></span></div>
      </div>
    </section>
  );
}
