'use client';

import { useActionState, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, ArrowLeft, ArrowRight, BriefcaseBusiness, Building2, Check, CheckCheck, Code2, CreditCard, GraduationCap, Heart, House, Layers3, Loader2, MessageCircle, PartyPopper, Pencil, Rocket, ShieldCheck, ShoppingBag, Sparkles, Stethoscope, Store, Users, UtensilsCrossed, Wifi } from 'lucide-react';
import { createWorkspaceAction } from '@/actions/workspace';
import { useI18n } from '@/i18n/i18n-provider';
import s from './workspace-launch.module.css';

const verticals = [
  { value: 'isp', label: 'Provedor de internet', Icon: Wifi },
  { value: 'clinica', label: 'Clínica e saúde', Icon: Stethoscope },
  { value: 'ecommerce', label: 'E-commerce', Icon: ShoppingBag },
  { value: 'delivery', label: 'Delivery', Icon: UtensilsCrossed },
  { value: 'saas', label: 'Tecnologia e SaaS', Icon: Code2 },
  { value: 'servicos', label: 'Serviços locais', Icon: Store },
  { value: 'educacao', label: 'Educação', Icon: GraduationCap },
  { value: 'imobiliaria', label: 'Imobiliária', Icon: House },
  { value: 'financeiro', label: 'Financeiro', Icon: CreditCard },
  { value: 'geral', label: 'Outro segmento', Icon: BriefcaseBusiness },
];
const stepLabels = ['Identidade', 'Seu negócio', 'Tudo pronto'];
const initialState = { success: false, error: null as string | null };

