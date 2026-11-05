import type { Pool, PoolClient } from 'pg';
import { getAgentToolDefinition } from '@/services/agent-tools/catalog';
import type { AgentToolName } from '@/services/agent-tools/types';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import type { AutopilotFlowGraph } from '@/lib/types';
import { previewAutopilotNativeMigration } from './autopilot-migration';
import { createWorkflowNode } from './catalog';
import { createNativeWorkflowTemplate } from './native-templates';
import { WorkflowDefinitionSchema } from './schemas';
import type { ModelConfiguration, WorkflowDefinition } from './types';
import { hashValue } from './utils';
import { validateWorkflowDefinition } from './validator';

type JsonRecord = Record<string, unknown>;

export type AutopilotCutoverConfig = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  ai_model?: string | null;
  knowledge_base?: string | null;
  knowledge_base_documents?: unknown;
  knowledge_collections?: unknown;
  enabled_tool_names?: unknown;
  flow_graph?: unknown;
  workflow_builder_mode?: string | null;
  workflow_runtime_v2_mode?: string | null;
  active_workflow_id?: string | null;
  active_workflow_version?: string | null;
  [key: string]: unknown;
};

export type AutopilotCutoverPreview = {
  configId: string;
  workspaceId: string;
  name: string;
  strategy: 'legacy_graph' | 'single_agent_template' | 'single_agent_fallback';
  sourceHash: string;
  workflow: WorkflowDefinition;
  valid: boolean;
  errors: string[];
  warnings: string[];
  diff: {
    nodes: number;
    connections: number;
    agents: number;
    tools: string[];
    collectionIds: string[];
    documentIds: string[];
    personaPreserved: boolean;
    modelPreserved: boolean;
  };
};

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function objectId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return null;
  const item = value as JsonRecord;
  for (const key of ['id', 'collection_id', 'document_id']) {
    if (typeof item[key] === 'string' && String(item[key]).trim()) return String(item[key]).trim();
  }
  return null;
}

function stringList(value: unknown): string[] {
  return [...new Set(jsonArray(value).map(objectId).filter((item): item is string => Boolean(item)))];
}

function modelConfiguration(value: unknown): ModelConfiguration {
  const model = typeof value === 'string' && value.trim()
    ? value.trim()
    : process.env.DEFAULT_AUTOPILOT_MODEL || 'gemini-2.0-flash';
  return {
    provider: getAiModelRuntimeProvider(model),
    model,
    temperature: 0.2,
    maxOutputTokens: 2_048,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    timeoutMs: 60_000,
    maxRetries: 2,
  };
}

