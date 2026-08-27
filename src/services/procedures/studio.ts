import type { ProcedureGraph } from '@/services/autopilot/procedure-types';
import type {
  ProcedureStudioDocument,
  ProcedureStudioStep,
  ProcedureToolOption,
} from './schemas';
import { ProcedureGraphSchema, ProcedureStudioDocumentSchema } from './schemas';
import { validateProcedureStudioDocument, type ProcedureValidationResult } from './validator';

export type ProcedureSimulationEvent = {
  sequence: number;
  stepId: string;
  stepLabel: string;
  stepType: ProcedureStudioStep['type'];
  status: 'success' | 'confirmed' | 'simulated' | 'handoff' | 'response' | 'error';
  summary: string;
};

export type ProcedureSimulationCase = {
  id: string;
  name: string;
  mode: 'happy_path' | 'decision_branch' | 'tool_failure';
  failedToolName?: string;
  passed: boolean;
  terminal: 'responded' | 'handoff' | 'failed';
  events: ProcedureSimulationEvent[];
  error?: string;
};

export type ProcedureSimulationReport = {
  passed: boolean;
  validation: ProcedureValidationResult;
  cases: ProcedureSimulationCase[];
  executedAt: string;
};

function browserSafeId() {
  const uuid = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `proc_${uuid.replace(/-/g, '')}`;
}

export function createBlankProcedure(configId: string): ProcedureStudioDocument {
  const id = browserSafeId();
  return ProcedureStudioDocumentSchema.parse({
    id,
    configId,
    name: 'Novo procedimento',
    description: '',
    goal: 'Resolver uma solicitação do cliente do início ao fim.',
    priority: 100,
    trigger: {
      intents: ['support_request'],
      phrases: ['Preciso de ajuda com este atendimento'],
      keywords: ['ajuda'],
      exclusions: [],
    },
    steps: [{
      id: 'step_1',
      order: 1,
      type: 'respond',
      label: 'Responder ao cliente',
      responseTemplate: 'Explique ao cliente como a solicitação será resolvida.',
      useLlm: true,
      nextStepId: null,
    }],
    metadata: { source: 'procedure_studio', template: 'blank' },
  });
}

function findTool(tools: ProcedureToolOption[], suffix: string) {
  return tools.find((tool) => tool.name === suffix || tool.name.endsWith(`:${suffix}`));
}

