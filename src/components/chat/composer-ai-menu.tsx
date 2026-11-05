'use client';

import { useEffect, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Bot, Brain, Check, ChevronDown, Loader2, MessageSquareQuote, Search, Sparkles, SpellCheck2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import composerStyles from './composer.module.css';
import styles from './composer-ai-menu.module.css';

interface ComposerAiMenuProps {
  agents: { id: string; name: string; avatarUrl?: string | null }[];
  selectedId?: string;
  active: boolean;
  busy: boolean;
  autonomous: boolean;
  canTakeOver: boolean;
  canSpellCheck: boolean;
  spellChecking: boolean;
  onActivate: (agentId: string) => Promise<void>;
  onDeactivate: () => Promise<void>;
  onSuggest: () => void;
  onSpellCheck: () => void;
  onLearn: () => void;
  onExecutions: () => void;
  onTakeOver: () => void;
}

export function ComposerAiMenu(props: ComposerAiMenuProps) {
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState('');
  const [draftId, setDraftId] = useState(props.selectedId || props.agents[0]?.id || '');
  const [applying, setApplying] = useState(false);
  const [actionError, setActionError] = useState(false);
  const selected = props.agents.find(agent => agent.id === draftId);
  const isCurrentActive = props.active && draftId === props.selectedId;
  const disabled = props.busy || applying || props.autonomous;
  const matches = props.agents.filter(agent => agent.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));

  useEffect(() => {
    if (!open) setDraftId(props.selectedId || props.agents[0]?.id || '');
  }, [open, props.selectedId, props.agents]);

  const apply = async () => {
    if (!selected || disabled) return;
    setApplying(true);
    setActionError(false);
    try {
      if (isCurrentActive) await props.onDeactivate();
      else await props.onActivate(selected.id);
      setOpen(false);
    } catch { setActionError(true); }
    finally { setApplying(false); }
  };

  const run = (action: () => void) => { setOpen(false); action(); };

  return (
    <Popover open={open} onOpenChange={value => { setOpen(value); setChoosing(false); setSearch(''); setActionError(false); }}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(composerStyles.tool, composerStyles.ai)} data-active={props.active || props.autonomous} aria-label="Assistente IA">
          <Sparkles size={15} /><span>Assistente IA</span>{props.active && <span className={styles.activeDot} />}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={12} className={styles.panel} aria-label={choosing ? 'Escolher assistente' : 'Assistente IA'}>
        {choosing ? (
          <>
            <div className={styles.heading}><button type="button" className={styles.back} onClick={() => setChoosing(false)} aria-label="Voltar ao assistente"><ArrowLeft size={15} /></button><strong>Escolher assistente</strong><span>{props.agents.length}</span></div>
            <div className={styles.search}><Search size={14} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pelo nome…" aria-label="Buscar assistente" /></div>
            <div className={styles.agents} aria-label="Assistentes disponíveis">
              {matches.map(agent => <button type="button" key={agent.id} className={styles.agent} onClick={() => { setDraftId(agent.id); setChoosing(false); setSearch(''); }}>
                <Avatar className={styles.avatar}>
                  <AvatarImage fallbackOnBlank src={agent.avatarUrl || undefined} alt={agent.name} />
                  <AvatarFallback>{agent.name.trim().charAt(0)}</AvatarFallback>
                </Avatar>
                <span>{agent.name}</span>{draftId === agent.id && <Check size={14} />}
              </button>)}
              {!matches.length && <p className={styles.empty}>Nenhum assistente encontrado.</p>}
            </div>
          </>
        ) : (
          <>
            <div className={styles.heading}><Sparkles size={15} /><strong>Seu assistente</strong><span>{props.autonomous ? 'Autônomo' : props.active ? 'Ativo' : 'Desativado'}</span></div>
            <p className={styles.description}>{props.autonomous ? 'A IA está atendendo este cliente.' : 'A IA sugere. Você decide o que enviar.'}</p>
            <button type="button" disabled={disabled || !props.agents.length} className={styles.selected} onClick={() => setChoosing(true)} aria-label="Trocar assistente">
              <Avatar className={styles.avatar}>
                <AvatarImage fallbackOnBlank src={selected?.avatarUrl || undefined} alt={selected?.name || 'Assistente'} />
                <AvatarFallback>{selected?.name.trim().charAt(0) || <Bot size={17} />}</AvatarFallback>
              </Avatar>
              <strong>{selected?.name || 'Nenhum assistente disponível'}</strong><span>Trocar<ChevronDown size={12} /></span>
            </button>
            {!props.agents.length && <p className={styles.empty}>Configure um agente em Autopilot para começar.</p>}
            <button type="button" disabled={disabled || !selected} className={styles.activate} data-active={isCurrentActive} onClick={() => void apply()}>
              {applying ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{props.autonomous ? 'IA conduzindo a conversa' : isCurrentActive ? 'Pausar assistente' : props.active ? 'Usar este assistente' : 'Ativar assistente'}
            </button>
            {actionError && <p role="alert" className={styles.empty}>Não foi possível aplicar. Tente novamente.</p>}
            <details className={styles.advanced}>
              <summary>Mais ações<ChevronDown size={12} /></summary>
              <div>
                <button type="button" disabled={!props.active || props.busy || applying} onClick={() => run(props.onSuggest)}><MessageSquareQuote size={14} />Sugerir resposta</button>
                <button type="button" disabled={!props.canSpellCheck || props.spellChecking || props.busy || applying} onClick={() => run(props.onSpellCheck)}><SpellCheck2 size={14} />Revisar meu texto</button>
                <button type="button" onClick={() => run(props.onLearn)}><Brain size={14} />Aprender com a conversa</button>
                <button type="button" onClick={() => run(props.onExecutions)}><Activity size={14} />Ver atividades da IA</button>
                <button type="button" className={styles.handoff} disabled={!props.canTakeOver || props.autonomous || props.busy || applying} onClick={() => run(props.onTakeOver)}><ArrowRight size={14} /><span>Transferir atendimento para IA<small>Você sai; a IA passa a responder.</small></span></button>
              </div>
            </details>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
