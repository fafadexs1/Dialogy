"use client";

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion';
import { ArrowDown, ArrowRight, ArrowUpRight, AudioLines, BookOpen, Check, CheckCheck, ChevronDown, FileText, Globe, Heart, ImageIcon, Menu, MessageCircle, MousePointer2, Plus, ShieldCheck, Sparkles, Tags, Users, Workflow, X, Zap } from 'lucide-react';
import { FaFacebookMessenger, FaInstagram, FaTelegram, FaWhatsapp } from 'react-icons/fa6';
import { AI_FAQ } from '@/content/ai-page';
import s from './ai-page.module.css';

const scenarios = [
  { name: 'Vender melhor', label: 'AGENTE COMERCIAL', icon: Sparkles, question: 'Oi! Quero conhecer os serviços. Mas sem aquele textão, tá? 😅', reply: 'Combinado, vamos direto ao que importa. 😊 Você procura uma solução para você ou para sua empresa?', action: 'Entende a intenção', second: 'É para minha empresa. Somos 8 pessoas no atendimento.', answer: 'Boa! Vou passar esse contexto para o nosso time comercial ajudar você a escolher.', result: 'Interesse e tamanho da equipe registrados no CRM', tags: ['Novo lead', 'Equipe de 8 pessoas'] },
  { name: 'Dar suporte', label: 'AGENTE DE SUPORTE', icon: MessageCircle, question: 'Socorro, não consigo conectar meu canal. Já cliquei em tudo 🙃', reply: 'Vamos por partes. Qual canal você está tentando conectar: WhatsApp, Instagram ou outro?', action: 'Coleta o contexto', second: 'WhatsApp. Aparece uma mensagem de erro na conexão.', answer: 'Pode me enviar uma imagem do erro? Assim consigo entender melhor e seguir as orientações de suporte da empresa.', result: 'Contexto organizado para o próximo passo do atendimento', tags: ['Suporte', 'Conexão WhatsApp'] },
  { name: 'Organizar o financeiro', label: 'AGENTE FINANCEIRO', icon: FileText, question: 'Oi! A segunda via da minha fatura sumiu por aqui 🫠', reply: 'Eu te ajudo a encontrar. Primeiro, vamos confirmar os dados necessários para localizar seu cadastro.', action: 'Identifica o cliente', second: 'Pronto, dados confirmados. Pode consultar.', answer: 'Encontrei sua fatura no sistema conectado. Aqui está o link da segunda via. 😊', result: 'Consulta e segunda via pela integração configurada', tags: ['Cliente identificado', 'Segunda via'] },
];
const tones = [
  { name: 'Descontraído', text: 'Opa, chegou no lugar certo! 😎 Me conta: como posso facilitar seu dia?', caption: 'Um sorriso até do outro lado da tela.' },
  { name: 'Acolhedor', text: 'Olá! Que bom ter você aqui. 💚 Conte comigo para encontrar o que você precisa.', caption: 'Cuidado que dá para sentir na conversa.' },
  { name: 'Objetivo', text: 'Olá! Como posso ajudar? Posso tirar dúvidas ou direcionar você à equipe responsável.', caption: 'Direto ao ponto. Com toda a atenção.' },
];
const steps = [
  { title: 'Entende o pedido', text: 'Identifica a intenção e coleta as informações que faltam, dentro do atendimento que você desenhou.', icon: MessageCircle, detail: '“Quero conhecer os planos para minha empresa.”', chip: 'Intenção: conhecer serviços' },
  { title: 'Consulta o que sabe', text: 'Busca nos materiais da empresa e nas integrações que você conectou as informações para ajudar.', icon: BookOpen, detail: 'Materiais da empresa → serviços e condições', chip: 'Conhecimento da sua empresa' },
  { title: 'Coloca a mão na massa', text: 'Executa as ações permitidas: atualiza o CRM, aplica etiquetas ou consulta um sistema conectado.', icon: Zap, detail: 'Contato → interesse registrado → etiqueta aplicada', chip: 'Ações configuradas por você' },
  { title: 'Dá o próximo passo', text: 'Responde, conclui o procedimento ou encaminha para uma pessoa, conforme as regras da sua operação.', icon: Users, detail: '“Vou conectar você ao nosso time comercial.”', chip: 'Equipe certa, contexto junto' },
];