export function createWifiCredentialsProcedure(
  configId: string,
  tools: ProcedureToolOption[],
): ProcedureStudioDocument {
  const id = browserSafeId();
  const lookup = findTool(tools, 'sgp_fetch_contact_panel_data');
  const change = findTool(tools, 'change_wifi_credentials');
  const steps: ProcedureStudioStep[] = [
    {
      id: 'identify_customer', order: 1, type: 'gather_data', label: 'Identificar o cliente',
      requiredSlots: ['customer_identifier'],
      slotDefinitions: [{ key: 'customer_identifier', label: 'CPF ou CNPJ do titular', type: 'document', required: true, aliases: ['cpf', 'cnpj'], placeholder: '000.000.000-00' }],
      promptTemplate: 'Para localizar seu contrato, informe o CPF ou CNPJ do titular.',
      nextStepId: 'lookup_contract', maxRetries: 2,
    },
    {
      id: 'lookup_contract', order: 2, type: 'tool_call', label: 'Consultar contrato e roteador',
      toolName: lookup?.name || 'sgp_fetch_contact_panel_data',
      toolPayloadTemplate: { customer_identifier: '{{customer_identifier}}' },
      sideEffect: 'none', requiresConfirmation: false,
      successStepId: 'choose_change', errorStepId: 'technical_handoff', nextStepId: 'choose_change', maxRetries: 1,
    },
    {
      id: 'choose_change', order: 3, type: 'decide', label: 'Entender o que será alterado',
      decisionPrompt: 'O cliente quer trocar o nome da rede, a senha ou os dois?',
      branches: [
        { condition: 'Nome ou SSID', nextStepId: 'collect_name' },
        { condition: 'Senha', nextStepId: 'collect_password' },
        { condition: 'Caso contrário: nome e senha', nextStepId: 'collect_both' },
      ],
      nextStepId: null,
    },
    {
      id: 'collect_name', order: 4, type: 'gather_data', label: 'Coletar o novo nome da rede',
      requiredSlots: ['wifi_name'],
      slotDefinitions: [{ key: 'wifi_name', label: 'novo nome do Wi-Fi', type: 'text', required: true, aliases: ['ssid', 'nome da rede'] }],
      promptTemplate: 'Qual será o novo nome da rede Wi-Fi?', nextStepId: 'change_wifi_name', maxRetries: 2,
    },
    {
      id: 'collect_password', order: 5, type: 'gather_data', label: 'Coletar a nova senha',
      requiredSlots: ['wifi_password'],
      slotDefinitions: [{ key: 'wifi_password', label: 'nova senha do Wi-Fi', type: 'text', required: true, aliases: ['senha'] }],
      promptTemplate: 'Qual será a nova senha do Wi-Fi?', nextStepId: 'change_wifi_password', maxRetries: 2,
    },
    {
      id: 'collect_both', order: 6, type: 'gather_data', label: 'Coletar nome e senha',
      requiredSlots: ['wifi_name', 'wifi_password'],
      slotDefinitions: [
        { key: 'wifi_name', label: 'novo nome do Wi-Fi', type: 'text', required: true, aliases: ['ssid', 'nome da rede'] },
        { key: 'wifi_password', label: 'nova senha do Wi-Fi', type: 'text', required: true, aliases: ['senha'] },
      ],
      promptTemplate: 'Envie o novo nome da rede e a nova senha do Wi-Fi.', nextStepId: 'change_wifi_both', maxRetries: 2,
    },
    {
      id: 'change_wifi_name', order: 7, type: 'tool_call', label: 'Alterar o nome da rede no roteador',
      semanticIntent: 'wifi_credentials_change', requiresExplicitCustomerRequest: true,
      toolName: change?.name || '',
      toolPayloadTemplate: {
        customer_identifier: '{{customer_identifier}}',
        ssid: '{{wifi_name}}',
      },
      sideEffect: 'high', requiresConfirmation: true,
      confirmationPrompt: 'Vou alterar o nome da rede Wi-Fi e os aparelhos poderão ser desconectados. Confirma que posso executar agora?',
      successStepId: 'success_response', errorStepId: 'technical_handoff', nextStepId: 'success_response', maxRetries: 1,
    },
    {
      id: 'change_wifi_password', order: 8, type: 'tool_call', label: 'Alterar a senha no roteador',
      semanticIntent: 'wifi_credentials_change', requiresExplicitCustomerRequest: true,
      toolName: change?.name || '',
      toolPayloadTemplate: {
        customer_identifier: '{{customer_identifier}}',
        password: '{{wifi_password}}',
      },
      sideEffect: 'high', requiresConfirmation: true,
      confirmationPrompt: 'Vou alterar a senha do Wi-Fi e os aparelhos poderão ser desconectados. Confirma que posso executar agora?',
      successStepId: 'success_response', errorStepId: 'technical_handoff', nextStepId: 'success_response', maxRetries: 1,
    },
    {
      id: 'change_wifi_both', order: 9, type: 'tool_call', label: 'Alterar nome e senha no roteador',
      semanticIntent: 'wifi_credentials_change', requiresExplicitCustomerRequest: true,
      toolName: change?.name || '',
      toolPayloadTemplate: {
        customer_identifier: '{{customer_identifier}}',
        ssid: '{{wifi_name}}',
        password: '{{wifi_password}}',
      },
      sideEffect: 'high', requiresConfirmation: true,
      confirmationPrompt: 'Vou alterar o nome e a senha do Wi-Fi e os aparelhos poderão ser desconectados. Confirma que posso executar agora?',
      successStepId: 'success_response', errorStepId: 'technical_handoff', nextStepId: 'success_response', maxRetries: 1,
    },
    {
      id: 'success_response', order: 10, type: 'respond', label: 'Confirmar a alteração',
      responseTemplate: 'A alteração do Wi-Fi foi confirmada pelo sistema. Oriente o cliente a reconectar os aparelhos com os novos dados.',
      useLlm: true, nextStepId: null,
    },
    {
      id: 'technical_handoff', order: 11, type: 'handoff', label: 'Encaminhar falha para o suporte',
      handoffReason: 'Não foi possível concluir a alteração automaticamente. Encaminhe para a equipe de Suporte com o histórico das tentativas.',
      nextStepId: null,
    },
  ];
  return ProcedureStudioDocumentSchema.parse({
    id,
    configId,
    name: 'Trocar nome ou senha do Wi-Fi',
    description: 'Identifica o contrato, coleta os novos dados, confirma a ação e altera o roteador com rota segura de falha.',
    goal: 'Alterar com segurança o nome, a senha ou ambos os dados da rede Wi-Fi do cliente.',
    priority: 300,
    trigger: {
      intents: ['change_request', 'support_request'],
      phrases: ['Quero trocar a senha do Wi-Fi', 'Preciso mudar o nome da minha rede', 'Quero alterar o nome e a senha do Wi-Fi'],
      keywords: ['trocar senha wifi', 'mudar ssid', 'alterar nome da rede'],
      exclusions: ['Quero apenas consultar minha senha atual', 'Minha internet está lenta', 'Quero reiniciar o roteador'],
    },
    steps,
    metadata: { source: 'procedure_studio', template: 'wifi_credentials' },
  });
}

