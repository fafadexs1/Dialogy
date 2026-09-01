import { getWorkflowNodeManifest } from './catalog';
import { WorkflowDefinitionSchema } from './schemas';
import { assertValidCronExpression } from './cron';
import type {
  WorkflowConnection,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowValidationIssue,
  WorkflowValidationResult,
} from './types';

export type WorkflowValidatorOptions = {
  knownWorkflowIds?: Iterable<string>;
  knownVariableNames?: Iterable<string>;
  allowMultipleTriggers?: boolean;
  availableModelIds?: Iterable<string>;
};

type ValidationCollector = {
  errors: WorkflowValidationIssue[];
  warnings: WorkflowValidationIssue[];
};

function error(
  collector: ValidationCollector,
  code: string,
  message: string,
  details: Pick<WorkflowValidationIssue, 'nodeId' | 'connectionId'> = {},
) {
  collector.errors.push({ code, message, ...details });
}

function warning(
  collector: ValidationCollector,
  code: string,
  message: string,
  details: Pick<WorkflowValidationIssue, 'nodeId' | 'connectionId'> = {},
) {
  collector.warnings.push({ code, message, ...details });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSchemaLike(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (Object.keys(value).length === 0) return true;
  if (typeof value.type === 'string') return true;
  return isObject(value.properties) || Array.isArray(value.anyOf) || Array.isArray(value.oneOf);
}

function configuredText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function connectionKey(connection: WorkflowConnection) {
  return `${connection.sourceNodeId}:${connection.sourcePortId}->${connection.targetNodeId}:${connection.targetPortId}`;
}

function collectKnownVariables(
  definition: WorkflowDefinition,
  options: WorkflowValidatorOptions,
): Set<string> {
  const names = new Set<string>([
    'input',
    'current',
    'arguments',
    'context',
    'variables',
    'nodeResults',
    'sessionId',
    'conversationId',
    ...(options.knownVariableNames || []),
  ]);
  const inputProperties = definition.inputSchema?.properties;
  if (isObject(inputProperties)) {
    for (const name of Object.keys(inputProperties)) names.add(`input.${name}`);
  }
  for (const node of definition.nodes) {
    const variableName = configuredText(node.config.variableName);
    const outputKey = configuredText(node.config.outputKey);
    if (variableName) names.add(variableName);
    if (outputKey) names.add(outputKey);
    if (node.type === 'data.set' && isObject(node.config.assignments)) {
      for (const name of Object.keys(node.config.assignments)) names.add(name);
    }
  }
  return names;
}

function collectVariableReferences(value: unknown, found: Set<string>, visited = new Set<object>()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.-]*)\s*\}\}/g)) {
      if (match[1]) found.add(match[1]);
    }
    return;
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectVariableReferences(item, found, visited);
    return;
  }
  for (const item of Object.values(value)) collectVariableReferences(item, found, visited);
}

function containsInlineSecret(value: unknown, key = '', visited = new Set<object>()): boolean {
  const secretKey = /(api[_-]?key|token|password|authorization|client[_-]?secret|private[_-]?key)/i.test(key);
  const isReferenceKey = /(reference|secretref|secret_id|credential_id)$/i.test(key);
  if (typeof value === 'string') {
    if (/^https?:\/\/[^/\s]+:[^@\s]+@/i.test(value)) return true;
    return secretKey && !isReferenceKey && value.trim().length > 0;
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return false;
  visited.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsInlineSecret(item, key, visited));
  }
  return Object.entries(value).some(([childKey, childValue]) => (
    containsInlineSecret(childValue, childKey, visited)
  ));
}

function executableConnections(definition: WorkflowDefinition) {
  return definition.connections.filter((connection) => (
    connection.connectionType === 'main'
    || connection.connectionType === 'error'
    || connection.connectionType === 'event'
  ));
}

function findReachable(
  startId: string,
  adjacency: Map<string, string[]>,
): Set<string> {
  const visited = new Set<string>();
  const pending = [startId];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    for (const target of adjacency.get(nodeId) || []) pending.push(target);
  }
  return visited;
}

function canReachTerminal(
  nodeId: string,
  terminalIds: Set<string>,
  adjacency: Map<string, string[]>,
  memo: Map<string, boolean>,
  visiting = new Set<string>(),
): boolean {
  if (terminalIds.has(nodeId)) return true;
  const cached = memo.get(nodeId);
  if (cached !== undefined) return cached;
  if (visiting.has(nodeId)) return false;
  visiting.add(nodeId);
  const result = (adjacency.get(nodeId) || []).some((target) => (
    canReachTerminal(target, terminalIds, adjacency, memo, visiting)
  ));
  visiting.delete(nodeId);
  memo.set(nodeId, result);
  return result;
}

function detectCycles(
  nodeIds: Iterable<string>,
  adjacency: Map<string, string[]>,
): string[][] {
  const completed = new Set<string>();
  const stack: string[] = [];
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  const visit = (nodeId: string) => {
    if (completed.has(nodeId)) return;
    if (inStack.has(nodeId)) {
      const start = stack.indexOf(nodeId);
      if (start >= 0) cycles.push(stack.slice(start));
      return;
    }
    inStack.add(nodeId);
    stack.push(nodeId);
    for (const target of adjacency.get(nodeId) || []) visit(target);
    stack.pop();
    inStack.delete(nodeId);
    completed.add(nodeId);
  };

  for (const nodeId of nodeIds) visit(nodeId);
  return cycles;
}