function Mascot({ small = false }: { small?: boolean }) {
  return <div className={`${s.mascot} ${small ? s.mascotSmall : ''}`} aria-hidden="true"><div className={s.face}><i /><i /><b /></div><span className={s.cheek} /><span className={s.cheekRight} /><span className={s.mascotGlint} /></div>;
}

function ConversationDemo() {
  const [selected, setSelected] = useState(0);
  const item = scenarios[selected];
  return <div className={s.demoLayout}>
    <div className={s.demoChoices}>
      <span className={s.eyebrow}>UM AGENTE. MUITAS POSSIBILIDADES.</span>
      <h2>De “oi” a<br /><em>“resolvido”.</em></h2>
      <p>O cliente chega com uma dúvida. Sua IA entra com contexto, conversa e um próximo passo.</p>
      <div className={s.scenarioButtons} aria-label="Escolha um exemplo de atendimento">
        {scenarios.map(({ name, icon: Icon }, index) => <button key={name} aria-pressed={selected === index} onClick={() => setSelected(index)}><Icon size={19} />{name}<ArrowUpRight size={18} /></button>)}
      </div>
      <span className={s.finePrint}>Exemplos ilustrativos. As ações dependem das configurações e integrações do seu agente.</span>
    </div>
    <div className={s.chatWindow}>
      <div className={s.chatHeader}><span className={s.chatAvatar}><Sparkles size={20} /></span><div><strong>Seu próximo agente</strong><span>IA da Dialogy · {item.label.toLowerCase()}</span></div><span className={s.online} /></div>
      <div className={s.chatBody} key={selected} aria-live="polite" aria-atomic="true">
        <span className={s.exampleLabel}>EXEMPLO DE CONVERSA</span>
        <div className={s.customerBubble}>{item.question}</div>
        <div className={s.aiBubble}>{item.reply}<CheckCheck size={13} /></div>
        <div className={s.chatEvent}><Sparkles size={12} />{item.action}</div>
        <div className={s.customerBubble}>{item.second}</div>
        <div className={s.aiBubble}>{item.answer}<CheckCheck size={13} /></div>
        <div className={s.chatResult}><span><Check size={15} />{item.result}</span><div>{item.tags.map(tag => <b key={tag}>{tag}</b>)}</div></div>
      </div>
      <div className={s.chatBottom}><span>Menos tarefas repetidas. Mais conversa boa.</span><Heart size={16} /></div>
    </div>
  </div>;
}

