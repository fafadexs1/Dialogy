import { createWorkflowNode } from './catalog';
import { WorkflowDefinitionSchema } from './schemas';
import type {
  ModelConfiguration,
  WorkflowConnection,
  WorkflowDefinition,
  WorkflowNode,
} from './types';

export type NativeWorkflowTemplate = 'single_agent' | 'routed_team' | 'blank';

export type CreateNativeWorkflowTemplateInput = {
  configId: string;
  workspaceId: string;
  name: string;
  model: ModelConfiguration;
  persona?: string;
  language?: string;
  template: NativeWorkflowTemplate;
};

function link(
  id: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
  connectionType: WorkflowConnection['connectionType'] = 'main',
): WorkflowConnection {
  return { id, sourceNodeId, sourcePortId, targetNodeId, targetPortId, connectionType };
}

function baseDefinition(input: CreateNativeWorkflowTemplateInput): WorkflowDefinition {
  const timestamp = new Date().toISOString();
  return {
    id: `autopilot:${input.configId}`,
    workspaceId: input.workspaceId,
    name: input.name,
    version: 'draft',
    status: 'draft',
    nodes: [],
    connections: [],
    settings: {
      executionTimeoutMs: 120_000,
      maxSteps: 100,
      maxModelCalls: 15,
      maxToolCalls: 20,
      maxAgentTurnsPerNode: 8,
      maxRepeatedDecisionSignatures: 2,
      maxTotalInputTokens: 100_000,
      maxTotalOutputTokens: 20_000,
      concurrencyLimit: 1,
    },
    metadata: {
      source: 'native_flowbuilder',
      editorVersion: 2,
      template: input.template,
      configId: input.configId,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function addNode(
  definition: WorkflowDefinition,
  type: string,
  id: string,
  name: string,
  position: { x: number; y: number },
  config: Record<string, unknown> = {},
): WorkflowNode {
  const node = createWorkflowNode(type, { id, name, position, config });
  definition.nodes.push(node);
  return node;
}

function addAgentBranch(input: {
  definition: WorkflowDefinition;
  prefix: string;
  title: string;
  role: string;
  objective: string;
  persona: string;
  language: string;
  x: number;
  y: number;
  mainSource: { nodeId: string; portId: string };
  modelId: string;
  memoryId: string;
  guardrailId: string;
}) {
  const { definition, prefix, x, y } = input;
  const agent = addNode(definition, 'ai.agent', `${prefix}_agent`, input.title, { x, y }, {
    name: input.title,
    role: input.role,
    persona: input.persona,
    language: input.language,
    objective: input.objective,
    instructions: [
      'Use somente as capacidades conectadas a este agente.',
      'Não invente resultados de ferramentas ou informações ausentes.',
    ],
    completionCriteria: ['Responder, perguntar ou encaminhar a solicitação de forma segura.'],
    availableContext: ['input', 'context', 'variables'],
    maxTurns: 8,
    maxToolCalls: 20,
    maxRepeatedToolCalls: 2,
    timeoutMs: 120_000,
    modelTimeoutMs: 60_000,
    toolTimeoutMs: 30_000,
    allowParallelToolCalls: false,
    requireStructuredFinalOutput: false,
    fallbackOnToolError: 'route_to_error',
    onLimitReached: 'handoff',
  });
  const rag = addNode(definition, 'knowledge.rag_retriever', `${prefix}_knowledge`, `Conhecimento de ${input.title}`, { x: x - 260, y: y + 190 });
  const respond = addNode(definition, 'output.respond', `${prefix}_respond`, 'Responder', { x: x + 280, y: y - 100 }, {
    message: '{{current.response}}',
    channel: 'source',
    idempotent: true,
  });
  const ask = addNode(definition, 'output.respond', `${prefix}_ask`, 'Pedir informação', { x: x + 280, y: y + 40 }, {
    message: '{{current.question}}',
    channel: 'source',
    idempotent: true,
  });
  const limit = addNode(definition, 'output.respond', `${prefix}_limit`, 'Informar limite', { x: x + 280, y: y + 180 }, {
    message: '{{current.response}}',
    channel: 'source',
    idempotent: true,
  });
  const handoff = addNode(definition, 'output.respond', `${prefix}_handoff`, 'Transferência ainda não configurada', { x: x + 280, y: y + 320 }, {
    message: 'Não consegui encaminhar automaticamente agora porque a equipe de destino ainda não foi configurada.',
    channel: 'source',
    idempotent: true,
  });
  const respondEnd = addNode(definition, 'output.end', `${prefix}_respond_end`, 'Finalizar resposta', { x: x + 560, y: y - 100 });
  const askEnd = addNode(definition, 'output.end', `${prefix}_ask_end`, 'Finalizar pergunta', { x: x + 560, y: y + 40 });
  const limitEnd = addNode(definition, 'output.end', `${prefix}_limit_end`, 'Finalizar limite', { x: x + 560, y: y + 180 });
  const handoffEnd = addNode(definition, 'output.end', `${prefix}_handoff_end`, 'Finalizar sem transferência', { x: x + 560, y: y + 320 });

  definition.connections.push(
    link(`${prefix}_main`, input.mainSource.nodeId, input.mainSource.portId, agent.id, 'main'),
    link(`${prefix}_model`, input.modelId, 'model', agent.id, 'model', 'model'),
    link(`${prefix}_memory`, input.memoryId, 'memory', agent.id, 'memory', 'memory'),
    link(`${prefix}_knowledge_link`, rag.id, 'knowledge', agent.id, 'knowledge', 'knowledge'),
    link(`${prefix}_guardrail`, input.guardrailId, 'guardrail', agent.id, 'guardrails', 'guardrail'),
    link(`${prefix}_completed`, agent.id, 'completed', respond.id, 'main'),
    link(`${prefix}_needs_input`, agent.id, 'needs_input', ask.id, 'main'),
    link(`${prefix}_limit_reached`, agent.id, 'limit_reached', limit.id, 'main'),
    link(`${prefix}_handoff_route`, agent.id, 'handoff', handoff.id, 'main'),
    link(`${prefix}_respond_done`, respond.id, 'success', respondEnd.id, 'main'),
    link(`${prefix}_ask_done`, ask.id, 'success', askEnd.id, 'main'),
    link(`${prefix}_limit_done`, limit.id, 'success', limitEnd.id, 'main'),
    link(`${prefix}_handoff_done`, handoff.id, 'success', handoffEnd.id, 'main'),
  );
}

function addSharedCapabilities(definition: WorkflowDefinition, input: CreateNativeWorkflowTemplateInput) {
  const model = addNode(definition, 'ai.model', 'shared_model', 'Modelo principal', { x: 80, y: 60 }, input.model);
  const memory = addNode(definition, 'memory.session', 'shared_memory', 'Memória da conversa', { x: 80, y: 250 });
  const guardrail = addNode(definition, 'guardrail.policy', 'shared_guardrail', 'Políticas da automação', { x: 80, y: 440 }, {
    name: 'Políticas da automação',
    checks: ['no_secret_exposure', 'no_unconfirmed_tool_success'],
    onViolation: 'route_to_error',
  });
  return { model, memory, guardrail };
}

function createSingleAgentTemplate(input: CreateNativeWorkflowTemplateInput) {
  const definition = baseDefinition(input);
  const trigger = addNode(definition, 'trigger.received_message', 'message_received', 'Mensagem recebida', { x: 80, y: -120 });
  const shared = addSharedCapabilities(definition, input);
  addAgentBranch({
    definition,
    prefix: 'primary',
    title: 'Agente de atendimento',
    role: 'atendimento principal',
    objective: 'Resolver a solicitação atual do cliente dentro das políticas configuradas.',
    persona: input.persona || '',
    language: input.language || 'pt-BR',
    x: 430,
    y: -120,
    mainSource: { nodeId: trigger.id, portId: 'message' },
    modelId: shared.model.id,
    memoryId: shared.memory.id,
    guardrailId: shared.guardrail.id,
  });
  return WorkflowDefinitionSchema.parse(definition);
}

function createRoutedTeamTemplate(input: CreateNativeWorkflowTemplateInput) {
  const definition = baseDefinition(input);
  const trigger = addNode(definition, 'trigger.received_message', 'message_received', 'Mensagem recebida', { x: 80, y: -160 });
  const shared = addSharedCapabilities(definition, input);
  const router = addNode(definition, 'logic.ai_router', 'team_router', 'Identificar especialista', { x: 390, y: -160 }, {
    routes: [
      { id: 'support', label: 'Suporte', description: 'Dúvidas, problemas técnicos e ajuda operacional.', examples: [] },
      { id: 'sales', label: 'Comercial', description: 'Produtos, propostas, planos e intenção de compra.', examples: [] },
    ],
    minimumConfidence: 0.75,
    lowConfidenceOutput: 'low_confidence',
    defaultOutput: 'default',
  });
  router.outputPorts.splice(0, 0,
    { id: 'support', label: 'Suporte', direction: 'output', connectionType: 'main', required: true, multiple: false },
    { id: 'sales', label: 'Comercial', direction: 'output', connectionType: 'main', required: true, multiple: false },
  );
  const lowConfidence = addNode(definition, 'output.respond', 'router_low_confidence', 'Pedir contexto', { x: 720, y: 460 }, {
    message: 'Para direcionar você corretamente, pode explicar um pouco mais o que precisa?',
    channel: 'source',
    idempotent: true,
  });
  const lowEnd = addNode(definition, 'output.end', 'router_low_end', 'Finalizar esclarecimento', { x: 1010, y: 460 });
  const defaultResponse = addNode(definition, 'output.respond', 'router_default', 'Fallback de rota', { x: 720, y: 600 }, {
    message: 'Ainda não identifiquei o melhor especialista. Pode detalhar sua solicitação?',
    channel: 'source',
    idempotent: true,
  });
  const defaultEnd = addNode(definition, 'output.end', 'router_default_end', 'Finalizar fallback', { x: 1010, y: 600 });
  definition.connections.push(
    link('trigger_router', trigger.id, 'message', router.id, 'main'),
    link('router_model', shared.model.id, 'model', router.id, 'model', 'model'),
    link('router_low', router.id, 'low_confidence', lowConfidence.id, 'main'),
    link('router_default_route', router.id, 'default', defaultResponse.id, 'main'),
    link('router_low_done', lowConfidence.id, 'success', lowEnd.id, 'main'),
    link('router_default_done', defaultResponse.id, 'success', defaultEnd.id, 'main'),
  );
  addAgentBranch({
    definition,
    prefix: 'support',
    title: 'Agente de suporte',
    role: 'suporte',
    objective: 'Diagnosticar e resolver solicitações de suporte com segurança.',
    persona: input.persona || '',
    language: input.language || 'pt-BR',
    x: 720,
    y: -220,
    mainSource: { nodeId: router.id, portId: 'support' },
    modelId: shared.model.id,
    memoryId: shared.memory.id,
    guardrailId: shared.guardrail.id,
  });
  addAgentBranch({
    definition,
    prefix: 'sales',
    title: 'Agente comercial',
    role: 'comercial',
    objective: 'Entender a necessidade e conduzir a oportunidade comercial sem inventar condições.',
    persona: input.persona || '',
    language: input.language || 'pt-BR',
    x: 720,
    y: 120,
    mainSource: { nodeId: router.id, portId: 'sales' },
    modelId: shared.model.id,
    memoryId: shared.memory.id,
    guardrailId: shared.guardrail.id,
  });
  return WorkflowDefinitionSchema.parse(definition);
}

export function createNativeWorkflowTemplate(input: CreateNativeWorkflowTemplateInput): WorkflowDefinition {
  if (input.template === 'single_agent') return createSingleAgentTemplate(input);
  if (input.template === 'routed_team') return createRoutedTeamTemplate(input);
  const definition = baseDefinition(input);
  addNode(definition, 'trigger.manual', 'manual_trigger', 'Execução manual', { x: 120, y: 120 });
  return WorkflowDefinitionSchema.parse(definition);
}
