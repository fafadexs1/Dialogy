import { AlertTriangle, CheckCircle2, Circle, Database, GitBranch, KeyRound, Rocket, ShieldCheck, TestTube2, Wrench, XCircle, type LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { AutopilotFlowGraph, KnowledgeBaseDocument } from '@/lib/types';
import type { AiModelCatalogEntry } from '@/lib/ai-models';
import type { AutopilotPlaygroundTrace } from '@/services/autopilot/playground-trace';
import { cn } from '@/lib/utils';
import { auditAutopilotFlowGraph } from '@/services/autopilot/flow-audit';

type ReadinessState = 'ready' | 'warning' | 'blocked' | 'pending';

type ReadinessItem = {
  key: string;
  label: string;
  detail: string;
  state: ReadinessState;
  icon: LucideIcon;
};

interface AutopilotReadinessProps {
  aiModel: string;
  modelOptions: AiModelCatalogEntry[];
  hasRuntimeKey: boolean;
  knowledgeBase: string;
  documents: KnowledgeBaseDocument[];
  fallbackReply: string;
  escalationPolicy: string;
  enabledToolNames: string[];
  isActive: boolean;
  isDirty: boolean;
  lastTrace: AutopilotPlaygroundTrace | null;
  flowGraph?: AutopilotFlowGraph | null;
}

function countDocumentChars(documents: KnowledgeBaseDocument[]) {
  return documents.reduce((total, doc) => total + (doc.content || '').trim().length, 0);
}

function readinessStyle(state: ReadinessState): {
  icon: LucideIcon;
  className: string;
  badge: string;
  label: string;
} {
  if (state === 'ready') {
    return {
      icon: CheckCircle2,
      className: 'text-emerald-600 dark:text-emerald-400',
      badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      label: 'ok',
    };
  }
  if (state === 'warning') {
    return {
      icon: AlertTriangle,
      className: 'text-amber-600 dark:text-amber-300',
      badge: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      label: 'atencao',
    };
  }
  if (state === 'pending') {
    return {
      icon: Circle,
      className: 'text-muted-foreground',
      badge: 'border-border bg-muted/40 text-muted-foreground',
      label: 'pendente',
    };
  }
  return {
    icon: XCircle,
    className: 'text-destructive',
    badge: 'border-destructive/25 bg-destructive/10 text-destructive',
      label: 'bloqueado',
  };
}

export function AutopilotReadiness({
  aiModel,
  modelOptions,
  hasRuntimeKey,
  knowledgeBase,
  documents,
  fallbackReply,
  escalationPolicy,
  enabledToolNames,
  isActive,
  isDirty,
  lastTrace,
  flowGraph,
}: AutopilotReadinessProps) {
  const hasModel = Boolean(aiModel && modelOptions.some((model) => model.id === aiModel));
  const documentChars = countDocumentChars(documents);
  const hasKnowledge = knowledgeBase.trim().length >= 40 || documentChars >= 80;
  const hasFallback = fallbackReply.trim().length >= 20;
  const hasEscalation = escalationPolicy.trim().length >= 20 || enabledToolNames.includes('transfer_chat');
  const hasTools = enabledToolNames.length > 0;
  const testState: ReadinessState = !lastTrace
    ? 'pending'
    : isDirty
      ? 'warning'
    : lastTrace.validator.decision === 'replace_with_fallback'
      ? 'warning'
      : 'ready';
  const publishState: ReadinessState = !isActive
    ? 'blocked'
    : isDirty
      ? 'warning'
      : 'ready';

  const configItems: ReadinessItem[] = [
    {
      key: 'model',
      label: 'Modelo',
      detail: hasModel ? 'Modelo liberado para o runtime.' : 'Selecione um modelo suportado.',
      state: hasModel ? 'ready' : 'blocked',
      icon: Rocket,
    },
    {
      key: 'key',
      label: 'Credencial',
      detail: hasRuntimeKey ? 'Chave disponivel em Modelos de IA.' : 'Configure uma chave em Integracoes / Modelos de IA.',
      state: hasRuntimeKey ? 'ready' : 'blocked',
      icon: KeyRound,
    },
    {
      key: 'knowledge',
      label: 'Base',
      detail: hasKnowledge ? `${documents.length} documento(s), ${documentChars.toLocaleString()} caracteres.` : 'Inclua persona, FAQ ou documentos.',
      state: hasKnowledge ? 'ready' : 'warning',
      icon: Database,
    },
    {
      key: 'fallback',
      label: 'Fallback',
      detail: hasFallback ? 'Mensagem de contingencia configurada.' : 'Defina uma resposta segura.',
      state: hasFallback ? 'ready' : 'warning',
      icon: ShieldCheck,
    },
    {
      key: 'handoff',
      label: 'Humano',
      detail: hasEscalation ? 'Escalonamento ou transferencia disponivel.' : 'Defina quando escalar.',
      state: hasEscalation ? 'ready' : 'warning',
      icon: ShieldCheck,
    },
    {
      key: 'tools',
      label: 'Acoes',
      detail: hasTools ? `${enabledToolNames.length} ferramenta(s) habilitada(s).` : 'Sem ferramentas habilitadas.',
      state: hasTools ? 'ready' : 'warning',
      icon: Wrench,
    },
    {
      key: 'test',
      label: 'Teste',
      detail: lastTrace ? `Validator: ${lastTrace.validator.decision}${isDirty ? ' no rascunho' : ''}.` : 'Rode um teste no playground.',
      state: testState,
      icon: TestTube2,
    },
    {
      key: 'published',
      label: 'Publicado',
      detail: !isActive ? 'Agente pausado.' : isDirty ? 'Publique o rascunho aprovado.' : 'Ativo e sincronizado.',
      state: publishState,
      icon: Rocket,
    },
  ];

  const flowAudit = auditAutopilotFlowGraph(flowGraph);
  const hasFlow = Boolean(flowGraph?.nodes?.length);
  const flowItems: ReadinessItem[] = [
    {
      key: 'flow-v2',
      label: 'Fluxo V2',
      detail: hasFlow ? `${flowGraph?.nodes.length || 0} bloco(s) conectaveis.` : 'Nenhum fluxo visual configurado.',
      state: hasFlow ? 'ready' : 'pending',
      icon: GitBranch,
    },
    {
      key: 'flow-audit',
      label: 'Auditoria',
      detail: flowAudit.status === 'passed'
        ? 'Sem bloqueios estruturais criticos.'
        : flowAudit.issues[0]?.message || 'Fluxo possui problemas criticos.',
      state: flowAudit.status === 'passed' ? 'ready' : 'blocked',
      icon: ShieldCheck,
    },
  ];

  const configReadyCount = configItems.filter((item) => item.state === 'ready').length;
  const configScore = Math.round((configReadyCount / configItems.length) * 100);
  const configScoreState: ReadinessState = configScore >= 85 ? 'ready' : configScore >= 60 ? 'warning' : 'blocked';
  const configScoreStyle = readinessStyle(configScoreState);
  const flowReadyCount = flowItems.filter((item) => item.state === 'ready').length;
  const flowScore = Math.round((flowReadyCount / flowItems.length) * 100);
  const flowScoreState: ReadinessState = flowScore >= 85 ? 'ready' : flowScore >= 60 ? 'warning' : 'blocked';
  const flowScoreStyle = readinessStyle(flowScoreState);

  return (
    <section className="rounded-[26px] border border-border bg-card shadow-sm">
      <div className="border-b border-border/60 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Prontidao</h2>
            <p className="text-xs text-muted-foreground">Configuração e qualidade do fluxo separadas.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className={cn('rounded-full', configScoreStyle.badge)}>
              Config {configScore}%
            </Badge>
            <Badge variant="outline" className={cn('rounded-full', flowScoreStyle.badge)}>
              Flow {flowScore}%
            </Badge>
          </div>
        </div>
        <Progress value={configScore} className="mt-4 h-2" indicatorClassName={configScoreState === 'ready' ? 'bg-emerald-500' : configScoreState === 'warning' ? 'bg-amber-500' : 'bg-destructive'} />
        <Progress value={flowScore} className="mt-2 h-1.5" indicatorClassName={flowScoreState === 'ready' ? 'bg-emerald-500' : flowScoreState === 'warning' ? 'bg-amber-500' : 'bg-destructive'} />
      </div>

      <div className="grid gap-2 p-3">
        {[...configItems, ...flowItems].map((item) => {
          const Icon = item.icon;
          const status = readinessStyle(item.state);
          const StatusIcon = status.icon;
          return (
            <div key={item.key} className="flex items-start gap-3 rounded-2xl px-3 py-3 hover:bg-muted/40">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium text-foreground">{item.label}</div>
                  <StatusIcon className={cn('h-4 w-4 shrink-0', status.className)} />
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
