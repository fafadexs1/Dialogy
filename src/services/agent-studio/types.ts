import { z } from 'zod';

// ==========================================
// 1. DATA COLLECTION FIELD TYPES
// ==========================================
export const FIELD_DATA_TYPES = [
  'text',
  'number',
  'currency',
  'date',
  'time',
  'email',
  'phone',
  'cpf',
  'cnpj',
  'cpf_cnpj',
  'cep',
  'url',
  'single_select',
  'multi_select',
  'file',
  'boolean',
] as const;

export type FieldDataType = (typeof FIELD_DATA_TYPES)[number];

export const FIELD_DATA_TYPE_LABELS: Record<FieldDataType, string> = {
  text: 'Texto livre',
  number: 'Número',
  currency: 'Dinheiro (R$)',
  date: 'Data',
  time: 'Horário',
  email: 'E-mail',
  phone: 'Telefone / WhatsApp',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  cpf_cnpj: 'CPF ou CNPJ',
  cep: 'CEP',
  url: 'Link / URL',
  single_select: 'Opção única (Escolha)',
  multi_select: 'Múltiplas opções',
  file: 'Arquivo ou documento (PDF/Imagem)',
  boolean: 'Sim ou Não (Verdadeiro/Falso)',
};

export const CollectedFieldDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(200), // Empty authoring drafts are valid; publication validates required text.
  variableKey: z.string().min(1), // Auto-generated internal key: "customer_cpf"
  aliases: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
  description: z.string().optional(),
  type: z.enum(FIELD_DATA_TYPES).default('text'),
  required: z.boolean().default(true),
  promptMessage: z.string().max(4000),
  errorMessage: z.string().optional(), // Ex: "CPF inválido. Digite apenas os 11 números."
  exampleValue: z.string().optional(), // Ex: "123.456.789-00"
  options: z.array(z.string()).optional(), // For single_select / multi_select
  optionsSourceKey: z.string().optional(),
  optionLabelPath: z.string().optional(),
  optionValuePath: z.string().optional(),
  maxAttempts: z.number().int().min(1).max(5).default(3),
  requiresConfirmation: z.boolean().default(false),
  isSensitive: z.boolean().default(false), // Ocultar nos logs, privacidade LGPD
  reuseFrom: z.object({ sourceType: z.enum(['contact_property', 'flow_input']), sourceValue: z.string().max(200) }).optional(),
  validationRegex: z.string().optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
});

export type CollectedFieldDefinition = z.infer<typeof CollectedFieldDefinitionSchema>;

// ==========================================
// 2. API CONNECTIONS & HTTP REQUEST STEP
// ==========================================
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const AUTH_TYPES = [
  'none',
  'api_key',
  'bearer_token',
  'basic_auth',
  'custom_header',
  'oauth2',
] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const ApiConnectionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1), // Ex: "ERP Financeiro", "SGP Provedor"
  baseUrl: z.string().url(),
  authType: z.enum(AUTH_TYPES).default('none'),
  apiKeyHeader: z.string().optional(),
  apiKeyValue: z.string().optional(), // Encrypted on backend
  bearerToken: z.string().optional(), // Encrypted on backend
  basicUsername: z.string().optional(),
  basicPassword: z.string().optional(), // Encrypted on backend
  customHeaders: z.record(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApiConnection = z.infer<typeof ApiConnectionSchema>;

export const HttpRequestStepConfigSchema = z.object({
  connectionId: z.string().optional(), // If using a registered connection
  name: z.string().max(200),
  objective: z.string().optional(),
  method: z.enum(HTTP_METHODS).default('GET'),
  url: z.string(), // Rascunhos podem permanecer vazios; publicação exige URL válida.
  authType: z.enum(AUTH_TYPES).default('none'),
  // Guided Data Sent Table
  sentDataMappings: z
    .array(
      z.object({
        apiField: z.string(), // "document", "invoice_id"
        sourceType: z.enum(['collected_field', 'contact_property', 'static_value', 'step_output', 'flow_input']),
        sourceValue: z.string(), // "customer_cpf", "551199999999"
        location: z.enum(['query', 'body', 'path', 'header']).optional(),
        valueType: z.enum(['text', 'number', 'boolean', 'json']).optional(),
      })
    )
    .default([]),
  // Output Chip Mappings
  outputMappings: z
    .array(
      z.object({
        jsonPath: z.string(), // "data.invoice.url"
        chipLabel: z.string(), // "Link da fatura"
        chipKey: z.string(), // "invoice_url"
        required: z.boolean().optional(),
        sensitive: z.boolean().optional(),
      })
    )
    .default([]),
  // Advanced Settings (collapsed by default)
  headers: z.record(z.string()).optional(),
  queryParams: z.record(z.string()).optional(),
  bodyJson: z.string().optional(),
  timeoutSeconds: z.number().int().min(1).max(60).default(15),
  maxRetries: z.number().int().min(0).max(3).default(1),
  idempotencyKey: z.string().optional(),
  requiresConfirmation: z.boolean().optional(),
  fallbackAction: z.enum(['handoff', 'retry', 'message', 'abort']).default('handoff'),
  fallbackMessage: z.string().optional(),
});

export type HttpRequestStepConfig = z.infer<typeof HttpRequestStepConfigSchema>;

// ==========================================
// 3. MCP SERVER & MCP TOOL STEP
// ==========================================
export const MCP_TRANSPORTS = ['streamable_http', 'sse', 'stdio'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const McpServerConnectionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1), // Ex: "Servidor MCP Cobrança"
  transport: z.enum(MCP_TRANSPORTS).default('streamable_http'),
  endpoint: z.string().min(1),
  authHeader: z.string().optional(),
  authToken: z.string().optional(),
  discoveredToolsCount: z.number().default(0),
  status: z.enum(['connected', 'offline', 'error']).default('connected'),
  lastSyncedAt: z.string().optional(),
});