export default function WorkspaceLaunch() {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [name, setName] = useState('');
  const [vertical, setVertical] = useState('__none__');
  const [nameError, setNameError] = useState(false);
  const [entering, setEntering] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [state, formAction, pending] = useActionState(async (previous: typeof initialState, data: FormData) => {
    try { return await createWorkspaceAction(previous, data); }
    catch { return { success: false, error: t('Não foi possível confirmar a criação. Verifique seus workspaces antes de tentar novamente.') }; }
  }, initialState);
  const displayName = name.trim() || t('Seu novo workspace');
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
  const selectedVertical = verticals.find(item => item.value === vertical);
  const segmentLabel = selectedVertical ? t(selectedVertical.label) : t('Definir depois');

  useEffect(() => {
    if (state.success) successHeading.current?.focus();
    else if (state.error) errorMessage.current?.focus();
  }, [state]);

  function goTo(next: number) {
    if (pending || state.success) return;
    if (next > 0 && !name.trim()) { setNameError(true); nameInput.current?.focus(); return; }
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending || state.success) { event.preventDefault(); return; }
    if (step < 2) { event.preventDefault(); goTo(step + 1); return; }
    if (!name.trim()) { event.preventDefault(); setNameError(true); goTo(0); }
  }

  function enterWorkspace() {
    setEntering(true);
    // Reload all app providers with the newly active workspace after confirmed creation.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Existing app providers cache the active workspace; entering a newly created one requires a fresh shell.
    window.location.assign('/inbox');
  }

  return <div className={s.launch} data-workspace-launch data-success={state.success}>
    <div className={s.ambient} aria-hidden="true"><i /><i /><span /></div>
    <div className={s.topbar}>
      {!state.success ? <Link href="/settings/workspace" className={s.backLink}><ArrowLeft size={16} />{t('Voltar aos ajustes')}</Link> : <span className={s.createdLabel}><CheckCheck size={17} />{t('Workspace criado')}</span>}
      <span className={s.topLabel}><span />{t('UM NOVO COMEÇO NA DIALOGY')}</span>
    </div>
    <AnimatePresence mode="wait" initial={false}>
      {state.success ? <motion.div key="success" className={s.success} initial={{ opacity: 0, y: reduced ? 0 : 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .6 }} onAnimationComplete={() => successHeading.current?.focus()}>
        <div className={s.confetti} aria-hidden="true">{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ '--x': `${(i * 31) % 100}%`, '--delay': `${(i % 8) * .09}s`, '--turn': `${i * 47}deg`, '--color': ['#a8f0bf', '#b4a2ed', '#e9d598', '#75ccd0'][i % 4] } as CSSProperties} />)}</div>
        <div className={s.successEmblem} aria-hidden="true"><div className={s.successOrbit} /><span><Check size={44} strokeWidth={1.5} /></span><Sparkles className={s.successSpark} size={27} /><PartyPopper className={s.successParty} size={29} /></div>
        <span className={s.eyebrow}>{t('ESSE COMEÇO MERECE SER CELEBRADO')}</span>
        <h1 ref={successHeading} tabIndex={-1}>{t('Um novo espaço.')}<br /><em>{t('Infinitas boas conversas.')}</em></h1>
        <p>{t('O workspace')} <strong className={s.successName}>{displayName}</strong> {t('foi criado. Agora é hora de dar vida a ele com a sua equipe.')}</p>
        <div className={s.successWorkspace}><span className={s.smallAvatar}>{initials || <Building2 size={22} />}</span><div><strong>{displayName}</strong><span>{segmentLabel} <i /> {t('Você é administrador')}</span></div><ShieldCheck size={22} /></div>
        <button type="button" className={s.primary} disabled={entering} onClick={enterWorkspace}>{entering ? <Loader2 className={s.spin} size={18} /> : <Rocket size={18} />}{entering ? t('Entrando no seu workspace...') : t('Entrar no meu workspace')}<ArrowRight size={18} /></button>
        <div className={s.nextSteps}><span>{t('OS PRÓXIMOS CAPÍTULOS')}</span><div><span><MessageCircle size={16} />{t('Conectar seus canais')}</span><span><Users size={16} />{t('Trazer sua equipe')}</span><span><Sparkles size={16} />{t('Explorar a IA')}</span></div></div>
      </motion.div> : <motion.div key="wizard" className={s.stage} exit={{ opacity: 0, scale: reduced ? 1 : .98 }} transition={{ duration: reduced ? 0 : .25 }}>
        <aside className={s.story} aria-label={t('Prévia do workspace')}>
          <span className={s.eyebrow}><Sparkles size={14} />{t('ESPAÇO PARA O QUE VEM AÍ')}</span>
          <h1>{t('Grandes conversas.')}<br /><em>{t('Novos começos.')}</em></h1>
          <p>{t('Um lugar para conectar sua equipe, cuidar dos clientes e transformar ideias em boas histórias.')}</p>
          <div className={s.scene} data-stage={step}>
            <div className={s.orbitOne} aria-hidden="true" /><div className={s.orbitTwo} aria-hidden="true" />
            <div className={`${s.satellite} ${s.satelliteChat}`} aria-hidden="true"><MessageCircle size={23} /></div>
            <div className={`${s.satellite} ${s.satelliteTeam}`} aria-hidden="true"><Users size={23} /></div>
            <div className={`${s.satellite} ${s.satelliteAi}`} aria-hidden="true"><Sparkles size={23} /></div>
            <motion.div className={s.workspaceObject} animate={{ rotate: reduced ? -5 : [-5, -2, -5], y: reduced ? 0 : [0, -9, 0] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}>
              <div className={s.objectShine} /><span className={s.objectIcon}>{initials || <Layers3 size={49} strokeWidth={1.3} />}</span><span className={s.objectDots}><i /><i /><i /></span>
            </motion.div>
            <div className={s.workspaceCaption}><strong>{displayName}</strong><span>{step === 0 ? t('Toda grande história começa com um nome.') : step === 1 ? segmentLabel : t('Pronto para o seu próximo capítulo.')}</span></div>
            <span className={s.sceneTag}><span />{step === 0 ? t('Seu espaço. Sua identidade.') : step === 1 ? t('Uma experiência com a sua cara.') : t('Só falta o primeiro clique.')}</span>
          </div>
          <div className={s.storyFooter}><span><MessageCircle size={15} />{t('Conversas')}</span><i /><span><Users size={15} />{t('Pessoas')}</span><i /><span><Sparkles size={15} />{t('Possibilidades')}</span></div>
        </aside>
        <div className={s.formColumn}>
          <nav aria-label={t('Etapas de criação')} className={s.stepper}><ol>{stepLabels.map((label, index) => <li key={label} data-state={index === step ? 'active' : index < step ? 'complete' : 'future'}><button type="button" disabled={pending || index > step} aria-current={index === step ? 'step' : undefined} onClick={() => goTo(index)}><span>{index < step ? <Check size={15} /> : `0${index + 1}`}</span><strong>{t(label)}</strong></button>{index < 2 && <i aria-hidden="true" />}</li>)}</ol></nav>
          <form action={formAction} onSubmit={onSubmit} className={s.form} aria-busy={pending}>
            <input type="hidden" name="workspaceName" value={name.trim()} />
            <input type="hidden" name="vertical" value={vertical} />
            <fieldset disabled={pending}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={step} className={s.stepBody} initial={{ opacity: 0, x: reduced ? 0 : direction * 22 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : direction * -16 }} transition={{ duration: reduced ? 0 : .23 }} onAnimationComplete={() => { if (step > 0) heading.current?.focus(); else nameInput.current?.focus(); }}>
                  <span className={s.stepKicker}>{t('PASSO')} 0{step + 1}<span>/ 03</span></span>
                  <h2 ref={heading} tabIndex={-1}>{step === 0 ? <>{t('Vamos dar um nome')}<br />{t('a esse novo começo?')}</> : step === 1 ? <>{t('O seu negócio')}<br />{t('tem uma história.')}</> : <>{t('Tudo do seu jeito.')}<br /><em>{t('Vamos começar?')}</em></>}</h2>
                  <p className={s.stepDescription}>{step === 0 ? t('Pode ser o nome da empresa, da sua equipe ou daquela ideia que está saindo do papel.') : step === 1 ? t('Conte em qual segmento você atua. Isso ajuda a direcionar as sugestões de aprendizado da IA.') : t('Confira os detalhes. Seu novo espaço está a um clique de acontecer.')}</p>
                  {step === 0 && <div className={s.identityFields}>
                    <label htmlFor="workspace-name">{t('Nome do workspace')}<span>{t('Obrigatório')}</span></label>
                    <div className={s.nameField} data-invalid={nameError}><Building2 size={20} /><input ref={nameInput} id="workspace-name" value={name} onChange={e => { setName(e.target.value); if (e.target.value.trim()) setNameError(false); }} placeholder={t('Ex.: Aurora Studio')} autoComplete="organization" aria-required="true" aria-invalid={nameError} aria-describedby={nameError ? 'workspace-name-error' : 'workspace-name-hint'} autoFocus /></div>
                    {nameError ? <p id="workspace-name-error" className={s.fieldError} role="alert"><AlertCircle size={14} />{t('Dê um nome ao seu workspace para continuar.')}</p> : <p id="workspace-name-hint" className={s.fieldHint}>{t('Escolha um nome fácil de reconhecer. Você pode alterá-lo depois.')}</p>}
                    <div className={s.welcomeNote}><span><Heart size={19} /></span><div><strong>{t('Seu time vai se sentir em casa.')}</strong><p>{t('Aqui vão morar suas conversas, seus contatos e as próximas conquistas da equipe.')}</p></div></div>
                  </div>}
                  {step === 1 && <div className={s.businessFields}>
                    <div className={s.fieldLabel} id="segment-label">{t('Segmento do seu negócio')}<span>{t('Opcional')}</span></div>
                    <div className={s.segmentGrid} role="radiogroup" aria-labelledby="segment-label">{verticals.map(({ value, label, Icon }) => <label key={value} className={s.segment} data-selected={vertical === value}><input type="radio" name="vertical-choice" value={value} checked={vertical === value} onChange={() => setVertical(value)} /><Icon size={19} /><span>{t(label)}</span><Check size={13} className={s.segmentCheck} /></label>)}</div>
                    <label className={s.skipSegment}><input type="radio" name="vertical-choice" value="__none__" checked={vertical === '__none__'} onChange={() => setVertical('__none__')} />{t('Prefiro definir isso depois.')}</label>
                  </div>}
                  {step === 2 && <div className={s.reviewFields}>
                    <div className={s.reviewCard}><div className={s.reviewTop}><span className={s.smallAvatar}>{initials || <Building2 size={23} />}</span><div><span>{t('SEU NOVO WORKSPACE')}</span><strong>{displayName}</strong></div><button type="button" aria-label={t('Editar nome do workspace')} onClick={() => goTo(0)}><Pencil size={16} /></button></div><div className={s.reviewRow}><span><BriefcaseBusiness size={15} />{t('Segmento')}</span><strong>{segmentLabel}</strong><button type="button" aria-label={t('Editar segmento')} onClick={() => goTo(1)}><Pencil size={14} /></button></div><div className={s.reviewRow}><span><ShieldCheck size={15} />{t('Seu acesso')}</span><strong>{t('Administrador')}</strong><Check size={15} /></div></div>
                    <div className={s.readyNote}><span><CheckCheck size={19} /></span><p>{t('Ao criar, este será seu workspace ativo. Depois, você poderá conectar canais e convidar sua equipe.')}</p></div>
                  </div>}
                </motion.div>
              </AnimatePresence>
              {state.error && step === 2 && <div ref={errorMessage} tabIndex={-1} className={s.serverError} role="alert"><AlertCircle size={19} /><div><strong>{t('Não foi possível concluir')}</strong><p>{state.error}</p></div></div>}
              <div className={s.formFooter}>
                {step > 0 && <button type="button" className={s.previous} onClick={() => goTo(step - 1)} aria-label={t('Voltar uma etapa')}><ArrowLeft size={18} /><span>{t('Voltar')}</span></button>}
                <button className={s.primary} type="submit" disabled={pending}>{pending ? <Loader2 size={18} className={s.spin} /> : step === 2 ? <Sparkles size={18} /> : null}{pending ? t('Criando seu espaço...') : step === 2 ? t('Criar meu workspace') : t('Continuar')}<ArrowRight size={18} /></button>
              </div>
              <p className={s.footerHint} role="status">{pending ? t('Estamos preparando seu workspace. Aguarde a confirmação.') : step === 2 ? t('Um pequeno clique. Um grande começo.') : t('No seu ritmo. Você pode revisar tudo antes de criar.')}</p>
            </fieldset>
          </form>
          <div className={s.milestone}><span><i /><i /><i /></span><p>{t('Uma nova fase começa com uma boa conversa.')} <Heart size={12} /></p></div>
        </div>
      </motion.div>}
    </AnimatePresence>
  </div>;
}