export function resequenceProcedureSteps(
  steps: ProcedureStudioStep[],
  options: { relinkLinear?: boolean } = {},
): ProcedureStudioStep[] {
  return steps.map((step, index, collection) => {
    const next = collection[index + 1]?.id || null;
    const linear = !['decide', 'handoff'].includes(step.type);
    const nextStepId = options.relinkLinear && linear
      ? next
      : step.nextStepId && collection.some((candidate) => candidate.id === step.nextStepId)
        ? step.nextStepId
        : null;
    return { ...step, order: index + 1, nextStepId };
  });
}

export function createProcedureStep(
  type: ProcedureStudioStep['type'],
  index: number,
): ProcedureStudioStep {
  const id = `step_${Date.now().toString(36)}_${index + 1}`;
  const base = { id, order: index + 1, type, label: 'Nova peça', nextStepId: null } as ProcedureStudioStep;
  if (type === 'gather_data') return { ...base, label: 'Perguntar ao cliente', requiredSlots: ['information'], slotDefinitions: [{ key: 'information', label: 'informação', type: 'text', required: true, aliases: [] }], promptTemplate: 'Qual informação preciso coletar?' };
  if (type === 'retrieve_knowledge') return { ...base, label: 'Consultar conhecimento', knowledgeQueryTemplate: '{{customer_message}}', requiredKnowledgeCoverage: 'medium', onLowKnowledge: 'handoff' };
  if (type === 'validate') return { ...base, label: 'Verificar uma regra', condition: 'Descreva a condição verificável', onFail: 'handoff' };
  if (type === 'tool_call') return { ...base, label: 'Executar ferramenta/API', toolName: '', toolPayloadTemplate: {}, sideEffect: 'none', requiresConfirmation: false, successStepId: null, errorStepId: null, maxRetries: 1 };
  if (type === 'decide') return { ...base, label: 'Escolher um caminho', decisionPrompt: 'Qual caminho se aplica?', branches: [] };
  if (type === 'respond') return { ...base, label: 'Responder ao cliente', responseTemplate: 'Escreva a resposta ou a instrução para a IA.', useLlm: true };
  return { ...base, label: 'Encaminhar para uma equipe', handoffReason: 'Explique o motivo e a equipe que deve continuar.' };
}

export function materializeProcedureGraph(
  procedureInput: ProcedureStudioDocument,
  version: number,
  compiledAt = new Date().toISOString(),
): ProcedureGraph {
  const procedure = ProcedureStudioDocumentSchema.parse(procedureInput);
  return ProcedureGraphSchema.parse({
    id: procedure.id,
    documentId: `procedure-studio:${procedure.configId}:${procedure.id}`,
    documentName: procedure.name,
    version,
    compiledAt,
    triggerIntents: procedure.trigger.intents,
    triggerKeywords: Array.from(new Set([...procedure.trigger.phrases, ...procedure.trigger.keywords])),
    steps: resequenceProcedureSteps(procedure.steps),
    metadata: {
      ...procedure.metadata,
      source: 'procedure_studio',
      configId: procedure.configId,
      description: procedure.description,
      goal: procedure.goal,
      priority: procedure.priority,
      triggerExclusions: procedure.trigger.exclusions,
    },
  }) as ProcedureGraph;
}