export default function AiPage() {
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tone, setTone] = useState(0);
  const [transcript, setTranscript] = useState(false);
  const [step, setStep] = useState(0);
  const [handoff, setHandoff] = useState(false);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 100, damping: 30 });
  const { scrollYProgress: heroProgress } = useScroll({ target: hero, offset: ['start start', 'end start'] });
  const heroY = useTransform(heroProgress, [0, 1], [0, 100]);
  const heroRotate = useTransform(heroProgress, [0, 1], [-7, 8]);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.setAttribute('data-visible', 'true');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    root.current?.querySelectorAll('[data-reveal]').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const nav = [['O que ela faz', '#possibilidades'], ['Do seu jeito', '#personalidade'], ['Como funciona', '#como-funciona']];
  const activeStep = steps[step];

  return <div className={s.page} ref={root}>
    <a className={s.skip} href="#conteudo-ia">Pular para o conteúdo</a>
    <motion.div className={s.progress} style={{ scaleX: reduced ? scrollYProgress : progress }} />
    <header className={s.header}>
      <div className={s.headerInner}>
        <Link href="/" className={s.logo} aria-label="Dialogy — página inicial"><Image src="/logo.png" alt="Dialogy" width={120} height={30} preload /></Link>
        <span className={s.headerDivider} /><Link href="/ia" className={s.productName}>Inteligência artificial<span>IA</span></Link>
        <nav className={s.desktopNav} aria-label="Navegação da página de IA">{nav.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav>
        <Link href="/register" className={s.navCta}>Começar <ArrowUpRight size={14} /></Link>
        <button className={s.menuButton} aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menuOpen} aria-controls="ai-mobile-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      </div>
      {menuOpen && <nav id="ai-mobile-nav" className={s.mobileNav} aria-label="Navegação mobile" onKeyDown={e => { if (e.key === 'Escape') setMenuOpen(false); }}>{nav.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}<ArrowUpRight size={16} /></a>)}<Link href="/pricing">Planos e preços<ArrowUpRight size={16} /></Link></nav>}
    </header>
    <main id="conteudo-ia">
      <section className={s.hero} ref={hero}>
        <div className={s.heroGrid} aria-hidden="true" />
        <div className={s.heroCopy}>
          <span className={s.heroBadge}><span /> DIALOGY AI <span className={s.badgeDivider} /> O SEU NOVO SUPERPODER</span>
          <h1>Inteligência artificial.<br /><span>Carisma natural.</span><Sparkles className={s.titleSpark} aria-hidden="true" /></h1>
          <p>Atende, entende e faz acontecer.<br />Uma IA com a cabeça na sua empresa e o coração na conversa.</p>
          <div className={s.heroActions}><Link className={s.primaryButton} href="/register">Quero essa IA no meu time <ArrowUpRight size={18} /></Link><a href="#possibilidades" className={s.textButton}>Olha o que ela faz <ArrowDown size={16} /></a></div>
        </div>
        <div className={s.heroStage}>
          <div className={s.orbit} aria-hidden="true" /><div className={s.orbitTwo} aria-hidden="true" />
          <motion.div className={s.heroMascot} style={{ y: reduced ? 0 : heroY, rotate: reduced ? -7 : heroRotate }}><Mascot /></motion.div>
          <div className={`${s.floatingCard} ${s.floatLeft}`}><span className={s.floatIcon}><AudioLines size={21} /></span><div><strong>“Mandei um áudio, pode ser?”</strong><span>Pode. Pode muito. 🎧</span></div></div>
          <div className={`${s.floatingCard} ${s.floatRight}`}><span className={s.floatIcon}><Check size={22} /></span><div><strong>Conversa boa. CRM em dia.</strong><span>Seu agente conecta os pontos.</span></div></div>
          <span className={s.helloNote}>Prazer, seu braço direito.<svg viewBox="0 0 75 40" fill="none" aria-hidden="true"><path d="M3 2C16 32 40 5 68 30m-13-2 13 3-2-14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></span>
          <span className={s.mascotShadow} aria-hidden="true" />
          <span className={s.heroCaption}><Sparkles size={13} /> Tecnologia séria. Energia boa.</span>
        </div>
      </section>

      <section className={s.channelStrip} aria-label="Canais conectados">
        <p>Onde a conversa acontece,<br /><strong>a Dialogy conecta.</strong></p>
        <div>{[{ name: 'WhatsApp', Icon: FaWhatsapp }, { name: 'Instagram', Icon: FaInstagram }, { name: 'Messenger', Icon: FaFacebookMessenger }, { name: 'Telegram', Icon: FaTelegram }, { name: 'Chat do site', Icon: Globe }].map(({ name, Icon }) => <span key={name}><Icon size={22} />{name}</span>)}</div>
      </section>

      <section className={`${s.section} ${s.intro}`} data-reveal>
        <span className={s.eyebrow}>MENOS “SÓ UM MOMENTINHO”.</span>
        <h2>Mais conversa.<br />Mais solução.<br /><span>Mais gente sendo bem atendida.</span></h2>
        <p>Responder é só o começo. A IA da Dialogy usa o conhecimento da sua empresa, organiza informações e executa os próximos passos que você definiu. Tudo conectado ao seu atendimento.</p>
        <div className={s.introPills}><span><BookOpen size={16} /> Conhece seu negócio</span><span><Zap size={16} /> Age com suas regras</span><span><Heart size={16} /> Trabalha com seu time</span></div>
      </section>

      <section id="possibilidades" className={`${s.section} ${s.demoSection}`}><div className={s.container} data-reveal><ConversationDemo /></div></section>

      <section id="personalidade" className={`${s.section} ${s.personality}`}>
        <div className={s.container}>
          <div className={s.centerHeading} data-reveal><span className={s.eyebrow}>INTELIGÊNCIA TEM. PERSONALIDADE TAMBÉM.</span><h2>A sua marca.<br /><em>Até no “oi”.</em></h2><p>Escolha o tom, defina as instruções e crie especialistas para cada missão. O jeito de conversar continua sendo seu.</p></div>
          <div className={s.personalityVisual} data-reveal>
            <div className={s.toneCharacter}><Mascot /><span>Uma IA. O seu jeito.</span></div>
            <div className={s.tonePanel}><span className={s.panelLabel}>ESCOLHA UMA VIBE</span><div className={s.toneControls} aria-label="Exemplos de tom de voz">{tones.map(({ name }, index) => <button key={name} aria-pressed={tone === index} onClick={() => setTone(index)}>{name}</button>)}</div><div className={s.toneMessage} key={tone} aria-live="polite"><Sparkles size={23} /><p>{tones[tone].text}</p></div><span className={s.toneCaption}>{tones[tone].caption}</span><span className={s.finePrint}>Prévia ilustrativa de personalidade.</span></div>
          </div>
          <div className={s.specialists}><span><i className={s.greenDot} /> Comercial que sabe ouvir.</span><span><i className={s.purpleDot} /> Suporte que vai por partes.</span><span><i className={s.orangeDot} /> Financeiro sem frieza.</span></div>
        </div>
      </section>

      <section className={`${s.section} ${s.knowledge}`}>
        <div className={`${s.container} ${s.knowledgeGrid}`}>
          <div data-reveal><span className={s.eyebrow}>CONHECIMENTO DA CASA</span><h2>Ela estuda<br />a sua empresa.<br /><em>Sem pedir café.</em></h2><p>Seus materiais, produtos, orientações e perguntas frequentes viram fonte de consulta para o agente. Assim, a conversa ganha o contexto do seu negócio.</p><div className={s.inlineNote}><ShieldCheck size={20} /><span>Você escolhe as fontes, as instruções e o que pode ser publicado.</span></div></div>
          <div className={s.knowledgeVisual} aria-label="Ilustração de materiais usados como conhecimento" data-reveal><div className={`${s.document} ${s.docBack}`}><BookOpen /><strong>O jeito da nossa marca</strong><span>Tom de voz · orientações</span><i /><i /><i /></div><div className={`${s.document} ${s.docMiddle}`}><FileText /><strong>Perguntas frequentes</strong><span>Perguntas reais. Contexto da casa.</span><i /><i /><i /></div><div className={`${s.document} ${s.docFront}`}><span className={s.documentIcon}><Sparkles /></span><strong>Seu conhecimento.<br />Na conversa certa.</strong><span>PDF, textos e materiais da empresa</span><div className={s.sourceChip}><Check size={13} /> Fontes escolhidas por você</div></div><span className={s.knowledgeSticker}>Bem informada.<br />Bem sua. <Heart size={16} /></span></div>
        </div>
      </section>

      <section className={`${s.section} ${s.senses}`}>
        <div className={s.container}><div className={s.centerHeading} data-reveal><span className={s.eyebrow}>PODE MANDAR DO SEU JEITO</span><h2>Texto, áudio, imagem.<br /><em>Ela pega a conversa.</em></h2><p>Porque cliente nenhum vem com manual de instruções.<br />E nem sempre a dúvida chega digitada.</p></div>
          <div className={s.senseGrid}>
            <article className={s.audioCard} data-reveal><span className={s.cardKicker}><AudioLines size={18} /> OUVIDOS ATENTOS</span><h3>O áudio de 2 minutos?<br />Vira contexto.</h3><p>Transcreva mensagens de voz para entender o pedido e facilitar o atendimento.</p><button className={s.audioPreview} aria-expanded={transcript} aria-controls="audio-transcript" onClick={() => setTranscript(!transcript)}><span className={s.audioButton}><AudioLines size={20} /></span><span className={s.wave} aria-hidden="true">{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ '--bar': `${12 + ((i * 17) % 34)}px`, '--delay': `${i * 35}ms` } as CSSProperties} />)}</span><span>0:12</span></button><button className={s.underlinedButton} onClick={() => setTranscript(!transcript)} aria-expanded={transcript} aria-controls="audio-transcript">{transcript ? 'Ocultar transcrição de exemplo' : 'Ver transcrição de exemplo'}<ChevronDown size={15} /></button>{transcript && <div className={s.transcript} id="audio-transcript">“Oi, pessoal! Queria saber como funciona o atendimento para uma equipe de oito pessoas. Vocês podem me ajudar?”</div>}</article>
            <article className={s.visionCard} data-reveal><span className={s.cardKicker}><ImageIcon size={18} /> OLHAR PARA OS DETALHES</span><h3>“É esse erro aqui, ó.”<br />Agora ficou mais claro.</h3><p>Imagens e documentos ajudam a IA a interpretar o que o cliente está tentando explicar.</p><div className={s.imageExample}><div className={s.miniPhoto}><div /><ImageIcon size={30} /><span>imagem-do-cliente.png</span></div><span className={s.visionBubble}><Sparkles size={15} /> Mais contexto para ajudar.</span><MousePointer2 className={s.pointer} size={29} /></div></article>
          </div><p className={s.sectionFootnote}>Recursos de mídia variam conforme o canal, o formato e o modelo de IA configurado.</p>
        </div>
      </section>

      <section id="como-funciona" className={`${s.section} ${s.workflowSection}`}>
        <div className={s.container}><div className={s.workflowHeading} data-reveal><span className={s.eyebrow}>PAPO BOM. AÇÃO TAMBÉM.</span><h2>Por trás de um “deixa comigo”,<br /><em>tem muita coisa acontecendo.</em></h2><p>Com o Estúdio de Agentes e o Nexus, você conecta conversa, conhecimento e ações em uma jornada com as suas regras.</p></div>
          <div className={s.workflowDemo} data-reveal><div className={s.stepNav} aria-label="Etapas de um atendimento">{steps.map(({ title, icon: Icon }, index) => <button key={title} aria-pressed={step === index} onClick={() => setStep(index)}><span>0{index + 1}</span><Icon size={22} /><strong>{title}</strong><ArrowRight size={17} /></button>)}</div><div className={s.stepContent} key={step} aria-live="polite"><span className={s.stepNumber}>0{step + 1}</span><div><span className={s.stepChip}><activeStep.icon size={14} />{activeStep.chip}</span><h3>{activeStep.title}.</h3><p>{activeStep.text}</p><div className={s.stepExample}>{activeStep.detail}</div></div></div></div>
          <div className={s.workflowFooter}><span><Tags size={17} /> CRM e etiquetas</span><span><Workflow size={17} /> Procedimentos e integrações</span><span><ShieldCheck size={17} /> Permissões e confirmações</span></div>
        </div>
      </section>

      <section className={`${s.section} ${s.humanSection}`}>
        <div className={`${s.container} ${s.humanGrid}`}>
          <div className={s.handoffVisual} data-reveal><span className={s.panelLabel}>DUPLA BOA É ASSIM</span><div className={s.handoffAvatars}><span className={s.handoffAi}><Sparkles size={30} /></span><span className={s.handoffLine}><i /><i /><i /><ArrowRight size={18} /></span><span className={s.humanAvatar}>Ju<span>💚</span></span></div><div className={s.handoffMessage} aria-live="polite"><strong>{handoff ? 'Ju, da equipe. Com o contexto em mãos.' : 'IA da Dialogy. Preparando o próximo passo.'}</strong><p>{handoff ? '“Oi! Vi que você quer uma solução para 8 pessoas. Vamos continuar de onde parou?”' : '“Essa conversa merece alguém do nosso time. Vou encaminhar seu atendimento.”'}</p></div><div className={s.contextNote}><FileText size={18} /><div><strong>Histórico disponível no Inbox</strong><span>Pedido, mensagens e informações do contato.</span></div><Check size={17} /></div><button className={s.handoffButton} onClick={() => setHandoff(!handoff)}>{handoff ? 'Rever exemplo' : 'Ver a passagem para a equipe'}<ArrowRight size={17} /></button><span className={s.finePrint}>Exemplo ilustrativo de transferência.</span></div>
          <div data-reveal><span className={s.eyebrow}>IA + PESSOAS = 💚</span><h2>Sabe ajudar.<br />E sabe a hora<br /><em>de chamar você.</em></h2><p>Quando a conversa pede uma pessoa, o agente encaminha para a equipe definida. O histórico continua ali, e os resumos ajudam seu time a entrar no assunto.</p><p className={s.humanPunchline}>A tecnologia cuida do caminho.<br />As pessoas continuam no centro.</p></div>
        </div>
      </section>

      <section className={`${s.section} ${s.controlSection}`}>
        <div className={s.container}><div className={s.centerHeading} data-reveal><span className={s.eyebrow}>SUPERPODER, COM DIREÇÃO</span><h2>O talento é da IA.<br /><em>O comando é seu.</em></h2></div><div className={s.controlGrid}>{[{ Icon: ShieldCheck, title: 'Limites bem combinados.', text: 'Defina instruções, ações permitidas e quando o agente deve pedir confirmação ou chamar sua equipe.' }, { Icon: Sparkles, title: 'Teste. Ajuste. Publique.', text: 'Experimente a jornada antes de ativar o agente e publique uma versão do atendimento que você preparou.' }, { Icon: FileText, title: 'Acompanhe de perto.', text: 'Consulte o histórico de sessões, acompanhe o consumo de IA e refine o atendimento com mais contexto.' }].map(({ Icon, title, text }) => <article key={title} data-reveal><span><Icon size={25} /></span><h3>{title}</h3><p>{text}</p></article>)}</div></div>
      </section>

      <section className={`${s.section} ${s.faqSection}`}><div className={`${s.container} ${s.faqGrid}`}><div data-reveal><span className={s.eyebrow}>AINDA COM AQUELA DÚVIDA?</span><h2>Pode perguntar.<br /><em>A gente gosta.</em></h2><p>Algumas respostas antes do nosso primeiro “oi”.</p></div><div className={s.faqList}>{AI_FAQ.map(item => <details key={item.question}><summary>{item.question}<Plus size={20} /></summary><p>{item.answer}</p></details>)}</div></div></section>

      <section className={s.finalCta}><div className={s.ctaHalo} aria-hidden="true" /><div data-reveal><span className={s.eyebrow}><Sparkles size={15} /> UM NOVO JEITO DE ATENDER</span><h2>Sua equipe acaba<br />de ganhar um <em>superpoder.</em></h2><p>Mais espaço para criar conexões.<br />E uma IA pronta para fazer parte da conversa.</p><Link href="/register" className={s.primaryButton}>Bora conhecer a Dialogy <ArrowUpRight size={19} /></Link><Link href="/pricing" className={s.ctaPricing}>Explorar planos e recursos <ArrowRight size={15} /></Link></div><div className={s.ctaMascot}><Mascot small /></div></section>
    </main>
    <footer className={s.footer}><div><Link href="/" className={s.logo} aria-label="Dialogy — página inicial"><Image src="/logo.png" alt="Dialogy" width={120} height={30} /></Link><span>Conversa boa move o mundo.</span></div><nav aria-label="Links do rodapé"><Link href="/">Plataforma</Link><Link href="/pricing">Planos</Link><Link href="/login">Entrar</Link><Link href="/privacy">Privacidade</Link><Link href="/terms">Termos</Link></nav><p>© {new Date().getFullYear()} Dialogy. Feito para conectar.</p></footer>
  </div>;
}
