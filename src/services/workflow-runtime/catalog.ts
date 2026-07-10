import type { ConnectionType, NodePort, RetryPolicy, WorkflowNode } from './types';

export type WorkflowNodeCategory =
  | 'triggers'
  | 'data'
  | 'logic'
  | 'ai'
  | 'knowledge_memory'
  | 'tools'
  | 'output'
  | 'error';

export type WorkflowNodeAvailability = 'stable' | 'beta' | 'hidden';

export type WorkflowNodeEditorField = {
  path: string;
  label: string;
  control: 'text' | 'textarea' | 'number' | 'boolean' | 'json' | 'string_list' | 'select';
  description?: string;
  options?: Array<{ label: string; value: string }>;
};

export type WorkflowNodeManifest = {
  type: string;
  label: string;
  description: string;
  category: WorkflowNodeCategory;
  icon: string;
  tone: 'blue' | 'cyan' | 'amber' | 'orange' | 'violet' | 'emerald' | 'red' | 'slate';
  inputPorts: NodePort[];
  outputPorts: NodePort[];
  defaultConfig: Record<string, unknown>;
  defaultTimeoutMs?: number;
  defaultRetryPolicy?: RetryPolicy;
  attachment: boolean;
  terminal?: boolean;
  sensitive?: boolean;
  requiresErrorRoute?: boolean;
  availability: WorkflowNodeAvailability;
  editorFields: WorkflowNodeEditorField[];
  requiredCapabilities: string[];
};

type WorkflowNodeManifestInput = Omit<
  WorkflowNodeManifest,
  'availability' | 'editorFields' | 'requiredCapabilities'
> & Partial<Pick<WorkflowNodeManifest, 'availability' | 'editorFields' | 'requiredCapabilities'>>;

export const STABLE_WORKFLOW_NODE_TYPES = new Set([
  'trigger.received_message',
  'trigger.manual',
  'data.set',
  'data.transform',
  'data.extract',
  'data.template',
  'logic.if',
  'logic.switch',
  'logic.ai_router',
  'logic.wait',
  'ai.model',
  'ai.agent',
  'knowledge.rag_retriever',
  'memory.session',
  'tool.internal',
  'tool.mcp',
  'guardrail.policy',
  'output.respond',
  'output.handoff',
  'output.end',
  'error.handler',
] as const);

const stableWorkflowNodeTypes: ReadonlySet<string> = STABLE_WORKFLOW_NODE_TYPES;

function editorControlFor(value: unknown): WorkflowNodeEditorField['control'] {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'string_list';
  if (value && typeof value === 'object') return 'json';
  return 'text';
}

function defaultCapabilitiesFor(type: string): string[] {
  if (type === 'ai.model') return ['model_provider'];
  if (type === 'ai.agent') return ['structured_output'];
  if (type === 'logic.ai_router' || type === 'data.extract') return ['structured_output'];
  if (type.startsWith('tool.')) return ['tool_runtime'];
  if (type === 'knowledge.rag_retriever') return ['rag'];
  if (type.startsWith('memory.')) return ['conversation_state'];
  if (type === 'output.respond') return ['message_delivery'];
  if (type === 'output.handoff') return ['human_handoff'];
  return [];
}

function defineManifest(input: WorkflowNodeManifestInput): WorkflowNodeManifest {
  return {
    ...input,
    availability: input.availability
      || (stableWorkflowNodeTypes.has(input.type)
        ? 'stable'
        : 'hidden'),
    editorFields: input.editorFields || Object.entries(input.defaultConfig).map(([path, value]) => ({
      path,
      label: path.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' '),
      control: editorControlFor(value),
    })),
    requiredCapabilities: input.requiredCapabilities || defaultCapabilitiesFor(input.type),
  };
}

const input = (
  id: string,
  label: string,
  connectionType: ConnectionType,
  options: Partial<Pick<NodePort, 'required' | 'multiple'>> = {},
): NodePort => ({
  id,
  label,
  direction: 'input',
  connectionType,
  required: options.required ?? false,
  multiple: options.multiple ?? false,
});

const output = (
  id: string,
  label: string,
  connectionType: ConnectionType,
  options: Partial<Pick<NodePort, 'required' | 'multiple'>> = {},
): NodePort => ({
  id,
  label,
  direction: 'output',
  connectionType,
  required: options.required ?? false,
  multiple: options.multiple ?? false,
});

