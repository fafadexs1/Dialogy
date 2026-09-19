import { createWorkflowNode, getWorkflowNodeManifest } from './catalog';
import type { WorkflowHandlerDependencies } from './node-handlers';
import { ToolRegistry } from './tools';
import type {
  WorkflowConnection,
  WorkflowDefinition,
  WorkflowStartInput,
} from './types';
import { isRecord, mergeStatePatch } from './utils';

const EXECUTION_CONNECTIONS = new Set(['main', 'error', 'event']);
const ATTACHMENT_CONNECTIONS = new Set(['model', 'tool', 'agent_tool', 'memory', 'knowledge', 'guardrail']);

export type WorkflowBlockTestFixture = {
  output: Record<string, unknown>;
  statePatch?: Record<string, unknown>;
};

export type WorkflowBlockTestFixtures = Record<string, WorkflowBlockTestFixture>;

export type WorkflowTestChatMessage = {
  id: string;
  nodeId?: string;
  nodeType?: string;
  role: 'bot' | 'user' | 'system';
  text: string;
  type?: 'text' | 'options' | 'input' | 'media' | 'handoff' | 'error';
  options?: Array<{ id: string; label: string; value: string }>;
  timestamp: string;
};

export type WorkflowTestExecutionResult = {
  success: boolean;
  executionId?: string;
  status?: string;
  resumeToken?: string;
  waitingNodeId?: string;
  messages?: WorkflowTestChatMessage[];
  variables?: Record<string, unknown>;
  nodeResults?: Record<string, unknown>;
  error?: string;
};

export type WorkflowBlockTestBlocker = {
  code:
    | 'node_not_found'
    | 'attachment_not_executable'
    | 'missing_main_input'
    | 'missing_upstream_fixture'
    | 'invalid_upstream_fixture';
  message: string;
  nodeId?: string;
};

export type WorkflowBlockTestAnalysis = {
  nodeId: string;
  canRun: boolean;
  upstreamNodeIds: string[];
  boundaryNodeIds: string[];
  requiredFixtureNodeIds: string[];
  retainedNodeIds: string[];
  blockers: WorkflowBlockTestBlocker[];
  sandbox: {
    toolCalls: 'deny';
    messageDelivery: 'simulate';
    handoff: 'simulate';
    externalEvents: 'simulate';
  };
};

export type PreparedWorkflowBlockTest = {
  analysis: WorkflowBlockTestAnalysis;
  workflow: WorkflowDefinition;
  startInput: WorkflowStartInput;
};

export type WorkflowBlockTestSideEffectRecord = {
  kind: 'message_delivery' | 'media_delivery' | 'handoff';
  nodeId: string;
  simulated: true;
  characterCount?: number;
};

/**
 * Runtime adapters for a block test. They never call an external tool, sender or
 * handoff implementation. The returned records contain metadata only, so a test
 * timeline does not need to persist the full message payload.
 */
export function createWorkflowBlockTestSideEffectAdapters(): {
  dependencies: {
    resolveToolRegistry: NonNullable<WorkflowHandlerDependencies['resolveToolRegistry']>;
    sendResponse: NonNullable<WorkflowHandlerDependencies['sendResponse']>;
    sendMedia: NonNullable<WorkflowHandlerDependencies['sendMedia']>;
    executeHttp: NonNullable<WorkflowHandlerDependencies['executeHttp']>;
    executeIntegration: NonNullable<WorkflowHandlerDependencies['executeIntegration']>;
    executePlatformAction: NonNullable<WorkflowHandlerDependencies['executePlatformAction']>;
    handoff: NonNullable<WorkflowHandlerDependencies['handoff']>;
  };
  records: WorkflowBlockTestSideEffectRecord[];
} {
  const records: WorkflowBlockTestSideEffectRecord[] = [];
  return {
    records,
    dependencies: {
      resolveToolRegistry: async () => new ToolRegistry(async () => false),
      sendResponse: async (message, runtimeInput) => {
        records.push({
          kind: 'message_delivery',
          nodeId: runtimeInput.node.id,
          simulated: true,
          characterCount: message.length,
        });
        return { sandbox: true, delivered: false, characterCount: message.length };
      },
      sendMedia: async (media, runtimeInput) => {
        records.push({
          kind: 'media_delivery',
          nodeId: runtimeInput.node.id,
          simulated: true,
          characterCount: media.caption?.length || 0,
        });
        return { sandbox: true, delivered: false, mediaType: media.type };
      },
      executeHttp: async (runtimeInput) => {
        const outputKey = String(runtimeInput.node.config.outputKey || 'response');
        const simulated = { sandbox: true, status: 200, data: { simulated: true } };
        return { ...simulated, statePatch: { [outputKey]: simulated.data } };
      },
      executeIntegration: async (runtimeInput) => ({
        simulated: true,
        nodeType: runtimeInput.node.type,
        statePatch: { [String(runtimeInput.node.config.outputKey || 'result')]: { simulated: true } },
      }),
      executePlatformAction: async (runtimeInput) => {
        const selectedOutput = runtimeInput.node.type === 'dialogy.team_availability'
          ? 'open'
          : runtimeInput.node.type === 'dialogy.sgp_identify_customer'
          ? 'selected'
          : runtimeInput.node.type === 'dialogy.sgp_contract_status'
          ? 'active'
          : runtimeInput.node.type === 'dialogy.sgp_payment_promise'
            ? 'status-1'
            : 'success';
        const value = { simulated: true, nodeType: runtimeInput.node.type };
        return {
          status: 'route',
          selectedOutput,
          output: value,
          statePatch: { [String(runtimeInput.node.config.outputKey || 'result')]: value },
        };
      },
      handoff: async (runtimeInput) => {
        records.push({ kind: 'handoff', nodeId: runtimeInput.node.id, simulated: true });
        return { sandbox: true, transferred: false };
      },
    },
  };
}

