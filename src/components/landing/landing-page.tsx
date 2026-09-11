"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BarChart3,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  Command,
  Globe,
  Inbox,
  KanbanSquare,
  Menu,
  MessageCircle,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import {
  FaFacebookMessenger,
  FaInstagram,
  FaTelegram,
  FaWhatsapp,
} from "react-icons/fa6";
import { HOME_FAQ_ITEMS } from "@/content/home-seo";
import { DEFAULT_TRIAL_DAYS } from "@/lib/plans-types";
import s from "./landing.module.css";

const navigation = [
  ["Plataforma", "#plataforma"],
  ["Inteligência artificial", "#ia"],
  ["Como funciona", "#como-funciona"],
  ["Planos", "#planos"],
];
const channels = [
  { name: "WhatsApp", Icon: FaWhatsapp },
  { name: "Instagram", Icon: FaInstagram },
  { name: "Messenger", Icon: FaFacebookMessenger },
  { name: "Telegram", Icon: FaTelegram },
  { name: "Chat do site", Icon: Globe },
];
const contacts = [
  {
    name: "Marina Costa",
    initials: "MC",
    channel: "WhatsApp",
    preview: "Perfeito! Quero conhecer os planos.",
    message:
      "Oi! Estou procurando uma solução para organizar o atendimento da minha empresa.",
    response:
      "Oi, Marina! Vamos encontrar a melhor opção para sua equipe. Quantas pessoas atendem com você hoje?",
    detail: "Interesse em atendimento para equipe",
    color: "#c5a8f4",
  },
  {
    name: "Rafael Lima",
    initials: "RL",
    channel: "Instagram",
    preview: "Vocês atendem minha região?",
    message:
      "Olá! Vi vocês no Instagram. Como posso saber mais sobre o serviço?",
    response:
      "Olá, Rafael! Posso te ajudar. Me conte um pouco sobre o que você precisa e vou direcionar para a equipe certa.",
    detail: "Novo contato pelo Instagram",
    color: "#f2b991",
  },
  {
    name: "Luiza Martins",
    initials: "LM",
    channel: "Chat do site",
    preview: "Obrigada pela ajuda! 💚",
    message: "Preciso de ajuda para configurar meu primeiro canal.",
    response:
      "Claro, Luiza! Vou encaminhar sua solicitação ao suporte com o histórico da nossa conversa.",
    detail: "Ajuda com a configuração inicial",
    color: "#91c5f2",
  },
];

function Logo({ footer = false }: { footer?: boolean }) {
  return (
    <Link href="/" aria-label="Dialogy — página inicial" className={s.logo}>
      <Image
        src="/logo.png"
        alt="Dialogy"
        width={150}
        height={38}
        sizes="150px"
        preload={!footer}
      />
    </Link>
  );
}