export type McpServerConnection = z.infer<typeof McpServerConnectionSchema>;

export const McpToolStepConfigSchema = z.object({
  serverId: z.string(),
  serverName: z.string().optional(),
  qualifiedToolName: z.string(), // Ex: "mcp:billing:generate_invoice"
  friendlyToolName: z.string(), // Ex: "Gerar boleto e PIX"
  description: z.string().optional(),
  riskLevel: z.enum(['read_only', 'reversible', 'sensitive', 'destructive']).default('read_only'),
  requiresConfirmation: z.boolean().default(false),
  confirmationPrompt: z.string().optional(),
  // Arguments mapped from collected friendly chips
  argumentMappings: z
    .array(
      z.object({
        argumentName: z.string(), // "cpf", "amount"
        sourceChipKey: z.string(), // "customer_cpf"
        sourceChipLabel: z.string(), // "CPF do cliente"
        sourceType: z.enum(['collected_field', 'contact_property', 'static_value', 'step_output', 'flow_input']).optional(),
        valueType: z.enum(['text', 'number', 'boolean', 'json']).optional(),
      })
    )
    .default([]),
  // Output chip mappings
  outputMappings: z
    .array(
      z.object({
        jsonPath: z.string(), // "invoice_pdf_url"
        chipLabel: z.string(), // "Arquivo PDF da Fatura"
        chipKey: z.string(), // "invoice_pdf_url"
        required: z.boolean().optional(),
        sensitive: z.boolean().optional(),
      })
    )
    .default([]),
  fallbackAction: z.enum(['handoff', 'message', 'abort']).default('handoff'),
  fallbackHandoffTeam: z.string().optional(),
});

export type McpToolStepConfig = z.infer<typeof McpToolStepConfigSchema>;

// ==========================================
// 4. PROCEDURE STEP TYPES & SCHEMAS
// ==========================================
export const PROCEDURE_STEP_TYPES = [
  'message', // Enviar mensagem
  'collect_data', // Coletar dados
  'knowledge_lookup', // Consultar conhecimento
  'validate_data', // Validar dados
  'native_action', // Executar ação Dialogy
  'http_request', // Chamar API
  'mcp_tool_call', // Executar ferramenta MCP
  'decision', // Tomar decisão
  'respond', // Responder ao cliente
  'handoff', // Transferir atendimento
  'finish', // Finalizar procedimento
] as const;

export type ProcedureStepType = (typeof PROCEDURE_STEP_TYPES)[number];

export const PROCEDURE_STEP_TYPE_LABELS: Record<
  ProcedureStepType,
  { label: string; description: string; badgeColor: string }
