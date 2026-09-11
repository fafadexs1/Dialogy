'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/lib/db';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import { loadStudioRelease } from '@/services/agent-studio/repository';
import { validateStudioFlowBindings } from '@/services/agent-studio/flow-inputs';
import type { PoolClient } from 'pg';
import { assertNexusGoogleAdsBinding, loadNexusGoogleAdsOptions } from '../services/google-ads-lead';
import { createClient } from '@/lib/supabase/server';
import type { AutopilotConfig } from '@/lib/types';
import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { resolveWorkspaceAiExecutionContext } from '@/services/ai/runtime';
import { listWorkspaceConfiguredAiModels } from '@/services/ai/workspace-ai-credentials';
import {
  WorkflowDefinitionSchema,
  WorkflowExecutor,
  createWorkflowNode,
  createDefaultNodeHandlerRegistry,
  createWorkflowBlockTestSideEffectAdapters,
  hashValue,
  modelChainForNode,
  prepareWorkflowBlockTest,
  validateWorkflowDefinition,
  workflowFunctionalSignature,
  workflowLayoutSignature,
  type WorkflowBlockTestFixtures,
  type WorkflowDefinition,
  type WorkflowTestChatMessage,
  type WorkflowTestExecutionResult,
} from '@/services/workflow-runtime';
import { listStableWorkflowNodeManifests } from '@/services/workflow-runtime/catalog';
import type { NativeWorkflowAiProposal } from '@/services/workflow-runtime/native-ai-builder';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';

import {
  bindStandaloneNexusWorkflow,
  createStandaloneNexusWorkflow,
  duplicateStandaloneNexusWorkflow,
  normalizeStandaloneStudioAgents,
  type NexusWorkflowExecutionSummary,
  type NexusWorkflowRecord,
  type NexusWorkflowSummary,
  type NexusWorkflowTemplate,
  type NexusWorkflowVersionSource,
  type NexusWorkflowVersionSummary,
} from '../services/standalone-workflows';
import { loadWorkspaceDialogyKnowledge, retrieveNexusDialogyKnowledge } from '../services/dialogy-knowledge';
import {
  loadNexusDialogyResources,
  validateNexusWorkflowDialogyBindings,
  type NexusDialogyResources,
} from '../services/dialogy-resources';
import { listNexusDialogyTools } from '../services/dialogy-tools';
import { validateNexusWorkflowCredentialBindings } from '../services/credentials';
import { cancelPublishedNexusWorkflowExecution } from '../services/runtime';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';

type NexusWorkflowRow = Record<string, unknown>;
type NexusDatabase = Pick<PoolClient, 'query'>;

async function requireWorkspaceManager(workspaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado.');
  if (!await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) {
    throw new Error('Acesso não autorizado.');
  }
  return user;
}

function parseJson(value: unknown) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function iso(value: unknown) {
  return new Date(String(value)).toISOString();
}

const NexusAiEditProposalSchema = z.object({
  summary: z.string().min(1).max(2_000),
  changes: z.array(z.string().min(1).max(500)).min(1).max(30),
  workflow: WorkflowDefinitionSchema,
});

const NexusAiPatchProposalSchema = z.object({
  applicability: z.enum(['patch', 'full_edit_required']),
  summary: z.string().min(1).max(1_000),
  changes: z.array(z.string().min(1).max(300)).max(12),
  operations: z.array(z.object({
    nodeId: z.string().min(1),
    name: z.string().min(1).max(300).optional(),
    configPatch: z.record(z.string(), z.unknown()).optional(),
  })).max(12),
});

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeNexusConfigPatch(current: Record<string, unknown>, patch: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...current };
  Object.entries(patch).forEach(([key, value]) => {
    merged[key] = isRecordValue(value) && isRecordValue(merged[key])
      ? mergeNexusConfigPatch(merged[key], value)
      : value;
  });
  return merged;
}

function requiresStructuralNexusEdit(request: string) {
  return /\b(adicion(?:e|ar)|cri(?:e|ar)|remov(?:a|er)|exclu(?:a|ir)|conect(?:e|ar)|desconect(?:e|ar)|dupli(?:que|car)|nova?\s+(?:etapa|rota|ramifica[cç][aã]o)|novo\s+bloco|reestrutur|reconstru|credencia(?:l|is)|integra[cç][aã]o|\brag\b|agente\s+do\s+studio)\b/i.test(request);
}

function nexusAiChangeComplexity(request: string, workflow: WorkflowDefinition) {
  const normalized = request.trim().toLocaleLowerCase('pt-BR');
  const requestedActions = normalized.match(/\b(altere|ajuste|troque|renomeie|corrija|adicione|crie|remova|exclua|conecte|desconecte|mova|reorganize|configure)\b/g)?.length || 1;
  const clauses = normalized.split(/(?:\n+|;|\b(?:tamb[eé]m|al[eé]m disso|depois|e ent[aã]o)\b)/i).filter((part) => part.trim().length > 3).length;
  const mentionedNodes = workflow.nodes.filter((node) => (
    normalized.includes(node.id.toLocaleLowerCase('pt-BR'))
    || normalized.includes(node.name.toLocaleLowerCase('pt-BR'))
  )).length;
  const broadScope = /\b(todo|todos|todas|inteiro|completo|v[aá]rios|fluxo todo|em massa)\b/i.test(normalized);
  return {
    requestedChanges: Math.max(requestedActions, clauses, mentionedNodes, broadScope ? Math.max(4, Math.ceil(workflow.nodes.length * 0.6)) : 1),
    requestTokens: Math.max(1, Math.ceil(request.length / 3.5)),
  };
}

function calculateNexusAiOutputTokens(input: {
  mode: 'patch' | 'full';
  request: string;
  workflow: WorkflowDefinition;
}) {
  const complexity = nexusAiChangeComplexity(input.request, input.workflow);
  if (input.mode === 'patch') {
    const estimated = 768 + (complexity.requestedChanges * 420) + (complexity.requestTokens * 2);
    return Math.min(12_288, Math.max(1_536, Math.ceil(estimated / 256) * 256));
  }
  const structuralSize = (input.workflow.nodes.length * 420) + (input.workflow.connections.length * 160);
  const requestedGrowth = complexity.requestedChanges * 640;
  const estimated = 4_096 + structuralSize + requestedGrowth + (complexity.requestTokens * 2);
  return Math.min(32_768, Math.max(8_192, Math.ceil(estimated / 512) * 512));
}