const mainInput = input('main', 'Entrada', 'main', { required: true });
const mainOutput = output('success', 'Continuar', 'main');
const errorOutput = output('error', 'Erro', 'error');
const standardActionOutputs = [mainOutput, errorOutput];

const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 1,
  initialDelayMs: 0,
  backoffMultiplier: 2,
  maxDelayMs: 30_000,
  retryableErrorCodes: [],
};

const networkRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  maxDelayMs: 10_000,
  retryableErrorCodes: ['TIMEOUT', 'RATE_LIMITED', 'NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE'],
};

const WORKFLOW_NODE_MANIFEST_INPUTS: readonly WorkflowNodeManifestInput[] = [
  {
    type: 'trigger.received_message',
    label: 'Mensagem recebida',
    description: 'Inicia o fluxo quando uma nova mensagem chega.',
    category: 'triggers',
    icon: 'MessageSquareText',
    tone: 'blue',
    inputPorts: [],
    outputPorts: [output('message', 'Mensagem', 'main', { required: true })],
    defaultConfig: {},
    attachment: false,
  },
  {
    type: 'trigger.webhook',
    label: 'Webhook',
    description: 'Inicia o fluxo por uma requisição externa autenticada.',
    category: 'triggers',
    icon: 'Webhook',
    tone: 'blue',
    inputPorts: [],
    outputPorts: [output('request', 'Requisição', 'main', { required: true }), errorOutput],
    defaultConfig: { method: 'POST', authentication: 'signature' },
    attachment: false,
    requiresErrorRoute: true,
  },
  {
    type: 'trigger.internal_event',
    label: 'Evento interno',
    description: 'Inicia o fluxo a partir de um evento da plataforma.',
    category: 'triggers',
    icon: 'Radio',
    tone: 'blue',
    inputPorts: [],
    outputPorts: [output('event', 'Evento', 'main', { required: true })],
    defaultConfig: { eventName: '' },
    attachment: false,
  },
  {
    type: 'trigger.schedule',
    label: 'Agendamento',
    description: 'Executa o fluxo em um horário ou recorrência.',
    category: 'triggers',
    icon: 'CalendarClock',
    tone: 'blue',
    inputPorts: [],
    outputPorts: [output('tick', 'Disparo', 'main', { required: true })],
    defaultConfig: { timezone: 'America/Sao_Paulo', cron: '' },
    attachment: false,
  },
  {
    type: 'trigger.manual',
    label: 'Execução manual',
    description: 'Inicia uma execução de teste no editor.',
    category: 'triggers',
    icon: 'Play',
    tone: 'blue',
    inputPorts: [],
    outputPorts: [output('started', 'Iniciado', 'main', { required: true })],
    defaultConfig: {},
    attachment: false,
  },
  {
    type: 'data.set',
    label: 'Definir variáveis',
    description: 'Cria ou altera variáveis da execução.',
    category: 'data',
    icon: 'Braces',
    tone: 'slate',
    inputPorts: [mainInput],
    outputPorts: standardActionOutputs,
    defaultConfig: { assignments: {} },
    attachment: false,
  },
  {
    type: 'data.transform',
    label: 'Transformar dados',
    description: 'Mapeia, renomeia, combina ou remove campos.',
    category: 'data',
    icon: 'Shuffle',
    tone: 'slate',
    inputPorts: [mainInput],
    outputPorts: standardActionOutputs,
    defaultConfig: { mappings: {} },
    attachment: false,
  },
  {
    type: 'data.extract',
    label: 'Extrair dados',
    description: 'Converte texto em JSON validado por schema.',
    category: 'data',
    icon: 'ScanText',
    tone: 'cyan',
    inputPorts: [mainInput, input('model', 'Modelo', 'model', { required: true })],
    outputPorts: [
      output('success', 'Extraído', 'main'),
      output('invalid_output', 'Saída inválida', 'main'),
      errorOutput,
    ],
    defaultConfig: { schema: {}, maxAttempts: 2 },
    attachment: false,
    requiresErrorRoute: true,
  },
  {
    type: 'data.code',
    label: 'Código',
    description: 'Executa transformação isolada, limitada e auditada.',
    category: 'data',
    icon: 'Code2',
    tone: 'slate',
    inputPorts: [mainInput],
    outputPorts: standardActionOutputs,
    defaultConfig: {
      language: 'javascript',
      source: '',
      memoryLimitMb: 64,
      allowedResources: [],
      inputSchema: {},
      outputSchema: {},
    },
    defaultTimeoutMs: 5_000,
    defaultRetryPolicy,
    attachment: false,
    requiresErrorRoute: true,
  },
  {
    type: 'data.template',
    label: 'Template',
    description: 'Produz texto ou objeto a partir de variáveis.',
    category: 'data',
    icon: 'FileCode2',
    tone: 'slate',
    inputPorts: [mainInput],
    outputPorts: standardActionOutputs,
    defaultConfig: { template: '', outputKey: 'text' },
    attachment: false,
  },
  {
    type: 'logic.if',
    label: 'Condição IF',
    description: 'Roteia de forma determinística entre verdadeiro e falso.',
    category: 'logic',
    icon: 'Split',
    tone: 'amber',
    inputPorts: [mainInput],
    outputPorts: [
      output('true', 'Verdadeiro', 'main', { required: true }),
      output('false', 'Falso', 'main', { required: true }),
      errorOutput,
    ],
    defaultConfig: { left: '', operator: 'equals', right: '' },
    attachment: false,
  },
  {
    type: 'logic.switch',
    label: 'Switch',
    description: 'Compara um valor com rotas determinísticas e fallback.',
    category: 'logic',
    icon: 'GitBranch',
    tone: 'amber',
    inputPorts: [mainInput],
    outputPorts: [output('default', 'Padrão', 'main', { required: true }), errorOutput],
    defaultConfig: { value: '', cases: [], defaultOutput: 'default' },
    attachment: false,
  },
  {
    type: 'logic.ai_router',
    label: 'Roteador por IA',
    description: 'Seleciona uma rota permitida usando saída estruturada.',
    category: 'logic',
    icon: 'Route',
    tone: 'cyan',
    inputPorts: [mainInput, input('model', 'Modelo', 'model', { required: true })],
    outputPorts: [
      output('default', 'Padrão', 'main', { required: true }),
      output('low_confidence', 'Baixa confiança', 'main', { required: true }),
      errorOutput,
    ],
    defaultConfig: {
      routes: [],
      minimumConfidence: 0.75,
      lowConfidenceOutput: 'low_confidence',
      defaultOutput: 'default',
    },
    attachment: false,
    requiresErrorRoute: true,
  },
  {
    type: 'logic.merge',
    label: 'Merge',
    description: 'Reúne resultados de múltiplos caminhos.',
    category: 'logic',
    icon: 'Merge',
    tone: 'amber',
    inputPorts: [input('branches', 'Caminhos', 'main', { required: true, multiple: true })],
    outputPorts: standardActionOutputs,
    defaultConfig: { mode: 'wait_all' },
    attachment: false,
  },
  {
    type: 'logic.loop',
    label: 'Loop',
    description: 'Repete uma sequência com limite e condição de saída.',
    category: 'logic',
    icon: 'Repeat2',
    tone: 'amber',
    inputPorts: [mainInput],
    outputPorts: [
      output('iterate', 'Iterar', 'main', { required: true }),
      output('done', 'Concluído', 'main', { required: true }),
      output('limit_reached', 'Limite atingido', 'main', { required: true }),
      errorOutput,
    ],
    defaultConfig: { maxIterations: 10, exitCondition: '', totalTimeoutMs: 60_000 },
    attachment: false,
  },
  {
    type: 'logic.for_each',
    label: 'Iterar itens',
    description: 'Processa uma lista por item ou em lotes.',
    category: 'logic',
    icon: 'ListRestart',
    tone: 'amber',
    inputPorts: [mainInput],
    outputPorts: [
      output('item', 'Item', 'main', { required: true }),
      output('done', 'Concluído', 'main', { required: true }),
      errorOutput,
    ],
    defaultConfig: { items: '', batchSize: 1, maxItems: 1_000 },
    attachment: false,
  },
  {
    type: 'logic.parallel',
    label: 'Paralelo',
    description: 'Ativa ramificações independentes e controladas.',
    category: 'logic',
    icon: 'Waypoints',
    tone: 'amber',
    inputPorts: [mainInput],
    outputPorts: [output('branches', 'Ramificações', 'main', { required: true, multiple: true }), errorOutput],
    defaultConfig: { outputs: [], joinMode: 'wait_all' },
    attachment: false,
  },
  {
    type: 'logic.wait',
    label: 'Aguardar',
    description: 'Persiste e pausa a execução até tempo, evento ou resposta.',
    category: 'logic',
    icon: 'Timer',
    tone: 'amber',
    inputPorts: [mainInput, input('resume', 'Retomada', 'event')],
    outputPorts: [
      output('resumed', 'Retomado', 'main', { required: true }),
      output('expired', 'Expirado', 'main'),
      errorOutput,
    ],
    defaultConfig: { mode: 'event', timeoutMs: 86_400_000, resumeEvent: '' },
    attachment: false,
  },
  {
    type: 'logic.subflow',
    label: 'Subfluxo',
    description: 'Executa outro workflow com schemas explícitos.',
    category: 'logic',
    icon: 'Workflow',
    tone: 'amber',
    inputPorts: [mainInput],
    outputPorts: standardActionOutputs,
    defaultConfig: { workflowId: '', inputMapping: {}, inputSchema: {}, outputSchema: {} },
    attachment: false,
    requiresErrorRoute: true,
  },
  {
    type: 'ai.model',
    label: 'Modelo de IA',
    description: 'Configura provedor, modelo, capacidades e limites.',
    category: 'ai',
    icon: 'Cpu',
    tone: 'violet',
    inputPorts: [],
    outputPorts: [output('model', 'Modelo', 'model', { required: true, multiple: true })],
    defaultConfig: {
      provider: 'lmstudio',
      model: '',
      temperature: 0.2,
      maxOutputTokens: 2048,
      supportsTools: false,
      supportsStructuredOutput: false,
      supportsStreaming: false,
      timeoutMs: 60_000,
      maxRetries: 2,
    },
    attachment: true,
  },
  {
    type: 'ai.prompt',
    label: 'Prompt de IA',
    description: 'Executa uma única geração sem loop autônomo.',
    category: 'ai',
    icon: 'Sparkles',
    tone: 'cyan',
    inputPorts: [
      mainInput,
      input('model', 'Modelo', 'model', { required: true }),
      input('knowledge', 'Conhecimento', 'knowledge', { multiple: true }),
      input('guardrail', 'Guardrail', 'guardrail', { multiple: true }),
    ],
    outputPorts: [
      output('success', 'Resposta', 'main'),
      output('invalid_output', 'Saída inválida', 'main'),
      errorOutput,
    ],
    defaultConfig: { prompt: '', structuredOutput: false },
    attachment: false,
    requiresErrorRoute: true,
  },
  {
    type: 'ai.agent',
    label: 'Agente de IA',
    description: 'Decide, solicita tools e encerra dentro dos limites do runtime.',
    category: 'ai',
    icon: 'Bot',
    tone: 'cyan',
    inputPorts: [
      mainInput,
      input('model', 'Modelo', 'model', { required: true }),
      input('tools', 'Ferramentas', 'tool', { multiple: true }),
      input('memory', 'Memória', 'memory'),
      input('knowledge', 'Conhecimento', 'knowledge', { multiple: true }),
      input('guardrails', 'Guardrails', 'guardrail', { multiple: true }),
    ],
    outputPorts: [
      output('completed', 'Concluído', 'main'),
      output('needs_input', 'Precisa de dados', 'main'),
      output('handoff', 'Transferir', 'main'),
      output('limit_reached', 'Limite atingido', 'main'),
      errorOutput,
    ],
    defaultConfig: {
      name: 'Agente',
      role: '',
      persona: '',
      language: 'pt-BR',
      objective: '',
      instructions: [],
      completionCriteria: [],
      availableContext: [],
      maxTurns: 8,
      maxToolCalls: 20,
      maxRepeatedToolCalls: 2,
      timeoutMs: 120_000,
      modelTimeoutMs: 60_000,
      toolTimeoutMs: 30_000,
      allowParallelToolCalls: false,
      requireStructuredFinalOutput: false,
      fallbackOnToolError: 'route_to_error',
      onLimitReached: 'error',
    },
    defaultTimeoutMs: 120_000,
    attachment: false,
    requiresErrorRoute: true,
  },
  {
    type: 'ai.supervisor',
    label: 'Agente supervisor',
    description: 'Delega tarefas estruturadas a agentes especializados.',
    category: 'ai',
    icon: 'Network',
    tone: 'cyan',
    inputPorts: [
      mainInput,
      input('model', 'Modelo', 'model', { required: true }),
      input('agents', 'Agentes', 'agent_tool', { required: true, multiple: true }),
      input('memory', 'Memória', 'memory'),
      input('guardrails', 'Guardrails', 'guardrail', { multiple: true }),
    ],
    outputPorts: [
      output('completed', 'Concluído', 'main'),
      output('needs_input', 'Precisa de dados', 'main'),
      output('handoff', 'Transferir', 'main'),
      output('limit_reached', 'Limite atingido', 'main'),
      errorOutput,
    ],
    defaultConfig: { maxDelegations: 6, maxTurns: 8 },
    defaultTimeoutMs: 120_000,
    attachment: false,
    requiresErrorRoute: true,
  },
  {
    type: 'ai.evaluator',
    label: 'Avaliador',
    description: 'Avalia um resultado com quantidade limitada de revisões.',
    category: 'ai',
    icon: 'BadgeCheck',
    tone: 'cyan',
    inputPorts: [mainInput, input('model', 'Modelo', 'model', { required: true })],
    outputPorts: [
      output('approved', 'Aprovado', 'main', { required: true }),
      output('rejected', 'Corrigir', 'main', { required: true }),
      errorOutput,
    ],
    defaultConfig: { criteria: [], minimumScore: 0.8, maxRevisions: 2 },
    attachment: false,
  },
  {
    type: 'ai.planner',
    label: 'Planejador',
    description: 'Transforma um objetivo em etapas; não as executa.',
    category: 'ai',
    icon: 'ListTree',
    tone: 'cyan',
    inputPorts: [mainInput, input('model', 'Modelo', 'model', { required: true })],
    outputPorts: [output('planned', 'Plano', 'main'), errorOutput],
    defaultConfig: { maxSteps: 20 },
    attachment: false,
  },
  {
    type: 'ai.plan_executor',
    label: 'Executor de plano',
    description: 'Executa etapas validadas por tools ou subfluxos.',
    category: 'ai',
    icon: 'PlaySquare',
    tone: 'cyan',
    inputPorts: [
      mainInput,
      input('tools', 'Ferramentas', 'tool', { multiple: true }),
      input('subagents', 'Agentes', 'agent_tool', { multiple: true }),
    ],
    outputPorts: [
      output('completed', 'Concluído', 'main'),
      output('partial', 'Parcial', 'main'),
      output('limit_reached', 'Limite atingido', 'main'),
      errorOutput,
    ],
    defaultConfig: { maxSteps: 20, stopOnError: true },
    attachment: false,
    requiresErrorRoute: true,
  },
  {
    type: 'knowledge.rag_retriever',
    label: 'Retriever RAG',
    description: 'Recupera somente documentos relevantes dentro do orçamento.',
    category: 'knowledge_memory',
    icon: 'BookOpen',
    tone: 'orange',
    inputPorts: [],
    outputPorts: [output('knowledge', 'Conhecimento', 'knowledge', { required: true, multiple: true })],
    defaultConfig: {
      maxDocuments: 6,
      minimumScore: 0.55,
      filters: {},
      strategy: 'hybrid',
      rerank: true,
      tokenLimit: 6_000,
    },
    attachment: true,
  },
  {
    type: 'memory.session',
    label: 'Memória de sessão',
    description: 'Armazena informações válidas durante a conversa.',
    category: 'knowledge_memory',
    icon: 'History',
    tone: 'violet',
    inputPorts: [],
    outputPorts: [output('memory', 'Memória', 'memory', { required: true, multiple: true })],
    defaultConfig: { provider: 'postgres', maxMessages: 20, ttlSeconds: 86_400 },
    attachment: true,
  },
  {
    type: 'memory.long_term',
    label: 'Memória de longo prazo',
    description: 'Persiste fatos autorizados e recuperáveis.',
    category: 'knowledge_memory',
    icon: 'Database',
    tone: 'violet',
    inputPorts: [],
    outputPorts: [output('memory', 'Memória', 'memory', { required: true, multiple: true })],
    defaultConfig: { provider: 'postgres', allowedFields: [], requireConsent: true },
    attachment: true,
  },
  {
    type: 'memory.summarizer',
    label: 'Resumidor de histórico',
    description: 'Mantém um resumo incremental e fatos relevantes.',
    category: 'knowledge_memory',
    icon: 'NotebookTabs',
    tone: 'violet',
    inputPorts: [mainInput, input('model', 'Modelo', 'model', { required: true })],
    outputPorts: standardActionOutputs,
    defaultConfig: { maxSummaryTokens: 1_500 },
    attachment: false,
  },
  {
    type: 'state.load',
    label: 'Recuperar estado',
    description: 'Carrega dados persistidos de execução ou conversa.',
    category: 'knowledge_memory',
    icon: 'DatabaseZap',
    tone: 'violet',
    inputPorts: [mainInput],
    outputPorts: standardActionOutputs,
    defaultConfig: { namespace: '', keys: [] },
    attachment: false,
  },
  {
    type: 'state.save',
    label: 'Salvar estado',
    description: 'Persiste apenas campos explicitamente permitidos.',
    category: 'knowledge_memory',
    icon: 'Save',
    tone: 'violet',
    inputPorts: [mainInput],
    outputPorts: standardActionOutputs,
    defaultConfig: { namespace: '', allowedFields: [] },
    attachment: false,
  },
  {
    type: 'tool.http',
    label: 'Ferramenta HTTP',
    description: 'Executa uma API com segredo referenciado, timeout e schema.',
    category: 'tools',
    icon: 'Globe2',
    tone: 'red',
    inputPorts: [],
    outputPorts: [output('tool', 'Ferramenta', 'tool', { required: true, multiple: true })],
    defaultConfig: {
      name: '',
      description: '',
      method: 'GET',
      url: '',
      headers: {},
      secretReferences: [],
      inputSchema: {},
      outputSchema: {},
      timeoutMs: 15_000,
      maxResponseBytes: 1_000_000,
      idempotent: true,
    },
    defaultRetryPolicy: networkRetryPolicy,
    attachment: true,
    requiresErrorRoute: true,
  },
  {
    type: 'tool.database',
    label: 'Ferramenta de banco',
    description: 'Executa uma operação declarativa previamente permitida.',
    category: 'tools',
    icon: 'Database',
    tone: 'red',
    inputPorts: [],
    outputPorts: [output('tool', 'Ferramenta', 'tool', { required: true, multiple: true })],
    defaultConfig: {
      name: '',
      description: '',
      operation: '',
      inputSchema: {},
      outputSchema: {},
      allowRawSql: false,
      idempotent: true,
    },
    attachment: true,
    sensitive: true,
  },
  {
    type: 'tool.internal',
    label: 'Ferramenta interna',
    description: 'Executa uma ação autorizada da plataforma.',
    category: 'tools',
    icon: 'Wrench',
    tone: 'red',
    inputPorts: [],
    outputPorts: [output('tool', 'Ferramenta', 'tool', { required: true, multiple: true })],
    defaultConfig: {
      name: '',
      description: '',
      action: '',
      inputSchema: {},
      outputSchema: {},
      idempotent: false,
    },
    attachment: true,
  },
  {
    type: 'tool.mcp',
    label: 'Ferramenta MCP',
    description: 'Expõe uma tool autorizada de um servidor MCP.',
    category: 'tools',
    icon: 'PlugZap',
    tone: 'red',
    inputPorts: [],
    outputPorts: [output('tool', 'Ferramenta', 'tool', { required: true, multiple: true })],
    defaultConfig: {
      name: '',
      description: '',
      serverId: '',
      allowedTools: [],
      inputSchema: {},
      outputSchema: {},
      timeoutMs: 20_000,
      requiresConfirmation: false,
      audit: true,
    },
    attachment: true,
  },
  {
    type: 'tool.subflow',
    label: 'Ferramenta de subfluxo',
    description: 'Disponibiliza um workflow tipado como ferramenta.',
    category: 'tools',
    icon: 'Workflow',
    tone: 'red',
    inputPorts: [],
    outputPorts: [output('tool', 'Ferramenta', 'tool', { required: true, multiple: true })],
    defaultConfig: {
      name: '',
      description: '',
      workflowId: '',
      inputSchema: {},
      outputSchema: {},
      idempotent: true,
    },
    attachment: true,
  },
  {
    type: 'guardrail.policy',
    label: 'Guardrail',
    description: 'Valida entrada, saída e ações sensíveis.',
    category: 'ai',
    icon: 'ShieldCheck',
    tone: 'emerald',
    inputPorts: [],
    outputPorts: [output('guardrail', 'Política', 'guardrail', { required: true, multiple: true })],
    defaultConfig: { name: '', checks: [], onViolation: 'route_to_error' },
    attachment: true,
  },
  {
    type: 'output.respond',
    label: 'Responder',
    description: 'Envia uma resposta pelo canal configurado.',
    category: 'output',
    icon: 'Send',
    tone: 'emerald',
    inputPorts: [mainInput],
    outputPorts: [mainOutput, errorOutput],
    defaultConfig: { channel: 'source', message: '', idempotent: true },
    attachment: false,
    requiresErrorRoute: true,
  },
  {
    type: 'output.handoff',
    label: 'Transferir para humano',
    description: 'Transfere o atendimento com motivo e resumo.',
    category: 'output',
    icon: 'UserRound',
    tone: 'violet',
    inputPorts: [mainInput],
    outputPorts: [output('completed', 'Transferido', 'main'), errorOutput],
    defaultConfig: { teamId: '', reason: '', requireConfirmation: false },
    attachment: false,
    sensitive: true,
    requiresErrorRoute: true,
  },
  {
    type: 'output.end',
    label: 'Finalizar',
    description: 'Encerra a execução com saída estruturada.',
    category: 'output',
    icon: 'CheckCircle2',
    tone: 'emerald',
    inputPorts: [mainInput],
    outputPorts: [],
    defaultConfig: { output: {} },
    attachment: false,
    terminal: true,
  },
  {
    type: 'error.handler',
    label: 'Tratador de erro',
    description: 'Recebe falhas padronizadas e decide recuperação ou término.',
    category: 'error',
    icon: 'ShieldAlert',
    tone: 'red',
    inputPorts: [input('error', 'Erro', 'error', { required: true, multiple: true })],
    outputPorts: [
      output('recovered', 'Recuperado', 'main'),
      output('failed', 'Falhou', 'main'),
    ],
    defaultConfig: { mode: 'fail', publicMessage: 'Não foi possível concluir esta etapa.' },
    attachment: false,
  },
] as const;

