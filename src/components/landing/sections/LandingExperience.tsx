'use client';

import Image from 'next/image';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import {
  ArrowRight, BarChart3, Check, ChevronDown, Headphones, Infinity as InfinityIcon,
  Menu, MessageCircle, Repeat2, Scale, ShoppingBag, Users, X, Zap,
} from 'lucide-react';
import { BrandMark } from '@/components/landing/BrandMark';

const ease = [0.22, 1, 0.36, 1] as const;

function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div className={className} initial={reduced ? false : { opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-8%' }} transition={{ duration: reduced ? 0 : .52, delay, ease }}>
      {children}
    </motion.div>
  );
}

const steps = [
  ['1', 'Chega de todo lugar', 'WhatsApp, Instagram, E-mail, Chat, Telefone e mais.'],
  ['2', 'Tudo em uma inbox', 'Mensagens chegam em tempo real para o time.'],
  ['3', 'Roteia e distribui', 'Atribuição inteligente e equilíbrio de carga.'],
] as const;

const benefits = [
  ['Respostas mais rápidas', 'Centralize canais e tenha contexto completo para resolver de primeira.', Zap],
  ['Trabalho equilibrado', 'Distribuição automática evita filas e sobrecarga no time.', Scale],
  ['Escala com liberdade', 'Convide quantos usuários precisar, sem limites e sem complicação.', InfinityIcon],
] as const;

const uses = [
  ['Vendas', 'Transforme mensagens em oportunidades sem perder o histórico.', ShoppingBag],
  ['Suporte', 'Organize filas, prioridades e transferências com contexto.', Headphones],
  ['Pós-venda', 'Continue a relação depois da compra no mesmo lugar.', Repeat2],
  ['Operações', 'Acompanhe volume e distribuição com clareza.', BarChart3],
] as const;

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#050507]/95 backdrop-blur-md">
      <nav className="mx-auto flex h-[88px] max-w-[1400px] items-center px-5 sm:px-8 lg:h-[72px]">
        <Link href="/" aria-label="Dialogy — início"><BrandMark /></Link>
        <div className="mx-auto hidden items-center gap-8 lg:flex">
          {['Produto', 'Recursos', 'Integrações', 'Empresa'].map(item => <a key={item} href={item === 'Produto' ? '#produto' : item === 'Recursos' ? '#recursos' : item === 'Integrações' ? '/integrations' : '/about'} className="flex items-center gap-1 text-[13px] font-medium text-white/75 transition hover:text-white">{item}<ChevronDown className="h-3 w-3" /></a>)}
          <a href="#pricing" className="text-[13px] font-medium text-white/75 transition hover:text-white">Preços</a>
        </div>
        <div className="ml-auto hidden items-center gap-5 lg:flex">
          <Link href="/login" className="text-[13px] font-medium text-white/65 hover:text-white">Entrar</Link>
          <Link href="/register" className="rounded-lg bg-[#32d67f] px-5 py-3 text-[13px] font-bold text-black transition hover:bg-[#48df92]">Começar grátis</Link>
        </div>
        <button type="button" className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 lg:hidden" aria-label={open ? 'Fechar menu' : 'Abrir menu'} aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? <X /> : <Menu />}</button>
      </nav>
      <AnimatePresence>
        {open && <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="fixed inset-x-0 top-[88px] z-50 border-b border-white/10 bg-[#050507] p-5 lg:hidden">
          <div className="space-y-2">{[['Produto','#produto'],['Recursos','#recursos'],['Integrações','/integrations'],['Preços','#pricing'],['Empresa','/about']].map(([label,href]) => <a key={label} href={href} onClick={() => setOpen(false)} className="block rounded-xl px-4 py-3 text-lg font-semibold text-white/80 hover:bg-white/5">{label}</a>)}</div>
          <div className="mt-5 grid gap-3 border-t border-white/10 pt-5"><Link href="/login" className="landing-ref-button landing-ref-secondary">Entrar</Link><Link href="/register" className="landing-ref-button landing-ref-primary">Começar grátis</Link></div>
        </motion.div>}
      </AnimatePresence>
    </header>
  );
}