> = {
  message: {
    label: 'Enviar mensagem',
    description: 'Envia uma mensagem de texto ao cliente',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
  collect_data: {
    label: 'Coletar dados',
    description: 'Solicita e valida dados do cliente',
    badgeColor: 'bg-sky-100 text-sky-800 border-sky-300',
  },
  knowledge_lookup: {
    label: 'Consultar conhecimento',
    description: 'Busca respostas na base de documentos',
    badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  },
  validate_data: {
    label: 'Validar dados',
    description: 'Confere uma regra de negócio',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  native_action: {
    label: 'Ação Dialogy',
    description: 'Aplica etiqueta, atualiza CRM ou encerra atendimento',
    badgeColor: 'bg-purple-100 text-purple-800 border-purple-300',
  },
  http_request: {
    label: 'Chamar API',
    description: 'Integração HTTP/REST direta',
    badgeColor: 'bg-orange-100 text-orange-800 border-orange-300',
  },
  mcp_tool_call: {
    label: 'Ferramenta MCP',
    description: 'Executa tool descoberta em servidor MCP',
    badgeColor: 'bg-violet-100 text-violet-800 border-violet-300',
  },
  decision: {
    label: 'Tomar decisão',
    description: 'Bifurca caminhos sem fios técnicos',
    badgeColor: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300',
  },
  respond: {
    label: 'Responder',
    description: 'Informa a solução encontrada',
    badgeColor: 'bg-teal-100 text-teal-800 border-teal-300',
  },
  handoff: {
    label: 'Transferir',
    description: 'Encaminha para a equipe humana correta',
    badgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
  },
  finish: {
    label: 'Finalizar',
    description: 'Conclui o procedimento com sucesso',
    badgeColor: 'bg-slate-100 text-slate-800 border-slate-300',
  },
};

export const DecisionBranchSchema = z.object({
  id: z.string().min(1),
  conditionLabel: z.string().max(1000),
  actionType: z.enum(['respond', 'handoff', 'continue', 'collect_data']),
  actionValue: z.string().optional(), // Message text or Team name
  nextStepId: z.string().optional(),
  isDefault: z.boolean().optional(),
  condition: z.object({
    fieldKey: z.string(),
    operator: z.enum(['exists', 'not_exists', 'equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'count_equals', 'count_greater_than']),
    value: z.string().optional(),
  }).optional(),
});

export const ProcedureStepSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().min(1),
  type: z.enum(PROCEDURE_STEP_TYPES),
  title: z.string().max(200),
  subtitle: z.string().optional(),
  // Detailed configurations per type
  messageText: z.string().optional(),
  collectField: CollectedFieldDefinitionSchema.optional(),
  knowledgeCollectionId: z.string().optional(),
  validationRule: z.string().optional(),
  nativeActionType: z.enum(['add_tag', 'remove_tag', 'update_crm_field', 'close_chat']).optional(),
  nativeActionPayload: z.record(z.unknown()).optional(),
  nativeDataMappings: z.array(z.object({
    apiField: z.string(), sourceType: z.enum(['collected_field', 'step_output', 'contact_property', 'flow_input', 'static_value']),
    sourceValue: z.string(), valueType: z.enum(['text', 'number', 'boolean', 'json']).optional(),
  })).optional(),
  httpRequest: HttpRequestStepConfigSchema.optional(),
  mcpTool: McpToolStepConfigSchema.optional(),
  decisionBranches: z.array(DecisionBranchSchema).optional(),
  handoffTeam: z.string().optional(),
  handoffReason: z.string().optional(),
  // On failure branch
  onFailHandoffTeam: z.string().optional(),
  onFailMessage: z.string().optional(),
  nextStepId: z.string().nullable().optional(),
  messageDataKeys: z.array(z.string()).optional(),
});

export type ProcedureStep = z.infer<typeof ProcedureStepSchema>;

export const ProcedureDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(200),
  description: z.string().optional(),
  objective: z.string().optional(), // Ex: "Emitir e enviar segunda via em PDF ou PIX"
  priority: z.number().int().default(100),
  whenToUse: z.string().optional(), // Ex: "Quando o cliente solicitar boleto ou código de barras"
  whenNotToUse: z.string().optional(), // Ex: "Para cancelamento ou alteração de plano"
  triggerKeywords: z.array(z.string()).default([]),
  exampleRequests: z.array(z.string()).default([]),
  steps: z.array(ProcedureStepSchema).default([]),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  publishedVersion: z.number().nullable().default(null),
  updatedAt: z.string(),
});