export const WORKFLOW_NODE_CATALOG: readonly WorkflowNodeManifest[] = WORKFLOW_NODE_MANIFEST_INPUTS
  .map(defineManifest);

const manifestByType = new Map(WORKFLOW_NODE_CATALOG.map((manifest) => [manifest.type, manifest]));

export function getWorkflowNodeManifest(type: string): WorkflowNodeManifest | undefined {
  return manifestByType.get(type);
}

export function listWorkflowNodeManifests(category?: WorkflowNodeCategory): WorkflowNodeManifest[] {
  return WORKFLOW_NODE_CATALOG
    .filter((manifest) => !category || manifest.category === category)
    .map((manifest) => ({
      ...manifest,
      inputPorts: manifest.inputPorts.map((port) => ({ ...port })),
      outputPorts: manifest.outputPorts.map((port) => ({ ...port })),
      defaultConfig: structuredClone(manifest.defaultConfig),
    }));
}

export function listStableWorkflowNodeManifests(category?: WorkflowNodeCategory): WorkflowNodeManifest[] {
  return listWorkflowNodeManifests(category).filter((manifest) => manifest.availability === 'stable');
}

export function createWorkflowNode(
  type: string,
  input: {
    id: string;
    name?: string;
    position: { x: number; y: number };
    config?: Record<string, unknown>;
  },
): WorkflowNode {
  const manifest = getWorkflowNodeManifest(type);
  if (!manifest) throw new Error(`Unknown workflow node type: ${type}`);
  return {
    id: input.id,
    type,
    name: input.name || manifest.label,
    position: input.position,
    config: {
      ...structuredClone(manifest.defaultConfig),
      ...(input.config || {}),
    },
    inputPorts: manifest.inputPorts.map((port) => ({ ...port })),
    outputPorts: manifest.outputPorts.map((port) => ({ ...port })),
    retryPolicy: manifest.defaultRetryPolicy
      ? { ...manifest.defaultRetryPolicy }
      : undefined,
    timeoutMs: manifest.defaultTimeoutMs,
  };
}