function applyNexusAiPatch(input: {
  current: WorkflowDefinition;
  patch: z.infer<typeof NexusAiPatchProposalSchema>;
  workflowId: string;
  workspaceId: string;
  configuredModelIds: string[];
}) {
  const validationOptions = { availableModelIds: input.configuredModelIds };
  const baselineValidation = validateWorkflowDefinition(input.current, validationOptions);
  const draft = structuredClone(input.current);
  const nodesById = new Map(draft.nodes.map((node) => [node.id, node]));
  for (const operation of input.patch.operations) {
    const node = nodesById.get(operation.nodeId);
    if (!node) throw new Error(`O bloco ${operation.nodeId} não existe mais no fluxo.`);
    if (operation.name) node.name = operation.name;
    if (operation.configPatch) node.config = mergeNexusConfigPatch(node.config, operation.configPatch);
  }
  draft.updatedAt = new Date().toISOString();
  const workflow = bindStandaloneNexusWorkflow({
    definition: WorkflowDefinitionSchema.parse(draft),
    id: input.workflowId,
    workspaceId: input.workspaceId,
    name: input.current.name,
  });
  const validation = validateWorkflowDefinition(workflow, validationOptions);
  const baselineErrors = new Set(baselineValidation.errors.map((issue) => `${issue.code}:${issue.nodeId || ''}:${issue.connectionId || ''}`));
  const introducedErrors = validation.errors.filter((issue) => !baselineErrors.has(`${issue.code}:${issue.nodeId || ''}:${issue.connectionId || ''}`));
  if (introducedErrors.length > 0) throw new Error(introducedErrors.map((issue) => issue.message).join(' '));
  return { workflow, validation };
}