function ProductDemo() {
  const [tab, setTab] = useState("inbox");
  const [contact, setContact] = useState(0);
  const person = contacts[contact];
  const tabs = [
    { id: "inbox", title: "Inbox unificado", Icon: Inbox },
    { id: "ai", title: "Agentes de IA", Icon: Sparkles },
    { id: "crm", title: "CRM de vendas", Icon: KanbanSquare },
  ];
  return (
    <div>
      <div
        className={s.demoTabs}
        role="tablist"
        aria-label="Explore a plataforma"
      >
        {tabs.map(({ id, title, Icon }, index) => (
          <button
            key={id}
            id={`tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 2
                      : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                setTab(tabs[next].id);
                document.getElementById(`tab-${tabs[next].id}`)?.focus();
              }
            }}
          >
            <Icon size={16} />
            {title}
          </button>
        ))}
      </div>
      <div className={s.productWindow}>
        <div className={s.windowBar}>
          <span className={s.windowDots}>
            <i />
            <i />
            <i />
          </span>
          <span>
            <ShieldCheck size={12} /> Seu espaço de trabalho
          </span>
          <span className={s.demoLabel}>DEMONSTRAÇÃO INTERATIVA</span>
        </div>
        <div
          id={`panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          tabIndex={0}
          className={s.productBody}
        >
          <aside className={s.appRail} aria-hidden="true">
            <Command className={s.railBrand} />
            <Inbox className={s.railActive} />
            <Users />
            <KanbanSquare />
            <Bot />
            <BarChart3 />
            <span className={s.railBottom}>D</span>
          </aside>
          {tab === "inbox" ? (
            <>
              <div className={s.contactList}>
                <div className={s.listHeading}>
                  <strong>Conversas</strong>
                  <span>3</span>
                </div>
                <div className={s.searchMock}>
                  <Search size={14} /> Buscar conversa
                </div>
                <div className={s.listFilter}>
                  Todas as conversas <ChevronDown size={13} />
                </div>
                {contacts.map((item, i) => (
                  <button
                    key={item.name}
                    onClick={() => setContact(i)}
                    aria-pressed={contact === i}
                    className={`${s.contact} ${contact === i ? s.selectedContact : ""}`}
                  >
                    <span
                      className={s.avatar}
                      style={{ background: item.color }}
                    >
                      {item.initials}
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.preview}</small>
                      <em>{item.channel}</em>
                    </span>
                    <span className={s.contactTime}>agora</span>
                  </button>
                ))}
                <div className={s.teamNote}>
                  <span className={s.onlineDot} /> Sua equipe, no mesmo lugar.
                </div>
              </div>
              <div className={s.conversation} key={person.name}>
                <div className={s.conversationHeader}>
                  <span
                    className={s.avatar}
                    style={{ background: person.color }}
                  >
                    {person.initials}
                  </span>
                  <span>
                    <strong>{person.name}</strong>
                    <small>{person.channel} · Atendimento comercial</small>
                  </span>
                  <MoreHorizontal size={19} />
                </div>
                <div className={s.messages}>
                  <span className={s.today}>Hoje</span>
                  <div className={s.incoming}>
                    {person.message}
                    <small>10:42</small>
                  </div>
                  <div className={s.aiNotice}>
                    <Sparkles size={12} /> Agente de IA entrou na conversa
                  </div>
                  <div className={s.outgoing}>
                    {person.response}
                    <small>
                      10:42 <CheckCheck size={13} />
                    </small>
                  </div>
                  <div className={s.contextNote}>
                    <CircleCheck size={13} /> Contexto salvo. Equipe pronta para
                    continuar.
                  </div>
                </div>
                <div className={s.composer}>
                  <span>Uma conversa. Todas as possibilidades.</span>
                  <span>
                    <Send size={15} />
                  </span>
                </div>
              </div>
              <aside className={s.customerPanel}>
                <span className={s.panelEyebrow}>SOBRE O CONTATO</span>
                <span
                  className={s.profileAvatar}
                  style={{ background: person.color }}
                >
                  {person.initials}
                </span>
                <strong>{person.name}</strong>
                <small>Histórico conectado</small>
                <div className={s.customerTags}>
                  <span>Novo lead</span>
                  <span>Comercial</span>
                </div>
                <hr />
                <span className={s.panelEyebrow}>RESUMO INTELIGENTE</span>
                <p>
                  {person.detail}. O histórico acompanha cada etapa do
                  atendimento.
                </p>
                <div className={s.contextCard}>
                  <Sparkles size={16} />
                  <span>
                    Menos perguntas repetidas.
                    <br />
                    <strong>Mais conexão.</strong>
                  </span>
                </div>
              </aside>
            </>
          ) : tab === "ai" ? (
            <div className={s.aiDemo}>
              <div>
                <span className={s.eyebrow}>
                  <Sparkles size={14} /> SEU AGENTE DE IA
                </span>
                <h3>
                  Uma boa conversa
                  <br />
                  começa com contexto.
                </h3>
                <p>
                  Seu conteúdo, seu jeito de atender e as regras da sua
                  operação.
                </p>
                <div className={s.demoKnowledge}>
                  <Check size={15} /> Catálogo de produtos{" "}
                  <span>Conhecimento</span>
                </div>
                <div className={s.demoKnowledge}>
                  <Check size={15} /> Perguntas frequentes{" "}
                  <span>Conhecimento</span>
                </div>
                <div className={s.demoKnowledge}>
                  <Check size={15} /> Encaminhar para um especialista{" "}
                  <span>Regra</span>
                </div>
              </div>
              <div className={s.aiFlow}>
                <span>
                  <MessageCircle /> Cliente faz uma pergunta
                </span>
                <i />
                <span className={s.flowHighlighted}>
                  <Sparkles /> IA consulta seu conteúdo
                </span>
                <i />
                <span>
                  <Users /> Equipe recebe com contexto
                </span>
                <small>Exemplo ilustrativo de um fluxo de atendimento.</small>
              </div>
            </div>
          ) : (
            <div className={s.crmDemo}>
              <div className={s.crmHeading}>
                <div>
                  <small>RELACIONAMENTO QUE AVANÇA</small>
                  <h3>Da primeira mensagem à próxima conquista.</h3>
                </div>
                <KanbanSquare />
              </div>
              <div className={s.kanban}>
                {[
                  ["Novos contatos", "Marina Costa", "Rafael Lima"],
                  ["Em conversa", "Luiza Martins", "Pedro Alves"],
                  ["Próximo passo", "Ana Oliveira"],
                ].map((column, i) => (
                  <div key={column[0]}>
                    <h4>
                      <i
                        style={{
                          background: ["#a78bfa", "#6fb5ee", "#6de6b5"][i],
                        }}
                      />
                      {column[0]}
                      <span>{column.length - 1}</span>
                    </h4>
                    {column.slice(1).map((name, j) => (
                      <article key={name}>
                        <span className={s.kanbanTag}>
                          {i === 0
                            ? "Novo lead"
                            : i === 1
                              ? "Em atendimento"
                              : "Follow-up"}
                        </span>
                        <strong>{name}</strong>
                        <p>
                          {
                            ["Solução para equipe", "Conhecer os serviços"][
                              j % 2
                            ]
                          }
                        </p>
                        <footer>
                          <FaWhatsapp /> Conversa vinculada{" "}
                          <ArrowUpRight size={13} />
                        </footer>
                      </article>
                    ))}
                  </div>
                ))}
              </div>
              <small className={s.exampleNote}>
                Exemplo ilustrativo de organização de oportunidades.
              </small>
            </div>
          )}
        </div>
      </div>
      <div className={s.demoFoot}>
        <span>
          <span className={s.onlineDot} /> Canais conectados. Contexto
          preservado.
        </span>
        <span>
          Explore as abas acima <MousePointer2 size={13} />
        </span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const elements = root.current?.querySelectorAll("[data-reveal]");
    if (!elements || !("IntersectionObserver" in window)) return;
    root.current?.setAttribute("data-animated", "true");
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-visible", "true");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  return (
    <div ref={root} className={s.landing}>
      <a className={s.skipLink} href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Logo />
          <nav aria-label="Navegação principal" className={s.desktopNav}>
            {navigation.map(([label, href]) => (
              <a href={href} key={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className={s.headerActions}>
            <Link href="/login" className={s.login}>
              Entrar <ArrowUpRight size={14} />
            </Link>
            <Link href="/register" className={s.headerCta}>
              Começar agora <ArrowRight size={14} />
            </Link>
            <button
              ref={menuButton}
              className={s.menuButton}
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
              aria-controls="landing-menu"
              aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="landing-menu"
            aria-label="Navegação mobile"
            className={s.mobileNav}
          >
            {navigation.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)}>
                {label}
                <ArrowUpRight size={15} />
              </a>
            ))}
            <Link href="/login">
              Entrar na minha conta <ArrowRight size={15} />
            </Link>
          </nav>
        )}
      </header>
      <main id="conteudo">
        <section className={s.hero}>
          <div className={s.heroAtmosphere} aria-hidden="true">
            <div className={s.orbitOne} />
            <div className={s.orbitTwo} />
            <div className={s.starfield} />
            <span className={`${s.floatingChannel} ${s.floatWhatsapp}`}>
              <FaWhatsapp />
            </span>
            <span className={`${s.floatingChannel} ${s.floatInstagram}`}>
              <FaInstagram />
            </span>
            <span className={`${s.floatingChannel} ${s.floatMessenger}`}>
              <FaFacebookMessenger />
            </span>
            <span className={`${s.floatingChannel} ${s.floatTelegram}`}>
              <FaTelegram />
            </span>
          </div>
          <div className={s.heroContent}>
            <a href="#ia" className={s.heroBadge}>
              <span className={s.onlineDot} /> Inteligência que aproxima.{" "}
              <span>
                Conheça a Dialogy <ArrowUpRight size={12} />
              </span>
            </a>
            <h1>
              Mais conexão.
              <br />
              <span>Em cada conversa.</span>
            </h1>
            <p>
              Todos os seus canais, sua equipe e o poder da IA.
              <br className={s.desktopBreak} /> Juntos para transformar
              atendimento em relacionamento.
            </p>
            <div className={s.heroActions}>
              <Link href="/register" className={s.primaryButton}>
                Começar minha experiência <ArrowUpRight size={18} />
              </Link>
              <a href="#plataforma" className={s.secondaryButton}>
                Explorar a plataforma <ArrowDown size={16} />
              </a>
            </div>
            <div className={s.heroReassurance}>
              <span>
                <Check size={13} /> {DEFAULT_TRIAL_DAYS} dias para experimentar
              </span>
              <span>
                <Check size={13} /> Sua equipe inteira conectada
              </span>
            </div>
          </div>
          <div id="plataforma" className={s.productSection}>
            <ProductDemo />
          </div>
        </section>
        <section id="canais" className={s.channelSection}>
          <div className={s.container}>
            <p>
              SEU CLIENTE ESCOLHE O CANAL.{" "}
              <strong>VOCÊ CONTINUA A CONVERSA.</strong>
            </p>
            <div className={s.channelRow}>
              {channels.map(({ name, Icon }) => (
                <span key={name}>
                  <Icon />
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>
        <section className={s.section}>
          <div className={s.container}>
            <div className={s.sectionHeading} data-reveal>
              <div>
                <span className={s.eyebrow}>
                  <span className={s.tinyCross}>✳</span> MENOS ABAS. MAIS
                  POSSIBILIDADES.
                </span>
                <h2>
                  Seu atendimento.
                  <br />
                  <span>Em outra dimensão.</span>
                </h2>
              </div>
              <p>
                Da primeira mensagem ao próximo negócio.
                <br />
                Tudo o que sua operação precisa para seguir em frente, no mesmo
                lugar.
              </p>
            </div>
            <div className={s.featureGrid}>
              <article
                className={`${s.featureCard} ${s.inboxCard}`}
                data-reveal
              >
                <span className={s.featureIcon}>
                  <Inbox />
                </span>
                <h3>
                  Todos os canais.
                  <br />
                  Uma conversa completa.
                </h3>
                <p>
                  WhatsApp, Instagram, Messenger, Telegram e seu site em uma
                  única caixa de entrada. Seu cliente não precisa começar do
                  zero.
                </p>
                <div className={s.channelDiagram} aria-hidden="true">
                  <div>
                    {channels.slice(0, 4).map(({ Icon, name }) => (
                      <span key={name}>
                        <Icon />
                      </span>
                    ))}
                  </div>
                  <div className={s.connectorLines} />
                  <span className={s.diagramHub}>
                    <Inbox size={26} />
                    <span>Inbox Dialogy</span>
                    <i className={s.onlineDot} />
                  </span>
                </div>
                <span className={s.cardCaption}>
                  Várias origens. O mesmo cuidado. <ArrowUpRight size={16} />
                </span>
              </article>
              <article
                className={`${s.featureCard} ${s.workflowCard}`}
                data-reveal
              >
                <span className={s.featureIcon}>
                  <Workflow />
                </span>
                <h3>
                  O trabalho repetitivo?
                  <br />
                  Deixa com o fluxo.
                </h3>
                <p>
                  Crie jornadas visuais para organizar a triagem, coletar
                  informações e encaminhar cada pessoa ao time certo.
                </p>
                <div className={s.workflowIllustration} aria-hidden="true">
                  <span>
                    <MessageCircle size={16} /> Nova mensagem <i />
                  </span>
                  <div className={s.workflowLine} />
                  <span>
                    <Zap size={16} /> Identificar o interesse <i />
                  </span>
                  <div className={s.workflowSplit} />
                  <div>
                    <span>
                      <Users size={14} /> Vendas
                    </span>
                    <span>
                      <AudioLines size={14} /> Suporte
                    </span>
                  </div>
                </div>
              </article>
              <article
                className={`${s.featureCard} ${s.smallCard}`}
                data-reveal
              >
                <span className={s.featureIcon}>
                  <KanbanSquare />
                </span>
                <h3>Conversas que viram oportunidades.</h3>
                <p>
                  Organize contatos, acompanhe as etapas da venda e mantenha o
                  próximo passo à vista com o CRM.
                </p>
                <div className={s.miniPipeline} aria-hidden="true">
                  <span>Contato</span>
                  <ArrowRight size={14} />
                  <span>Conversa</span>
                  <ArrowRight size={14} />
                  <span>Conquista</span>
                </div>
              </article>
              <article
                className={`${s.featureCard} ${s.smallCard}`}
                data-reveal
              >
                <span className={s.featureIcon}>
                  <Users />
                </span>
                <h3>Um time que joga junto.</h3>
                <p>
                  Filas, departamentos e permissões. Distribua os atendimentos
                  com clareza e mantenha o histórico com a equipe.
                </p>
                <div className={s.teamIllustration} aria-hidden="true">
                  <span>MC</span>
                  <span>RL</span>
                  <span>LM</span>
                  <span>
                    <Plus size={17} />
                  </span>
                  <small>Todo mundo na mesma página.</small>
                </div>
              </article>
              <article
                className={`${s.featureCard} ${s.smallCard}`}
                data-reveal
              >
                <span className={s.featureIcon}>
                  <BarChart3 />
                </span>
                <h3>Enxergue além da mensagem.</h3>
                <p>
                  Acompanhe volume, tempo de resposta e desempenho para entender
                  sua operação e decidir com mais clareza.
                </p>
                <div className={s.miniChart} aria-hidden="true">
                  {[27, 43, 34, 57, 46, 65, 58, 80, 72, 93, 83, 100].map(
                    (height, i) => (
                      <i key={i} style={{ height: `${height}%` }} />
                    ),
                  )}
                </div>
              </article>
            </div>
          </div>
        </section>
        <section id="ia" className={s.aiSection}>
          <div className={`${s.container} ${s.aiGrid}`}>
            <div className={s.aiCopy} data-reveal>
              <span className={s.eyebrow}>
                <Sparkles size={15} /> INTELIGÊNCIA COM O SEU JEITO
              </span>
              <h2>
                Artificial na tecnologia.
                <br />
                <span>Natural na conversa.</span>
              </h2>
              <p>
                Uma IA que usa o conhecimento da sua empresa, entende a
                necessidade do cliente e ajuda sua equipe a chegar mais longe.
              </p>
              <ul>
                <li>
                  <Check /> Respostas baseadas nos seus materiais e regras.
                </li>
                <li>
                  <Check /> Coleta de dados e qualificação de oportunidades.
                </li>
                <li>
                  <Check /> Transferência para humanos com o contexto da
                  conversa.
                </li>
              </ul>
              <Link href="/register" className={s.textLink}>
                Conhecer meu próximo agente <ArrowUpRight size={18} />
              </Link>
            </div>
            <div className={s.aiVisual} data-reveal>
              <div className={s.aiOrb} aria-hidden="true">
                <div />
                <div />
                <span>
                  <Sparkles size={38} />
                </span>
              </div>
              <span className={`${s.orbTag} ${s.orbTagOne}`}>
                <ShieldCheck size={14} /> Seu conhecimento
              </span>
              <span className={`${s.orbTag} ${s.orbTagTwo}`}>
                <MessageCircle size={14} /> Sua linguagem
              </span>
              <div className={s.handoffCard}>
                <span className={s.handoffIcon}>
                  <Users size={19} />
                </span>
                <div>
                  <small>IA + EQUIPE</small>
                  <strong>
                    A conversa continua.
                    <br />O contexto também.
                  </strong>
                </div>
                <CheckCheck size={19} />
              </div>
            </div>
          </div>
        </section>
        <section id="como-funciona" className={s.section}>
          <div className={s.container}>
            <div className={s.centerHeading} data-reveal>
              <span className={s.eyebrow}>
                DO PRIMEIRO OLÁ AO PRÓXIMO NÍVEL
              </span>
              <h2>
                Começar pode ser <span>simples assim.</span>
              </h2>
            </div>
            <div className={s.steps}>
              {[
                {
                  title: "Conecte seus canais",
                  text: "Traga os canais em que seus clientes já estão. As mensagens passam a chegar no mesmo lugar.",
                  Icon: MessageCircle,
                },
                {
                  title: "Dê o seu toque",
                  text: "Organize sua equipe, adicione seus conteúdos e configure as regras do seu atendimento.",
                  Icon: Sparkles,
                },
                {
                  title: "Deixe a conversa fluir",
                  text: "Atenda com contexto, acompanhe os resultados e evolua sua operação a cada interação.",
                  Icon: Zap,
                },
              ].map(({ title, text, Icon }, i) => (
                <article key={title} data-reveal>
                  <div>
                    <span>0{i + 1}</span>
                    <Icon size={22} />
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section id="planos" className={s.plansSection}>
          <div className={`${s.container} ${s.planBanner}`} data-reveal>
            <div>
              <span className={s.eyebrow}>
                <Users size={14} /> ESPAÇO PARA TODA A EQUIPE
              </span>
              <h2>
                Sua operação cresce.
                <br />
                <span>A Dialogy acompanha.</span>
              </h2>
              <p>
                Planos por volume de conversas, com usuários ilimitados.
                <br />
                Encontre o melhor momento para dar o próximo passo.
              </p>
            </div>
            <div className={s.planAction}>
              <Link href="/pricing" className={s.primaryButton}>
                Encontrar meu plano <ArrowUpRight size={18} />
              </Link>
              <span>
                {DEFAULT_TRIAL_DAYS} dias de teste nos planos self-service.
              </span>
              <small>Recursos e limites variam conforme o plano.</small>
            </div>
          </div>
        </section>
        <section id="faq" className={s.section}>
          <div className={`${s.container} ${s.faqGrid}`}>
            <div data-reveal>
              <span className={s.eyebrow}>VAMOS CONVERSAR?</span>
              <h2>
                Boas perguntas.
                <br />
                <span>Respostas claras.</span>
              </h2>
              <p>Seu próximo passo começa sem dúvidas.</p>
              <a
                className={s.textLink}
                href="https://wa.me/551151994714"
                target="_blank"
                rel="noopener noreferrer"
              >
                Falar com nossa equipe <ArrowUpRight size={17} />
              </a>
            </div>
            <div className={s.faqList}>
              {HOME_FAQ_ITEMS.map((item) => (
                <details key={item.question}>
                  <summary>
                    {item.question}
                    <Plus size={17} />
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <section className={s.finalCta}>
          <div className={s.finalOrbit} aria-hidden="true" />
          <span className={s.eyebrow}>
            <span className={s.onlineDot} /> GRANDES RELAÇÕES COMEÇAM COM UM
            OLÁ.
          </span>
          <h2>
            Sua próxima boa conversa
            <br />
            <span>começa aqui.</span>
          </h2>
          <Link href="/register" className={s.primaryButton}>
            Vamos começar? <ArrowUpRight size={20} />
          </Link>
          <p>Mais perto dos seus clientes. Mais longe com seu negócio.</p>
        </section>
      </main>
      <footer className={s.footer}>
        <div className={`${s.container} ${s.footerTop}`}>
          <div>
            <Logo footer />
            <p>
              Tecnologia para aproximar.
              <br />
              Conversas para transformar.
            </p>
          </div>
          <div>
            <strong>Plataforma</strong>
            <a href="#plataforma">Explore a Dialogy</a>
            <a href="#ia">Inteligência artificial</a>
            <Link href="/pricing">Planos e preços</Link>
          </div>
          <div>
            <strong>Vamos juntos</strong>
            <Link href="/login">Acessar minha conta</Link>
            <a
              href="https://wa.me/551151994714"
              target="_blank"
              rel="noopener noreferrer"
            >
              Fale com a equipe
            </a>
            <Link href="/developer/docs">Documentação</Link>
          </div>
        </div>
        <div className={`${s.container} ${s.footerBottom}`}>
          <span>
            © {new Date().getFullYear()} Dialogy. Feita para conectar.
          </span>
          <div>
            <Link href="/privacy">Privacidade</Link>
            <Link href="/terms">Termos de uso</Link>
          </div>
          <span>
            <span className={s.onlineDot} /> De pessoas, para pessoas.
          </span>
        </div>
      </footer>
    </div>
  );
}