export function LandingExperience() {
  return (
    <div className="landing-reference bg-[#050507] text-white">
      <section id="produto" className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_67%_40%,rgba(58,169,255,.075),transparent_32%),radial-gradient(circle_at_43%_38%,rgba(25,245,178,.07),transparent_26%)]" />
        <div className="relative mx-auto grid max-w-[1280px] gap-8 px-5 pb-12 pt-5 sm:px-8 md:pt-16 lg:min-h-[530px] lg:grid-cols-[470px_minmax(0,1fr)] lg:items-start lg:gap-12 lg:pb-14 lg:pt-12">
          <Reveal className="lg:pt-6">
            <h1 className="max-w-[560px] text-[34px] font-extrabold leading-[1.02] tracking-[-.045em] sm:text-[54px] lg:text-[58px]">
              <span className="block">Toda conversa</span>
              <span className="block">chega. <span className="text-brand-green">A equipe</span></span>
              <span className="block text-brand-green">certa responde.</span>
            </h1>
            <p className="mt-4 max-w-[520px] text-sm leading-5 text-white/65 md:mt-6 md:text-lg md:leading-8">Todos os canais em uma inbox compartilhada. Converse, transfira e resolva com contexto.</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row md:mt-7">
              <Link className="landing-ref-button landing-ref-primary" href="/register">Começar grátis</Link>
              <a className="landing-ref-button landing-ref-secondary" href="#como-funciona"><span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/40 text-[9px]">▶</span> Ver como funciona</a>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-1 text-[10px] text-white/60 md:mt-7 lg:flex lg:gap-x-7 lg:text-xs">
              <span className="flex flex-col items-center gap-1 text-center lg:flex-row lg:gap-2"><Zap className="h-4 w-4 text-brand-green" />Tempo real</span>
              <span className="flex flex-col items-center gap-1 text-center lg:flex-row lg:gap-2"><Scale className="h-4 w-4 text-brand-green" />Distribuição equilibrada</span>
              <span className="flex flex-col items-center gap-1 text-center lg:flex-row lg:gap-2"><InfinityIcon className="h-4 w-4 text-brand-green" />Usuários ilimitados</span>
            </div>
          </Reveal>
          <Reveal delay={.1} className="relative max-md:-mx-[5px] lg:w-full lg:max-w-[605px] lg:justify-self-end">
            <div aria-hidden className="absolute inset-5 rounded-[40px] bg-gradient-to-br from-brand-green/20 via-transparent to-brand-blue/20 blur-3xl" />
            <motion.div whileHover={{ y: -3 }} transition={{ duration: .25 }} className="relative overflow-hidden rounded-[26px] border border-white/15 bg-[#070a0e] shadow-[0_28px_90px_rgba(0,0,0,.55)]">
              <Image src="/landing-hero-inbox-dark.webp" alt="Inbox escura da Dialogy mostrando uma conversa distribuída para a equipe" width={605} height={475} priority sizes="(max-width: 1024px) 100vw, 60vw" className="hidden h-auto w-full md:block" />
              <Image src="/landing-hero-inbox-mobile.webp" alt="Lista de atendimentos da inbox Dialogy no celular" width={290} height={475} priority sizes="100vw" className="h-[395px] w-full object-cover object-top md:hidden" />
              <div aria-hidden className="landing-scan absolute inset-x-0 top-0 h-px bg-brand-green/70" />
            </motion.div>
          </Reveal>
        </div>
      </section>

      <section id="como-funciona" className="border-t border-white/10 pb-16 pt-8 md:pb-24">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
          <Reveal className="hidden md:block">
            <Image src="/landing-flow-visual.webp" alt="Fluxo de mensagens dos canais para uma inbox e distribuição equilibrada entre atendentes" width={1052} height={370} sizes="100vw" className="h-auto w-full" />
          </Reveal>
          <div className="md:hidden">
            <Reveal><h2 className="mb-5 text-center text-3xl font-black tracking-tight">Como funciona</h2></Reveal>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.025]">
              {steps.map(([n,title,text],i) => <Reveal key={n} delay={i*.06}><article className={`flex gap-4 p-5 ${i < steps.length - 1 ? 'border-b border-white/10' : ''}`}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-black text-black">{n}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-white/55">{text}</p></div></article></Reveal>)}
            </div>
            <Reveal className="mt-3"><Link href="/register" className="landing-ref-button landing-ref-primary w-full">Começar grátis</Link><p className="mt-3 text-center text-xs text-white/40">Não é necessário cartão de crédito</p></Reveal>
          </div>
        </div>
      </section>

      <section id="recursos" className="landing-defer border-y border-white/10 py-20 md:py-28">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
          <Reveal className="max-w-4xl"><p className="text-xs font-bold uppercase tracking-[.22em] text-brand-green">Uma plataforma, vários jeitos de usar</p><h2 className="mt-4 text-4xl font-black tracking-[-.045em] md:text-6xl">A mesma conversa.<br/><span className="text-brand-green">Vários times em sintonia.</span></h2><p className="mt-5 max-w-2xl text-lg leading-8 text-white/60">Vendas, suporte, pós-venda e operações trabalham no mesmo lugar, com o contexto sempre à mão.</p></Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{uses.map(([title,text,Icon],i)=><Reveal key={title} delay={i*.06}><article className="group flex min-h-64 flex-col justify-between rounded-[26px] border border-white/10 bg-white/[.025] p-6 transition duration-300 hover:-translate-y-1 hover:border-brand-green/35"><Icon className="h-7 w-7 text-brand-green"/><div><h3 className="text-2xl font-bold">{title}</h3><p className="mt-3 text-sm leading-6 text-white/55">{text}</p></div></article></Reveal>)}</div>
        </div>
      </section>

      <section className="landing-defer relative overflow-hidden py-24 md:py-32">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(25,245,178,.15),transparent_42%)]" />
        <Reveal className="relative mx-auto max-w-5xl px-5 text-center sm:px-8"><MessageCircle className="mx-auto h-12 w-12 text-brand-green"/><h2 className="mt-6 text-[clamp(3.2rem,8vw,7rem)] font-black leading-[.9] tracking-[-.06em]">Cliente feliz<br/><span className="text-brand-green">volta e indica.</span></h2><p className="mx-auto mt-7 max-w-2xl text-lg leading-8 text-white/60">Quando a equipe responde com agilidade e todo o contexto, cada atendimento fortalece a relação com a sua marca.</p><Link href="/register" className="landing-ref-button landing-ref-primary mt-8">Começar grátis <ArrowRight className="h-4 w-4"/></Link></Reveal>
      </section>
    </div>
  );
}