export type ProcedureDocument = z.infer<typeof ProcedureDocumentSchema>;

// ==========================================
// 5. MAIN AGENT STUDIO DOCUMENT & STAGES
// ==========================================
export const AgentServiceType = [
  'support',
  'sales',
  'billing',
  'scheduling',
  'custom',
] as const;
export type AgentServiceType = (typeof AgentServiceType)[number];

export const AGENT_SERVICE_TYPE_LABELS: Record<AgentServiceType, string> = {
  support: 'Suporte e Atendimento',
  sales: 'Vendas e Comercial',
  billing: 'Cobrança e Financeiro',
  scheduling: 'Agendamento e Reservas',
  custom: 'Personalizado',
};

export const AgentStudioDocumentSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().max(200),
  objective: z.string().optional(), // Ex: "Atender clientes com dúvidas e emitir boletos"
  serviceType: z.enum(AgentServiceType).default('support'),
  language: z.string().default('pt-BR'),
  aiModel: z.string().trim().min(1).max(200).optional(),
  avatarUrl: z.union([z.string().url().startsWith('https://').max(2048), z.literal('')]).optional(),
  inlineKnowledge: z.array(z.object({
    id: z.string().min(1), name: z.string().max(200), content: z.string().max(100_000),
    sourceType: z.enum(['manual', 'file']).optional(), fileName: z.string().max(255).optional(),
    mimeType: z.string().max(100).optional(), importedAt: z.string().optional(), contentHash: z.string().length(64).optional(),
    pages: z.array(z.object({ number: z.number().int().positive(), content: z.string().max(100_000) })).max(100).optional(),
  })).max(20).optional(),
  status: z.enum(['draft', 'published', 'paused']).default('draft'),
  publishedVersion: z.number().nullable().default(null),
  // 1. Entender o cliente
  draftRevision: z.number().int().nonnegative().optional(),
  migrationReview: z.object({ sourceHash: z.string().max(64), acknowledgedKeys: z.array(z.string().max(200)).max(500) }).optional(),
  restoredKnowledgeReleaseId: z.string().uuid().optional(),
  understandStage: z.object({
    welcomeMessage: z.string().default('Olá! Sou o assistente virtual. Como posso te ajudar hoje?'),
    askInitialData: z.boolean().default(true),
    initialFields: z.array(CollectedFieldDefinitionSchema).default([]),
    outOfScopeMessage: z.string().default('Desculpe, não consigo ajudar com este assunto no momento.'),
  }),
  // 2. Resolver com IA
  resolveStage: z.object({
    knowledgeCollectionIds: z.array(z.string()).default([]),
    procedures: z.array(ProcedureDocumentSchema).default([]),
    allowGeneralAiChat: z.boolean().default(true),
  }),
  // 3. Concluir o atendimento
  concludeStage: z.object({
    confirmResolutionQuestion: z.string().default('Conseguiu resolver tudo o que precisava?'),
    successClosingMessage: z.string().default('Perfeito! Agradecemos o seu contato. Tenha um ótimo dia!'),
    handoffTeam: z.string().default('Suporte'),
    handoffMessage: z.string().default('Vou transferir seu atendimento para um de nossos especialistas.'),
    maxRetriesBeforeHandoff: z.number().int().min(1).max(5).default(3),
  }),
  // Regras e Aparência
  appearance: z.object({
    colorTheme: z.string().default('emerald'),
    showAvatar: z.boolean().default(true),
    botTitle: z.string().default('Atendimento'),
  }),
  rules: z.object({
    operatingHoursEnabled: z.boolean().default(false),
    operatingHoursStart: z.string().default('08:00'),
    operatingHoursEnd: z.string().default('18:00'),
    outOfHoursMessage: z.string().default('Nosso atendimento opera de segunda a sexta, das 08h às 18h.'),
    toneOfVoice: z.string().default('cordial, objetivo e prestativo'),
    timeZone: z.string().optional(),
    operatingDays: z.array(z.number().int().min(0).max(6)).optional(),
    maxTurnsPerSession: z.number().int().min(2).max(100).optional(),
    maxToolCallsPerSession: z.number().int().min(1).max(50).optional(),
    excludedTopics: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
    prohibitedDataLabels: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  }),
  updatedAt: z.string(),
});

