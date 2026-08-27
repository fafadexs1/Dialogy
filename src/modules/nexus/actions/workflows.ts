'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import type { PoolClient } from 'pg';
import { createClient } from '@/lib/supabase/server';
import type { AutopilotConfig } from '@/lib/types';
import type { KnowledgeBaseDocument, KnowledgeCollection } from '@/lib/types';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { resolveWorkspaceAiExecutionContext } from '@/services/ai/runtime';
import { listWorkspaceConfiguredAiModels } from '@/services/ai/workspace-ai-credentials';
import {
  WorkflowDefinitionSchema,
  WorkflowExecutor,
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
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';

import {
  bindStandaloneNexusWorkflow,
  createStandaloneNexusWorkflow,
  duplicateStandaloneNexusWorkflow,
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
    draftDefinition: WorkflowDefinitionSchema.parse(parseJson(row.draft_definition)),
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

export async function createNexusWorkflow(input: {
  workspaceId: string;
  name: string;
  description?: string;
  template?: NexusWorkflowTemplate;
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
    });
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
    await client.query('COMMIT');
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
