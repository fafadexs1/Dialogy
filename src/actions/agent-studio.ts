'use server';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateSchema } from 'genkit/schema';
import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/actions/user';
import { db } from '@/lib/db';
import { listWorkspaceConfiguredAiModels } from '@/services/ai/workspace-ai-credentials';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { resolveSafeAutopilotWebhookTarget } from '@/services/autopilot/automation-rules';
import { executeStudioHttp, executeStudioMcp, resolveStudioMcpTool } from '@/services/agent-studio/integrations';
import { loadStudioRelease, lockStudioDraft, parseStudioSnapshot, withStudioTransaction } from '@/services/agent-studio/repository';
import {
  listNexusCredentialSummaries,
  saveNexusCredential,
  type NexusCredentialType,
} from '@/modules/nexus/services/credentials';
import { validateAgentForPublication } from '@/services/agent-studio/assistant-validator';
import {
  AgentStudioDocumentSchema,
  McpToolStepConfigSchema,
  createDefaultAgentStudioDocument,
  createInvoiceAgentStudioTemplate,
  type AgentReleaseManifest,
  type AgentServiceType,
  type AgentStudioDocument,
  type HttpRequestStepConfig,
  type McpToolStepConfig,
} from '@/services/agent-studio/types';
import { getMcpWorkspaceConfig } from '@/services/mcp/store';
import { createStudioSession, StudioSessionSchema } from '@/services/agent-studio/engine';
import type { AutopilotConfig } from '@/lib/types';
import { sealStudioSession } from '@/services/agent-studio/session-store';
import { readStudioResults } from '@/services/agent-studio/results';
import { studioConnectionFingerprint, studioMcpFingerprint } from '@/services/agent-studio/integration-identity';
import { planStudioMigration } from '@/services/agent-studio/migration';
import { readStudioMigrationInventory } from '@/services/agent-studio/migration-inventory';
import { buildStudioMcpArguments, mapStudioOutputs } from '@/services/agent-studio/data-mapping';
import { studioFlowInputs, studioFlowOutputs } from '@/services/agent-studio/flow-inputs';
import { reviewStudioUncertainOutcome, type StudioOutcomeResolution } from '@/services/agent-studio/operations';
import { rollbackStudioAgentToLegacy } from '@/services/agent-studio/legacy-rollback';
import { revokeStudioRelease } from '@/services/agent-studio/revocation';
import { extractStudioKnowledgeFile } from '@/services/agent-studio/knowledge-file';

export type AgentApiConnectionSummary = {
  id: string;
  name: string;
  baseUrl: string;
  authType: 'none' | 'api_key' | 'bearer_token' | 'basic_auth';
};

type JsonObject = Record<string, unknown>;

async function resolveStudioModel(workspaceId: string, selected?: string, previous?: unknown) {
  const models = await listWorkspaceConfiguredAiModels(workspaceId);
  const requested = selected || (typeof previous === 'string' ? previous : '') || models[0]?.id;
  if (requested && models.some((model) => model.id === requested)) return requested;
  throw new Error('Selecione um modelo de IA cadastrado e ativo na aba Modelos de IA deste workspace.');
}