export type AgentStudioDocument = z.infer<typeof AgentStudioDocumentSchema>;

// ==========================================
// 6. IMMUTABLE RELEASE MANIFEST
// ==========================================
export const AgentReleaseManifestSchema = z.object({
  releaseId: z.string().min(1),
  agentId: z.string().min(1),
  workspaceId: z.string().min(1),
  version: z.number().int().min(1),
  agentSnapshot: AgentStudioDocumentSchema,
  publishedProcedures: z.array(ProcedureDocumentSchema),
  referencedConnectionIds: z.array(z.string()),
  connectionFingerprints: z.record(z.string()).optional(),
  mcpServerToolFingerprints: z.record(z.string()), // toolName -> fingerprint
  createdAt: z.string(),
  publishedByUserId: z.string().optional(),
  runtimeVersion: z.literal('studio-v1').optional(),
  knowledgeSnapshot: z.array(z.record(z.unknown())).optional(),
  runtimeConfig: z.object({ aiModel: z.string().nullable() }).optional(),
});

export type AgentReleaseManifest = z.infer<typeof AgentReleaseManifestSchema>;

// ==========================================
// 7. FACTORY HELPERS
// ==========================================
export function createInvoiceAgentStudioTemplate(
  id: string,
  workspaceId: string,
  name = 'Novo Agente de IA',
  serviceType: AgentServiceType = 'support'
): AgentStudioDocument {
  return {
    id,
    workspaceId,
    name,
    objective: 'Atender solicitações e executar procedimentos operacionais com IA.',
    serviceType,
    language: 'pt-BR',
    status: 'draft',
    publishedVersion: null,
    understandStage: {
      welcomeMessage: 'Olá! Sou o assistente virtual. Como posso te ajudar hoje?',
      askInitialData: false,
      initialFields: [],
      outOfScopeMessage: 'Não identifiquei como ajudar com esse assunto. Pode explicar melhor o que precisa ou pedir atendimento humano?',
    },
    resolveStage: {
      knowledgeCollectionIds: [],
      procedures: [
        {
          id: `proc_${Date.now()}_1`,
          name: 'Segunda via de fatura',
          description: 'A IA segue estas etapas quando o cliente pedir uma nova via da fatura.',
          objective: 'Localizar a fatura e entregar o boleto ou chave PIX.',
          whenToUse: 'Quando o cliente solicitar a segunda via de uma fatura. O sistema consultado deve verificar o acesso do titular; CPF/CNPJ válido não comprova identidade.',
          whenNotToUse: 'Não usar para contestação, negociação de dívida, cancelamento ou acesso a dados de outra pessoa.',
          priority: 100,
          triggerKeywords: ['fatura', 'boleto', 'segunda via', 'pix', 'pagamento', 'conta'],
          exampleRequests: ['Quero minha fatura', 'Me manda o boleto', 'Preciso do PIX para pagar'],
          status: 'draft',
          publishedVersion: null,
          updatedAt: new Date().toISOString(),
          steps: [
            {
              id: 'step_1',
              order: 1,
              type: 'collect_data',
              title: 'Identificar o cliente',
              subtitle: 'Pedir CPF ou CNPJ do titular',
              collectField: {
                id: 'field_cpf',
                name: 'CPF ou CNPJ do titular',
                variableKey: 'customer_cpf',
                type: 'cpf_cnpj',
                required: true,
                promptMessage: 'Para localizar seu cadastro, por favor me informe o CPF ou CNPJ do titular.',
                errorMessage: 'O documento não parece válido. Confira o CPF ou CNPJ informado.',
                maxAttempts: 3,
                requiresConfirmation: false,
                isSensitive: true,
              },
            },
            {
              id: 'step_2',
              order: 2,
              type: 'http_request',
              title: 'Consultar faturas autorizadas',
              subtitle: 'Buscar contratos e faturas disponíveis no sistema',
              httpRequest: {
                name: 'Consultar faturas no ERP',
                method: 'GET',
                url: '',
                authType: 'none',
                sentDataMappings: [
                  {
                    apiField: 'document',
                    sourceType: 'collected_field',
                    sourceValue: 'customer_cpf',
                  },
                ],
                outputMappings: [
                  {
                    jsonPath: 'data.invoices',
                    chipLabel: 'Faturas encontradas',
                    chipKey: 'invoices_list',
                  },
                ],
                timeoutSeconds: 15,
                maxRetries: 1,
                fallbackAction: 'handoff',
                fallbackMessage: 'Não foi possível consultar as faturas no momento.',
              },
            },
            {
              id: 'step_3',
              order: 3,
              type: 'decision',
              title: 'Verificar faturas encontradas',
              subtitle: 'Prosseguir apenas se a consulta retornar uma lista não vazia',
              decisionBranches: [
                {
                  id: 'branch_single',
                  conditionLabel: 'Uma ou mais faturas encontradas',
                  actionType: 'continue',
                  condition: { fieldKey: 'invoices_list', operator: 'count_greater_than', value: '0' },
                  nextStepId: 'step_choose',
                },
                {
                  id: 'branch_none',
                  conditionLabel: 'Nenhuma fatura em aberto',
                  actionType: 'respond',
                  actionValue: 'Não encontrei faturas disponíveis nesta consulta. Você pode corrigir o documento informado ou pedir atendimento humano.',
                  isDefault: true,
                },
              ],
            },
            {
              id: 'step_choose', order: 4, type: 'collect_data', title: 'Selecionar a fatura',
              subtitle: 'Com uma fatura, seleciona automaticamente; com várias, pergunta ao cliente.',
              collectField: { id: 'field_invoice', name: 'Fatura escolhida', variableKey: 'selected_invoice', type: 'single_select',
                required: true, promptMessage: 'Qual fatura você deseja receber?', maxAttempts: 3, requiresConfirmation: false, isSensitive: true,
                optionsSourceKey: 'invoices_list', optionLabelPath: 'reference', optionValuePath: 'id' },
            },
            {
              id: 'step_4',
              order: 5,
              type: 'mcp_tool_call',
              title: 'Gerar segunda via',
              subtitle: 'Criar PDF, boleto ou PIX no servidor financeiro',
              mcpTool: {
                serverId: '',
                serverName: '',
                qualifiedToolName: '',
                friendlyToolName: 'Selecionar ferramenta MCP',
                riskLevel: 'read_only',
                requiresConfirmation: true,
                argumentMappings: [
                  {
                    argumentName: 'invoice_id',
                    sourceChipKey: 'selected_invoice',
                    sourceChipLabel: 'Fatura escolhida',
                  },
                ],
                outputMappings: [
                  {
                    jsonPath: 'invoice_url',
                    chipLabel: 'Link da fatura',
                    chipKey: 'invoice_url',
                  },
                ],
                fallbackAction: 'handoff',
                fallbackHandoffTeam: '',
              },
            },
            {
              id: 'step_5',
              order: 6,
              type: 'respond',
              title: 'Enviar link do documento',
              subtitle: 'Responder somente com o resultado confirmado pela integração',
              messageText: 'Aqui está o link da segunda via da sua fatura:',
              messageDataKeys: ['invoice_url'],
            },
          ],
        },
      ],
      allowGeneralAiChat: true,
    },
    concludeStage: {
      confirmResolutionQuestion: 'Conseguiu resolver tudo o que precisava?',
      successClosingMessage: 'Perfeito! Agradecemos o seu contato. Tenha um ótimo dia!',
      handoffTeam: 'Suporte',
      handoffMessage: 'Vou transferir você agora mesmo para a nossa equipe de suporte.',
      maxRetriesBeforeHandoff: 3,
    },
    appearance: {
      colorTheme: 'emerald',
      showAvatar: true,
      botTitle: 'Atendimento Virtual',
    },
    rules: {
      operatingHoursEnabled: false,
      operatingHoursStart: '08:00',
      operatingHoursEnd: '18:00',
      outOfHoursMessage: 'Nosso atendimento funciona de segunda a sexta, das 08h às 18h.',
      toneOfVoice: 'cordial, rápido, objetivo e seguro',
    },
    updatedAt: new Date().toISOString(),
  };
}

/** New and unmigrated agents must never inherit a published demo procedure. */
export function createDefaultAgentStudioDocument(
  id: string, workspaceId: string, name = 'Novo Agente de IA', serviceType: AgentServiceType = 'support',
): AgentStudioDocument {
  const document = createInvoiceAgentStudioTemplate(id, workspaceId, name, serviceType);
  document.resolveStage.procedures = [];
  document.concludeStage.handoffTeam = '';
  document.draftRevision = 0;
  return document;
}