function safeId(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function attachPreservedCapabilities(workflow: WorkflowDefinition, config: AutopilotCutoverConfig) {
  const agents = workflow.nodes.filter((node) => node.type === 'ai.agent');
  const tools = stringList(config.enabled_tool_names);
  const collectionIds = stringList(config.knowledge_collections);
  const documentIds = stringList(config.knowledge_base_documents);

  const retrievers = workflow.nodes.filter((node) => node.type === 'knowledge.rag_retriever');
  for (const retriever of retrievers) {
    const filters = retriever.config.filters && typeof retriever.config.filters === 'object'
      ? retriever.config.filters as JsonRecord
      : {};
    retriever.config.filters = {
      ...filters,
      collectionIds: [...new Set([...stringList(filters.collectionIds), ...collectionIds])],
      documentIds: [...new Set([...stringList(filters.documentIds), ...documentIds])],
    };
  }

  if ((collectionIds.length > 0 || documentIds.length > 0) && retrievers.length === 0 && agents.length > 0) {
    const rag = createWorkflowNode('knowledge.rag_retriever', {
      id: 'cutover_preserved_knowledge',
      name: 'Conhecimento preservado',
      position: { x: agents[0].position.x - 260, y: agents[0].position.y + 220 },
      config: { filters: { collectionIds, documentIds } },
    });
    workflow.nodes.push(rag);
    for (const agent of agents) {
      workflow.connections.push({
        id: `cutover_knowledge_${safeId(agent.id)}`,
        sourceNodeId: rag.id,
        sourcePortId: 'knowledge',
        targetNodeId: agent.id,
        targetPortId: 'knowledge',
        connectionType: 'knowledge',
      });
    }
  }

  for (const [index, toolName] of tools.entries()) {
    const nativeDefinition = toolName.startsWith('mcp:') ? null : getAgentToolDefinition(toolName as AgentToolName);
    const existing = workflow.nodes.find((node) => node.type.startsWith('tool.') && node.config.name === toolName);
    const tool = existing || createWorkflowNode(toolName.startsWith('mcp:') ? 'tool.mcp' : 'tool.internal', {
      id: `cutover_tool_${safeId(toolName) || 'tool'}_${index}`,
      name: toolName,
      position: { x: agents[0]?.position.x - 260 || 80, y: (agents[0]?.position.y || 0) + 400 + index * 120 },
      config: toolName.startsWith('mcp:')
        ? (() => {
          const [, serverId = '', mcpTool = ''] = toolName.split(':');
          return { name: toolName, serverId, allowedTools: mcpTool ? [mcpTool] : [], description: toolName, audit: true };
        })()
        : {
          name: toolName, action: toolName,
          description: nativeDefinition?.description || toolName,
          inputSchema: nativeDefinition?.inputSchema || {},
          outputSchema: nativeDefinition?.outputSchema || {},
          class: nativeDefinition?.class,
          riskLevel: nativeDefinition?.riskLevel || 'low',
          idempotent: nativeDefinition?.idempotent ?? true,
          timeoutMs: nativeDefinition?.timeoutMs || 20_000,
        },
    });
    if (!existing) workflow.nodes.push(tool);
    for (const agent of agents) {
      const alreadyAttached = workflow.connections.some((connection) =>
        connection.sourceNodeId === tool.id && connection.targetNodeId === agent.id && connection.connectionType === 'tool');
      if (!alreadyAttached) {
        workflow.connections.push({
          id: `cutover_tool_${safeId(tool.id)}_${safeId(agent.id)}`,
          sourceNodeId: tool.id,
          sourcePortId: 'tool',
          targetNodeId: agent.id,
          targetPortId: 'tools',
          connectionType: 'tool',
        });
      }
    }
  }

  workflow.metadata = {
    ...(workflow.metadata || {}),
    preservedToolNames: tools,
    preservedKnowledgeCollectionIds: collectionIds,
    preservedKnowledgeDocumentIds: documentIds,
  };
  return { tools, collectionIds, documentIds };
}

function usableGraph(value: unknown): AutopilotFlowGraph | null {
  if (!value || typeof value !== 'object') return null;
  const graph = value as Partial<AutopilotFlowGraph>;
  return graph.version === 1 && Array.isArray(graph.nodes) && graph.nodes.length > 0 && Array.isArray(graph.edges)
    ? graph as AutopilotFlowGraph
    : null;
}

export function buildAutopilotCutoverPreview(config: AutopilotCutoverConfig): AutopilotCutoverPreview {
  const graph = usableGraph(config.flow_graph);
  const model = modelConfiguration(config.ai_model);
  const persona = typeof config.knowledge_base === 'string' ? config.knowledge_base : '';
  let strategy: AutopilotCutoverPreview['strategy'] = graph ? 'legacy_graph' : 'single_agent_template';
  const fallbackWarnings: string[] = [];
  const template = () => createNativeWorkflowTemplate({
      configId: config.id,
      workspaceId: config.workspace_id,
      name: config.name,
      model,
      persona,
      template: 'single_agent',
    });
  let workflow: WorkflowDefinition;
  if (graph) {
    try {
      const migrated = previewAutopilotNativeMigration({
        configId: config.id,
        workspaceId: config.workspace_id,
        name: config.name,
        graph,
        model,
        persona,
      });
      workflow = migrated.workflow;
      attachPreservedCapabilities(workflow, config);
      const migratedValidation = validateWorkflowDefinition(WorkflowDefinitionSchema.parse(workflow));
      if (!migratedValidation.valid) {
        fallbackWarnings.push(...migratedValidation.errors.map((issue) => `${issue.code}: ${issue.message}`));
        strategy = 'single_agent_fallback';
        workflow = template();
      }
    } catch (error) {
      fallbackWarnings.push(error instanceof Error ? error.message : 'Falha desconhecida ao converter o grafo legado.');
      strategy = 'single_agent_fallback';
      workflow = template();
    }
  } else {
    workflow = template();
  }
  const preserved = attachPreservedCapabilities(workflow, config);
  const sourceHash = hashValue({
    graph: graph || null,
    persona,
    model,
    tools: preserved.tools,
    collectionIds: preserved.collectionIds,
    documentIds: preserved.documentIds,
  });
  workflow.metadata = {
    ...(workflow.metadata || {}),
    cutoverSourceHash: sourceHash,
    cutoverStrategy: strategy,
    ...(fallbackWarnings.length > 0 ? {
      legacyMigrationFallback: true,
      legacyMigrationWarnings: fallbackWarnings,
    } : {}),
  };
  workflow.updatedAt = new Date().toISOString();
  const parsed = WorkflowDefinitionSchema.parse(workflow);
  const validation = validateWorkflowDefinition(parsed);
  const agents = parsed.nodes.filter((node) => node.type === 'ai.agent');
  return {
    configId: config.id,
    workspaceId: config.workspace_id,
    name: config.name,
    strategy,
    sourceHash,
    workflow: parsed,
    valid: validation.valid,
    errors: validation.errors.map((issue) => `${issue.code}: ${issue.message}`),
    warnings: [
      ...fallbackWarnings.map((message) => `legacy_graph_fallback: ${message}`),
      ...validation.warnings.map((issue) => `${issue.code}: ${issue.message}`),
    ],
    diff: {
      nodes: parsed.nodes.length,
      connections: parsed.connections.length,
      agents: agents.length,
      tools: preserved.tools,
      collectionIds: preserved.collectionIds,
      documentIds: preserved.documentIds,
      personaPreserved: agents.every((node) => node.config.persona === persona),
      modelPreserved: parsed.nodes.some((node) => node.type === 'ai.model' && node.config.model === model.model),
    },
  };
}

async function activeSourceHash(client: PoolClient, config: AutopilotCutoverConfig) {
  if (!config.active_workflow_id || !config.active_workflow_version) return null;
  const result = await client.query(
    `SELECT definition FROM public.workflow_definitions
     WHERE workflow_id = $1 AND workflow_version = $2 LIMIT 1`,
    [config.active_workflow_id, config.active_workflow_version],
  );
  const definition = result.rows[0]?.definition as WorkflowDefinition | undefined;
  return typeof definition?.metadata?.cutoverSourceHash === 'string' ? definition.metadata.cutoverSourceHash : null;
}

export async function cutoverAutopilotConfig(client: PoolClient, configId: string) {
  const selected = await client.query('SELECT * FROM public.autopilot_configs WHERE id = $1 FOR UPDATE', [configId]);
  if (!selected.rows[0]) throw new Error(`Automation ${configId} not found.`);
  const config = selected.rows[0] as AutopilotCutoverConfig;
  const preview = buildAutopilotCutoverPreview(config);
  if (!preview.valid) throw new Error(`Automation ${configId} is invalid: ${preview.errors.join(' ')}`);
  if (await activeSourceHash(client, config) === preview.sourceHash) {
    await client.query(
      `UPDATE public.autopilot_configs
       SET workflow_builder_mode = 'native_v2', workflow_runtime_v2_mode = 'shadow', updated_at = NOW()
       WHERE id = $1`,
      [configId],
    );
    return { ...preview, applied: false, reused: true, version: config.active_workflow_version };
  }
  const next = await client.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(workflow_version, '[^0-9]', '', 'g'), '')::int), 0) + 1 AS version
     FROM public.workflow_definitions WHERE workflow_id = $1`,
    [`autopilot:${configId}`],
  );
  const version = `v${Number(next.rows[0]?.version || 1)}`;
  const timestamp = new Date().toISOString();
  const published = WorkflowDefinitionSchema.parse({
    ...preview.workflow,
    id: `autopilot:${configId}`,
    version,
    status: 'published',
    updatedAt: timestamp,
  });
  await client.query(
    `INSERT INTO public.workflow_definitions
       (workflow_id, workflow_version, workspace_id, name, status, definition, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'published', $5::jsonb, $6, $6)
     ON CONFLICT (workflow_id, workflow_version) DO NOTHING`,
    [published.id, published.version, config.workspace_id, config.name, JSON.stringify(published), timestamp],
  );
  await client.query(
    `UPDATE public.autopilot_configs SET
       workflow_builder_mode = 'native_v2', workflow_runtime_v2_mode = 'shadow',
       active_workflow_id = $2, active_workflow_version = $3, updated_at = NOW()
     WHERE id = $1`,
    [configId, published.id, published.version],
  );
  return { ...preview, workflow: published, applied: true, reused: false, version };
}

export async function cutoverAllAutopilotConfigs(input: {
  database: Pool;
  workspaceId?: string;
  configId?: string;
  apply?: boolean;
}) {
  const conditions: string[] = [];
  const values: string[] = [];
  if (input.workspaceId) { values.push(input.workspaceId); conditions.push(`workspace_id = $${values.length}`); }
  if (input.configId) { values.push(input.configId); conditions.push(`id = $${values.length}`); }
  const selected = await input.database.query(
    `SELECT * FROM public.autopilot_configs ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at, id`,
    values,
  );
  const previews = selected.rows.map((row) => buildAutopilotCutoverPreview(row as AutopilotCutoverConfig));
  if (!input.apply) return { dryRun: true, total: previews.length, valid: previews.filter((item) => item.valid).length, invalid: previews.filter((item) => !item.valid).length, results: previews };
  if (previews.some((item) => !item.valid)) throw new Error('Cutover aborted: at least one automation is invalid. Run dry-run and fix all validation errors first.');
  const results = [];
  for (const preview of previews) {
    const client = await input.database.connect();
    try {
      await client.query('BEGIN');
      results.push(await cutoverAutopilotConfig(client, preview.configId));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return { dryRun: false, total: results.length, results };
}
