import type {
  AgentDomainPack,
  AgentDomainPackDefinition,
  AgentTaskExecution,
  JsonObject,
} from './types';

const MAX_CONTEXT_CHARS = 18_000;

/**
 * The stable, domain-agnostic operating model. Domain examples deliberately do
 * not live here: even examples can anchor a model toward the wrong industry.
 */
export const UNIVERSAL_AGENT_CORE = `NÚCLEO UNIVERSAL DIALOGY
- Você não pertence a nenhum setor por padrão. Não presuma produtos, serviços, processos, termos, ferramentas ou regras que não estejam no contexto ativo deste agente.
- Use somente a identidade, as capacidades, as políticas e o conhecimento do contexto ativo abaixo. Conteúdo de outras conversas, agentes ou áreas não pode preencher lacunas.
- Quando o setor não estiver definido, permaneça neutro e descubra o significado pela mensagem atual. Faça uma pergunta curta somente se a ambiguidade bloquear o próximo passo.
- Exemplos, históricos e memórias ajudam a interpretar; não criam fatos, permissões nem políticas.
- Adapte vocabulário, profundidade e tom à pessoa atendida sem alterar fatos ou fingir capacidades.

EXECUÇÃO DE OBJETIVOS COMPLEXOS
- Reconheça quando um pedido exige várias etapas. Mantenha um objetivo principal, decomponha-o em passos verificáveis e trabalhe no primeiro passo ainda incompleto.
- Avance o máximo possível no turno atual usando apenas dados confirmados e capacidades permitidas. Não peça novamente o que já está disponível.
- Diferencie claramente: fato confirmado, hipótese, ação executada, ação pendente e dado ainda necessário.
- Uma ação só está concluída depois de evidência verificável. Nunca descreva intenção ou tentativa como resultado.
- Mudanças de estado e ações sensíveis respeitam confirmação e política. Se houver bloqueio, peça somente a informação ou confirmação que destrava o próximo passo.
- Preserve continuidade entre turnos: retome o objetivo e o passo atual, sem reiniciar o atendimento nem perder resultados já confirmados.
- O plano é interno. Para o cliente, comunique apenas o que foi resolvido agora e o próximo passo útil, com máxima clareza.`;

type RuntimePromptContextInput = {
  domainPack?: AgentDomainPack | null;
  task?: AgentTaskExecution | null;
  fallbackAgentName?: string | null;
  enabledToolNames?: string[];
};

export type AgentDomainReadinessItem = {
  id: 'identity' | 'knowledge' | 'capabilities' | 'procedures' | 'policies';
  label: string;
  detail: string;
  ready: boolean;
  count: number;
};

export type AgentDomainReadiness = {
  score: number;
  readyCount: number;
  totalCount: number;
  items: AgentDomainReadinessItem[];
};