function executionConnections(definition: WorkflowDefinition) {
  return definition.connections.filter((connection) => EXECUTION_CONNECTIONS.has(connection.connectionType));
}

function collectTransitive(
  startNodeId: string,
  connections: WorkflowConnection[],
  direction: 'upstream' | 'downstream',
) {
  const visited = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const connection of connections) {
      const matches = direction === 'upstream'
        ? connection.targetNodeId === current
        : connection.sourceNodeId === current;
      if (!matches) continue;
      const next = direction === 'upstream' ? connection.sourceNodeId : connection.targetNodeId;
      if (next === startNodeId || visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function jsonRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function fixtureIsValid(value: unknown): value is WorkflowBlockTestFixture {
  if (!isRecord(value) || !jsonRecord(value.output)) return false;
  return value.statePatch === undefined || jsonRecord(value.statePatch);
}

function sorted(values: Iterable<string>) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function analyzeWorkflowBlockTest(
  definition: WorkflowDefinition,
  nodeId: string,
  fixtures: WorkflowBlockTestFixtures = {},
): WorkflowBlockTestAnalysis {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  const blockers: WorkflowBlockTestBlocker[] = [];
  const sandbox = {
    toolCalls: 'deny' as const,
    messageDelivery: 'simulate' as const,
    handoff: 'simulate' as const,
    externalEvents: 'simulate' as const,
  };
  if (!node) {
    blockers.push({ code: 'node_not_found', message: `O bloco "${nodeId}" não existe.`, nodeId });
    return {
      nodeId,
      canRun: false,
      upstreamNodeIds: [],
      boundaryNodeIds: [],
      requiredFixtureNodeIds: [],
      retainedNodeIds: [],
      blockers,
      sandbox,
    };
  }

  const manifest = getWorkflowNodeManifest(node.type);
  if (manifest?.attachment) {
    blockers.push({
      code: 'attachment_not_executable',
      message: `"${node.name}" é uma capacidade anexada e não inicia uma rota de execução.`,
      nodeId,
    });
  }

  const connections = executionConnections(definition);
  const upstream = collectTransitive(nodeId, connections, 'upstream');
  const downstream = collectTransitive(nodeId, connections, 'downstream');
  const incoming = connections.filter((connection) => connection.targetNodeId === nodeId);
  const boundary = new Set(incoming.map((connection) => connection.sourceNodeId));
  const isTrigger = node.type.startsWith('trigger.');

  if (!isTrigger && !node.inputPorts.some((port) => port.connectionType === 'main')) {
    blockers.push({
      code: 'missing_main_input',
      message: `"${node.name}" não possui uma entrada principal simulável.`,
      nodeId,
    });
  }

  for (const dependencyId of boundary) {
    const fixture = fixtures[dependencyId];
    if (fixture === undefined) {
      blockers.push({
        code: 'missing_upstream_fixture',
        message: `Simule a saída anterior de "${definition.nodes.find((candidate) => candidate.id === dependencyId)?.name || dependencyId}".`,
        nodeId: dependencyId,
      });
    } else if (!fixtureIsValid(fixture)) {
      blockers.push({
        code: 'invalid_upstream_fixture',
        message: `A simulação de "${definition.nodes.find((candidate) => candidate.id === dependencyId)?.name || dependencyId}" deve conter output JSON e statePatch JSON opcional.`,
        nodeId: dependencyId,
      });
    }
  }

  const retained = new Set([nodeId, ...downstream]);
  for (const connection of definition.connections) {
    if (!retained.has(connection.targetNodeId) || !ATTACHMENT_CONNECTIONS.has(connection.connectionType)) continue;
    retained.add(connection.sourceNodeId);
  }

  return {
    nodeId,
    canRun: blockers.length === 0,
    upstreamNodeIds: sorted(upstream),
    boundaryNodeIds: sorted(boundary),
    requiredFixtureNodeIds: sorted(boundary),
    retainedNodeIds: sorted(retained),
    blockers,
    sandbox,
  };
}

function simulatedInput(boundaryNodeIds: string[], fixtures: WorkflowBlockTestFixtures) {
  if (boundaryNodeIds.length === 0) return {};
  if (boundaryNodeIds.length === 1) return structuredClone(fixtures[boundaryNodeIds[0]]!.output);
  return {
    branches: Object.fromEntries(boundaryNodeIds.map((nodeId) => [nodeId, structuredClone(fixtures[nodeId]!.output)])),
  };
}

export function prepareWorkflowBlockTest(input: {
  definition: WorkflowDefinition;
  nodeId: string;
  fixtures?: WorkflowBlockTestFixtures;
  input?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  context?: Record<string, unknown>;
  executionId?: string;
}): PreparedWorkflowBlockTest {
  const fixtures = input.fixtures || {};
  const analysis = analyzeWorkflowBlockTest(input.definition, input.nodeId, fixtures);
  if (!analysis.canRun) {
    throw new Error(analysis.blockers.map((blocker) => blocker.message).join(' '));
  }

  const selected = input.definition.nodes.find((node) => node.id === input.nodeId)!;
  const retained = new Set(analysis.retainedNodeIds);
  let nodes = input.definition.nodes.filter((node) => retained.has(node.id)).map((node) => structuredClone(node));
  let connections = input.definition.connections.filter((connection) => (
    retained.has(connection.sourceNodeId)
    && retained.has(connection.targetNodeId)
  )).map((connection) => structuredClone(connection));

  const startInput = selected.type.startsWith('trigger.')
    ? structuredClone(input.input || {})
    : simulatedInput(analysis.boundaryNodeIds, fixtures);

  if (!selected.type.startsWith('trigger.')) {
    const trigger = createWorkflowNode('trigger.manual', {
      id: `__block_test_trigger_${selected.id}`,
      name: 'Início do teste isolado',
      position: { x: selected.position.x - 320, y: selected.position.y },
    });
    const mainInput = selected.inputPorts.find((port) => port.connectionType === 'main')!;
    nodes = [trigger, ...nodes];
    connections = [{
      id: `__block_test_connection_${selected.id}`,
      sourceNodeId: trigger.id,
      sourcePortId: 'started',
      targetNodeId: selected.id,
      targetPortId: mainInput.id,
      connectionType: 'main',
    }, ...connections];
  }

  // Handoffs are metadata-only in the sandbox. Supplying a local destination
  // keeps the isolated graph statically valid without depending on a real team
  // or on a confirmation value that the sandbox intentionally never consumes.
  nodes = nodes.map((node) => node.type === 'output.handoff'
    ? {
      ...node,
      config: {
        ...node.config,
        destinationType: 'human',
        teamId: String(node.config.teamId || '__block_test_team__'),
        requireConfirmation: false,
        confirmationPath: '',
      },
    }
    : node);

  const danglingErrorOutputs = nodes.flatMap((node) => node.type === 'error.handler'
    ? node.outputPorts
      .filter((port) => port.connectionType === 'main')
      .filter((port) => !connections.some((connection) => (
        connection.sourceNodeId === node.id && connection.sourcePortId === port.id
      )))
      .map((port) => ({ node, port }))
    : []);
  if (danglingErrorOutputs.length > 0) {
    const errorEnd = createWorkflowNode('output.end', {
      id: `__block_test_error_end_${selected.id}`,
      name: 'Fim seguro do teste isolado',
      position: { x: selected.position.x + 900, y: selected.position.y + 620 },
      config: { output: { sandbox: true, outcome: 'simulated_error' } },
    });
    nodes.push(errorEnd);
    connections.push(...danglingErrorOutputs.map(({ node, port }, index) => ({
      id: `__block_test_error_connection_${selected.id}_${index + 1}`,
      sourceNodeId: node.id,
      sourcePortId: port.id,
      targetNodeId: errorEnd.id,
      targetPortId: 'main',
      connectionType: 'main' as const,
    })));
  }

  let variables = structuredClone(input.variables || {});
  for (const dependencyId of analysis.boundaryNodeIds) {
    variables = mergeStatePatch(variables, fixtures[dependencyId]?.statePatch || {});
  }

  const timestamp = new Date().toISOString();
  const workflow: WorkflowDefinition = {
    ...structuredClone(input.definition),
    id: `${input.definition.id}:block-test:${selected.id}`,
    name: `${input.definition.name} · teste de ${selected.name}`,
    version: 'sandbox',
    status: 'draft',
    nodes,
    connections,
    metadata: {
      ...(input.definition.metadata || {}),
      sandbox: true,
      blockTest: {
        sourceWorkflowId: input.definition.id,
        sourceNodeId: selected.id,
        skippedUpstreamNodeIds: analysis.upstreamNodeIds,
        toolCalls: 'deny',
        messageDelivery: 'simulate',
        handoff: 'simulate',
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    analysis,
    workflow,
    startInput: {
      workflow,
      input: startInput,
      variables,
      context: {
        ...(input.context || {}),
        sandbox: true,
        blockTestSourceNodeId: selected.id,
      },
      executionId: input.executionId,
    },
  };
}