export async function generateNexusWorkflowWithAi(input: {
  workspaceId: string;
  workflowId: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentWorkflow: WorkflowDefinition;
}): Promise<{ proposal: NativeWorkflowAiProposal | null; error?: string }> {
  try {
    const user = await requireWorkspaceManager(input.workspaceId);
    const conversation = input.conversation
      .filter((message) => ['user', 'assistant'].includes(message.role) && message.content?.trim())
      .slice(-12)
      .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 12_000) }));
    if (!conversation.some((message) => message.role === 'user')) {
      return { proposal: null, error: 'Descreva a alteração que deseja fazer no fluxo.' };
    }
    const current = bindStandaloneNexusWorkflow({
      definition: WorkflowDefinitionSchema.parse(input.currentWorkflow),
      id: input.workflowId,
      workspaceId: input.workspaceId,
    });
    const [runtime, configuredModels] = await Promise.all([
      resolveWorkspaceAiExecutionContext(input.workspaceId),
      listWorkspaceConfiguredAiModels(input.workspaceId),
    ]);
    const modelNode = current.nodes.find((node) => node.type === 'ai.model') || createWorkflowNode('ai.model', {
      id: 'nexus_ai_editor_model',
      name: 'Modelo do editor Nexus',
      position: { x: 0, y: 0 },
      config: {
        provider: getAiModelRuntimeProvider(configuredModels[0]?.id || runtime.model),
        model: configuredModels[0]?.id || runtime.model,
        temperature: 0.1,
        maxOutputTokens: 16_384,
        supportsTools: true,
        supportsStructuredOutput: true,
        supportsStreaming: false,
        timeoutMs: 120_000,
        maxRetries: 2,
      },
    });
    const runtimeConfig = (runtime.autopilotConfig || {
      workspace_id: input.workspaceId,
      gemini_api_key: runtime.workspaceGeminiApiKey || null,
    }) as AutopilotConfig;
    const latestRequest = [...conversation].reverse().find((message) => message.role === 'user')?.content || '';
    if (!requiresStructuralNexusEdit(latestRequest)) {
      try {
        const patchOutputTokens = calculateNexusAiOutputTokens({ mode: 'patch', request: latestRequest, workflow: current });
        const patchModelNode = {
          ...modelNode,
          config: {
            ...modelNode.config,
            temperature: 0,
            maxOutputTokens: patchOutputTokens,
            timeoutMs: 20_000,
            maxRetries: 0,
          },
        };
        const patchChain = await modelChainForNode({ workspaceId: input.workspaceId, config: runtimeConfig, modelNode: patchModelNode });
        const generatedPatch = await patchChain.generateStructured({
          schema: NexusAiPatchProposalSchema,
          schemaName: 'dialogy_nexus_flow_patch',
          timeoutMs: 20_000,
          messages: [{ role: 'system', content: [
            'Você é o editor rápido de fluxos Nexus da Dialogy.',
            'Altere somente nome ou configuração de blocos existentes. Preserve integralmente nós, portas, conexões, posições e tudo que não foi solicitado.',
            'Use applicability=patch apenas quando o pedido puder ser resolvido com até 12 patches nos blocos existentes.',
            'Se for necessário criar, remover, conectar, desconectar ou consultar recursos externos, use applicability=full_edit_required e operations vazias.',
            'configPatch deve conter somente as chaves alteradas; nunca repita a configuração completa.',
            'Use exclusivamente os IDs de bloco fornecidos.',
            `O orçamento calculado para esta resposta é ${patchOutputTokens} tokens; use apenas o necessário para as mudanças solicitadas.`,
          ].join('\n') }, { role: 'user', content: JSON.stringify({
            request: latestRequest,
            recentConversation: conversation.slice(-4),
            nodes: current.nodes.map((node) => ({ id: node.id, type: node.type, name: node.name, config: node.config })),
          }) }],
        });
        const parsedPatch = NexusAiPatchProposalSchema.parse(generatedPatch.output);
        if (parsedPatch.applicability === 'patch' && parsedPatch.operations.length > 0) {
          const patched = applyNexusAiPatch({
            current,
            patch: parsedPatch,
            workflowId: input.workflowId,
            workspaceId: input.workspaceId,
            configuredModelIds: configuredModels.map((model) => model.id),
          });
          return { proposal: {
            summary: parsedPatch.summary,
            workflow: patched.workflow,
            changes: parsedPatch.changes.length > 0 ? parsedPatch.changes : ['Configuração atualizada.'],
            warnings: [],
            validation: patched.validation,
            selectedToolNames: [],
          } };
        }
      } catch (patchError) {
        console.warn('[NEXUS_AI_FAST_PATCH] Falling back to full workflow edit:', patchError);
      }
    }

    const [knowledge, tools, resources, studioAgents] = await Promise.all([
      loadWorkspaceDialogyKnowledge(input.workspaceId),
      listNexusDialogyTools(input.workspaceId),
      loadNexusDialogyResources(input.workspaceId),
      db.query(`SELECT a.id, a.name, v.version_number,
          v.snapshot->'agent_release_manifest'->>'releaseId' AS release_id
        FROM autopilot_configs a
        JOIN LATERAL (
          SELECT version_number, snapshot FROM autopilot_config_versions
          WHERE config_id = a.id AND workspace_id = a.workspace_id
            AND snapshot->'agent_release_manifest'->>'runtimeVersion' = 'studio-v1'
          ORDER BY version_number DESC LIMIT 1
        ) v ON true
        WHERE a.workspace_id = $1 AND a.is_active = true AND (NOT a.is_private OR a.user_id = $2)
        ORDER BY a.name`, [input.workspaceId, user.id]),
    ]);
    const fullEditOutputTokens = calculateNexusAiOutputTokens({ mode: 'full', request: latestRequest, workflow: current });
    const fullEditModelNode = {
      ...modelNode,
      config: {
        ...modelNode.config,
        temperature: 0.1,
        maxOutputTokens: fullEditOutputTokens,
        timeoutMs: 60_000,
        maxRetries: 0,
      },
    };
    const chain = await modelChainForNode({ workspaceId: input.workspaceId, config: runtimeConfig, modelNode: fullEditModelNode });
    const catalog = listStableWorkflowNodeManifests()
      .filter((manifest) => manifest.type !== 'ai.agent')
      .map((manifest) => ({
        type: manifest.type,
        label: manifest.label,
        inputPorts: manifest.inputPorts,
        outputPorts: manifest.outputPorts,
        defaultConfig: manifest.defaultConfig,
        terminal: manifest.terminal === true,
      }));
    const context = {
      conversation,
      currentWorkflow: current,
      catalog,
      studioAgents: studioAgents.rows.map((row) => ({ agentId: String(row.id), agentName: String(row.name), releaseId: String(row.release_id), version: Number(row.version_number) })),
      resources: {
        teams: resources.teams,
        tags: resources.tags,
        members: resources.members,
        intelligentAgents: resources.intelligentAgents,
        instances: resources.instances,
        workflows: resources.workflows,
        knowledgeDocuments: knowledge.documents.map((document) => ({ id: document.id, name: document.name })),
        knowledgeCollections: knowledge.collections.map((collection) => ({ id: collection.id, name: collection.name })),
        tools: tools.map((tool) => ({ name: tool.name, label: tool.displayName, source: tool.source, riskLevel: tool.riskLevel })),
      },
    };
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const generated = await chain.generateStructured({
        schema: NexusAiEditProposalSchema,
        schemaName: 'dialogy_nexus_flow_edit_proposal',
        timeoutMs: 60_000,
        messages: [{ role: 'system', content: [
          'Você é o editor profissional de fluxos Nexus da Dialogy.',
          'Aplique exatamente o pedido do usuário ao workflow atual e preserve tudo que não foi solicitado.',
          'Use somente tipos, portas, IDs de recursos e configurações presentes no contexto.',
          'Nunca use ai.agent. Para atendimento autônomo, use ai.published_agent com uma versão publicada do Studio.',
          'ai.published_agent é terminal: recebe somente uma entrada main, não possui saídas e transfere o atendimento ao Atendente Inteligente vinculado ao agente publicado.',
          'Nunca invente credenciais, IDs, resultados de ferramentas ou segredos. Mantenha posições legíveis e conexões válidas.',
          'Retorne o workflow completo, um resumo objetivo e a lista concreta de alterações.',
          `O orçamento calculado para esta resposta é ${fullEditOutputTokens} tokens; use apenas o necessário para representar o fluxo resultante.`,
          lastError ? `A tentativa anterior foi inválida: ${lastError}. Corrija integralmente.` : '',
        ].filter(Boolean).join('\n') }, { role: 'user', content: JSON.stringify(context) }],
      });
      const parsed = NexusAiEditProposalSchema.parse(generated.output);
      const workflow = bindStandaloneNexusWorkflow({ definition: parsed.workflow, id: input.workflowId, workspaceId: input.workspaceId, name: current.name });
      const validation = validateWorkflowDefinition(workflow, { availableModelIds: configuredModels.map((model) => model.id) });
      if (validation.valid) return { proposal: { summary: parsed.summary, workflow, changes: parsed.changes, warnings: [], validation, selectedToolNames: [] } };
      lastError = validation.errors.map((issue) => issue.message).join(' ');
    }
    return { proposal: null, error: `A IA não conseguiu produzir uma alteração válida. ${lastError}` };
  } catch (error) {
    return { proposal: null, error: error instanceof Error ? error.message : 'Não foi possível alterar o fluxo com IA.' };
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

async function recordNexusWorkflowVersion(input: {
  database: NexusDatabase;
  workflowId: string;
  workspaceId: string;
  userId: string;
  definition: WorkflowDefinition;
  description?: string;
  source: NexusWorkflowVersionSource;
  publishedRevision?: number | null;
}) {
  const result = await input.database.query(
    `INSERT INTO public.nexus_workflow_versions (
       nexus_workflow_id, workspace_id, revision, published_revision,
       definition, description, source, created_by
     )
     SELECT $1, $2, COALESCE(MAX(revision), 0) + 1, $3, $4::jsonb, $5, $6, $7
     FROM public.nexus_workflow_versions
     WHERE nexus_workflow_id = $1
     RETURNING id, revision`,
    [
      input.workflowId,
      input.workspaceId,
      input.publishedRevision || null,
      JSON.stringify(input.definition),
      input.description?.trim() || '',
      input.source,
      input.userId,
    ],
  );
  return { id: String(result.rows[0].id), revision: Number(result.rows[0].revision) };
}

function versionSummary(row: NexusWorkflowRow): NexusWorkflowVersionSummary {
  const definition = WorkflowDefinitionSchema.parse(parseJson(row.definition));
  return {
    id: String(row.id),
    revision: Number(row.revision),
    publishedRevision: row.published_revision == null ? null : Number(row.published_revision),
    description: String(row.description || ''),
    source: row.source as NexusWorkflowVersionSource,
    nodeCount: definition.nodes.length,
    connectionCount: definition.connections.length,
    createdAt: iso(row.created_at),
  };
}

function executionSummary(row: NexusWorkflowRow): NexusWorkflowExecutionSummary {
  const counters = jsonRecord(row.counters);
  const failure = jsonRecord(row.failure);
  return {
    id: String(row.id),
    workflowVersion: String(row.workflow_version),
    status: row.status as NexusWorkflowExecutionSummary['status'],
    sessionId: row.session_id ? String(row.session_id) : null,
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    currentNodeId: row.current_node_id ? String(row.current_node_id) : null,
    totalSteps: Number(counters.totalSteps || 0),
    totalModelCalls: Number(counters.totalModelCalls || 0),
    totalToolCalls: Number(counters.totalToolCalls || 0),
    totalTokens: counters.totalTokens == null ? null : Number(counters.totalTokens),
    failureMessage: failure.message ? String(failure.message) : null,
    startedAt: iso(row.started_at),
    updatedAt: iso(row.updated_at),
    finishedAt: row.finished_at ? iso(row.finished_at) : null,
  };
}

function rowSummary(row: NexusWorkflowRow): NexusWorkflowSummary {
  const definition = WorkflowDefinitionSchema.parse(parseJson(row.draft_definition));
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    description: String(row.description || ''),
    status: row.status as NexusWorkflowSummary['status'],
    nodeCount: definition.nodes.length,
    triggerTypes: definition.nodes.filter((node) => node.type.startsWith('trigger.')).map((node) => node.type),
    category: definition.nodes.some((node) => node.type === 'trigger.internal_event' && node.config.crmOption !== undefined) ? 'crm_trigger' : 'workflow',
    publishedRevision: Number(row.published_revision || 0),
    publishedAt: row.published_at ? iso(row.published_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowRecord(row: NexusWorkflowRow, hasUnpublishedChanges = true): NexusWorkflowRecord {
  return {
    ...rowSummary(row),
    createdBy: String(row.created_by),
    draftDefinition: normalizeStandaloneStudioAgents(WorkflowDefinitionSchema.parse(parseJson(row.draft_definition))),
    publishedWorkflowId: row.published_workflow_id ? String(row.published_workflow_id) : null,
    publishedWorkflowVersion: row.published_workflow_version ? String(row.published_workflow_version) : null,
    hasUnpublishedChanges,
  };
}

export async function listNexusWorkflows(
  workspaceId: string,
  options?: { includeArchived?: boolean },
): Promise<{
  workflows: NexusWorkflowSummary[];
  error?: string;
}> {
  try {
    await requireWorkspaceManager(workspaceId);
    const statusFilter = options?.includeArchived ? '' : "AND status <> 'archived'";
    const result = await db.query(
      `SELECT * FROM public.nexus_workflows
       WHERE workspace_id = $1 ${statusFilter}
       ORDER BY updated_at DESC`,
      [workspaceId],
    );
    return { workflows: result.rows.map(rowSummary) };
  } catch (error) {
    return { workflows: [], error: error instanceof Error ? error.message : 'Falha ao carregar fluxos.' };
  }
}

export async function getNexusWorkflow(workspaceId: string, workflowId: string): Promise<{
  workflow: NexusWorkflowRecord | null;
  models: Awaited<ReturnType<typeof listWorkspaceConfiguredAiModels>>;
  knowledgeDocuments: KnowledgeBaseDocument[];
  knowledgeCollections: KnowledgeCollection[];
  tools: AgentToolCatalogItem[];
  resources: NexusDialogyResources;
  error?: string;
}> {
  try {
    await requireWorkspaceManager(workspaceId);
    const [result, models, knowledge, tools, resources] = await Promise.all([
      db.query(
        'SELECT * FROM public.nexus_workflows WHERE workspace_id = $1 AND id = $2 LIMIT 1',
        [workspaceId, workflowId],
      ),
      listWorkspaceConfiguredAiModels(workspaceId),
      loadWorkspaceDialogyKnowledge(workspaceId),
      listNexusDialogyTools(workspaceId),
      loadNexusDialogyResources(workspaceId),
    ]);
    if (!result.rows[0]) return { workflow: null, models, knowledgeDocuments: knowledge.documents, knowledgeCollections: knowledge.collections, tools, resources, error: 'Fluxo não encontrado.' };

    let hasUnpublishedChanges = true;
    const row = result.rows[0];
    if (Number(row.published_revision || 0) > 0 && row.status === 'published') {
      const publishedVersionRes = await db.query(
        `SELECT definition FROM public.nexus_workflow_versions
         WHERE nexus_workflow_id = $1 AND workspace_id = $2 AND published_revision IS NOT NULL
         ORDER BY revision DESC LIMIT 1`,
        [workflowId, workspaceId],
      );
      if (publishedVersionRes.rows[0]) {
        const publishedDef = WorkflowDefinitionSchema.parse(parseJson(publishedVersionRes.rows[0].definition));
        const draftDef = WorkflowDefinitionSchema.parse(parseJson(row.draft_definition));
        hasUnpublishedChanges = workflowFunctionalSignature(publishedDef) !== workflowFunctionalSignature(draftDef);
      }
    }

    return {
      workflow: rowRecord(row, hasUnpublishedChanges),
      models,
      knowledgeDocuments: knowledge.documents,
      knowledgeCollections: knowledge.collections,
      tools,
      resources,
    };
  } catch (error) {
    return {
      workflow: null,
      models: [],
      knowledgeDocuments: [],
      knowledgeCollections: [],
      tools: [],
      resources: { teams: [], tags: [], members: [], systemAgents: [], intelligentAgents: [], instances: [], workflows: [] },
      error: error instanceof Error ? error.message : 'Falha ao abrir o fluxo.',
    };
  }
}

export async function getNexusCrmOptionFields(workspaceId: string) {
  await requireWorkspaceManager(workspaceId);
  const result = await db.query('SELECT id, label, options FROM custom_field_definitions WHERE workspace_id = $1 AND type = $2 ORDER BY label', [workspaceId, 'select']);
  return result.rows.map((row) => ({ id: String(row.id), label: String(row.label), options: parseJson(row.options) as Array<{ value: string; label: string }> }));
}

export async function getNexusGoogleAdsOptions(workspaceId: string) {
  await requireWorkspaceManager(workspaceId);
  return loadNexusGoogleAdsOptions(workspaceId);
}

async function validateCrmOptionBindings(workspaceId: string, definition: WorkflowDefinition) {
  for (const node of definition.nodes) {
    if (node.type !== 'trigger.internal_event' || node.config.crmOption === undefined) continue;
    const condition = z.object({ fieldId: z.string().uuid(), value: z.string().min(1) }).parse(node.config.crmOption);
    const result = await db.query('SELECT options FROM custom_field_definitions WHERE workspace_id = $1 AND id = $2 AND type = $3', [workspaceId, condition.fieldId, 'select']);
    const options = parseJson(result.rows[0]?.options);
    if (!Array.isArray(options) || !options.some((option) => option.value === condition.value)) {
      throw new Error('Selecione um campo e uma opção disponíveis nesta workspace.');
    }
  }
}

export async function createNexusWorkflow(input: {
  workspaceId: string;
  name: string;
  description?: string;
  template?: NexusWorkflowTemplate;
  crmOption?: { fieldId: string; value: string };
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const client = await db.connect();
  try {
    const user = await requireWorkspaceManager(input.workspaceId);
    const id = randomUUID();
    const name = input.name.trim() || 'Novo fluxo';
    const definition = createStandaloneNexusWorkflow({
      id,
      workspaceId: input.workspaceId,
      name,
      template: input.template || 'blank',
      crmOption: input.crmOption,
    });
    await validateCrmOptionBindings(input.workspaceId, definition);
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO public.nexus_workflows
       (id, workspace_id, created_by, name, description, draft_definition)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [id, input.workspaceId, user.id, name, input.description?.trim() || '', JSON.stringify(definition)],
    );
    await recordNexusWorkflowVersion({
      database: client,
      workflowId: id,
      workspaceId: input.workspaceId,
      userId: user.id,
      definition,
      description: 'Fluxo criado.',
      source: 'create',
    });
    await client.query('COMMIT');
    revalidatePath('/nexus');
    return { success: true, id };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao criar o fluxo.' };
  } finally {
    client.release();
  }
}

export async function saveNexusWorkflowDraft(input: {
  workspaceId: string;
  workflowId: string;
  definition: WorkflowDefinition;
  description?: string;
  source?: Extract<NexusWorkflowVersionSource, 'save' | 'import'>;
}): Promise<{ success: boolean; definition?: WorkflowDefinition; error?: string }> {
  const client = await db.connect();
  try {
    const user = await requireWorkspaceManager(input.workspaceId);
    const definition = bindStandaloneNexusWorkflow({
      definition: input.definition,
      id: input.workflowId,
      workspaceId: input.workspaceId,
    });
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT draft_definition
       FROM public.nexus_workflows
       WHERE workspace_id = $1 AND id = $2 AND status <> 'archived'
       FOR UPDATE`,
      [input.workspaceId, input.workflowId],
    );
    if (!locked.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Fluxo não encontrado.' };
    }
    const current = WorkflowDefinitionSchema.parse(parseJson(locked.rows[0].draft_definition));
    if (workflowLayoutSignature(current) === workflowLayoutSignature(definition)) {
      await client.query('COMMIT');
      return { success: true, definition: current };
    }
    await client.query(
      `UPDATE public.nexus_workflows
       SET name = $3, draft_definition = $4::jsonb, updated_at = timezone('utc', now())
       WHERE workspace_id = $1 AND id = $2 AND status <> 'archived'`,
      [input.workspaceId, input.workflowId, definition.name, JSON.stringify(definition)],
    );
    await recordNexusWorkflowVersion({
      database: client,
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      userId: user.id,
      definition,
      description: input.description,
      source: input.source || 'save',
    });
    await client.query('COMMIT');
    revalidatePath('/nexus');
    revalidatePath(`/nexus/flows/${input.workflowId}`);
    return { success: true, definition };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao salvar o rascunho.' };
  } finally {
    client.release();
  }
}

export async function duplicateNexusWorkflow(input: {
  workspaceId: string;
  workflowId: string;
  name?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const client = await db.connect();
  try {
    const user = await requireWorkspaceManager(input.workspaceId);
    await client.query('BEGIN');
    const sourceResult = await client.query(
      `SELECT name, description, draft_definition
       FROM public.nexus_workflows
       WHERE workspace_id = $1 AND id = $2 AND status <> 'archived'
       FOR SHARE`,
      [input.workspaceId, input.workflowId],
    );
    const source = sourceResult.rows[0] as NexusWorkflowRow | undefined;
    if (!source) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Fluxo não encontrado.' };
    }
    const id = randomUUID();
    const name = input.name?.trim() || `Cópia de ${String(source.name)}`;
    const definition = duplicateStandaloneNexusWorkflow({
      definition: WorkflowDefinitionSchema.parse(parseJson(source.draft_definition)),
      id,
      workspaceId: input.workspaceId,
      name,
    });
    await client.query(
      `INSERT INTO public.nexus_workflows
       (id, workspace_id, created_by, name, description, draft_definition)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [id, input.workspaceId, user.id, name, String(source.description || ''), JSON.stringify(definition)],
    );
    await recordNexusWorkflowVersion({
      database: client,
      workflowId: id,
      workspaceId: input.workspaceId,
      userId: user.id,
      definition,
      description: `Duplicado de ${String(source.name)}.`,
      source: 'duplicate',
    });
    await client.query('COMMIT');
    revalidatePath('/nexus');
    return { success: true, id };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao duplicar o fluxo.' };
  } finally {
    client.release();
  }
}

export async function archiveNexusWorkflow(input: {
  workspaceId: string;
  workflowId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireWorkspaceManager(input.workspaceId);
    const result = await db.query(
      `UPDATE public.nexus_workflows
       SET status = 'archived', updated_at = timezone('utc', now())
       WHERE workspace_id = $1 AND id = $2 AND status <> 'archived'`,
      [input.workspaceId, input.workflowId],
    );
    if (!result.rowCount) return { success: false, error: 'Fluxo não encontrado.' };
    revalidatePath('/nexus');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao arquivar o fluxo.' };
  }
}

export async function restoreArchivedNexusWorkflow(input: {
  workspaceId: string;
  workflowId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireWorkspaceManager(input.workspaceId);
    const result = await db.query(
      `UPDATE public.nexus_workflows
       SET status = CASE
         WHEN published_workflow_id IS NULL THEN 'draft'
         ELSE 'published'
       END,
       updated_at = timezone('utc', now())
       WHERE workspace_id = $1 AND id = $2 AND status = 'archived'`,
      [input.workspaceId, input.workflowId],
    );
    if (!result.rowCount) return { success: false, error: 'Fluxo arquivado não encontrado.' };
    revalidatePath('/nexus');
    revalidatePath(`/nexus/flows/${input.workflowId}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao restaurar o fluxo.' };
  }
}

export async function listNexusWorkflowVersions(input: {
  workspaceId: string;
  workflowId: string;
}): Promise<{ versions: NexusWorkflowVersionSummary[]; error?: string }> {
  try {
    await requireWorkspaceManager(input.workspaceId);
    const result = await db.query(
      `SELECT id, revision, published_revision, definition, description, source, created_at
       FROM public.nexus_workflow_versions
       WHERE workspace_id = $1 AND nexus_workflow_id = $2
       ORDER BY revision DESC
       LIMIT 100`,
      [input.workspaceId, input.workflowId],
    );
    return { versions: result.rows.map(versionSummary) };
  } catch (error) {
    return { versions: [], error: error instanceof Error ? error.message : 'Falha ao carregar o histórico.' };
  }
}

export async function restoreNexusWorkflowVersion(input: {
  workspaceId: string;
  workflowId: string;
  versionId: string;
}): Promise<{ success: boolean; definition?: WorkflowDefinition; error?: string }> {
  const client = await db.connect();
  try {
    const user = await requireWorkspaceManager(input.workspaceId);
    await client.query('BEGIN');
    const workflowResult = await client.query(
      `SELECT id
       FROM public.nexus_workflows
       WHERE workspace_id = $1 AND id = $2 AND status <> 'archived'
       FOR UPDATE`,
      [input.workspaceId, input.workflowId],
    );
    if (!workflowResult.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Fluxo não encontrado.' };
    }
    const versionResult = await client.query(
      `SELECT revision, definition
       FROM public.nexus_workflow_versions
       WHERE id = $1 AND workspace_id = $2 AND nexus_workflow_id = $3
       LIMIT 1`,
      [input.versionId, input.workspaceId, input.workflowId],
    );
    const version = versionResult.rows[0] as NexusWorkflowRow | undefined;
    if (!version) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Versão não encontrada.' };
    }
    const source = WorkflowDefinitionSchema.parse(parseJson(version.definition));
    const definition = bindStandaloneNexusWorkflow({
      definition: source,
      id: input.workflowId,
      workspaceId: input.workspaceId,
      name: source.name,
    });
    await client.query(
      `UPDATE public.nexus_workflows
       SET name = $3, draft_definition = $4::jsonb, updated_at = timezone('utc', now())
       WHERE workspace_id = $1 AND id = $2`,
      [input.workspaceId, input.workflowId, definition.name, JSON.stringify(definition)],
    );
    await recordNexusWorkflowVersion({
      database: client,
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      userId: user.id,
      definition,
      description: `Restauração da revisão ${Number(version.revision)}.`,
      source: 'restore',
    });
    await client.query('COMMIT');
    revalidatePath('/nexus');
    revalidatePath(`/nexus/flows/${input.workflowId}`);
    return { success: true, definition };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao restaurar a versão.' };
  } finally {
    client.release();
  }
}

export async function listNexusWorkflowExecutions(input: {
  workspaceId: string;
  workflowId: string;
}): Promise<{ executions: NexusWorkflowExecutionSummary[]; error?: string }> {
  try {
    await requireWorkspaceManager(input.workspaceId);
    const result = await db.query(
      `SELECT id, workflow_version, status, session_id, conversation_id, current_node_id,
              counters, failure, started_at, updated_at, finished_at
       FROM public.workflow_executions
       WHERE workspace_id = $1 AND workflow_id = $2
       ORDER BY started_at DESC
       LIMIT 100`,
      [input.workspaceId, `nexus:${input.workflowId}`],
    );
    return { executions: result.rows.map(executionSummary) };
  } catch (error) {
    return { executions: [], error: error instanceof Error ? error.message : 'Falha ao carregar as execuções.' };
  }
}

export async function cancelNexusWorkflowExecution(input: {
  workspaceId: string;
  workflowId: string;
  executionId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireWorkspaceManager(input.workspaceId);
    const match = await db.query(
      `SELECT id
       FROM public.workflow_executions
       WHERE id = $1 AND workspace_id = $2 AND workflow_id = $3
         AND status IN ('queued', 'running', 'waiting')
       LIMIT 1`,
      [input.executionId, input.workspaceId, `nexus:${input.workflowId}`],
    );
    if (!match.rows[0]) return { success: false, error: 'Execução ativa não encontrada.' };
    await cancelPublishedNexusWorkflowExecution({
      workspaceId: input.workspaceId,
      executionId: input.executionId,
      reason: 'Cancelada manualmente no Nexus.',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao cancelar a execução.' };
  }
}

export async function publishNexusWorkflow(input: {
  workspaceId: string;
  workflowId: string;
  definition: WorkflowDefinition;
}): Promise<{ success: boolean; revision?: number; error?: string }> {
  const client = await db.connect();
  try {
    const user = await requireWorkspaceManager(input.workspaceId);
    const configuredModels = await listWorkspaceConfiguredAiModels(input.workspaceId);
    const draft = bindStandaloneNexusWorkflow({
      definition: input.definition,
      id: input.workflowId,
      workspaceId: input.workspaceId,
    });
    const validation = validateWorkflowDefinition(draft, {
      availableModelIds: configuredModels.map((model) => model.id),
    });
    if (!validation.valid) {
      return { success: false, error: validation.errors.map((issue) => issue.message).join(' ') };
    }
    await validateCrmOptionBindings(input.workspaceId, draft);
    for (const node of draft.nodes.filter((item) => item.type === 'integration.google_ads_lead')) {
      await assertNexusGoogleAdsBinding(input.workspaceId, node.config);
    }
    for (const node of draft.nodes.filter((item) => item.type === 'ai.published_agent')) {
      const release = await loadStudioRelease(input.workspaceId, String(node.config.agentId || ''), String(node.config.releaseId || ''));
      if (!release) throw new Error(`O bloco “${node.name}” não possui uma versão disponível neste workspace.`);
      validateStudioFlowBindings(release.agentSnapshot, node.config.inputMappings, node.config.outputKeys);
      const active = await db.query('SELECT is_active FROM autopilot_configs WHERE workspace_id = $1 AND id = $2 AND (NOT is_private OR user_id = $3)', [input.workspaceId, release.agentId, user.id]);
      if (!active.rows[0]?.is_active) throw new Error(`O agente do bloco “${node.name}” está pausado.`);
    }
    const [credentialBindings, dialogyBindings] = await Promise.all([
      validateNexusWorkflowCredentialBindings({
        workspaceId: input.workspaceId,
        definition: draft,
      }),
      validateNexusWorkflowDialogyBindings({
        workspaceId: input.workspaceId,
        definition: draft,
      }),
    ]);
    if (!credentialBindings.valid) {
      return {
        success: false,
        error: 'O fluxo possui uma credencial obrigatória ausente ou que não pertence a este workspace.',
      };
    }
    if (!dialogyBindings.valid) {
      return {
        success: false,
        error: dialogyBindings.issues.map((issue) => issue.message).join(' '),
      };
    }

    await client.query('BEGIN');
    // Recheck mutable visibility/activation under a shared lock. Published manifests are immutable.
    for (const agentId of [...new Set(draft.nodes.filter((node) => node.type === 'ai.published_agent').map((node) => String(node.config.agentId)))].sort()) {
      const available = await client.query('SELECT id FROM autopilot_configs WHERE workspace_id = $1 AND id = $2 AND is_active AND (NOT is_private OR user_id = $3) FOR SHARE', [input.workspaceId, agentId, user.id]);
      if (!available.rows[0]) throw new Error('Um agente foi pausado ou teve o acesso alterado. Revise os blocos antes de publicar.');
    }
    const locked = await client.query(
      `SELECT published_revision, status FROM public.nexus_workflows
       WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
      [input.workspaceId, input.workflowId],
    );
    if (!locked.rows[0]) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Fluxo não encontrado.' };
    }
    const currentRevision = Number(locked.rows[0].published_revision || 0);
    if (currentRevision > 0 && locked.rows[0].status === 'published') {
      const latestPublishedRes = await client.query(
        `SELECT definition FROM public.nexus_workflow_versions
         WHERE nexus_workflow_id = $1 AND workspace_id = $2 AND published_revision IS NOT NULL
         ORDER BY revision DESC LIMIT 1`,
        [input.workflowId, input.workspaceId],
      );
      if (latestPublishedRes.rows[0]) {
        const latestPublishedDef = WorkflowDefinitionSchema.parse(parseJson(latestPublishedRes.rows[0].definition));
        if (workflowFunctionalSignature(latestPublishedDef) === workflowFunctionalSignature(draft)) {
          await client.query('ROLLBACK');
          return { success: false, error: 'Nenhuma alteração nova para publicar.' };
        }
      }
    }
    const revision = currentRevision + 1;
    const timestamp = new Date().toISOString();
    const published = WorkflowDefinitionSchema.parse({
      ...draft,
      version: `v${revision}`,
      status: 'published',
      updatedAt: timestamp,
    });
    await new PostgresWorkflowPersistence(client).saveWorkflowDefinition(published);
    await client.query(
      `UPDATE public.nexus_workflows
       SET name = $3,
           status = 'published',
           draft_definition = $4::jsonb,
           published_workflow_id = $5,
           published_workflow_version = $6,
           published_revision = $7,
           published_at = $8,
           updated_at = timezone('utc', now())
       WHERE workspace_id = $1 AND id = $2`,
      [input.workspaceId, input.workflowId, draft.name, JSON.stringify(draft), published.id, published.version, revision, timestamp],
    );
    await recordNexusWorkflowVersion({
      database: client,
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      userId: user.id,
      definition: published,
      description: `Publicação v${revision}.`,
      source: 'publish',
      publishedRevision: revision,
    });
    const supersededExecutions = await client.query(
      `SELECT id
       FROM public.workflow_executions
       WHERE workspace_id = $1
         AND workflow_id = $2
         AND workflow_version <> $3
         AND status IN ('queued', 'running', 'waiting')`,
      [input.workspaceId, published.id, published.version],
    );
    await client.query('COMMIT');
    const cancellationResults = await Promise.allSettled(
      (supersededExecutions.rows as Array<{ id: string }>).map((execution) => (
        cancelPublishedNexusWorkflowExecution({
          workspaceId: input.workspaceId,
          executionId: String(execution.id),
          reason: `Execução substituída pela publicação ${published.version}.`,
        })
      )),
    );
    const cancellationFailures = cancellationResults.filter((result) => result.status === 'rejected');
    if (cancellationFailures.length > 0) {
      console.warn('[NEXUS_PUBLISH] Some superseded executions could not be cancelled.', {
        workflowId: published.id,
        publishedVersion: published.version,
        failed: cancellationFailures.length,
      });
    }
    revalidatePath('/nexus');
    revalidatePath(`/nexus/flows/${input.workflowId}`);
    return { success: true, revision };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao publicar o fluxo.' };
  } finally {
    client.release();
  }
}

export async function runNexusWorkflowTest(input: {
  workspaceId: string;
  workflowId: string;
  definition: WorkflowDefinition;
  message: string;
  startNodeId?: string;
  fixtures?: WorkflowBlockTestFixtures;
}): Promise<WorkflowTestExecutionResult> {
  try {
    const user = await requireWorkspaceManager(input.workspaceId);
    const configuredModels = await listWorkspaceConfiguredAiModels(input.workspaceId);
    const bound = bindStandaloneNexusWorkflow({
      definition: input.definition,
      id: input.workflowId,
      workspaceId: input.workspaceId,
    });
    const standardInput = { text: input.message, message: input.message, customerMessage: input.message };
    const prepared = input.startNodeId ? prepareWorkflowBlockTest({
      definition: bound,
      nodeId: input.startNodeId,
      fixtures: input.fixtures,
      input: standardInput,
      context: { sandbox: true, userId: user.id },
    }) : null;
    const executable = prepared?.workflow || bound;
    const workflow = WorkflowDefinitionSchema.parse({
      ...executable,
      version: `test-${hashValue(executable).slice(0, 16)}`,
      updatedAt: new Date().toISOString(),
    });
    const validation = validateWorkflowDefinition(workflow, {
      availableModelIds: configuredModels.map((model) => model.id),
    });
    if (!validation.valid) {
      return { success: false, error: validation.errors.map((issue) => issue.message).join(' '), messages: [], variables: {} };
    }

    const [aiContext, knowledgeLibrary] = await Promise.all([
      resolveWorkspaceAiExecutionContext(input.workspaceId),
      loadWorkspaceDialogyKnowledge(input.workspaceId),
    ]);
    const modelConfig = (aiContext.autopilotConfig || {
      workspace_id: input.workspaceId,
      gemini_api_key: aiContext.workspaceGeminiApiKey || null,
    }) as AutopilotConfig;

    const chatMessages: WorkflowTestChatMessage[] = [];
    const sandbox = createWorkflowBlockTestSideEffectAdapters();
    const persistence = new PostgresWorkflowPersistence(db);
    await persistence.saveWorkflowDefinition(workflow);
    const handlers = createDefaultNodeHandlerRegistry({
      resolveModelChain: async (context) => modelChainForNode({
        workspaceId: input.workspaceId,
        config: modelConfig,
        modelNode: context.modelNode,
      }),
      loadMemory: async () => ({ sandbox: true }),
      retrieveKnowledge: async (context) => retrieveNexusDialogyKnowledge({
        workspaceId: input.workspaceId,
        execution: context.execution,
        knowledgeNodes: context.knowledgeNodes,
        library: knowledgeLibrary,
      }),
      applyGuardrails: async (_phase, value) => value,
      closeConversation: async () => ({ sandbox: true, closed: false }),
      ...sandbox.dependencies,
      sendResponse: async (message, runtimeInput) => {
        const isOptions = runtimeInput.node.type === 'interaction.options';
        const isInput = runtimeInput.node.type.startsWith('interaction.');
        const rawOptions = runtimeInput.node.config.options;
        const options = isOptions && Array.isArray(rawOptions)
          ? rawOptions.filter((opt) => opt && typeof opt === 'object').map((opt: any, idx: number) => ({
              id: String(opt.id || `opt_${idx}`),
              label: String(opt.label || opt.value || `Opção ${idx + 1}`),
              value: String(opt.value || opt.label || `Opção ${idx + 1}`),
            }))
          : undefined;

        chatMessages.push({
          id: `msg_${randomUUID()}`,
          nodeId: runtimeInput.node.id,
          nodeType: runtimeInput.node.type,
          role: 'bot',
          text: message,
          type: isOptions ? 'options' : isInput ? 'input' : 'text',
          options,
          timestamp: new Date().toISOString(),
        });
        return { sandbox: true, delivered: true, characterCount: message.length };
      },
      sendMedia: async (media, runtimeInput) => {
        chatMessages.push({
          id: `msg_${randomUUID()}`,
          nodeId: runtimeInput.node.id,
          nodeType: runtimeInput.node.type,
          role: 'bot',
          text: media.caption || `[Mídia: ${media.type}]`,
          type: 'media',
          timestamp: new Date().toISOString(),
        });
        return { sandbox: true, delivered: true, mediaType: media.type };
      },
      handoff: async (runtimeInput) => {
        chatMessages.push({
          id: `msg_${randomUUID()}`,
          nodeId: runtimeInput.node.id,
          nodeType: runtimeInput.node.type,
          role: 'system',
          text: 'Atendimento transferido para equipe humana.',
          type: 'handoff',
          timestamp: new Date().toISOString(),
        });
        return { sandbox: true, transferred: true };
      },
    });
    const execution = await new WorkflowExecutor(persistence, handlers).start({
      workflow,
      input: prepared?.startInput.input || standardInput,
      variables: prepared?.startInput.variables,
      context: prepared?.startInput.context || { sandbox: true, userId: user.id },
      sessionId: `nexus-test:${user.id}`,
      conversationId: `nexus-test:${input.workflowId}`,
      executionId: `nexus_test_${randomUUID()}`,
    }, { workerId: `nexus_test_${user.id}` });

    // Collect any AI agent responses if not delivered through sendResponse
    for (const step of execution.executionPath || []) {
      const nodeResult = execution.nodeResults[step.nodeId];
      if (step.nodeType === 'ai.agent' || step.nodeType === 'agent.intelligent') {
        const out = nodeResult?.output as Record<string, unknown> | undefined;
        const responseText = out?.response || out?.question || out?.summary;
        if (typeof responseText === 'string' && responseText.trim()) {
          const alreadyRecorded = chatMessages.some((msg) => msg.nodeId === step.nodeId && msg.text === responseText);
          if (!alreadyRecorded) {
            chatMessages.push({
              id: `msg_${randomUUID()}`,
              nodeId: step.nodeId,
              nodeType: step.nodeType,
              role: 'bot',
              text: responseText,
              type: out?.type === 'needs_input' ? 'input' : 'text',
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }

    if (chatMessages.length === 0 && execution.status === 'failed') {
      const failure = execution.failure as Record<string, unknown> | undefined;
      chatMessages.push({
        id: `msg_${randomUUID()}`,
        role: 'system',
        text: `O fluxo falhou: ${String(failure?.message || 'Erro desconhecido durante a execução.')}`,
        type: 'error',
        timestamp: new Date().toISOString(),
      });
    }

    return {
      success: true,
      executionId: execution.executionId,
      status: execution.status,
      resumeToken: execution.resumeToken,
      waitingNodeId: execution.currentNodeId || undefined,
      messages: chatMessages,
      variables: execution.variables || {},
      nodeResults: execution.nodeResults,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao testar o fluxo.', messages: [], variables: {} };
  }
}

export async function resumeNexusWorkflowTest(input: {
  workspaceId: string;
  workflowId: string;
  resumeToken: string;
  customerMessage: string;
  definition?: WorkflowDefinition;
}): Promise<WorkflowTestExecutionResult> {
  try {
    const user = await requireWorkspaceManager(input.workspaceId);
    const [aiContext, knowledgeLibrary] = await Promise.all([
      resolveWorkspaceAiExecutionContext(input.workspaceId),
      loadWorkspaceDialogyKnowledge(input.workspaceId),
    ]);
    const modelConfig = (aiContext.autopilotConfig || {
      workspace_id: input.workspaceId,
      gemini_api_key: aiContext.workspaceGeminiApiKey || null,
    }) as AutopilotConfig;

    const chatMessages: WorkflowTestChatMessage[] = [];
    const sandbox = createWorkflowBlockTestSideEffectAdapters();
    const persistence = new PostgresWorkflowPersistence(db);
    const handlers = createDefaultNodeHandlerRegistry({
      resolveModelChain: async (context) => modelChainForNode({
        workspaceId: input.workspaceId,
        config: modelConfig,
        modelNode: context.modelNode,
      }),
      loadMemory: async () => ({ sandbox: true }),
      retrieveKnowledge: async (context) => retrieveNexusDialogyKnowledge({
        workspaceId: input.workspaceId,
        execution: context.execution,
        knowledgeNodes: context.knowledgeNodes,
        library: knowledgeLibrary,
      }),
      applyGuardrails: async (_phase, value) => value,
      closeConversation: async () => ({ sandbox: true, closed: false }),
      ...sandbox.dependencies,
      sendResponse: async (message, runtimeInput) => {
        const isOptions = runtimeInput.node.type === 'interaction.options';
        const isInput = runtimeInput.node.type.startsWith('interaction.');
        const rawOptions = runtimeInput.node.config.options;
        const options = isOptions && Array.isArray(rawOptions)
          ? rawOptions.filter((opt) => opt && typeof opt === 'object').map((opt: any, idx: number) => ({
              id: String(opt.id || `opt_${idx}`),
              label: String(opt.label || opt.value || `Opção ${idx + 1}`),
              value: String(opt.value || opt.label || `Opção ${idx + 1}`),
            }))
          : undefined;

        chatMessages.push({
          id: `msg_${randomUUID()}`,
          nodeId: runtimeInput.node.id,
          nodeType: runtimeInput.node.type,
          role: 'bot',
          text: message,
          type: isOptions ? 'options' : isInput ? 'input' : 'text',
          options,
          timestamp: new Date().toISOString(),
        });
        return { sandbox: true, delivered: true, characterCount: message.length };
      },
      sendMedia: async (media, runtimeInput) => {
        chatMessages.push({
          id: `msg_${randomUUID()}`,
          nodeId: runtimeInput.node.id,
          nodeType: runtimeInput.node.type,
          role: 'bot',
          text: media.caption || `[Mídia: ${media.type}]`,
          type: 'media',
          timestamp: new Date().toISOString(),
        });
        return { sandbox: true, delivered: true, mediaType: media.type };
      },
      handoff: async (runtimeInput) => {
        chatMessages.push({
          id: `msg_${randomUUID()}`,
          nodeId: runtimeInput.node.id,
          nodeType: runtimeInput.node.type,
          role: 'system',
          text: 'Atendimento transferido para equipe humana.',
          type: 'handoff',
          timestamp: new Date().toISOString(),
        });
        return { sandbox: true, transferred: true };
      },
    });

    const executor = new WorkflowExecutor(persistence, handlers);
    const execution = await executor.resume({
      resumeToken: input.resumeToken,
      input: {
        message: input.customerMessage,
        customerMessage: input.customerMessage,
        text: input.customerMessage,
        value: input.customerMessage,
      },
    });

    // Collect any AI agent responses if not delivered through sendResponse
    for (const step of execution.executionPath || []) {
      const nodeResult = execution.nodeResults[step.nodeId];
      if (step.nodeType === 'ai.agent' || step.nodeType === 'agent.intelligent') {
        const out = nodeResult?.output as Record<string, unknown> | undefined;
        const responseText = out?.response || out?.question || out?.summary;
        if (typeof responseText === 'string' && responseText.trim()) {
          const alreadyRecorded = chatMessages.some((msg) => msg.nodeId === step.nodeId && msg.text === responseText);
          if (!alreadyRecorded) {
            chatMessages.push({
              id: `msg_${randomUUID()}`,
              nodeId: step.nodeId,
              nodeType: step.nodeType,
              role: 'bot',
              text: responseText,
              type: out?.type === 'needs_input' ? 'input' : 'text',
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }

    if (chatMessages.length === 0 && execution.status === 'failed') {
      const failure = execution.failure as Record<string, unknown> | undefined;
      chatMessages.push({
        id: `msg_${randomUUID()}`,
        role: 'system',
        text: `O fluxo falhou: ${String(failure?.message || 'Erro desconhecido durante a execução.')}`,
        type: 'error',
        timestamp: new Date().toISOString(),
      });
    }

    return {
      success: true,
      executionId: execution.executionId,
      status: execution.status,
      resumeToken: execution.resumeToken,
      waitingNodeId: execution.currentNodeId || undefined,
      messages: chatMessages,
      variables: execution.variables || {},
      nodeResults: execution.nodeResults,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao retomar o teste.', messages: [], variables: {} };
  }
}
