import { getWorkflowNodeManifest } from './catalog';
import { WorkflowDefinitionSchema } from './schemas';
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
    'context',
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

  if (manifest?.requiresErrorRoute && !outgoing.some((connection) => connection.connectionType === 'error')) {
    error(
      collector,
      'required_error_route_missing',
      `O bloco "${node.name}" precisa de um caminho explícito de erro.`,
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
    for (const triggerId of triggerIds) {
      if (!canReachTerminal(triggerId, terminalIds, adjacency, terminalMemo)) {
        error(
          collector,
          'path_without_terminal',
          `O caminho iniciado em "${nodeById.get(triggerId)?.name || triggerId}" não alcança uma finalização.`,
          { nodeId: triggerId },
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