function hasPermissionConfiguration(node: WorkflowNode): boolean {
  return Boolean(
    configuredText(node.config.permission)
    || configuredText(node.config.permissionScope)
    || node.config.requiresConfirmation === true
    || node.config.requireConfirmation === true
    || node.config.requiresHumanApproval === true
  );
}

function validateNodeConfig(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  incoming: WorkflowConnection[],
  outgoing: WorkflowConnection[],
  collector: ValidationCollector,
  options: WorkflowValidatorOptions,
) {
  const manifest = getWorkflowNodeManifest(node.type);
  if (!manifest) {
    warning(
      collector,
      'unknown_node_type',
      `O bloco "${node.name}" usa o tipo customizado "${node.type}".`,
      { nodeId: node.id },
    );
  }

  if (node.type === 'ai.agent' || node.type === 'ai.supervisor') {
    const modelConnections = incoming.filter((connection) => connection.connectionType === 'model');
    if (modelConnections.length === 0) {
      error(collector, 'agent_missing_model', `O agente "${node.name}" não possui modelo conectado.`, { nodeId: node.id });
    }
    if (!configuredText(node.config.objective) && node.type === 'ai.agent') {
      error(collector, 'agent_missing_objective', `O agente "${node.name}" precisa de um objetivo.`, { nodeId: node.id });
    }
    const toolConnections = incoming.filter((connection) => connection.connectionType === 'tool');
    if (toolConnections.length > 0 && modelConnections.length > 0) {
      const modelNode = definition.nodes.find((candidate) => candidate.id === modelConnections[0]?.sourceNodeId);
      if (modelNode?.config.supportsTools === false) {
        error(
          collector,
          'agent_model_without_tool_support',
          `O modelo conectado a "${node.name}" não foi aprovado para uso de ferramentas.`,
          { nodeId: node.id },
        );
      }
    }
  }

  if (node.type === 'ai.published_agent' && (!configuredText(node.config.agentId) || !configuredText(node.config.releaseId))) {
    error(collector, 'published_agent_missing_release', `Selecione uma versão publicada no bloco “${node.name}”.`, { nodeId: node.id });
  }

  if (node.type.startsWith('interaction.')) {
    if (!configuredText(node.config.prompt)) {
      error(collector, 'interaction_prompt_missing', `O bloco "${node.name}" precisa de uma pergunta.`, { nodeId: node.id });
    }
    if (!configuredText(node.config.outputKey)) {
      error(collector, 'interaction_output_missing', `O bloco "${node.name}" precisa informar onde salvar a resposta.`, { nodeId: node.id });
    }
    if (node.type === 'interaction.options') {
      const options = Array.isArray(node.config.options) ? node.config.options.filter(isObject) : [];
      if (options.length === 0) {
        error(collector, 'interaction_options_missing', `O bloco "${node.name}" precisa de ao menos uma opção.`, { nodeId: node.id });
      }
      const ids = options.map((option) => configuredText(option.id));
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
        error(collector, 'interaction_option_id_invalid', `As opções de "${node.name}" precisam de identificadores únicos.`, { nodeId: node.id });
      }
      for (const id of ids.filter(Boolean)) {
        if (!node.outputPorts.some((port) => port.id === id)) {
          error(collector, 'interaction_option_route_missing', `A opção "${id}" de "${node.name}" não possui saída.`, { nodeId: node.id });
        }
      }
      if (
        node.config.customFallbackRoutes === true
        && !outgoing.some((connection) => connection.sourcePortId === 'default')
      ) {
        error(collector, 'interaction_custom_fallback_missing', `O bloco "${node.name}" habilitou a rota avançada “Não reconhecida”, mas ela não está conectada.`, { nodeId: node.id });
      }
    }
  }

  if (node.type === 'data.code') {
    if (node.config.language !== 'javascript' || !configuredText(node.config.source) || !configuredText(node.config.outputKey)) {
      error(collector, 'code_config_invalid', `O bloco "${node.name}" precisa de JavaScript e variável de saída.`, { nodeId: node.id });
    }
  }

  if (node.type === 'memory.session') {
    const scope = configuredText(node.config.scope) || 'hybrid';
    const maxMessages = Number(node.config.maxMessages ?? 20);
    const maxAgeDays = Number(node.config.maxAgeDays ?? 180);
    if (node.config.provider !== 'dialogy' || !['hybrid', 'conversation', 'contact'].includes(scope)) {
      error(collector, 'dialogy_memory_config_invalid', `O bloco "${node.name}" precisa usar a memória nativa da Dialogy e um escopo válido.`, { nodeId: node.id });
    }
    if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 200 || !Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 730) {
      error(collector, 'dialogy_memory_limits_invalid', `O bloco "${node.name}" possui limites de memória inválidos.`, { nodeId: node.id });
    }
  }

  if (node.type === 'data.transform' && node.config.mode === 'jsonata') {
    if (!configuredText(node.config.expression)) {
      error(collector, 'jsonata_expression_missing', `O bloco "${node.name}" precisa de uma expressão JSONata.`, { nodeId: node.id });
    }
    if (!configuredText(node.config.outputKey)) {
      error(collector, 'jsonata_output_missing', `O bloco "${node.name}" precisa informar onde salvar o resultado JSONata.`, { nodeId: node.id });
    }
    const evaluationTimeoutMs = Number(node.config.evaluationTimeoutMs || 250);
    if (!Number.isFinite(evaluationTimeoutMs) || evaluationTimeoutMs < 25 || evaluationTimeoutMs > 2_000) {
      error(collector, 'jsonata_timeout_invalid', `O limite JSONata de "${node.name}" deve ficar entre 25 e 2000 ms.`, { nodeId: node.id });
    }
  }

  if (node.type === 'trigger.received_message') {
    const mode = configuredText(node.config.matchMode) || 'all';
    if (!['all', 'any_keyword', 'all_keywords', 'regex'].includes(mode)) {
      error(collector, 'message_trigger_mode_invalid', `O modo do gatilho "${node.name}" é inválido.`, { nodeId: node.id });
    }
    if (mode === 'any_keyword' || mode === 'all_keywords') {
      const keywords = Array.isArray(node.config.keywords) ? node.config.keywords.map(configuredText).filter(Boolean) : [];
      if (keywords.length === 0) error(collector, 'message_trigger_keywords_missing', `O gatilho "${node.name}" precisa de palavras-chave.`, { nodeId: node.id });
      const thresholds = isObject(node.config.keywordThresholds) ? node.config.keywordThresholds : {};
      if (Object.values(thresholds).some((value) => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) {
        error(collector, 'message_trigger_threshold_invalid', `O gatilho "${node.name}" possui compatibilidade fora do intervalo de 0 a 100%.`, { nodeId: node.id });
      }
      if (isObject(node.config.keywordOutputPorts)) {
        const invalidOutput = Object.entries(node.config.keywordOutputPorts).some(([keyword, outputId]) => (
          !keywords.includes(keyword)
          || !node.outputPorts.some((port) => port.id === configuredText(outputId) && port.connectionType === 'main')
        ));
        if (invalidOutput) error(collector, 'message_trigger_keyword_route_invalid', `O gatilho "${node.name}" possui uma saída de frase inválida.`, { nodeId: node.id });
      }
    }
    if (mode === 'regex') {
      try { new RegExp(configuredText(node.config.pattern), node.config.caseSensitive === true ? '' : 'i'); } catch {
        error(collector, 'message_trigger_regex_invalid', `A expressão regular de "${node.name}" é inválida.`, { nodeId: node.id });
      }
      if (!configuredText(node.config.pattern)) error(collector, 'message_trigger_regex_missing', `O gatilho "${node.name}" precisa de uma expressão regular.`, { nodeId: node.id });
    }
    const configuredList = (value: unknown) => Array.isArray(value) ? value.map(configuredText).filter(Boolean) : [];
    const platforms = configuredList(node.config.platforms);
    const messageTypes = configuredList(node.config.messageTypes);
    if (platforms.some((platform) => !['whatsapp', 'telegram', 'instagram', 'messenger', 'webchat'].includes(platform))) {
      error(collector, 'message_trigger_platform_invalid', `O gatilho "${node.name}" possui um canal inválido.`, { nodeId: node.id });
    }
    if (messageTypes.some((messageType) => !['text', 'image', 'video', 'audio', 'document'].includes(messageType))) {
      error(collector, 'message_trigger_content_type_invalid', `O gatilho "${node.name}" possui um tipo de mensagem inválido.`, { nodeId: node.id });
    }
    if (!['all', 'unassigned_only'].includes(configuredText(node.config.startPolicy) || 'all')) {
      error(collector, 'message_trigger_start_policy_invalid', `A regra de atribuição do gatilho "${node.name}" é inválida.`, { nodeId: node.id });
    }
    const defaultOutput = configuredText(node.config.defaultOutput);
    if (defaultOutput && !node.outputPorts.some((port) => port.id === defaultOutput && port.connectionType === 'main')) {
      error(collector, 'message_trigger_default_route_invalid', `O gatilho "${node.name}" aponta para uma saída padrão inexistente.`, { nodeId: node.id });
    }
  }

  if (node.type === 'interaction.options' && node.config.intelligentMatching === true) {
    const minimumConfidence = Number(node.config.intelligentMinimumConfidence ?? 0.65);
    if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0.5 || minimumConfidence > 1) {
      error(collector, 'interaction_option_confidence_invalid', `A confiança inteligente de "${node.name}" deve ficar entre 0,5 e 1.`, { nodeId: node.id });
    }
  }

  if (node.type === 'trigger.internal_event') {
    const eventName = configuredText(node.config.eventName);
    if (!eventName || !/^[a-z0-9][a-z0-9._:-]*$/.test(eventName)) {
      error(collector, 'internal_event_name_invalid', `O gatilho "${node.name}" precisa de um nome de acontecimento interno válido.`, { nodeId: node.id });
    }
  }

  if (node.type === 'trigger.webhook' && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(configuredText(node.config.method).toUpperCase())) {
    error(collector, 'webhook_method_invalid', `O método do webhook "${node.name}" é inválido.`, { nodeId: node.id });
  }

  if (node.type === 'trigger.schedule') {
    try { assertValidCronExpression(configuredText(node.config.cron), configuredText(node.config.timezone) || 'UTC'); } catch {
      error(collector, 'schedule_config_invalid', `O cron ou fuso horário de "${node.name}" é inválido.`, { nodeId: node.id });
    }
  }

  if (node.type === 'logic.time_window') {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(configuredText(node.config.startTime)) || !timePattern.test(configuredText(node.config.endTime))) {
      error(collector, 'time_window_invalid', `A faixa horária de "${node.name}" é inválida.`, { nodeId: node.id });
    }
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: configuredText(node.config.timezone) }).format();
    } catch {
      error(collector, 'time_window_timezone_invalid', `O fuso horário de "${node.name}" é inválido.`, { nodeId: node.id });
    }
  }

  if (node.type === 'logic.goto') {
    const targetNodeId = configuredText(node.config.targetNodeId);
    if (!targetNodeId || targetNodeId === node.id || !definition.nodes.some((candidate) => candidate.id === targetNodeId && !candidate.type.startsWith('trigger.'))) {
      error(collector, 'goto_target_invalid', `O destino de "${node.name}" precisa ser outro bloco executável deste fluxo.`, { nodeId: node.id });
    }
  }

  if (node.type === 'output.media') {
    const url = configuredText(node.config.url);
    if (!url || (!url.includes('{{') && !/^https:\/\//i.test(url))) {
      error(collector, 'media_url_invalid', `O bloco "${node.name}" precisa de uma URL HTTPS pública ou variável.`, { nodeId: node.id });
    }
  }

  if (node.type === 'output.redirect') {
    const url = configuredText(node.config.url);
    if (!url || (!url.includes('{{') && !/^https?:\/\//i.test(url))) {
      error(collector, 'redirect_url_invalid', `O bloco "${node.name}" precisa de uma URL HTTP(S) ou variável.`, { nodeId: node.id });
    }
  }

  if (node.type === 'output.handoff') {
    const destinationType = configuredText(node.config.destinationType) || 'human';
    if (
      (destinationType === 'intelligent_agent' && !configuredText(node.config.systemAgentId))
      || (destinationType === 'human' && !configuredText(node.config.teamId) && !configuredText(node.config.agentId))
      || !['human', 'intelligent_agent'].includes(destinationType)
    ) {
      error(collector, 'handoff_destination_invalid', `O bloco "${node.name}" precisa de uma equipe, atendente ou Atendente Inteligente válido.`, { nodeId: node.id });
    }
    if (node.config.requireConfirmation === true && !configuredText(node.config.confirmationPath)) {
      error(collector, 'handoff_confirmation_missing', `O bloco "${node.name}" exige o caminho de uma confirmação booleana explícita.`, { nodeId: node.id });
    }
  }

  if (node.type === 'output.close_conversation') {
    const mode = configuredText(node.config.closePolicy) || 'goal_evidence';
    if (!['goal_evidence', 'deterministic_route'].includes(mode)) {
      error(collector, 'close_authorization_invalid', `O bloco "${node.name}" possui uma autorização de encerramento inválida.`, { nodeId: node.id });
    }
    if (mode === 'goal_evidence') {
      const hasGoalInput = incoming
        .filter((connection) => connection.connectionType === 'main')
        .some((connection) => {
          const sourceNode = definition.nodes.find((candidate) => candidate.id === connection.sourceNodeId);
          return sourceNode?.type === 'logic.goal_completion' && connection.sourcePortId === 'completed';
        });
      if (!hasGoalInput) error(collector, 'close_goal_evidence_missing', `O bloco "${node.name}" precisa receber a saída Concluído de um verificador de objetivo.`, { nodeId: node.id });
    }
  }

  if (node.type === 'integration.http_request') {
    const url = configuredText(node.config.url);
    if (!url || (!url.includes('{{') && !/^https:\/\//i.test(url))) {
      error(collector, 'http_url_invalid', `O bloco "${node.name}" precisa de uma URL HTTPS pública ou variável.`, { nodeId: node.id });
    }
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(configuredText(node.config.method).toUpperCase())) {
      error(collector, 'http_method_invalid', `O método HTTP de "${node.name}" é inválido.`, { nodeId: node.id });
    }
    if (!configuredText(node.config.outputKey)) {
      error(collector, 'http_output_missing', `O bloco "${node.name}" precisa de uma variável de saída.`, { nodeId: node.id });
    }
  }

  if (node.type === 'integration.mcp_call') {
    const toolName = configuredText(node.config.toolName);
    if (!/^mcp:[^:]+:.+$/.test(toolName) || !configuredText(node.config.outputKey) || !isObject(node.config.arguments)) {
      error(collector, 'mcp_call_config_invalid', `O bloco "${node.name}" precisa de uma ferramenta MCP sincronizada, argumentos JSON e variável de saída.`, { nodeId: node.id });
    }
    if (node.config.requiresConfirmation === true && !configuredText(node.config.confirmationPath)) {
      error(collector, 'mcp_call_confirmation_missing', `O bloco "${node.name}" exige o caminho de uma confirmação booleana explícita.`, { nodeId: node.id });
    }
  }

  if (node.type === 'integration.email') {
    if (!configuredText(node.config.credentialId) || !configuredText(node.config.to) || !configuredText(node.config.subject) || (!configuredText(node.config.text) && !configuredText(node.config.html))) {
      error(collector, 'email_config_invalid', `O bloco "${node.name}" precisa de SMTP, destinatário, assunto e conteúdo.`, { nodeId: node.id });
    }
  }

  if (node.type === 'integration.google_sheets_append') {
    if (!configuredText(node.config.credentialId) || !configuredText(node.config.spreadsheetId) || !configuredText(node.config.range) || !Array.isArray(node.config.values) || node.config.values.length === 0) {
      error(collector, 'sheets_config_invalid', `O bloco "${node.name}" precisa de OAuth, planilha, intervalo e valores.`, { nodeId: node.id });
    }
  }

  if (node.type === 'integration.database') {
    const operation = configuredText(node.config.operation);
    const filters = Array.isArray(node.config.filters) ? node.config.filters : [];
    if (!configuredText(node.config.credentialId) || !configuredText(node.config.table) || !['select', 'insert', 'update', 'delete'].includes(operation)) {
      error(collector, 'database_config_invalid', `O bloco "${node.name}" precisa de conexão, tabela e operação declarativa.`, { nodeId: node.id });
    }
    if (['update', 'delete'].includes(operation) && filters.length === 0) {
      error(collector, 'database_filter_required', `O bloco "${node.name}" exige filtro para ${operation.toUpperCase()}.`, { nodeId: node.id });
    }
  }

  if (node.type === 'dialogy.crm_update' && (!isObject(node.config.fields) || Object.keys(node.config.fields).length === 0)) {
    error(collector, 'crm_fields_missing', `O bloco "${node.name}" precisa de ao menos um campo do CRM.`, { nodeId: node.id });
  }

  if (node.type.startsWith('dialogy.sgp_')) {
    if (!configuredText(node.config.outputKey) || Number(node.config.timeoutMs || 0) < 60_000) {
      error(collector, 'sgp_config_invalid', `O bloco "${node.name}" precisa de uma variável de saída e timeout de pelo menos um minuto.`, { nodeId: node.id });
    }
    if (node.type === 'dialogy.sgp_payment_promise') {
      const promiseDate = configuredText(node.config.promiseDate);
      if (promiseDate && !promiseDate.includes('{{') && !/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)) {
        error(collector, 'sgp_promise_date_invalid', `A data de "${node.name}" deve usar AAAA-MM-DD ou uma variável.`, { nodeId: node.id });
      }
    }
    if (node.type === 'dialogy.sgp_second_copy' && node.config.deliveryMode === 'cloud-template') {
      const templateFields = ['pixTemplateName', 'pixTemplateInstance', 'boletoTemplateName', 'boletoTemplateInstance'];
      if (templateFields.some((field) => !configuredText(node.config[field]))) {
        error(collector, 'sgp_templates_missing', `O bloco "${node.name}" precisa dos templates e instâncias de PIX e boleto.`, { nodeId: node.id });
      }
      if (
        configuredText(node.config.pixTemplateName) === configuredText(node.config.boletoTemplateName)
        && configuredText(node.config.pixTemplateInstance) === configuredText(node.config.boletoTemplateInstance)
      ) {
        error(collector, 'sgp_templates_equal', `O bloco "${node.name}" precisa usar templates diferentes para PIX e boleto.`, { nodeId: node.id });
      }
    }
  }

  if (node.type === 'dialogy.team_availability' && !configuredText(node.config.teamId)) {
    error(collector, 'dialogy_team_missing', `O bloco "${node.name}" precisa de uma equipe do workspace.`, { nodeId: node.id });
  }

  if (node.type === 'dialogy.chat_tag' && !configuredText(node.config.tagId)) {
    error(collector, 'dialogy_tag_missing', `O bloco "${node.name}" precisa de uma etiqueta do workspace.`, { nodeId: node.id });
  }

  if (node.type === 'whatsapp.group_create') {
    const participants = Array.isArray(node.config.participants)
      ? node.config.participants.map(configuredText).filter(Boolean)
      : configuredText(node.config.participants).split(/[\n,;]+/).filter(Boolean);
    const hasMessageTrigger = definition.nodes.some((candidate) => candidate.type === 'trigger.received_message');
    if (!configuredText(node.config.groupName) || participants.length === 0 || (!configuredText(node.config.instanceName) && !hasMessageTrigger)) {
      error(collector, 'whatsapp_group_config_invalid', `O bloco "${node.name}" precisa de nome, participantes e uma instância (ou gatilho de mensagem).`, { nodeId: node.id });
    }
  }

  if (node.type === 'whatsapp.send_text' || node.type === 'whatsapp.send_media') {
    const hasMessageTrigger = definition.nodes.some((candidate) => candidate.type === 'trigger.received_message');
    const targetConfigured = configuredText(node.config.phoneNumber) || hasMessageTrigger;
    const instanceConfigured = configuredText(node.config.instanceName) || hasMessageTrigger;
    const contentConfigured = node.type === 'whatsapp.send_text'
      ? configuredText(node.config.message)
      : configuredText(node.config.url);
    if (!targetConfigured || !instanceConfigured || !contentConfigured) {
      error(
        collector,
        'whatsapp_send_config_invalid',
        `O bloco "${node.name}" precisa do conteúdo, telefone e instância (telefone/instância podem vir do gatilho de mensagem).`,
        { nodeId: node.id },
      );
    }
  }

  if (node.type.startsWith('tool.')) {
    if (!configuredText(node.config.name) || !configuredText(node.config.description)) {
      error(
        collector,
        'tool_missing_description',
        `A ferramenta "${node.name}" precisa de nome e descrição operacional.`,
        { nodeId: node.id },
      );
    }
    if (!isSchemaLike(node.config.inputSchema) || !isSchemaLike(node.config.outputSchema)) {
      error(
        collector,
        'tool_missing_schema',
        `A ferramenta "${node.name}" precisa de schemas de entrada e saída válidos.`,
        { nodeId: node.id },
      );
    }
    if (node.type === 'tool.database' && node.config.allowRawSql === true) {
      warning(
        collector,
        'database_tool_raw_sql_enabled',
        `A ferramenta "${node.name}" permite SQL livre; prefira operações declarativas.`,
        { nodeId: node.id },
      );
    }
    if (node.type === 'tool.database') {
      const operation = configuredText(node.config.operation);
      const filters = Array.isArray(node.config.filters) ? node.config.filters : [];
      if (!configuredText(node.config.credentialId) || !configuredText(node.config.table) || !['select', 'insert', 'update', 'delete'].includes(operation)) {
        error(collector, 'database_tool_config_invalid', `A ferramenta "${node.name}" precisa de conexão, tabela e operação declarativa.`, { nodeId: node.id });
      }
      if (['update', 'delete'].includes(operation) && filters.length === 0) {
        const properties = isObject(node.config.inputSchema) && isObject(node.config.inputSchema.properties)
          ? node.config.inputSchema.properties
          : {};
        if (!Object.prototype.hasOwnProperty.call(properties, 'filter_column')) {
          error(collector, 'database_tool_filter_required', `A ferramenta "${node.name}" precisa de filtro fixo ou argumento de filtro para ${operation.toUpperCase()}.`, { nodeId: node.id });
        }
      }
    }
    if (node.type === 'tool.http') {
      const url = configuredText(node.config.url);
      const method = configuredText(node.config.method).toUpperCase();
      if (!url || (!url.includes('{{') && !/^https:\/\//i.test(url)) || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
        error(collector, 'http_tool_config_invalid', `A ferramenta "${node.name}" precisa de método permitido e URL HTTPS pública ou variável.`, { nodeId: node.id });
      }
      if (!isObject(node.config.inputSchema) || node.config.inputSchema.type !== 'object') {
        error(collector, 'http_tool_schema_invalid', `A ferramenta "${node.name}" precisa de argumentos definidos como objeto.`, { nodeId: node.id });
      }
      if (!['none', 'json', 'raw', 'text', 'form-data'].includes(configuredText(node.config.bodyType) || 'none')) {
        error(collector, 'http_tool_body_invalid', `O tipo de corpo da ferramenta "${node.name}" é inválido.`, { nodeId: node.id });
      }
      if (node.config.credentialRequired === true && !configuredText(node.config.credentialId)) {
        error(collector, 'http_tool_credential_missing', `A ferramenta "${node.name}" exige uma credencial segura.`, { nodeId: node.id });
      }
    }
  }

  if (node.type === 'logic.loop') {
    const maxIterations = Number(node.config.maxIterations);
    const totalTimeoutMs = Number(node.config.totalTimeoutMs);
    if (!Number.isInteger(maxIterations) || maxIterations <= 0 || !Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= 0) {
      error(
        collector,
        'loop_missing_limit',
        `O loop "${node.name}" precisa de máximo de iterações e timeout total.`,
        { nodeId: node.id },
      );
    }
    if (!configuredText(node.config.exitCondition)) {
      error(
        collector,
        'loop_missing_exit_condition',
        `O loop "${node.name}" precisa de uma condição de saída.`,
        { nodeId: node.id },
      );
    }
  }

  if (node.type === 'logic.switch') {
    const defaultOutput = configuredText(node.config.defaultOutput);
    if (!defaultOutput || !node.outputPorts.some((port) => port.id === defaultOutput)) {
      error(
        collector,
        'switch_missing_fallback',
        `O Switch "${node.name}" precisa de uma saída padrão existente.`,
        { nodeId: node.id },
      );
    }
  }

  if (node.type === 'logic.ai_router') {
    const routes = Array.isArray(node.config.routes) ? node.config.routes : [];
    if (routes.length === 0) {
      error(collector, 'ai_router_missing_routes', `O roteador "${node.name}" não possui rotas.`, { nodeId: node.id });
    }
    const lowConfidenceOutput = configuredText(node.config.lowConfidenceOutput);
    if (!lowConfidenceOutput || !node.outputPorts.some((port) => port.id === lowConfidenceOutput)) {
      error(
        collector,
        'ai_router_missing_low_confidence',
        `O roteador "${node.name}" precisa de uma saída de baixa confiança.`,
        { nodeId: node.id },
      );
    }
  }

  if (node.type === 'logic.wait') {
    const hasEventInput = node.inputPorts.some((port) => port.connectionType === 'event');
    const resumeEvent = configuredText(node.config.resumeEvent);
    const mode = configuredText(node.config.mode);
    if (!hasEventInput || (mode !== 'time' && !resumeEvent)) {
      error(
        collector,
        'wait_missing_resume_mechanism',
        `O bloco "${node.name}" precisa declarar como a execução será retomada.`,
        { nodeId: node.id },
      );
    }
    if (mode === 'time' && !outgoing.some((connection) => connection.sourcePortId === 'expired')) {
      error(
        collector,
        'wait_missing_expired_route',
        `O bloco "${node.name}" precisa conectar a saída de expiração.`,
        { nodeId: node.id },
      );
    }
    if (mode !== 'time' && !outgoing.some((connection) => connection.sourcePortId === 'resumed')) {
      error(
        collector,
        'wait_missing_resumed_route',
        `O bloco "${node.name}" precisa conectar a saída de retomada.`,
        { nodeId: node.id },
      );
    }
  }

  if (node.type === 'logic.subflow' || node.type === 'tool.subflow') {
    const workflowId = configuredText(node.config.workflowId);
    if (!workflowId) {
      error(collector, 'subflow_missing_workflow', `O bloco "${node.name}" não aponta para um workflow.`, { nodeId: node.id });
    } else if (options.knownWorkflowIds && !new Set(options.knownWorkflowIds).has(workflowId)) {
      error(
        collector,
        'subflow_not_found',
        `O subfluxo "${workflowId}" referenciado por "${node.name}" não existe.`,
        { nodeId: node.id },
      );
    }
  }

  if (
    node.config.customErrorRoute === true
    && node.outputPorts.some((port) => port.connectionType === 'error')
    && !outgoing.some((connection) => connection.connectionType === 'error')
  ) {
    error(
      collector,
      'required_error_route_missing',
      `O bloco "${node.name}" habilitou o caminho de erro personalizado, mas ele não está conectado.`,
      { nodeId: node.id },
    );
  }

  if (manifest?.sensitive && !hasPermissionConfiguration(node)) {
    error(
      collector,
      'sensitive_action_missing_permission',
      `A ação sensível "${node.name}" precisa de permissão ou confirmação explícita.`,
      { nodeId: node.id },
    );
  }

  if (containsInlineSecret(node.config)) {
    error(
      collector,
      'inline_secret',
      `O bloco "${node.name}" contém um segredo direto; use uma referência segura.`,
      { nodeId: node.id },
    );
  }

  for (const [key, value] of Object.entries(node.config)) {
    if (/schema$/i.test(key) && value !== undefined && !isSchemaLike(value)) {
      error(
        collector,
        'invalid_schema',
        `O campo "${key}" de "${node.name}" não contém um schema válido.`,
        { nodeId: node.id },
      );
    }
  }
}

export function validateWorkflowDefinition(
  rawDefinition: unknown,
  options: WorkflowValidatorOptions = {},
): WorkflowValidationResult {
  const collector: ValidationCollector = { errors: [], warnings: [] };
  const parsed = WorkflowDefinitionSchema.safeParse(rawDefinition);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      error(
        collector,
        'invalid_workflow_schema',
        `${issue.path.join('.') || 'workflow'}: ${issue.message}`,
      );
    }
    return { valid: false, ...collector };
  }

  const definition = parsed.data;
  const nodeById = new Map<string, WorkflowNode>();
  const duplicateNodeIds = new Set<string>();
  for (const node of definition.nodes) {
    if (nodeById.has(node.id)) duplicateNodeIds.add(node.id);
    nodeById.set(node.id, node);
  }
  for (const nodeId of duplicateNodeIds) {
    error(collector, 'duplicate_node_id', `O id de bloco "${nodeId}" está duplicado.`, { nodeId });
  }

  const connectionIds = new Set<string>();
  const connectionSignatures = new Set<string>();
  const validConnections: WorkflowConnection[] = [];
  for (const connection of definition.connections) {
    if (connectionIds.has(connection.id)) {
      error(
        collector,
        'duplicate_connection_id',
        `O id de conexão "${connection.id}" está duplicado.`,
        { connectionId: connection.id },
      );
    }
    connectionIds.add(connection.id);
    const signature = connectionKey(connection);
    if (connectionSignatures.has(signature)) {
      warning(
        collector,
        'duplicate_connection',
        `A conexão "${connection.id}" repete um vínculo já existente.`,
        { connectionId: connection.id },
      );
    }
    connectionSignatures.add(signature);

    const source = nodeById.get(connection.sourceNodeId);
    const target = nodeById.get(connection.targetNodeId);
    if (!source || !target) {
      error(
        collector,
        'connection_node_missing',
        `A conexão "${connection.id}" aponta para um bloco inexistente.`,
        { connectionId: connection.id },
      );
      continue;
    }
    const sourcePort = source.outputPorts.find((port) => port.id === connection.sourcePortId);
    const targetPort = target.inputPorts.find((port) => port.id === connection.targetPortId);
    if (!sourcePort || !targetPort) {
      error(
        collector,
        'connection_port_missing',
        `A conexão "${connection.id}" aponta para uma porta inexistente.`,
        { connectionId: connection.id },
      );
      continue;
    }
    if (
      sourcePort.direction !== 'output'
      || targetPort.direction !== 'input'
      || sourcePort.connectionType !== connection.connectionType
      || targetPort.connectionType !== connection.connectionType
    ) {
      error(
        collector,
        'incompatible_connection',
        `A conexão "${connection.id}" é incompatível com as portas selecionadas.`,
        { connectionId: connection.id },
      );
      continue;
    }
    validConnections.push(connection);
  }

  const triggers = definition.nodes.filter((node) => node.type.startsWith('trigger.'));
  if (triggers.length === 0) {
    error(collector, 'missing_trigger', 'O workflow precisa de um gatilho.');
  }
  if (triggers.length > 1 && !options.allowMultipleTriggers && definition.metadata?.allowMultipleTriggers !== true) {
    error(collector, 'incompatible_triggers', 'O workflow possui mais de um gatilho sem declarar compatibilidade.');
  }

  const incomingByNode = new Map<string, WorkflowConnection[]>();
  const outgoingByNode = new Map<string, WorkflowConnection[]>();
  const availableModelIds = options.availableModelIds ? new Set(options.availableModelIds) : null;
  for (const node of definition.nodes) {
    incomingByNode.set(node.id, []);
    outgoingByNode.set(node.id, []);
  }
  for (const connection of validConnections) {
    incomingByNode.get(connection.targetNodeId)?.push(connection);
    outgoingByNode.get(connection.sourceNodeId)?.push(connection);
  }

  for (const node of definition.nodes) {
    const incoming = incomingByNode.get(node.id) || [];
    const outgoing = outgoingByNode.get(node.id) || [];
    const manifest = getWorkflowNodeManifest(node.type);
    if (availableModelIds && node.type === 'ai.model') {
      const modelId = configuredText(node.config.model);
      if (!modelId || !availableModelIds.has(modelId)) {
        error(
          collector,
          'model_not_configured',
          `O modelo do bloco "${node.name}" não possui uma credencial ativa neste workspace.`,
          { nodeId: node.id },
        );
      }
    }
    if (incoming.length === 0 && outgoing.length === 0 && !manifest?.terminal) {
      error(collector, 'disconnected_node', `O bloco "${node.name}" está desconectado.`, { nodeId: node.id });
    }
    for (const port of node.inputPorts.filter((candidate) => candidate.required)) {
      if (!incoming.some((connection) => connection.targetPortId === port.id)) {
        error(
          collector,
          'required_input_unconnected',
          `A entrada obrigatória "${port.label}" de "${node.name}" não está conectada.`,
          { nodeId: node.id },
        );
      }
    }
    for (const port of node.outputPorts.filter((candidate) => candidate.required)) {
      if (!outgoing.some((connection) => connection.sourcePortId === port.id)) {
        error(
          collector,
          'required_output_unconnected',
          `A saída obrigatória "${port.label}" de "${node.name}" não está conectada.`,
          { nodeId: node.id },
        );
      }
    }
    for (const port of node.inputPorts.filter((candidate) => !candidate.multiple)) {
      const count = incoming.filter((connection) => connection.targetPortId === port.id).length;
      if (count > 1) {
        error(
          collector,
          'input_cardinality_exceeded',
          `A entrada "${port.label}" de "${node.name}" aceita somente uma conexão.`,
          { nodeId: node.id },
        );
      }
    }
    for (const port of node.outputPorts.filter((candidate) => !candidate.multiple)) {
      const count = outgoing.filter((connection) => connection.sourcePortId === port.id).length;
      if (count > 1) {
        error(
          collector,
          'output_cardinality_exceeded',
          `A saída "${port.label}" de "${node.name}" aceita somente uma conexão.`,
          { nodeId: node.id },
        );
      }
    }
    validateNodeConfig(definition, node, incoming, outgoing, collector, options);
  }

  const knownVariables = collectKnownVariables(definition, options);
  for (const node of definition.nodes) {
    const references = new Set<string>();
    collectVariableReferences(node.config, references);
    for (const reference of references) {
      const known = knownVariables.has(reference)
        || [...knownVariables].some((name) => reference.startsWith(`${name}.`));
      if (!known) {
        error(
          collector,
          'unknown_variable',
          `O bloco "${node.name}" referencia a variável inexistente "{{${reference}}}".`,
          { nodeId: node.id },
        );
      }
    }
  }

  const executionEdges = executableConnections(definition);
  const adjacency = new Map<string, string[]>();
  for (const node of definition.nodes) adjacency.set(node.id, []);
  for (const connection of executionEdges) {
    adjacency.get(connection.sourceNodeId)?.push(connection.targetNodeId);
  }
  for (const node of definition.nodes.filter((candidate) => candidate.type === 'logic.goto')) {
    const targetNodeId = configuredText(node.config.targetNodeId);
    if (targetNodeId && adjacency.has(targetNodeId)) adjacency.get(node.id)?.push(targetNodeId);
  }

  const triggerIds = triggers.map((node) => node.id);
  const reachable = new Set<string>();
  for (const triggerId of triggerIds) {
    for (const nodeId of findReachable(triggerId, adjacency)) reachable.add(nodeId);
  }
  for (const node of definition.nodes) {
    const manifest = getWorkflowNodeManifest(node.type);
    if (manifest?.attachment) continue;
    if (triggerIds.length > 0 && !reachable.has(node.id)) {
      error(
        collector,
        'unreachable_node',
        `O bloco "${node.name}" nunca é alcançado por um gatilho.`,
        { nodeId: node.id },
      );
    }
  }

  const terminalIds = new Set(
    definition.nodes
      .filter((node) => getWorkflowNodeManifest(node.type)?.terminal)
      .map((node) => node.id),
  );
  if (terminalIds.size === 0) {
    error(collector, 'missing_terminal', 'O workflow precisa de um bloco de finalização.');
  } else {
    const terminalMemo = new Map<string, boolean>();
    for (const nodeId of reachable) {
      const node = nodeById.get(nodeId);
      if (!node || getWorkflowNodeManifest(node.type)?.attachment || terminalIds.has(nodeId)) continue;
      if (!canReachTerminal(nodeId, terminalIds, adjacency, terminalMemo)) {
        error(
          collector,
          'path_without_terminal',
          `O caminho iniciado em "${node.name}" não alcança uma finalização.`,
          { nodeId },
        );
      }
    }
  }

  for (const cycle of detectCycles(definition.nodes.map((node) => node.id), adjacency)) {
    const declared = cycle.some((nodeId) => {
      const type = nodeById.get(nodeId)?.type;
      return type === 'logic.loop' || type === 'logic.for_each';
    });
    if (!declared) {
      error(
        collector,
        'undeclared_cycle',
        `O ciclo ${cycle.join(' → ')} não passa por um bloco de loop controlado.`,
        { nodeId: cycle[0] },
      );
    }
  }

  return {
    valid: collector.errors.length === 0,
    errors: collector.errors,
    warnings: collector.warnings,
  };
}