async function requireAgent(agentId: string) {
  z.string().uuid().parse(agentId);
  const user = await getCurrentUser();
  if (!user?.activeWorkspaceId) throw new Error('Usuário não autenticado no workspace.');
  if (!await hasWorkspacePermission(user.id, user.activeWorkspaceId, 'automations:manage')) {
    throw new Error('Você não tem permissão para configurar agentes neste workspace.');
  }
  const result = await db.query(
    'SELECT * FROM autopilot_configs WHERE id = $1 AND workspace_id = $2 LIMIT 1',
    [agentId, user.activeWorkspaceId],
  );
  if (!result.rows[0] || (result.rows[0].is_private && result.rows[0].user_id !== user.id)) throw new Error('Agente não encontrado.');
  return { user, row: result.rows[0] as JsonObject, workspaceId: user.activeWorkspaceId };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function studioFromSnapshot(value: unknown): AgentStudioDocument | null {
  return parseStudioSnapshot(value);
}

function baseSnapshot(row: JsonObject): JsonObject {
  return {
    name: row.name,
    ai_model: row.ai_model,
    knowledge_base: row.knowledge_base,
    knowledge_base_documents: row.knowledge_base_documents ?? [],
    knowledge_collections: row.knowledge_collections ?? [],
    enabled_tool_names: row.enabled_tool_names ?? [],
    flow_graph: row.flow_graph ?? null,
    workflow_definition: row.workflow_definition ?? null,
    workflow_builder_mode: row.workflow_builder_mode ?? 'legacy',
    workflow_runtime_v2_mode: row.workflow_runtime_v2_mode ?? 'off',
    is_active: row.is_active ?? false,
    is_private: row.is_private ?? false,
  };
}

async function loadDraftSnapshot(agentId: string, workspaceId: string): Promise<JsonObject | null> {
  const result = await db.query('SELECT snapshot FROM autopilot_config_drafts WHERE config_id = $1 AND workspace_id = $2 LIMIT 1', [agentId, workspaceId]);
  return result.rows[0] ? asObject(result.rows[0].snapshot) : null;
}

export async function getAgentStudioDataAction(agentId: string) {
  try {
    const { row, workspaceId } = await requireAgent(agentId);
    const draft = await loadDraftSnapshot(agentId, workspaceId);
    let document = studioFromSnapshot(draft);
    const version = await db.query(
        'SELECT snapshot FROM autopilot_config_versions WHERE config_id = $1 AND workspace_id = $2 ORDER BY version_number DESC LIMIT 1',
        [agentId, workspaceId],
      );
    const publishedDocument = studioFromSnapshot(version.rows[0]?.snapshot);
    document ??= publishedDocument;
    const inventory = await readStudioMigrationInventory(workspaceId, agentId);
    const migration = planStudioMigration(row, inventory);
    const requiresMigrationReview = !publishedDocument && migration.report.requiresReview;
    document ??= migration.document;
    document = { ...document, aiModel: document.aiModel || String(draft?.ai_model || row.ai_model || '') || undefined };
    return { success: true as const, document, isPublished: Boolean(row.is_active), requiresMigrationReview, migrationReport: requiresMigrationReview ? migration.report : null };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro ao carregar o agente.' };
  }
}

export async function saveAgentStudioDraftAction(agentId: string, input: AgentStudioDocument) {
  try {
    const { user, workspaceId } = await requireAgent(agentId);
    const parsed = AgentStudioDocumentSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: 'O agente possui configurações incompletas ou inválidas.' };
    if (parsed.data.aiModel) await resolveStudioModel(workspaceId, parsed.data.aiModel);
    const document: AgentStudioDocument = await withStudioTransaction(async (client) => {
      const current = await lockStudioDraft(client, workspaceId, agentId, parsed.data.draftRevision || 0);
      const document: AgentStudioDocument = {
      ...parsed.data,
      aiModel: parsed.data.aiModel || String(current.draft.ai_model || current.row.ai_model || '') || undefined,
      id: agentId,
      workspaceId,
      status: 'draft',
      publishedVersion: studioFromSnapshot(current.published)?.publishedVersion ?? null,
      draftRevision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    const snapshot = { ...baseSnapshot(current.row), ...current.draft, name: document.name, ai_model: document.aiModel, agent_studio_document: document,
      agent_studio_legacy_backup: current.draft.agent_studio_legacy_backup || current.published.agent_studio_legacy_backup || (!studioFromSnapshot(current.published) ? planStudioMigration(current.row).backup : undefined) };
    await client.query(
      `INSERT INTO autopilot_config_drafts (config_id, workspace_id, user_id, snapshot, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, timezone('utc', now()))
       ON CONFLICT (config_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id,
         user_id = EXCLUDED.user_id, snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at`,
      [agentId, workspaceId, user.id, JSON.stringify(snapshot)],
    );
      return document;
    });
    revalidatePath('/autopilot');
    revalidatePath(`/autopilot/${agentId}`);
    return { success: true as const, document };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro ao salvar o rascunho.' };
  }
}

const StudioPreviewInputSchema = z.object({
  document: AgentStudioDocumentSchema,
  state: StudioSessionSchema,
  message: z.string().trim().min(1).max(8000),
  messageId: z.string().uuid(),
  history: z.array(z.object({ role: z.enum(['user', 'bot']), text: z.string().max(16000) })).max(40).default([]),
  samples: z.record(z.string().max(100000)).default({}),
  failureStep: z.string().max(200).optional(),
});

async function studioTestKnowledge(document: AgentStudioDocument, row: JsonObject, workspaceId: string, agentId: string) {
  const restored = document.restoredKnowledgeReleaseId ? await loadStudioRelease(workspaceId, agentId, document.restoredKnowledgeReleaseId) : null;
  if (document.restoredKnowledgeReleaseId && !restored) throw new Error('A versão das fontes não está mais disponível.');
  const inlineIds = new Set((document.inlineKnowledge || []).map((source) => source.id));
  const sources = restored?.knowledgeSnapshot || (Array.isArray(row.knowledge_base_documents) ? row.knowledge_base_documents : []);
  const knowledge = sources.filter((source: JsonObject) => !inlineIds.has(String(source.id)) && !['draft', 'archived', 'expired'].includes(String(source.status || 'active')) &&
    (!source.validUntil || Date.parse(String(source.validUntil)) > Date.now()) && (!source.validFrom || Date.parse(String(source.validFrom)) <= Date.now()));
  knowledge.push(...(document.inlineKnowledge || []).map((source) => ({ ...source, collectionIds: [source.id], status: 'active' })));
  return knowledge;
}

async function requireLiveTestAccess(agentId: string) {
  const access = await requireAgent(agentId);
  for (const permission of ['workspace:settings:edit', 'crm:edit', 'inbox:access', 'teams:view']) {
    if (!await hasWorkspacePermission(access.user.id, access.workspaceId, permission)) throw new Error(`O teste real exige a permissão ${permission}.`);
  }
  return access;
}

const StartLiveTestSchema = z.object({
  sessionId: z.string().uuid(), document: AgentStudioDocumentSchema, realExecutionConfirmed: z.literal(true),
  contact: z.object({ name: z.string().trim().min(1).max(150), phone: z.string().regex(/^\+?[\d ()-]{8,25}$/).optional().or(z.literal('')), email: z.string().email().optional().or(z.literal('')) }),
  flowInput: z.record(z.unknown()).default({}),
});

export async function startAgentStudioLiveTestAction(agentId: string, input: unknown) {
  try {
    const { user, row, workspaceId } = await requireLiveTestAccess(agentId);
    if (JSON.stringify(input).length > 900000) throw new Error('Reduza os dados do teste para menos de 900 KB.');
    const parsed = StartLiveTestSchema.safeParse(input);
    if (!parsed.success) throw new Error('Revise os dados do contato e do rascunho antes de iniciar o teste real.');
    const { document, sessionId, contact, flowInput } = parsed.data;
    if (document.id !== agentId || document.workspaceId !== workspaceId) throw new Error('O rascunho não pertence a este agente.');
    const { readStudioValue } = await import('@/services/agent-studio/data-mapping');
    for (const entry of studioFlowInputs(document).filter((entry) => entry.required)) {
      if (readStudioValue(flowInput, entry.key) === undefined) throw new Error(`Informe o dado de entrada “${entry.label}” no contexto do teste.`);
    }
    const steps = document.resolveStage.procedures.filter((p) => p.status !== 'archived').flatMap((p) => p.steps);
    const connections = await listNexusCredentialSummaries(workspaceId);
    const referencedConnectionIds = [...new Set(steps.map((step) => step.httpRequest?.connectionId).filter((id): id is string => Boolean(id)))];
    const connectionFingerprints: Record<string, string> = {};
    for (const id of referencedConnectionIds) {
      const connection = connections.find((connection) => connection.id === id && connection.metadata.kind === 'agent_http');
      if (!connection) throw new Error('Uma conexão do rascunho não está disponível neste workspace.');
      connectionFingerprints[id] = studioConnectionFingerprint(connection);
    }
    const mcpServerToolFingerprints: Record<string, string> = {};
    for (const step of steps) if (step.mcpTool) {
      const resolved = await resolveStudioMcpTool(workspaceId, step.mcpTool);
      mcpServerToolFingerprints[step.mcpTool.qualifiedToolName] = resolved.fingerprint;
    }
    const release: AgentReleaseManifest = { releaseId: sessionId, agentId, workspaceId, version: 1, agentSnapshot: document,
      publishedProcedures: document.resolveStage.procedures.filter((p) => p.status !== 'archived'), runtimeVersion: 'studio-v1',
      runtimeConfig: { aiModel: await resolveStudioModel(workspaceId, document.aiModel, row.ai_model) }, knowledgeSnapshot: await studioTestKnowledge(document, row, workspaceId, agentId),
      referencedConnectionIds, connectionFingerprints, mcpServerToolFingerprints, createdAt: new Date().toISOString(), publishedByUserId: user.id };
    const { getMonthlyChatLimitStatus } = await import('@/lib/billing-logic');
    if (!(await getMonthlyChatLimitStatus(workspaceId)).allowed) throw new Error('O workspace atingiu o limite de atendimentos ou está com o plano bloqueado.');
    const { createLiveTest, readLiveTestView } = await import('@/services/agent-studio/live-test-store');
    const scope = { workspaceId, agentId, userId: user.id, sessionId };
    await createLiveTest(scope, release, contact, flowInput);
    return { success: true as const, view: await readLiveTestView(scope) };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Não foi possível iniciar o teste real.' }; }
}

export async function getAgentStudioLiveTestAction(agentId: string, sessionId: string) {
  try {
    const { user, workspaceId } = await requireAgent(agentId);
    z.string().uuid().parse(sessionId);
    const { readLiveTestView } = await import('@/services/agent-studio/live-test-store');
    return { success: true as const, view: await readLiveTestView({ workspaceId, agentId, userId: user.id, sessionId }) };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Não foi possível carregar o teste.' }; }
}

export async function sendAgentStudioLiveTestAction(agentId: string, formData: FormData) {
  try {
    const { user, workspaceId, row } = await requireLiveTestAccess(agentId);
    const sessionId = z.string().uuid().parse(formData.get('sessionId'));
    const messageId = z.string().uuid().parse(formData.get('messageId'));
    const file = formData.get('file');
    const message = z.string().trim().min(1).max(8000).parse(formData.get('message') || (file instanceof File ? `Arquivo: ${file.name}` : ''));
    const { sendLiveTestMessage, readLiveTestView } = await import('@/services/agent-studio/live-test');
    const scope = { workspaceId, agentId, userId: user.id, sessionId };
    await sendLiveTestMessage(scope, row as unknown as AutopilotConfig, messageId, message, file instanceof File ? { file } : undefined);
    return { success: true as const, view: await readLiveTestView(scope) };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'O teste foi interrompido. Consulte o histórico antes de repetir a operação.' }; }
}

/** Calls the configured model without publishing a draft or executing customer actions. */
export async function testAgentStudioConversationAction(agentId: string, input: unknown) {
  try {
    const { row, workspaceId } = await requireAgent(agentId);
    if (JSON.stringify(input).length > 900000) throw new Error('O teste excedeu o tamanho permitido. Reduza os dados ou recomece a conversa.');
    const parsed = StudioPreviewInputSchema.safeParse(input);
    if (!parsed.success) throw new Error('Os dados do teste estão inválidos. Revise o rascunho e recomece a conversa.');
    const { document, state, message, messageId, history, samples, failureStep } = parsed.data;
    if (document.id !== agentId || document.workspaceId !== workspaceId || state.agentId !== agentId || state.releaseId !== 'simulation') {
      throw new Error('A sessão de teste não pertence a este agente.');
    }
    const knowledgeSnapshot = await studioTestKnowledge(document, row, workspaceId, agentId);
    const { runStudioConversation } = await import('@/services/agent-studio/runtime');
    const model = await resolveStudioModel(workspaceId, document.aiModel, row.ai_model);
    const result = await runStudioConversation({
      release: { releaseId: 'simulation', agentId, workspaceId, version: 0, agentSnapshot: document,
        publishedProcedures: document.resolveStage.procedures, runtimeVersion: 'studio-v1', runtimeConfig: { aiModel: model },
        knowledgeSnapshot, referencedConnectionIds: [], mcpServerToolFingerprints: {}, createdAt: new Date().toISOString() },
      config: row as unknown as AutopilotConfig, state, message, messageId, chatId: `studio-preview:${state.id}`,
      contact: { id: 'studio-preview', workspace_id: workspaceId, name: 'Cliente de teste' },
      chatHistory: history.map((entry) => `${entry.role === 'user' ? 'Cliente' : 'Agente'}: ${entry.text}`).join('\n'),
      preview: { samples, failureStep }, checkpoint: async () => {}, assertCurrent: async () => {}, runNative: async () => {},
    });
    return { success: true as const, ...result, model };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Não foi possível conversar com a IA. Tente novamente.' };
  }
}

export async function importStudioKnowledgeFileAction(agentId: string, formData: FormData) {
  try {
    await requireAgent(agentId);
    const file = formData.get('file');
    if (!(file instanceof File)) throw new Error('Selecione um arquivo válido.');
    const extracted = await extractStudioKnowledgeFile(file);
    return { success: true as const, source: { id: `source_${crypto.randomUUID()}`, sourceType: 'file' as const, ...extracted } };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Não foi possível importar o arquivo.' }; }
}

/** Read-only: restoring is an explicit draft edit; this never republishes a release. */
export async function getStudioVersionForDraftAction(agentId: string, releaseId: string) {
  try {
    const { workspaceId } = await requireAgent(agentId);
    z.string().uuid().parse(releaseId);
    const release = await loadStudioRelease(workspaceId, agentId, releaseId);
    if (!release) throw new Error('Versão não encontrada.');
    return { success: true as const, document: { ...release.agentSnapshot, aiModel: release.agentSnapshot.aiModel || release.runtimeConfig?.aiModel || undefined, restoredKnowledgeReleaseId: release.releaseId } };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Não foi possível recuperar a versão.' }; }
}

export async function publishAgentStudioAction(agentId: string, input: AgentStudioDocument) {
  try {
    const { user, workspaceId, row } = await requireAgent(agentId);
    const parsed = AgentStudioDocumentSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: 'O agente possui configurações inválidas.' };
    const aiModel = await resolveStudioModel(workspaceId, parsed.data.aiModel, row.ai_model);
    const validation = validateAgentForPublication(parsed.data);
    if (!validation.valid) return { success: false as const, error: 'Corrija as pendências antes de publicar.', issues: validation.issues };
    // Fail before publishing if the deployment cannot persist encrypted customer state.
    try { sealStudioSession({ workspaceId, agentId, chatId: 'publication-readiness-check' }, createStudioSession(agentId, 'readiness-check', 'readiness-check')); }
    catch { throw new Error('Configure a chave de criptografia do ambiente antes de publicar agentes.'); }
    const historyReady = await db.query("SELECT to_regclass('public.agent_studio_sessions') AS ready");
    if (!historyReady.rows[0]?.ready) throw new Error('A atualização do banco do Estúdio ainda não foi aplicada. Solicite ao administrador a migração agent_studio_session_history antes de publicar.');

    // Read-only dependency validation happens before holding any database lock.
    const tools = await Promise.all(parsed.data.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').flatMap((procedure) => procedure.steps)
      .filter((step) => step.mcpTool).map((step) => resolveStudioMcpTool(workspaceId, step.mcpTool!)));
    const connections = await listNexusCredentialSummaries(workspaceId);
    const resources = await listStudioResourcesAction(agentId);
    if (!resources.success) throw new Error(resources.error);
    const teamNames = new Set(resources.teams.flatMap((team) => [team.name, team.id]));
    if (!teamNames.has(parsed.data.concludeStage.handoffTeam)) throw new Error('A equipe de transferência não existe neste workspace.');
    for (const step of parsed.data.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').flatMap((procedure) => procedure.steps)) {
      if (step.mcpTool) {
        const tool = tools.find((entry) => entry.tool.qualifiedName === step.mcpTool!.qualifiedToolName)?.tool;
        const required = Array.isArray(tool?.inputSchema?.required) ? tool.inputSchema.required.map(String) : [];
        const supplied = new Set(step.mcpTool.argumentMappings.map((mapping) => mapping.argumentName.split('.')[0]));
        if (required.some((name) => !supplied.has(name))) throw new Error(`Preencha todos os dados obrigatórios da ferramenta em “${step.title}”: ${required.filter((name) => !supplied.has(name)).join(', ')}.`);
        if (tool?.inputSchema && step.mcpTool.argumentMappings.every((mapping) => mapping.sourceType === 'static_value')) {
          const args = buildStudioMcpArguments(step.mcpTool, { values: {} });
          if (!validateSchema(args, { jsonSchema: tool.inputSchema }).valid) throw new Error(`Os valores fixos de “${step.title}” não atendem ao contrato da ferramenta MCP.`);
        }
      }
      if (step.httpRequest?.connectionId && !connections.some((connection) => connection.id === step.httpRequest!.connectionId && connection.metadata.kind === 'agent_http')) {
        throw new Error(`Selecione uma conexão válida na etapa “${step.title}”.`);
      }
      for (const team of [step.handoffTeam, step.onFailHandoffTeam, step.mcpTool?.fallbackHandoffTeam, ...(step.decisionBranches || []).filter((branch) => branch.actionType === 'handoff').map((branch) => branch.actionValue)].filter(Boolean)) {
        if (!teamNames.has(team!)) throw new Error(`Revise a equipe da etapa “${step.title}”.`);
      }
      if (['add_tag', 'remove_tag'].includes(step.nativeActionType || '') && !resources.tags.some((tag) => tag.id === step.nativeActionPayload?.tagId)) throw new Error(`Selecione uma etiqueta válida em “${step.title}”.`);
      for (const mapping of step.nativeDataMappings || []) if (!resources.fields.some((field) => field.id === mapping.apiField)) throw new Error(`Selecione um campo de CRM válido em “${step.title}”.`);
    }
    const published = await withStudioTransaction(async (client) => {
    const current = await lockStudioDraft(client, workspaceId, agentId, parsed.data.draftRevision || 0);
    if (!studioFromSnapshot(current.published)) {
      const migration = planStudioMigration(current.row).report;
      if (migration.requiresReview && (parsed.data.migrationReview?.sourceHash !== migration.sourceHash || migration.items.some((item) => item.status === 'review' && !parsed.data.migrationReview?.acknowledgedKeys.includes(item.key)))) {
        throw new Error('Revise todos os pontos da configuração anterior antes de publicar. Se ela mudou, recarregue o relatório de transição.');
      }
    }
    const usedConnections = connections.filter((connection) => parsed.data.resolveStage.procedures.some((procedure) => procedure.status !== 'archived' && procedure.steps.some((step) => step.httpRequest?.connectionId === connection.id)));
    if (usedConnections.length) {
      const currentConnections = await client.query('SELECT id, credential_type, metadata FROM nexus_credentials WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR SHARE', [workspaceId, usedConnections.map((connection) => connection.id)]);
      for (const connection of usedConnections) {
        const row = currentConnections.rows.find((row) => row.id === connection.id);
        if (!row || studioConnectionFingerprint({ id: row.id, type: row.credential_type, metadata: row.metadata }) !== studioConnectionFingerprint(connection)) throw new Error('Uma conexão mudou durante a publicação. Revise e tente novamente.');
      }
    }
    if (tools.length) {
      const currentMcp = await client.query("SELECT config FROM workspace_integrations WHERE workspace_id = $1 AND provider = 'mcp' FOR SHARE", [workspaceId]);
      for (const prepared of tools) {
        const server = currentMcp.rows[0]?.config?.servers?.find((server: { id: string }) => server.id === prepared.server.id);
        const tool = server?.tools?.find((tool: { qualifiedName: string }) => tool.qualifiedName === prepared.tool.qualifiedName);
        if (!server?.isActive || !tool || studioMcpFingerprint(tool, server) !== prepared.fingerprint) throw new Error('Uma ferramenta MCP mudou durante a publicação. Sincronize e revise a etapa.');
      }
    }
    const teamId = (value: string | undefined) => value ? resources.teams.find((team) => team.id === value || team.name === value)?.id || value : value;
    const normalized = { ...parsed.data, concludeStage: { ...parsed.data.concludeStage, handoffTeam: teamId(parsed.data.concludeStage.handoffTeam)! },
      resolveStage: { ...parsed.data.resolveStage, procedures: parsed.data.resolveStage.procedures.map((procedure) => ({ ...procedure, steps: procedure.steps.map((step) => ({ ...step,
        handoffTeam: teamId(step.handoffTeam), onFailHandoffTeam: teamId(step.onFailHandoffTeam),
        mcpTool: step.mcpTool ? { ...step.mcpTool, fallbackHandoffTeam: teamId(step.mcpTool.fallbackHandoffTeam) } : undefined,
        decisionBranches: step.decisionBranches?.map((branch) => branch.actionType === 'handoff' ? { ...branch, actionValue: teamId(branch.actionValue) } : branch),
      })) })) } };
    const usedTeamIds = new Set([normalized.concludeStage.handoffTeam, ...normalized.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').flatMap((procedure) => procedure.steps.flatMap((step) => [step.handoffTeam, step.onFailHandoffTeam, step.mcpTool?.fallbackHandoffTeam, ...(step.decisionBranches || []).filter((branch) => branch.actionType === 'handoff').map((branch) => branch.actionValue)]))].filter(Boolean));
    const currentTeams = await client.query('SELECT id FROM teams WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR SHARE', [workspaceId, [...usedTeamIds]]);
    if (currentTeams.rows.length !== usedTeamIds.size) throw new Error('Uma equipe deixou de estar disponível durante a publicação.');
    const activeSteps = normalized.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').flatMap((procedure) => procedure.steps);
    const tagIds = [...new Set(activeSteps.filter((step) => ['add_tag', 'remove_tag'].includes(step.nativeActionType || '')).map((step) => String(step.nativeActionPayload?.tagId)))];
    if (tagIds.length) {
      const currentTags = await client.query('SELECT id FROM tags WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR SHARE', [workspaceId, tagIds]);
      if (currentTags.rows.length !== tagIds.length) throw new Error('Uma etiqueta deixou de estar disponível durante a publicação.');
    }
    const fieldIds = [...new Set(activeSteps.flatMap((step) => (step.nativeDataMappings || []).map((mapping) => mapping.apiField)))];
    if (fieldIds.length) {
      const currentFields = await client.query('SELECT id, type FROM custom_field_definitions WHERE workspace_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR SHARE', [workspaceId, fieldIds]);
      if (currentFields.rows.length !== fieldIds.length || currentFields.rows.some((field) => resources.fields.find((prepared) => prepared.id === field.id)?.type !== field.type)) throw new Error('Um campo de CRM mudou durante a publicação. Revise os mapeamentos.');
    }
    const nextVersion = current.nextVersion;
    const selectedCollections = new Set([...parsed.data.resolveStage.knowledgeCollectionIds, ...parsed.data.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').flatMap((procedure) => procedure.steps.map((step) => step.knowledgeCollectionId).filter((id): id is string => Boolean(id)))]);
    let restoredKnowledge: Record<string, unknown>[] | undefined;
    if (parsed.data.restoredKnowledgeReleaseId) {
      const restored = await client.query(`SELECT v.snapshot->'agent_release_manifest' AS release,
        EXISTS (SELECT 1 FROM agent_studio_release_revocations r WHERE r.workspace_id = v.workspace_id
          AND r.agent_id = v.config_id AND r.release_id::text = v.snapshot->'agent_release_manifest'->>'releaseId') AS revoked,
        (SELECT array_agg(k.source_id) FROM agent_studio_knowledge_revocations k WHERE k.workspace_id = v.workspace_id
          AND k.agent_id = v.config_id AND k.release_id::text = v.snapshot->'agent_release_manifest'->>'releaseId') AS revoked_sources
        FROM autopilot_config_versions v WHERE v.workspace_id = $1 AND v.config_id = $2
          AND v.snapshot->'agent_release_manifest'->>'releaseId' = $3`, [workspaceId, agentId, parsed.data.restoredKnowledgeReleaseId]);
      if (!restored.rows[0]?.release) throw new Error('A versão de conhecimento recuperada não está disponível neste agente.');
      if (restored.rows[0].revoked) throw new Error('O conhecimento desta versão foi revogado e não pode ser republicado.');
      const revokedSources = new Set((restored.rows[0].revoked_sources || []).map(String));
      restoredKnowledge = (restored.rows[0].release.knowledgeSnapshot || []).filter((source: Record<string, unknown>) => !revokedSources.has(String(source.id || '')));
    }
    const currentKnowledgeDocuments = Array.isArray(current.row.knowledge_base_documents) ? current.row.knowledge_base_documents as Record<string, unknown>[] : [];
    const knownCollections = new Set((Array.isArray(current.row.knowledge_collections) ? current.row.knowledge_collections : []).map((collection: { id: string }) => collection.id));
    for (const source of currentKnowledgeDocuments) if (source.id) knownCollections.add(String(source.id));
    for (const source of restoredKnowledge || []) if (Array.isArray(source.collectionIds)) for (const id of source.collectionIds) knownCollections.add(String(id));
    for (const source of parsed.data.inlineKnowledge || []) knownCollections.add(source.id);
    for (const id of selectedCollections) if (!knownCollections.has(id)) throw new Error('Uma base selecionada não está mais disponível. Revise o conhecimento autorizado.');
    const inlineIds = new Set((parsed.data.inlineKnowledge || []).map((source) => source.id));
    const knowledgeSnapshot = (restoredKnowledge || currentKnowledgeDocuments).filter((item: Record<string, unknown>) =>
      !inlineIds.has(String(item.id)) &&
      !['draft', 'archived', 'expired'].includes(String(item.status || 'active')) &&
      (selectedCollections.has(String(item.id)) || (Array.isArray(item.collectionIds) && item.collectionIds.some((id: string) => selectedCollections.has(id)))) &&
      String(item.content || '').trim() && (!item.validUntil || Date.parse(String(item.validUntil)) > Date.now()) && (!item.validFrom || Date.parse(String(item.validFrom)) <= Date.now()));
    for (const source of parsed.data.inlineKnowledge || []) if (selectedCollections.has(source.id)) {
      if (!source.name.trim() || !source.content.trim()) throw new Error('Preencha o título e o conteúdo das fontes de conhecimento selecionadas.');
      knowledgeSnapshot.push({ ...source, collectionIds: [source.id], status: 'active' });
    }
    const revisionTimestamp = new Date().toISOString();
    for (const source of knowledgeSnapshot) {
      source.contentHash = createHash('sha256').update(String(source.content || '')).digest('hex');
      source.revisionPublishedAt = revisionTimestamp;
    }
    for (const id of selectedCollections) if (!knowledgeSnapshot.some((item: { id?: string; collectionIds?: string[] }) => item.id === id || item.collectionIds?.includes(id))) throw new Error('Uma base ou documento selecionado não possui conteúdo ativo para publicar.');
    const document: AgentStudioDocument = {
      ...normalized,
      aiModel,
      id: agentId,
      workspaceId,
      status: 'published',
      publishedVersion: nextVersion,
      draftRevision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      resolveStage: { ...normalized.resolveStage, procedures: normalized.resolveStage.procedures.map((procedure) => procedure.status === 'archived' ? procedure : { ...procedure, status: 'published', publishedVersion: nextVersion }) },
    };
    const referencedConnectionIds = [...new Set(document.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived').flatMap((procedure) => procedure.steps)
      .map((step) => step.httpRequest?.connectionId).filter((id): id is string => Boolean(id)))];
    const manifest: AgentReleaseManifest = {
      releaseId: crypto.randomUUID(),
      agentId,
      workspaceId,
      version: nextVersion,
      agentSnapshot: document,
      publishedProcedures: document.resolveStage.procedures.filter((procedure) => procedure.status !== 'archived'),
      runtimeVersion: 'studio-v1',
      knowledgeSnapshot,
      runtimeConfig: { aiModel: document.aiModel! },
      referencedConnectionIds,
      connectionFingerprints: Object.fromEntries(usedConnections.map((connection) => [connection.id, studioConnectionFingerprint(connection)])),
      mcpServerToolFingerprints: Object.fromEntries(tools.map((tool) => [tool.tool.qualifiedName, tool.fingerprint])),
      createdAt: new Date().toISOString(),
      publishedByUserId: user.id,
    };
    const snapshot = {
      ...baseSnapshot(current.row),
      ...current.draft,
      name: document.name,
      ai_model: document.aiModel,
      is_active: true,
      agent_studio_document: document,
      agent_release_manifest: manifest,
      agent_studio_legacy_backup: current.draft.agent_studio_legacy_backup || current.published.agent_studio_legacy_backup || (!studioFromSnapshot(current.published) ? planStudioMigration(current.row).backup : undefined),
    };
    await client.query(
      'UPDATE autopilot_configs SET name = $3, ai_model = $4, is_active = true, updated_at = NOW() WHERE id = $1 AND workspace_id = $2',
      [agentId, workspaceId, document.name, document.aiModel],
    );
    await client.query(
      `INSERT INTO autopilot_config_versions (config_id, workspace_id, user_id, version_number, label, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [agentId, workspaceId, user.id, nextVersion, `Estúdio de IA v${nextVersion}`, JSON.stringify(snapshot)],
    );
    await client.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1 AND workspace_id = $2', [agentId, workspaceId]);
    return { document, manifest, publishedVersion: nextVersion };
    });
    revalidatePath('/autopilot');
    revalidatePath(`/autopilot/${agentId}`);
    return { success: true as const, ...published };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro ao publicar o agente.' };
  }
}

export async function createNewAiAgentAction(input: {
  name: string; objective: string; serviceType: AgentServiceType; language?: string;
  isPrivate?: boolean; template?: 'blank' | 'invoice'; creationId?: string; aiModel?: string;
}) {
  try {
    const user = await getCurrentUser();
    if (!user?.activeWorkspaceId) return { success: false as const, error: 'Usuário não autenticado.' };
    if (!await hasWorkspacePermission(user.id, user.activeWorkspaceId, 'automations:manage')) throw new Error('Você não tem permissão para criar agentes.');
    const values = z.object({
      name: z.string().trim().min(1).max(160), objective: z.string().trim().min(1).max(4000),
      serviceType: z.enum(['support', 'sales', 'billing', 'scheduling', 'custom']),
      language: z.enum(['pt-BR', 'en', 'es']).default('pt-BR'), isPrivate: z.boolean().default(false),
      template: z.enum(['blank', 'invoice']).default('blank'), creationId: z.string().uuid().optional(),
      aiModel: z.string().trim().min(1).max(200).optional(),
    }).parse(input);
    const workspaceId = user.activeWorkspaceId, agentId = values.creationId || crypto.randomUUID();
    const aiModel = await resolveStudioModel(workspaceId, values.aiModel);
    const document = await withStudioTransaction(async (client) => {
      // Serialize the first-agent primary assignment, and make retries recover the same draft.
      const workspace = await client.query('SELECT id FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
      if (!workspace.rows.length) throw new Error('Workspace indisponível.');
      const existing = await client.query('SELECT user_id FROM autopilot_configs WHERE id = $1 AND workspace_id = $2', [agentId, workspaceId]);
      if (existing.rows.length) {
        if (existing.rows[0].user_id !== user.id) throw new Error('Identificador de criação indisponível.');
        const draft = await client.query('SELECT snapshot FROM autopilot_config_drafts WHERE config_id = $1 AND workspace_id = $2', [agentId, workspaceId]);
        const recovered = parseStudioSnapshot(draft.rows[0]?.snapshot);
        if (!recovered) throw new Error('O agente já existe. Abra-o na lista para continuar.');
        return recovered;
      }
      const count = await client.query('SELECT count(*)::int AS total FROM autopilot_configs WHERE workspace_id = $1', [workspaceId]);
      const document = (values.template === 'invoice' ? createInvoiceAgentStudioTemplate : createDefaultAgentStudioDocument)(agentId, workspaceId, values.name, values.serviceType);
      document.objective = values.objective; document.language = values.language; document.draftRevision = 1;
      document.aiModel = aiModel;
      document.concludeStage.handoffTeam = '';
      await client.query(`INSERT INTO autopilot_configs (id, workspace_id, user_id, name, is_primary, is_private, is_active, ai_model)
        VALUES ($1, $2, $3, $4, $5, $6, false, $7)`, [agentId, workspaceId, user.id, values.name, count.rows[0].total === 0, values.isPrivate, aiModel]);
      await client.query(`INSERT INTO autopilot_config_drafts (config_id, workspace_id, user_id, snapshot, updated_at)
        VALUES ($1, $2, $3, $4::jsonb, NOW())`, [agentId, workspaceId, user.id, JSON.stringify({ name: values.name, ai_model: aiModel, is_active: false, is_private: values.isPrivate, agent_studio_document: document })]);
      return document;
    });
    revalidatePath('/autopilot');
    return { success: true as const, agentId, document };
  } catch (error) {
    return { success: false as const, error: error instanceof z.ZodError ? 'Preencha nome, objetivo, idioma e área de atendimento.' : error instanceof Error ? error.message : 'Erro ao criar o agente.' };
  }
}

export async function listAgentApiConnectionsAction(agentId: string) {
  try {
    const { workspaceId } = await requireAgent(agentId);
    const credentials = await listNexusCredentialSummaries(workspaceId);
    const connections: AgentApiConnectionSummary[] = credentials
      .filter((credential) => credential.metadata.kind === 'agent_http')
      .map((credential) => ({
        id: credential.id,
        name: credential.name,
        baseUrl: String(credential.metadata.baseUrl || ''),
        authType: ['api_key', 'bearer_token', 'basic_auth'].includes(String(credential.metadata.authType))
          ? credential.metadata.authType as AgentApiConnectionSummary['authType']
          : 'none',
      }));
    return { success: true as const, connections };
  } catch (error) {
    return { success: false as const, connections: [], error: error instanceof Error ? error.message : 'Erro ao listar conexões.' };
  }
}

/** Validates a fictitious payload against the locally synchronized contract; never contacts the MCP server. */
export async function validateStudioMcpSimulationAction(agentId: string, stepInput: McpToolStepConfig, contextInput: unknown, sample: unknown) {
  try {
    const { workspaceId } = await requireAgent(agentId);
    if (JSON.stringify({ stepInput, contextInput, sample }).length > 200_000) throw new Error('Reduza o tamanho dos dados fictícios.');
    const step = McpToolStepConfigSchema.parse(stepInput);
    const context = z.object({ values: z.record(z.unknown()).default({}), contact: z.record(z.unknown()).default({}), input: z.record(z.unknown()).default({}) }).strict().parse(contextInput);
    const { tool } = await resolveStudioMcpTool(workspaceId, step);
    const args = buildStudioMcpArguments(step, context);
    if (tool.inputSchema && !validateSchema(args, { jsonSchema: tool.inputSchema }).valid) throw new Error('Os dados de entrada simulados não correspondem ao contrato MCP.');
    if (tool.outputSchema && !validateSchema(sample, { jsonSchema: tool.outputSchema }).valid) throw new Error('A resposta fictícia não corresponde ao contrato de saída MCP.');
    return { success: true as const, values: mapStudioOutputs(sample, step.outputMappings) };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'A simulação não pôde ser validada.' }; }
}

export async function saveAgentApiConnectionAction(agentId: string, input: {
  name: string;
  baseUrl: string;
  authType: AgentApiConnectionSummary['authType'];
  apiKeyHeader?: string;
  apiKeyValue?: string;
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
}) {
  try {
    const { user, workspaceId } = await requireAgent(agentId);
    if (!await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) {
      throw new Error('Você não tem permissão para administrar conexões.');
    }
    const connection = z.object({
      name: z.string().trim().min(1).max(160),
      baseUrl: z.string().url().max(2048),
      authType: z.enum(['none', 'api_key', 'bearer_token', 'basic_auth']),
      apiKeyHeader: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/).optional(),
      apiKeyValue: z.string().max(16000).optional(),
      bearerToken: z.string().max(16000).optional(),
      basicUsername: z.string().max(1000).optional(),
      basicPassword: z.string().max(16000).optional(),
    }).parse(input);
    if ((connection.authType === 'api_key' && !connection.apiKeyValue?.trim()) ||
      (connection.authType === 'bearer_token' && !connection.bearerToken?.trim()) ||
      (connection.authType === 'basic_auth' && (!connection.basicUsername?.trim() || !connection.basicPassword))) {
      throw new Error('Preencha os dados de autenticação da conexão.');
    }
    const target = await resolveSafeAutopilotWebhookTarget(connection.baseUrl);
    const baseUrl = target.url.toString();
    const credentialType: NexusCredentialType = input.authType === 'bearer_token'
      ? 'bearer'
      : input.authType === 'basic_auth'
        ? 'basic'
        : 'api_key';
    const saved = await saveNexusCredential({
      workspaceId,
      userId: user.id,
      name: connection.name,
      type: credentialType,
      payload: {
        name: connection.apiKeyHeader || 'X-API-Key',
        value: connection.apiKeyValue || '',
        placement: 'header',
        token: connection.bearerToken || '',
        username: connection.basicUsername || '',
        password: connection.basicPassword || '',
      },
      metadata: { kind: 'agent_http', baseUrl, authType: input.authType },
    });
    return { success: true as const, connection: { id: saved.id, name: saved.name, baseUrl, authType: input.authType } };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro ao salvar conexão de API.' };
  }
}

function discoverFields(value: unknown, prefix = '', output: Array<{ path: string; sample: string; label: string }> = [], depth = 0) {
  if (output.length >= 20 || depth > 10) return output;
  if (Array.isArray(value)) output.push({ path: prefix || '$', sample: `${value.length} item(ns)`, label: prefix.split('.').at(-1) || 'Lista' });
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as JsonObject)) {
      if (output.length >= 20) break;
      discoverFields(child, prefix ? `${prefix}.${key}` : key, output, depth + 1);
    }
  } else if (prefix) output.push({ path: prefix, sample: String(value ?? '').slice(0, 100), label: prefix.split('.').at(-1) || prefix });
  return output;
}

const IntegrationTestInputSchema = z.object({
  values: z.record(z.unknown()).default({}),
  contact: z.record(z.unknown()).default({}),
  input: z.record(z.unknown()).default({}),
  realExecutionConfirmed: z.literal(true),
});

export async function testHttpRequestAction(agentId: string, config: HttpRequestStepConfig, testInput?: unknown) {
  try {
    const { user, workspaceId } = await requireAgent(agentId);
    if (!await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) throw new Error('Você não tem permissão para testar integrações reais.');
    const parsed = IntegrationTestInputSchema.safeParse(testInput);
    if (!parsed.success) throw new Error('Confirme a execução real e informe os dados de teste antes de continuar.');
    const result = await executeStudioHttp({ workspaceId, config, context: parsed.data, confirmed: true });
    return { success: true, ...result, discoveredFields: discoverFields(result.response) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro ao testar a chamada HTTP.' };
  }
}

export async function testMcpToolAction(agentId: string, config: McpToolStepConfig, testInput?: unknown) {
  try {
    const { user, workspaceId } = await requireAgent(agentId);
    if (!await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) throw new Error('Você não tem permissão para testar integrações reais.');
    const parsed = IntegrationTestInputSchema.safeParse(testInput);
    if (!parsed.success) throw new Error('Confirme a execução real e informe os dados de teste antes de continuar.');
    const result = await executeStudioMcp({ workspaceId, config, context: parsed.data, confirmed: true });
    return { success: true as const, executedTool: config.friendlyToolName, ...result };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Erro ao executar a ferramenta MCP.' };
  }
}

/** Authoring catalog deliberately excludes headers, environment and local commands. */
export async function listAgentMcpServersAction(agentId: string) {
  try {
    const { workspaceId } = await requireAgent(agentId);
    const config = await getMcpWorkspaceConfig(workspaceId);
    return { success: true as const, servers: config.servers.map((server) => ({
      id: server.id, name: server.name, transport: server.transport, isActive: server.isActive,
      syncedAt: server.syncedAt, healthStatus: server.healthStatus, tools: server.tools || [],
    })) };
  } catch (error) {
    return { success: false as const, servers: [], error: error instanceof Error ? error.message : 'Erro ao carregar ferramentas.' };
  }
}

export async function listStudioResourcesAction(agentId: string) {
  try {
    const { workspaceId } = await requireAgent(agentId);
    const [teams, tags, fields] = await Promise.all([
      db.query('SELECT id, name FROM teams WHERE workspace_id = $1 ORDER BY name', [workspaceId]),
      db.query('SELECT id, label AS name FROM tags WHERE workspace_id = $1 ORDER BY label', [workspaceId]),
      db.query('SELECT id, label AS name, type FROM custom_field_definitions WHERE workspace_id = $1 ORDER BY label', [workspaceId]),
    ]);
    return { success: true as const, teams: teams.rows as Array<{ id: string; name: string }>, tags: tags.rows as Array<{ id: string; name: string }>, fields: fields.rows as Array<{ id: string; name: string; type: string }> };
  } catch (error) { return { success: false as const, teams: [], tags: [], fields: [], error: error instanceof Error ? error.message : 'Não foi possível carregar os recursos.' }; }
}

export async function getStudioResultsAction(agentId: string, periodDays = 30) {
  try {
    const { workspaceId } = await requireAgent(agentId);
    const [metrics, releases, current] = await Promise.all([
      readStudioResults(workspaceId, agentId, periodDays),
      db.query(`SELECT v.version_number AS version, v.snapshot->'agent_release_manifest' AS release,
        EXISTS (SELECT 1 FROM agent_studio_release_revocations r WHERE r.workspace_id = v.workspace_id
          AND r.agent_id = v.config_id AND r.release_id::text = v.snapshot->'agent_release_manifest'->>'releaseId') AS revoked,
        (SELECT array_agg(k.source_id) FROM agent_studio_knowledge_revocations k WHERE k.workspace_id = v.workspace_id
          AND k.agent_id = v.config_id AND k.release_id::text = v.snapshot->'agent_release_manifest'->>'releaseId') AS revoked_sources
        FROM autopilot_config_versions v WHERE v.workspace_id = $1 AND v.config_id = $2 AND v.snapshot ? 'agent_release_manifest'
        ORDER BY v.version_number DESC LIMIT 30`, [workspaceId, agentId]),
      db.query(`SELECT snapshot ? 'agent_release_manifest' AS "isStudio",
        snapshot ? 'agent_studio_legacy_backup' AS "hasLegacyBackup"
        FROM autopilot_config_versions WHERE workspace_id = $1 AND config_id = $2 ORDER BY version_number DESC LIMIT 1`, [workspaceId, agentId]),
    ]);
    const active = current.rows[0];
    return { success: true as const, ...metrics, releases: releases.rows.map((row) => {
      const revokedSources = new Set((row.revoked_sources || []).map(String));
      return { version: Number(row.version), id: String(row.release.releaseId), createdAt: String(row.release.createdAt), revoked: Boolean(row.revoked),
        knowledgeSources: (row.release.knowledgeSnapshot || []).flatMap((source: Record<string, unknown>) => source.id
          ? [{ id: String(source.id), name: String(source.name || source.id), revoked: revokedSources.has(String(source.id)) }] : []) };
    }),
      currentRuntime: active?.isStudio ? 'studio' as const : 'legacy' as const, canRollbackToLegacy: Boolean(active?.isStudio && active?.hasLegacyBackup) };
  } catch (error) { return { success: false as const, sessions: [], releases: [], currentRuntime: 'unknown' as const, canRollbackToLegacy: false,
    error: error instanceof Error ? error.message : 'Não foi possível carregar os resultados.' }; }
}

export async function rollbackAgentStudioToLegacyAction(agentId: string, confirmation: string) {
  try {
    if (confirmation !== 'VOLTAR AO MODO ANTERIOR') throw new Error('Digite a frase de confirmação exatamente como exibida.');
    const { user, workspaceId } = await requireAgent(agentId);
    if (!await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) throw new Error('Você não tem permissão para alterar o runtime deste agente.');
    const result = await withStudioTransaction((client) => rollbackStudioAgentToLegacy(client, { workspaceId, agentId, userId: user.id }));
    revalidatePath('/autopilot'); revalidatePath(`/autopilot/${agentId}`);
    return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Não foi possível voltar ao modo anterior.' }; }
}

export async function revokeAgentStudioReleaseAction(agentId: string, input: { releaseId: string; sourceId?: string; reason: string; confirmation: string }) {
  try {
    const expected = input.sourceId ? 'REVOGAR FONTE' : 'REVOGAR VERSÃO';
    if (input.confirmation !== expected) throw new Error(`Digite ${expected} exatamente como exibido.`);
    const { user, workspaceId } = await requireAgent(agentId);
    if (!await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) throw new Error('Você não tem permissão para revogar publicações.');
    const result = await withStudioTransaction((client) => revokeStudioRelease(client, { workspaceId, agentId, releaseId: input.releaseId,
      sourceId: input.sourceId, reason: input.reason, userId: user.id }));
    revalidatePath('/autopilot'); revalidatePath(`/autopilot/${agentId}`);
    return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Não foi possível revogar esta publicação.' }; }
}

export async function reviewStudioOutcomeAction(agentId: string, sessionId: string, resolution: StudioOutcomeResolution) {
  try {
    z.string().uuid().parse(sessionId);
    const { user, workspaceId } = await requireAgent(agentId);
    if (!await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) throw new Error('Você não tem permissão para confirmar resultados de operações externas.');
    const reviewed = await reviewStudioUncertainOutcome({ workspaceId, agentId, sessionId, userId: user.id,
      resolution: z.enum(['confirmed_succeeded', 'confirmed_failed']).parse(resolution) });
    revalidatePath(`/autopilot/${agentId}`);
    return { success: true as const, ...reviewed };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Não foi possível registrar a revisão.' }; }
}

export async function listPublishedStudioAgentsAction(workspaceId: string) {
  try {
    const user = await getCurrentUser();
    if (!user || user.activeWorkspaceId !== workspaceId || !await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) throw new Error('Acesso não autorizado aos agentes deste workspace.');
    const result = await db.query(`SELECT a.id, a.name, v.version_number, v.snapshot->'agent_release_manifest' AS release
      FROM autopilot_configs a JOIN autopilot_config_versions v ON v.config_id = a.id AND v.workspace_id = a.workspace_id
      WHERE a.workspace_id = $1 AND (NOT a.is_private OR a.user_id = $2) AND a.is_active = true AND v.snapshot->'agent_release_manifest'->>'runtimeVersion' = 'studio-v1'
        AND NOT EXISTS (SELECT 1 FROM agent_studio_release_revocations r WHERE r.workspace_id = a.workspace_id
          AND r.agent_id = a.id AND r.release_id::text = v.snapshot->'agent_release_manifest'->>'releaseId')
      ORDER BY a.name, v.version_number DESC LIMIT 200`, [workspaceId, user.id]);
    return { success: true as const, releases: result.rows.map((row) => {
      const document = AgentStudioDocumentSchema.parse(row.release.agentSnapshot);
      return { agentId: String(row.id), agentName: String(row.name), releaseId: String(row.release.releaseId), version: Number(row.version_number), inputs: studioFlowInputs(document), outputs: studioFlowOutputs(document) };
    }) };
  } catch (error) { return { success: false as const, releases: [], error: error instanceof Error ? error.message : 'Não foi possível carregar os agentes publicados.' }; }
}