function simulateCase(input: {
  procedure: ProcedureStudioDocument;
  id?: string;
  name?: string;
  mode?: ProcedureSimulationCase['mode'];
  forcedBranches?: Record<string, number>;
  failedStepId?: string;
}): ProcedureSimulationCase {
  const stepById = new Map(input.procedure.steps.map((step) => [step.id, step]));
  const sorted = [...input.procedure.steps].sort((a, b) => a.order - b.order);
  let current: ProcedureStudioStep | null = sorted[0] || null;
  const events: ProcedureSimulationEvent[] = [];
  const visited = new Set<string>();
  let terminal: ProcedureSimulationCase['terminal'] = 'failed';
  let error: string | undefined;

  while (current && events.length < 160) {
    if (visited.has(current.id)) {
      error = `Ciclo detectado em ${current.label}.`;
      break;
    }
    visited.add(current.id);
    const event = (status: ProcedureSimulationEvent['status'], summary: string) => events.push({
      sequence: events.length + 1,
      stepId: current!.id,
      stepLabel: current!.label,
      stepType: current!.type,
      status,
      summary,
    });
    let target: string | null = current.nextStepId || null;

    if (current.type === 'gather_data') event('simulated', `Campos preenchidos: ${(current.requiredSlots || []).join(', ') || 'resposta livre'}.`);
    if (current.type === 'retrieve_knowledge') event('simulated', 'Cobertura de conhecimento simulada como suficiente.');
    if (current.type === 'validate') event('success', 'Condição simulada como verdadeira.');
    if (current.type === 'decide') {
      const forcedIndex: number | undefined = input.forcedBranches?.[current.id];
      const branch: NonNullable<ProcedureStudioStep['branches']>[number] | undefined = forcedIndex == null
        ? (current.branches || []).find((candidate) => !/caso contr[aá]rio|default|fallback/i.test(candidate.condition)) || current.branches?.[0]
        : current.branches?.[forcedIndex];
      if (!branch) {
        error = `Decisão ${current.label} sem caminho.`;
        event('error', error);
        break;
      }
      target = branch.nextStepId;
      event('simulated', `Caminho escolhido: ${branch.condition}.`);
    }
    if (current.type === 'tool_call') {
      if (current.requiresConfirmation) event('confirmed', 'Confirmação explícita simulada antes da ação.');
      if (input.failedStepId === current.id) {
        target = current.errorStepId || null;
        event(target ? 'simulated' : 'error', target ? 'Falha simulada; rota de erro acionada.' : 'Falha simulada sem rota de erro.');
        if (!target) {
          error = `A ferramenta ${current.toolName} falhou sem rota de erro.`;
          break;
        }
      } else {
        target = current.successStepId || current.nextStepId || null;
        event('simulated', `Ferramenta ${current.toolName || 'não configurada'} retornou sucesso simulado.`);
      }
    }
    if (current.type === 'respond') {
      event('response', 'Resposta final entregue ao cliente.');
      if (!target) {
        terminal = 'responded';
        break;
      }
    }
    if (current.type === 'handoff') {
      event('handoff', 'Atendimento encaminhado com contexto.');
      terminal = 'handoff';
      break;
    }

    if (!target) {
      error = `O caminho terminou em ${current.label} sem resposta ou encaminhamento.`;
      break;
    }
    current = stepById.get(target) || null;
    if (!current) error = `A rota aponta para uma peça inexistente (${target}).`;
  }

  if (events.length >= 160) error = 'A simulação excedeu o limite de passos.';
  const failedToolName = input.failedStepId ? stepById.get(input.failedStepId)?.toolName : undefined;
  return {
    id: input.id || 'happy_path',
    name: input.name || 'Caminho principal',
    mode: input.mode || 'happy_path',
    failedToolName,
    passed: !error && terminal !== 'failed',
    terminal,
    events,
    error,
  };
}

function decisionSelectionsForTarget(
  procedure: ProcedureStudioDocument,
  targetStepId: string,
): Record<string, number> | null {
  const steps = [...procedure.steps].sort((a, b) => a.order - b.order);
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const first = steps[0];
  if (!first) return null;
  const queue: Array<{ stepId: string; selections: Record<string, number>; visited: Set<string> }> = [
    { stepId: first.id, selections: {}, visited: new Set() },
  ];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.stepId === targetStepId) return current.selections;
    if (current.visited.has(current.stepId)) continue;
    const step = stepById.get(current.stepId);
    if (!step) continue;
    const visited = new Set(current.visited).add(step.id);
    if (step.type === 'decide') {
      (step.branches || []).forEach((branch, index) => queue.push({
        stepId: branch.nextStepId,
        selections: { ...current.selections, [step.id]: index },
        visited,
      }));
      continue;
    }
    const target = step.type === 'tool_call'
      ? step.successStepId || step.nextStepId
      : step.nextStepId;
    if (target) queue.push({ stepId: target, selections: current.selections, visited });
  }
  return null;
}

export function simulateProcedureSuite(input: {
  procedure: ProcedureStudioDocument;
  tools?: ProcedureToolOption[];
}): ProcedureSimulationReport {
  const procedure = ProcedureStudioDocumentSchema.parse(input.procedure);
  const validation = validateProcedureStudioDocument({ procedure, tools: input.tools });
  const decisionCases = procedure.steps.flatMap((step) => step.type === 'decide'
    ? (step.branches || []).map((branch, index) => simulateCase({
        procedure,
        id: `decision:${step.id}:${index}`,
        name: `${step.label}: ${branch.condition}`,
        mode: 'decision_branch',
        forcedBranches: { [step.id]: index },
      }))
    : []);
  const toolFailureCases = procedure.steps.flatMap((step) => {
    if (step.type !== 'tool_call' || !step.toolName) return [];
    const forcedBranches = decisionSelectionsForTarget(procedure, step.id);
    if (!forcedBranches) return [];
    return [simulateCase({
      procedure,
      id: `tool_failure:${step.id}`,
      name: `Falha em ${step.label}`,
      mode: 'tool_failure',
      forcedBranches,
      failedStepId: step.id,
    })];
  });
  const cases = [
    simulateCase({ procedure }),
    ...decisionCases,
    ...toolFailureCases,
  ];
  return {
    passed: validation.valid && cases.every((item) => item.passed),
    validation,
    cases,
    executedAt: new Date().toISOString(),
  };
}