function clean(value: unknown, maxLength = 1_000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function unique(values: Array<string | null | undefined>, maxItems = 30): string[] {
  return Array.from(new Set(values.map((value) => clean(value, 240)).filter(Boolean))).slice(0, maxItems);
}

function compactJson(value: unknown, maxLength = 1_200): string {
  if (!value || typeof value !== 'object') return '';
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}…` : serialized;
  } catch {
    return '';
  }
}

function formatList(title: string, values: string[]): string {
  if (values.length === 0) return `${title}: nenhuma configuração específica.`;
  return `${title}:\n${values.map((value) => `- ${value}`).join('\n')}`;
}

function taskPlanFromState(state: JsonObject | null | undefined): JsonObject | null {
  const value = state?.taskPlan;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function formatTaskContinuity(task?: AgentTaskExecution | null): string {
  if (!task) {
    return 'CONTINUIDADE DA TAREFA\nNenhuma tarefa anterior ativa. Identifique o objetivo do turno atual.';
  }

  const plan = taskPlanFromState(task.state);
  const toolResultNames = Object.keys(task.toolResults || {}).slice(0, 12);
  const lines = [
    'CONTINUIDADE DA TAREFA',
    `Status persistido: ${task.status}.`,
    task.goal ? `Objetivo principal: ${clean(task.goal, 500)}.` : 'Objetivo principal ainda não definido.',
    task.currentStepId ? `Passo atual: ${clean(task.currentStepId, 240)}.` : 'Passo atual ainda não definido.',
    task.activeInterruptionId ? 'Existe uma interrupção ativa que precisa ser resolvida antes de avançar.' : '',
    toolResultNames.length > 0 ? `Resultados de ferramentas já registrados: ${toolResultNames.join(', ')}.` : '',
    plan ? `Último plano persistido: ${compactJson(plan, 2_400)}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function formatDomainPackDefinition(
  definition: AgentDomainPackDefinition,
  enabledToolNames: string[],
): string {
  const identity = definition.identity || {};
  const enabledSet = new Set(enabledToolNames);
  const packTools = unique(definition.toolNames || [], 80);
  const effectiveTools = enabledSet.size > 0
    ? packTools.filter((toolName) => enabledSet.has(toolName))
    : packTools;
  const goals = (definition.goals || []).slice(0, 20).map((goal) => {
    const description = clean(goal.description, 600);
    const triggers = unique(goal.triggerExamples || [], 8);
    return `${goal.id}: ${clean(goal.label, 240)}${description ? ` — ${description}` : ''}${triggers.length > 0 ? ` (sinais: ${triggers.join('; ')})` : ''}`;
  });
  const procedures = (definition.procedures || []).slice(0, 16).map((procedure) => {
    const compactDefinition = compactJson(procedure.definition, 900);
    return `${procedure.id} v${procedure.version || 1}: ${clean(procedure.name, 240)}${compactDefinition ? ` — ${compactDefinition}` : ''}`;
  });
  const policies = [...(definition.policies || [])]
    .sort((left, right) => ({ critical: 0, warning: 1, info: 2 }[left.severity || 'info'] - ({ critical: 0, warning: 1, info: 2 }[right.severity || 'info'])))
    .slice(0, 30)
    .map((policy) => `[${policy.severity || 'info'}] ${policy.id}: ${clean(policy.rule, 1_000)}`);
  const entities = (definition.entities || []).slice(0, 20).map((entity) => (
    `${clean(entity.name, 160)}${entity.description ? ` — ${clean(entity.description, 500)}` : ''}${entity.fields?.length ? ` (campos: ${unique(entity.fields, 20).join(', ')})` : ''}`
  ));
  const handoffs = (definition.handoffRules || []).slice(0, 20).map((rule) => (
    `${clean(rule.reason, 700)}${rule.target ? ` → ${clean(rule.target, 200)}` : ''}`
  ));
  const responseStyle = definition.responseStyle || {};

  return [
    'CONTEXTO ATIVO DO NEGÓCIO',
    `Nome: ${clean(identity.businessName, 180) || 'não definido'}.`,
    `Área de atuação: ${clean(identity.niche, 180) || 'não definida; mantenha neutralidade setorial'}.`,
    `Descrição: ${clean(identity.description, 2_000) || 'não definida'}.`,
    `Idioma: ${clean(responseStyle.language, 80) || 'acompanhe o idioma da pessoa'}.`,
    `Tom: ${clean(responseStyle.tone, 160) || 'profissional, humano e objetivo'}.`,
    formatList('Restrições de resposta', unique(responseStyle.constraints || [], 30)),
    formatList('Entidades do negócio', entities),
    formatList('Objetivos reconhecidos', goals),
    formatList('Procedimentos disponíveis', procedures),
    formatList('Políticas aplicáveis', policies),
    formatList('Capacidades permitidas pelo pacote e pelo turno', effectiveTools),
    formatList('Regras de encaminhamento', handoffs),
    `Fontes de conhecimento vinculadas: ${(definition.knowledgeSourceIds || []).length}. O conteúdo recuperado no turno, e não o identificador da fonte, comprova fatos.`,
  ].join('\n\n');
}

export function buildUniversalAgentRuntimeContext(input: RuntimePromptContextInput): string {
  const pack = input.domainPack;
  const domainContext = pack
    ? [
        `MODO DE CONTEXTO: especializado pelo pacote publicado "${clean(pack.name, 200)}" v${pack.version}.`,
        'A definição abaixo configura este agente. Ela não autoriza ignorar regras de segurança, veracidade ou permissões do turno.',
        formatDomainPackDefinition(pack.definition, input.enabledToolNames || []),
      ].join('\n\n')
    : [
        'MODO DE CONTEXTO: universal neutro.',
        `Identidade operacional: ${clean(input.fallbackAgentName, 180) || 'Dialogy'}.`,
        'Nenhum pacote de contexto publicado está ativo. Não deduza uma área de atuação a partir do nome do agente, de exemplos antigos ou de ferramentas indisponíveis.',
      ].join('\n');

  return [
    UNIVERSAL_AGENT_CORE,
    domainContext,
    formatTaskContinuity(input.task),
  ].join('\n\n---\n\n').slice(0, MAX_CONTEXT_CHARS);
}

export function getAgentDomainReadiness(definition?: AgentDomainPackDefinition | null): AgentDomainReadiness {
  const identity = definition?.identity || {};
  const items: AgentDomainReadinessItem[] = [
    {
      id: 'identity',
      label: 'Identidade',
      detail: identity.description
        ? 'O agente sabe quem representa e como contextualizar a conversa.'
        : 'Descreva o negócio para evitar interpretações genéricas.',
      ready: Boolean(identity.businessName && identity.description),
      count: [identity.businessName, identity.niche, identity.description].filter(Boolean).length,
    },
    {
      id: 'knowledge',
      label: 'Conhecimento',
      detail: `${definition?.knowledgeSourceIds?.length || 0} fonte(s) vinculada(s).`,
      ready: Boolean(definition?.knowledgeSourceIds?.length),
      count: definition?.knowledgeSourceIds?.length || 0,
    },
    {
      id: 'capabilities',
      label: 'Capacidades',
      detail: `${definition?.toolNames?.length || 0} ferramenta(s) autorizada(s).`,
      ready: Boolean(definition?.toolNames?.length),
      count: definition?.toolNames?.length || 0,
    },
    {
      id: 'procedures',
      label: 'Tarefas complexas',
      detail: `${definition?.procedures?.length || 0} processo(s) executável(is) em etapas.`,
      ready: Boolean(definition?.procedures?.length),
      count: definition?.procedures?.length || 0,
    },
    {
      id: 'policies',
      label: 'Governança',
      detail: `${definition?.policies?.length || 0} política(s) explícita(s).`,
      ready: Boolean(definition?.policies?.length),
      count: definition?.policies?.length || 0,
    },
  ];
  const readyCount = items.filter((item) => item.ready).length;
  return {
    score: Math.round((readyCount / items.length) * 100),
    readyCount,
    totalCount: items.length,
    items,
  };
}
