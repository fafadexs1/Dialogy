import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const bridge = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: bridge.query, connect: bridge.connect } }));
vi.mock('@/actions/user', () => ({ getCurrentUser: async () => ({ id: '00000000-0000-4000-8000-000000000009', activeWorkspaceId: '00000000-0000-4000-8000-000000000001' }) }));
vi.mock('@/actions/autopilot', () => ({ createAutopilotAgent: vi.fn() }));
vi.mock('@/lib/workspace-permissions', () => ({ hasWorkspacePermission: async () => true }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/services/agent-studio/integrations', () => ({ executeStudioHttp: vi.fn(), executeStudioMcp: vi.fn(), resolveStudioMcpTool: vi.fn() }));
vi.mock('@/modules/nexus/services/credentials', () => ({ listNexusCredentialSummaries: async () => [], saveNexusCredential: vi.fn() }));
vi.mock('@/services/mcp/store', () => ({ getMcpWorkspaceConfig: vi.fn() }));
vi.mock('@/services/autopilot/automation-rules', () => ({ resolveSafeAutopilotWebhookTarget: vi.fn() }));
import { createStudioSession } from '@/services/agent-studio/engine';
import { studioSessionStore, stopStudioSession } from '@/services/agent-studio/session-store';
import { readStudioResults } from '@/services/agent-studio/results';
import { purgeExpiredStudioOperationalData, reviewStudioUncertainOutcome, studioHistoryRetentionDays } from '@/services/agent-studio/operations';
import { createDefaultAgentStudioDocument } from '@/services/agent-studio/types';
import { listWorkspaceConfiguredAiModels } from '@/services/ai/workspace-ai-credentials';
import { readStudioMigrationInventory } from '@/services/agent-studio/migration-inventory';
import { loadStudioRelease } from '@/services/agent-studio/repository';
import { createNewAiAgentAction, getAgentStudioDataAction, saveAgentStudioDraftAction, publishAgentStudioAction, getStudioVersionForDraftAction, rollbackAgentStudioToLegacyAction, revokeAgentStudioReleaseAction, getStudioResultsAction, listPublishedStudioAgentsAction } from '@/actions/agent-studio';
import { StudioFlowContractSchema, STUDIO_FLOW_NODE_TYPES } from '@/services/agent-studio/flow-contract';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000009';
const agentId = '00000000-0000-4000-8000-000000000002';
const chatId = '00000000-0000-4000-8000-000000000003';
const releaseId = '00000000-0000-4000-8000-000000000004';
const sessionId = '00000000-0000-4000-8000-000000000005';
const scope = { workspaceId, agentId, chatId };
const platformConfig = (defaultModel: string) => ({
  defaultModel,
  models: ['googleai/gemini-2.5-flash-lite', 'openai/custom-agent-model'].map((id) => ({
    id, label: id, enabled: true, inputCost: 0, outputCost: 0, inputMarkup: 0, outputMarkup: 0,
  })),
  creditValueBrl: 1, costCurrency: 'BRL', usdToBrl: 1, billingEnabled: false,
});
let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite();
  bridge.query.mockImplementation((query: string, parameters?: unknown[]) => sql.query(query, parameters));
  bridge.connect.mockResolvedValue({ query: bridge.query, release: vi.fn() });
  await sql.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE workspace_integrations(workspace_id uuid, provider text, config jsonb, is_active boolean, updated_at timestamptz);
    CREATE TABLE ai_platform_settings(id text PRIMARY KEY CHECK (id = 'global'), config jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE ai_provider_credentials(provider text PRIMARY KEY, api_key text NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE autopilot_configs(id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid, name text, is_active boolean DEFAULT false, is_private boolean DEFAULT false, is_primary boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE chats(id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), autopilot_config_id uuid);
    CREATE TABLE autopilot_conversation_states(chat_id uuid PRIMARY KEY REFERENCES chats(id), workspace_id uuid NOT NULL, autopilot_config_id uuid, metadata jsonb, updated_at timestamptz);
    CREATE TABLE autopilot_config_drafts(config_id uuid PRIMARY KEY, workspace_id uuid, user_id uuid, snapshot jsonb, updated_at timestamptz);
    CREATE TABLE autopilot_config_versions(config_id uuid, workspace_id uuid, user_id uuid, version_number int, label text, snapshot jsonb, UNIQUE(config_id, version_number));
    CREATE TABLE workflow_definitions(workflow_id text, workflow_version text, workspace_id uuid, name text, status text, definition jsonb, PRIMARY KEY(workflow_id, workflow_version));
    CREATE TABLE system_agents(id uuid PRIMARY KEY, workspace_id uuid, autopilot_config_id uuid);
    CREATE TABLE webchat_widgets(id uuid PRIMARY KEY, workspace_id uuid, autopilot_config_id uuid);
    CREATE TABLE nexus_workflow_versions(id uuid PRIMARY KEY, workspace_id uuid, published_revision int, definition jsonb);
    CREATE TABLE teams(id uuid, workspace_id uuid, name text);
    CREATE TABLE tags(id uuid, workspace_id uuid, label text);
    CREATE TABLE custom_field_definitions(id uuid, workspace_id uuid, label text, type text);`);
  await sql.exec(`ALTER TABLE autopilot_configs
    ADD ai_model text, ADD transcription_model text, ADD knowledge_base text,
    ADD knowledge_base_documents jsonb, ADD knowledge_collections jsonb, ADD enabled_tool_names jsonb,
    ADD flow_graph jsonb, ADD workflow_builder_mode text DEFAULT 'legacy', ADD workflow_runtime_v2_mode text DEFAULT 'off',
    ADD active_workflow_id text, ADD active_workflow_version text, ADD agent_domain_pack_id uuid,
    ADD default_fallback_reply text, ADD escalation_policy text, ADD closing_policy text, ADD inactivity_timeout_seconds integer`);
  await sql.exec(await readFile('prisma/migrations/20260827130000_agent_studio_session_history/migration.sql', 'utf8'));
  await sql.exec(await readFile('prisma/migrations/20260908140000_agent_studio_durable_memory/migration.sql', 'utf8'));
  await sql.exec(await readFile('prisma/migrations/20261023180000_studio_flow_invocations/migration.sql', 'utf8'));
  await sql.query('INSERT INTO workspaces VALUES ($1)', [workspaceId]);
  await sql.query('INSERT INTO autopilot_configs (id, workspace_id) VALUES ($1, $2)', [agentId, workspaceId]);
  await sql.query('INSERT INTO chats (id, workspace_id) VALUES ($1, $2)', [chatId, workspaceId]);
  await sql.query('INSERT INTO teams VALUES ($1, $2, $3)', [chatId, workspaceId, 'Suporte']);
}, 30_000);
beforeEach(async () => {
  vi.stubEnv('WORKSPACE_CREDENTIALS_ENCRYPTION_KEY', 'isolated-test-key-at-least-32-characters');
  await sql.exec('TRUNCATE agent_studio_sessions, agent_studio_release_revocations, agent_studio_knowledge_revocations, autopilot_conversation_states, autopilot_config_drafts, autopilot_config_versions, workflow_definitions, system_agents, webchat_widgets, nexus_workflow_versions');
  await sql.query('DELETE FROM autopilot_configs WHERE id <> $1', [agentId]);
  await sql.exec("UPDATE autopilot_configs SET name = 'Agente', ai_model = NULL, is_active = false, knowledge_base_documents = NULL, knowledge_collections = NULL, default_fallback_reply = NULL");
  await sql.exec('UPDATE chats SET autopilot_config_id = NULL');
  await sql.exec('TRUNCATE workspace_integrations');
  await sql.query(`INSERT INTO ai_platform_settings (id, config) VALUES ('global', $1::jsonb)
    ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config`, [JSON.stringify(platformConfig('googleai/gemini-2.5-flash-lite'))]);
  await sql.query(`INSERT INTO workspace_integrations VALUES
    ($1, 'gemini', $2::jsonb, true, NOW()), ($1, 'openai', $3::jsonb, true, NOW())`,
    [workspaceId, JSON.stringify({ apiKey: 'isolated-test-key', aiModel: 'googleai/gemini-2.5-flash-lite' }),
      JSON.stringify({ apiKey: 'isolated-test-key', aiModel: 'openai/custom-agent-model' })]);
});
afterAll(async () => { vi.unstubAllEnvs(); await sql?.close(); });

describe('Studio persistence on isolated PostgreSQL (PGlite)', () => {
  it('publishes and lists a fixed composition contract without changing it when a draft is edited', async () => {
    const document = createDefaultAgentStudioDocument(agentId, workspaceId, 'Composição');
    document.concludeStage.handoffTeam = 'Suporte';
    document.flowBuilder = StudioFlowContractSchema.parse({ enabled: true, completionCriteria: 'Devolver resultado', outputs: [{ key: 'resultado', label: 'Resultado' }] });
    const published = await publishAgentStudioAction(agentId, document); if (!published.success) throw new Error(published.error);
    expect(published.manifest.flowContract).toEqual(document.flowBuilder);
    await saveAgentStudioDraftAction(agentId, { ...published.document, flowBuilder: { ...document.flowBuilder, completionCriteria: 'Novo critério' } });
    const library = await listPublishedStudioAgentsAction(workspaceId); if (!library.success) throw new Error(library.error);
    expect(library.releases[0].flowContract).toEqual(document.flowBuilder);
    expect((await loadStudioRelease(workspaceId, agentId, published.manifest.releaseId))?.flowContract).toEqual(document.flowBuilder);
  });
  it.each(STUDIO_FLOW_NODE_TYPES)('protects publications and agent deletion for %s', async (type) => {
    const document = createDefaultAgentStudioDocument(agentId, workspaceId); document.concludeStage.handoffTeam = 'Suporte';
    const published = await publishAgentStudioAction(agentId, document); if (!published.success) throw new Error(published.error);
    const definition = { nodes: [{ type, config: { agentId, releaseId: published.manifest.releaseId } }] };
    await sql.query("INSERT INTO workflow_definitions VALUES ('composed', '1', $1, 'Composição', 'published', $2::jsonb)", [workspaceId, JSON.stringify(definition)]);
    await expect(sql.query('DELETE FROM autopilot_configs WHERE id = $1', [agentId])).rejects.toThrow('fluxos publicados');
    definition.nodes[0].config.releaseId = 'unavailable';
    await expect(sql.query("INSERT INTO workflow_definitions VALUES ('invalid-composed', '1', $1, 'Inválido', 'published', $2::jsonb)", [workspaceId, JSON.stringify(definition)])).rejects.toThrow('indisponível');
  });
  it('lists only the active platform model without exposing workspace credential keys', async () => {
    await sql.query(`INSERT INTO workspace_integrations VALUES
      ($1, 'deepseek', $2::jsonb, false, NOW()), ($3, 'deepseek', $4::jsonb, true, NOW()),
      ($1, 'deepseek', $5::jsonb, true, NOW())`,
      [workspaceId, JSON.stringify({ apiKey: 'disabled-secret', aiModel: 'deepseek/disabled' }),
        releaseId, JSON.stringify({ apiKey: 'foreign-secret', aiModel: 'deepseek/foreign' }),
        JSON.stringify({ apiKey: '', aiModel: 'deepseek/no-key' })]);
    const models = await listWorkspaceConfiguredAiModels(workspaceId);
    expect(models.map((model) => model.id)).toEqual(['googleai/gemini-2.5-flash-lite']);
    expect(models.every((model) => !('apiKey' in model))).toBe(true);
  });
  it('does not offer or create an agent when the platform has no configured model', async () => {
    await sql.exec('TRUNCATE ai_platform_settings');
    expect(await listWorkspaceConfiguredAiModels(workspaceId)).toEqual([]);
    for (const aiModel of [undefined, 'googleai/gemini-2.5-flash-lite']) {
      const result = await createNewAiAgentAction({ name: 'Novo', objective: 'Atender', serviceType: 'support', creationId: releaseId, aiModel });
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('plataforma') });
    }
    expect((await sql.query('SELECT id FROM autopilot_configs WHERE id = $1', [releaseId])).rows).toEqual([]);
  });
  it('keeps each published platform model snapshot through a later global-model change and version restoration', async () => {
    const firstModel = 'googleai/gemini-2.5-flash-lite';
    const nextModel = 'openai/custom-agent-model';
    const created = await createNewAiAgentAction({ name: 'Modelo escolhido', objective: 'Ajudar clientes', serviceType: 'support', creationId: releaseId, aiModel: firstModel });
    if (!created.success) throw new Error(created.error);
    expect(created.document.aiModel).toBe(firstModel);
    const first = await publishAgentStudioAction(releaseId, { ...created.document, concludeStage: { ...created.document.concludeStage, handoffTeam: 'Suporte' } });
    if (!first.success) throw new Error(first.error);
    await sql.query("UPDATE ai_platform_settings SET config = $1::jsonb WHERE id = 'global'", [JSON.stringify(platformConfig(nextModel))]);
    const draft = await saveAgentStudioDraftAction(releaseId, { ...first.document, aiModel: nextModel });
    if (!draft.success) throw new Error(draft.error);
    const loaded = await getAgentStudioDataAction(releaseId);
    expect(loaded.success && loaded.document.aiModel).toBe(nextModel);
    const activeModel = async () => (await sql.query<{ ai_model: string }>('SELECT ai_model FROM autopilot_configs WHERE id = $1', [releaseId])).rows[0].ai_model;
    expect(await activeModel()).toBe(firstModel);
    const next = await publishAgentStudioAction(releaseId, draft.document);
    if (!next.success) throw new Error(next.error);
    expect(next.manifest.runtimeConfig?.aiModel).toBe(nextModel);
    expect(await activeModel()).toBe(nextModel);
    expect((await loadStudioRelease(workspaceId, releaseId, first.manifest.releaseId))?.runtimeConfig?.aiModel).toBe(firstModel);
    const restored = await getStudioVersionForDraftAction(releaseId, first.manifest.releaseId);
    expect(restored.success && restored.document.aiModel).toBe(firstModel);
    expect(await activeModel()).toBe(nextModel);
  });
  it('inventories existing conversations, channels and published workflow consumers without reading their contents', async () => {
    await sql.query('UPDATE autopilot_configs SET is_active = true WHERE id = $1', [agentId]);
    await sql.query('INSERT INTO autopilot_config_versions VALUES ($1, $2, $3, $4, $5, $6)', [agentId, workspaceId, userId, 1, 'Publicada', {
      agent_release_manifest: { releaseId, runtimeVersion: 'studio-v1' },
    }]);
    await sql.query('UPDATE chats SET autopilot_config_id = $1 WHERE id = $2', [agentId, chatId]);
    await sql.query('INSERT INTO system_agents VALUES ($1, $2, $3)', ['00000000-0000-4000-8000-000000000011', workspaceId, agentId]);
    await sql.query('INSERT INTO webchat_widgets VALUES ($1, $2, $3)', ['00000000-0000-4000-8000-000000000012', workspaceId, agentId]);
    const definition = { nodes: [{ type: 'ai.published_agent', config: { agentId, releaseId } }] };
    await sql.query('INSERT INTO workflow_definitions VALUES ($1, $2, $3, $4, $5, $6)', ['flow', 'v1', workspaceId, 'Fluxo', 'published', definition]);
    await sql.query('INSERT INTO nexus_workflow_versions VALUES ($1, $2, $3, $4)', ['00000000-0000-4000-8000-000000000013', workspaceId, 1, definition]);
    expect(await readStudioMigrationInventory(workspaceId, agentId)).toEqual({ conversations: 1, systemAgents: 1, webchatWidgets: 1, publishedWorkflowReferences: 2 });
  });
  it('reconciles an uncertain operation atomically without executing it again', async () => {
    const childScope = { ...scope, contextId: 'execution:agent-node' };
    const state = createStudioSession(agentId, releaseId, sessionId); state.inFlight = { key: 'reserved-write', stepId: 'write' };
    await (await studioSessionStore(childScope)).checkpoint(state);
    const reviewed = await reviewStudioUncertainOutcome({ workspaceId, agentId, sessionId, userId: '00000000-0000-4000-8000-000000000009', resolution: 'confirmed_succeeded' });
    expect(reviewed.resolution).toBe('confirmed_succeeded');
    const current = (await studioSessionStore(childScope)).state!;
    expect(current).toMatchObject({ inFlight: null, phase: 'done', status: 'failed' });
    expect(current.events.at(-1)?.kind).toBe('outcome_reviewed');
    const summary = (await sql.query<{ summary: any }>('SELECT summary FROM agent_studio_sessions')).rows[0].summary;
    expect(summary).toMatchObject({ outcomeUnknown: false, outcomeReview: { resolution: 'confirmed_succeeded' } });
    await expect(reviewStudioUncertainOutcome({ workspaceId, agentId, sessionId, userId: 'user', resolution: 'confirmed_failed' })).rejects.toThrow('já revisado');
  });
  it('rolls back uncertain-outcome review if history reconciliation fails', async () => {
    const childScope = { ...scope, contextId: 'execution:agent-node' };
    const state = createStudioSession(agentId, releaseId, sessionId); state.inFlight = { key: 'reserved-write', stepId: 'write' };
    await (await studioSessionStore(childScope)).checkpoint(state);
    await sql.exec("CREATE FUNCTION reject_outcome_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF COALESCE((NEW.summary->>'outcomeUnknown')::boolean, false) = false THEN RAISE EXCEPTION 'injected review failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_outcome_review BEFORE UPDATE ON agent_studio_sessions FOR EACH ROW EXECUTE FUNCTION reject_outcome_review()");
    try {
      await expect(reviewStudioUncertainOutcome({ workspaceId, agentId, sessionId, userId: 'user', resolution: 'confirmed_failed' })).rejects.toThrow('injected review failure');
      expect((await studioSessionStore(childScope)).state?.inFlight).toEqual(state.inFlight);
      expect((await sql.query<{ summary: any }>('SELECT summary FROM agent_studio_sessions')).rows[0].summary.outcomeUnknown).toBe(true);
    } finally { await sql.exec('DROP TRIGGER reject_outcome_review ON agent_studio_sessions; DROP FUNCTION reject_outcome_review()'); }
  });
  it('purges only expired terminal data and retains active or uncertain sessions', async () => {
    expect(studioHistoryRetentionDays('bad')).toBe(90); expect(studioHistoryRetentionDays('6')).toBe(90); expect(studioHistoryRetentionDays('30')).toBe(30);
    const terminal = createStudioSession(agentId, releaseId, sessionId); terminal.phase = 'done'; terminal.status = 'resolved';
    await (await studioSessionStore(scope)).checkpoint(terminal);
    await sql.exec("UPDATE agent_studio_sessions SET completed_at = NOW() - INTERVAL '40 days'; UPDATE autopilot_conversation_states SET metadata = jsonb_set(metadata, '{agent_studio,updatedAt}', to_jsonb((NOW() - INTERVAL '40 days')::text))");
    expect(await purgeExpiredStudioOperationalData(30)).toEqual({ days: 30, deletedSessions: 1, clearedStates: 1 });
    expect((await sql.query('SELECT 1 FROM agent_studio_sessions')).rows).toHaveLength(0);
    expect((await sql.query<any>('SELECT metadata FROM autopilot_conversation_states')).rows[0].metadata.agent_studio).toBeUndefined();
    await expect(purgeExpiredStudioOperationalData(1)).rejects.toThrow('retenção');

    const uncertain = createStudioSession(agentId, releaseId, sessionId); uncertain.inFlight = { key: 'write', stepId: 'write' };
    await (await studioSessionStore(scope)).checkpoint(uncertain);
    await sql.exec("UPDATE agent_studio_sessions SET completed_at = NOW() - INTERVAL '400 days'");
    expect(await purgeExpiredStudioOperationalData(30)).toMatchObject({ deletedSessions: 0, clearedStates: 0 });
  });
  it('cancels a child session atomically with its history without claiming resolution', async () => {
    const childScope = { ...scope, contextId: 'execution:agent-node' };
    const state = createStudioSession(agentId, releaseId, sessionId); state.status = 'waiting_input'; state.pendingField = 'cpf';
    await (await studioSessionStore(childScope)).checkpoint(state);
    await stopStudioSession(childScope, 'cancelled');
    const saved = (await studioSessionStore(childScope)).state!;
    expect(saved).toMatchObject({ phase: 'done', status: 'cancelled', pendingField: null });
    expect(saved.events.at(-1)?.kind).toBe('cancelled');
    const history = (await sql.query<{ status: string; completed_at: string | null; summary: Record<string, unknown> }>('SELECT status, completed_at, summary FROM agent_studio_sessions')).rows[0];
    expect(history.status).toBe('cancelled'); expect(history.completed_at).not.toBeNull();
    expect((await readStudioResults(workspaceId, agentId, 7)).sessions).toEqual([{ status: 'cancelled', count: 1 }]);
    await stopStudioSession(childScope, 'cancelled');
    expect((await studioSessionStore(childScope)).state?.events).toHaveLength(1);
    expect((await studioSessionStore({ ...childScope, contextId: 'new:agent-node' })).state).toBeNull();
  });
  it('keeps uncertain operation reservations after cancellation and blocks a replacement invocation', async () => {
    const childScope = { ...scope, contextId: 'execution:agent-node' };
    const state = createStudioSession(agentId, releaseId, sessionId); state.inFlight = { key: 'operation', stepId: 'write' };
    await (await studioSessionStore(childScope)).checkpoint(state);
    await stopStudioSession(childScope, 'cancelled');
    expect((await studioSessionStore(childScope)).state?.inFlight).toEqual(state.inFlight);
    const history = (await sql.query<{ summary: { outcomeUnknown: boolean } }>('SELECT summary FROM agent_studio_sessions')).rows[0];
    expect(history.summary.outcomeUnknown).toBe(true);
    await expect(studioSessionStore({ ...childScope, contextId: 'replacement' })).rejects.toThrow('resultado incerto');
    await stopStudioSession({ ...childScope, contextId: 'unrelated' }, 'failed');
    expect((await studioSessionStore(childScope)).state?.status).toBe('cancelled');
  });
  it('does not report a completed cancellation if recording its history fails', async () => {
    const state = createStudioSession(agentId, releaseId, sessionId); state.status = 'waiting_input';
    await (await studioSessionStore(scope)).checkpoint(state);
    await sql.exec("CREATE FUNCTION reject_cancel_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'cancelled' THEN RAISE EXCEPTION 'injected history failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_cancel_history BEFORE UPDATE ON agent_studio_sessions FOR EACH ROW EXECUTE FUNCTION reject_cancel_history()");
    try {
      await expect(stopStudioSession(scope, 'cancelled')).rejects.toThrow('injected history failure');
      expect((await studioSessionStore(scope)).state?.status).toBe('waiting_input');
    } finally { await sql.exec('DROP TRIGGER reject_cancel_history ON agent_studio_sessions; DROP FUNCTION reject_cancel_history()'); }
  });
  it('keeps migration review after autosave and prevents publishing without explicit acknowledgement', async () => {
    await sql.exec('UPDATE autopilot_configs SET is_active = true');
    const loaded = await getAgentStudioDataAction(agentId); if (!loaded.success) throw new Error(loaded.error);
    expect(loaded.requiresMigrationReview).toBe(true);
    loaded.document.concludeStage.handoffTeam = 'Suporte';
    const saved = await saveAgentStudioDraftAction(agentId, loaded.document); if (!saved.success) throw new Error(saved.error);
    expect((await getAgentStudioDataAction(agentId)).success).toBe(true);
    const reloaded = await getAgentStudioDataAction(agentId);
    expect(reloaded.success && reloaded.requiresMigrationReview).toBe(true);
    expect((await publishAgentStudioAction(agentId, saved.document)).success).toBe(false);
    const reviewed = { ...saved.document, migrationReview: { sourceHash: loaded.migrationReport!.sourceHash, acknowledgedKeys: ['activation'] } };
    const published = await publishAgentStudioAction(agentId, reviewed); if (!published.success) throw new Error(published.error);
    const snapshot = (await sql.query<{ snapshot: Record<string, unknown> }>('SELECT snapshot FROM autopilot_config_versions')).rows[0].snapshot;
    expect(snapshot.agent_studio_legacy_backup).toMatchObject({ is_active: true, name: 'Agente' });
  });
  it('restores the exact historical external knowledge rather than reading a changed source', async () => {
    await sql.query('UPDATE autopilot_configs SET knowledge_collections = $1::jsonb, knowledge_base_documents = $2::jsonb',
      [JSON.stringify([{ id: 'manual', name: 'Manual' }]), JSON.stringify([{ id: 'doc', name: 'Política', content: 'Conteúdo original', collectionIds: ['manual'] }])]);
    const document = createDefaultAgentStudioDocument(agentId, workspaceId); document.concludeStage.handoffTeam = 'Suporte';
    const migration = await getAgentStudioDataAction(agentId); if (!migration.success) throw new Error(migration.error);
    document.migrationReview = { sourceHash: migration.migrationReport!.sourceHash, acknowledgedKeys: ['knowledge'] };
    document.resolveStage.knowledgeCollectionIds = ['manual'];
    const first = await publishAgentStudioAction(agentId, document); if (!first.success) throw new Error(first.error);
    await sql.query('UPDATE autopilot_configs SET knowledge_base_documents = $1::jsonb', [JSON.stringify([{ id: 'doc', name: 'Política', content: 'Conteúdo alterado', collectionIds: ['manual'] }])]);
    const restored = await getStudioVersionForDraftAction(agentId, first.manifest.releaseId); if (!restored.success) throw new Error(restored.error);
    const second = await publishAgentStudioAction(agentId, restored.document); if (!second.success) throw new Error(second.error);
    expect(second.manifest.knowledgeSnapshot?.[0].content).toBe('Conteúdo original');
  });
  it('revokes a published knowledge revision or the entire release without mutating immutable history', async () => {
    const document = createDefaultAgentStudioDocument(agentId, workspaceId); document.concludeStage.handoffTeam = 'Suporte';
    document.inlineKnowledge = [{ id: 'policy', name: 'Política', content: 'Conteúdo publicado.' }];
    document.resolveStage.knowledgeCollectionIds = ['policy'];
    const published = await publishAgentStudioAction(agentId, document); if (!published.success) throw new Error(published.error);
    expect((await loadStudioRelease(workspaceId, agentId, published.manifest.releaseId))?.knowledgeSnapshot).toHaveLength(1);

    const sourceRevocation = await revokeAgentStudioReleaseAction(agentId, { releaseId: published.manifest.releaseId, sourceId: 'policy',
      reason: 'Fonte desatualizada por decisão administrativa.', confirmation: 'REVOGAR FONTE' });
    expect(sourceRevocation.success).toBe(true);
    expect((await loadStudioRelease(workspaceId, agentId, published.manifest.releaseId))?.knowledgeSnapshot).toEqual([]);
    expect((await revokeAgentStudioReleaseAction(agentId, { releaseId: published.manifest.releaseId, sourceId: 'policy', reason: 'Tentativa repetida.', confirmation: 'REVOGAR FONTE' })).success).toBe(false);

    const releaseRevocation = await revokeAgentStudioReleaseAction(agentId, { releaseId: published.manifest.releaseId,
      reason: 'Versão interrompida por decisão administrativa.', confirmation: 'REVOGAR VERSÃO' });
    expect(releaseRevocation.success).toBe(true);
    await expect(loadStudioRelease(workspaceId, agentId, published.manifest.releaseId)).rejects.toThrow('revogada');
    const results = await getStudioResultsAction(agentId); if (!results.success) throw new Error(results.error);
    expect(results.releases[0]).toMatchObject({ revoked: true, knowledgeSources: [{ id: 'policy', revoked: true }] });
    expect((await sql.query('SELECT snapshot FROM autopilot_config_versions')).rows).toHaveLength(1);
    const definition = { nodes: [{ id: 'node', type: 'ai.published_agent', config: { agentId, releaseId: published.manifest.releaseId } }] };
    await expect(sql.query("INSERT INTO workflow_definitions VALUES ('revoked', '1', $1, 'Revogado', 'published', $2::jsonb)", [workspaceId, JSON.stringify(definition)])).rejects.toThrow('indisponível');
  });
  it('creates an inactive agent and its draft atomically, recovering retries without replacing edits', async () => {
    const input = { name: 'Financeiro', objective: 'Consultar faturas', serviceType: 'billing' as const, language: 'pt-BR', isPrivate: true, creationId: releaseId };
    const created = await createNewAiAgentAction(input); if (!created.success) throw new Error(created.error);
    expect(created.document.objective).toBe(input.objective); expect(created.document.draftRevision).toBe(1);
    const row = (await sql.query('SELECT * FROM autopilot_configs WHERE id = $1', [releaseId])).rows[0];
    expect(row).toMatchObject({ is_active: false, is_private: true, is_primary: false });
    const edited = await saveAgentStudioDraftAction(releaseId, { ...created.document, name: 'Edição preservada' });
    expect(edited.success).toBe(true);
    const retried = await createNewAiAgentAction(input);
    expect(retried.success && retried.document.name).toBe('Edição preservada');
    expect((await sql.query('SELECT * FROM autopilot_configs WHERE id = $1', [releaseId])).rows).toHaveLength(1);
  });
  it('leaves no agent behind when creating its draft fails', async () => {
    await sql.exec(`ALTER TABLE autopilot_config_drafts ADD CONSTRAINT injected_creation_failure CHECK (config_id <> '${releaseId}'::uuid)`);
    try {
      const result = await createNewAiAgentAction({ name: 'Novo', objective: 'Atender', serviceType: 'support', creationId: releaseId });
      expect(result.success).toBe(false);
      expect((await sql.query('SELECT * FROM autopilot_configs WHERE id = $1', [releaseId])).rows).toEqual([]);
    } finally { await sql.exec('ALTER TABLE autopilot_config_drafts DROP CONSTRAINT injected_creation_failure'); }
  });
  it('does not recover a creation identifier owned by someone else', async () => {
    const result = await createNewAiAgentAction({ name: 'Novo', objective: 'Atender', serviceType: 'support', creationId: agentId });
    expect(result.success).toBe(false);
    expect((await sql.query('SELECT * FROM autopilot_config_drafts')).rows).toEqual([]);
  });
  it('protects immutable publications and prevents deleting an agent referenced by a published flow', async () => {
    const document = createDefaultAgentStudioDocument(agentId, workspaceId); document.concludeStage.handoffTeam = 'Suporte';
    const result = await publishAgentStudioAction(agentId, document); if (!result.success) throw new Error(result.error);
    expect(result.document.concludeStage.handoffTeam).toBe(chatId); // Published references use the stable team ID.
    await expect(sql.query("UPDATE autopilot_config_versions SET snapshot = '{}'::jsonb")).rejects.toThrow('immutable');
    const definition = { nodes: [{ id: 'node', type: 'ai.published_agent', config: { agentId, releaseId: result.manifest.releaseId } }] };
    await sql.query("INSERT INTO workflow_definitions VALUES ('flow', '1', $1, 'Atendimento', 'published', $2::jsonb)", [workspaceId, JSON.stringify(definition)]);
    await expect(sql.query('DELETE FROM autopilot_configs WHERE id = $1', [agentId])).rejects.toThrow('fluxos publicados');
    const invalid = { nodes: [{ id: 'node', type: 'ai.published_agent', config: { agentId, releaseId: 'missing-release' } }] };
    await expect(sql.query("INSERT INTO workflow_definitions VALUES ('invalid', '1', $1, 'Inválido', 'published', $2::jsonb)", [workspaceId, JSON.stringify(invalid)])).rejects.toThrow('indisponível');
  });
  it('publishes a snapshot, keeps edits in a draft, and restores without altering production', async () => {
    const document = createDefaultAgentStudioDocument(agentId, workspaceId, 'Versão inicial'); document.concludeStage.handoffTeam = 'Suporte';
    const first = await publishAgentStudioAction(agentId, document);
    expect(first.success).toBe(true); if (!first.success) throw new Error(first.error);
    expect(first.publishedVersion).toBe(1);
    const draft = await saveAgentStudioDraftAction(agentId, { ...first.document, name: 'Novo rascunho' });
    expect(draft.success).toBe(true);
    expect((await sql.query<{ name: string }>('SELECT name FROM autopilot_configs')).rows[0].name).toBe('Versão inicial');
    const restored = await getStudioVersionForDraftAction(agentId, first.manifest.releaseId);
    expect(restored.success && restored.document.name).toBe('Versão inicial');
    const savedDraft = (await sql.query<{ snapshot: { agent_studio_document: { name: string } } }>('SELECT snapshot FROM autopilot_config_drafts')).rows[0];
    expect(savedDraft.snapshot.agent_studio_document.name).toBe('Novo rascunho');
  });
  it('reuses the current release when publishing the same effective version again', async () => {
    const document = createDefaultAgentStudioDocument(agentId, workspaceId, 'Versão única');
    document.concludeStage.handoffTeam = 'Suporte';
    const first = await publishAgentStudioAction(agentId, document); if (!first.success) throw new Error(first.error);

    const repeated = await publishAgentStudioAction(agentId, first.document); if (!repeated.success) throw new Error(repeated.error);

    expect(repeated).toMatchObject({
      publishedVersion: first.publishedVersion,
      reusedExistingVersion: true,
      manifest: { releaseId: first.manifest.releaseId },
    });
    expect((await sql.query('SELECT version_number FROM autopilot_config_versions')).rows).toHaveLength(1);
  });
  it('rolls back new conversations to the preserved legacy runtime without deleting Studio releases or its draft', async () => {
    await sql.exec("UPDATE autopilot_configs SET name = 'Atendimento anterior', is_active = true, default_fallback_reply = 'Mensagem anterior'");
    const migration = await getAgentStudioDataAction(agentId); if (!migration.success) throw new Error(migration.error);
    const document = createDefaultAgentStudioDocument(agentId, workspaceId, 'Agente do Estúdio');
    document.concludeStage.handoffTeam = 'Suporte';
    document.migrationReview = { sourceHash: migration.migrationReport!.sourceHash, acknowledgedKeys: ['activation'] };
    const published = await publishAgentStudioAction(agentId, document); if (!published.success) throw new Error(published.error);

    expect((await rollbackAgentStudioToLegacyAction(agentId, 'frase errada')).success).toBe(false);
    const rollback = await rollbackAgentStudioToLegacyAction(agentId, 'VOLTAR AO MODO ANTERIOR');
    expect(rollback.success).toBe(true); if (!rollback.success) throw new Error(rollback.error);
    expect((await sql.query<{ name: string; default_fallback_reply: string; is_active: boolean }>('SELECT name, default_fallback_reply, is_active FROM autopilot_configs')).rows[0])
      .toEqual({ name: 'Atendimento anterior', default_fallback_reply: 'Mensagem anterior', is_active: true });
    const versions = (await sql.query<{ snapshot: Record<string, unknown> }>('SELECT snapshot FROM autopilot_config_versions ORDER BY version_number')).rows;
    expect(versions).toHaveLength(2);
    expect(versions[0].snapshot.agent_release_manifest).toMatchObject({ releaseId: published.manifest.releaseId });
    expect(versions[1].snapshot.agent_release_manifest).toBeUndefined();
    expect(versions[1].snapshot.agent_studio_rollback).toMatchObject({ fromReleaseId: published.manifest.releaseId });
    const draft = (await sql.query<{ snapshot: { agent_studio_document: { name: string; status: string } } }>('SELECT snapshot FROM autopilot_config_drafts')).rows[0];
    expect(draft.snapshot.agent_studio_document).toMatchObject({ name: 'Agente do Estúdio', status: 'draft' });
    expect((await rollbackAgentStudioToLegacyAction(agentId, 'VOLTAR AO MODO ANTERIOR')).success).toBe(false);
  });
  it('rolls publication back entirely when inserting its version fails', async () => {
    const document = createDefaultAgentStudioDocument(agentId, workspaceId, 'Versão inicial'); document.concludeStage.handoffTeam = 'Suporte';
    const first = await publishAgentStudioAction(agentId, document); if (!first.success) throw new Error(first.error);
    const draft = await saveAgentStudioDraftAction(agentId, { ...first.document, name: 'Versão nova' }); if (!draft.success) throw new Error(draft.error);
    await sql.exec('ALTER TABLE autopilot_config_versions ADD CONSTRAINT reject_second_version CHECK (version_number < 2)');
    try {
      expect((await publishAgentStudioAction(agentId, draft.document)).success).toBe(false);
      expect((await sql.query<{ name: string }>('SELECT name FROM autopilot_configs')).rows[0].name).toBe('Versão inicial');
      expect((await sql.query('SELECT * FROM autopilot_config_versions')).rows).toHaveLength(1);
      expect((await sql.query('SELECT * FROM autopilot_config_drafts')).rows).toHaveLength(1);
    } finally { await sql.exec('ALTER TABLE autopilot_config_versions DROP CONSTRAINT reject_second_version'); }
  });
  it('rejects stale draft revisions without losing the newer document', async () => {
    const document = createDefaultAgentStudioDocument(agentId, workspaceId, 'Primeiro rascunho');
    expect((await saveAgentStudioDraftAction(agentId, document)).success).toBe(true);
    expect((await saveAgentStudioDraftAction(agentId, { ...document, name: 'Gravação atrasada' })).success).toBe(false);
    const saved = (await sql.query<{ snapshot: { agent_studio_document: { name: string } } }>('SELECT snapshot FROM autopilot_config_drafts')).rows[0];
    expect(saved.snapshot.agent_studio_document.name).toBe('Primeiro rascunho');
  });
  it('commits typed encrypted state and a PII-free historical summary atomically', async () => {
    const state = createStudioSession(agentId, releaseId, sessionId);
    state.values = { cpf: '52998224725', enabled: false };
    state.lastTurn = { messageId: 'message', response: 'CPF 52998224725', outcome: 'waiting_input' };
    const store = await studioSessionStore(scope); await store.checkpoint(state);
    expect((await studioSessionStore(scope)).state?.values).toEqual(state.values);
    const rows = await sql.query('SELECT * FROM agent_studio_sessions');
    expect(rows.rows).toHaveLength(1); expect(JSON.stringify(rows.rows)).not.toContain('52998224725');
    expect((rows.rows[0] as { release_id: string }).release_id).toBe(releaseId);
  });
  it('reserves once under competing workers and records one session', async () => {
    const [first, stale] = await Promise.all([studioSessionStore(scope), studioSessionStore(scope)]);
    const state = createStudioSession(agentId, releaseId, sessionId);
    await first.checkpoint(state); await expect(stale.checkpoint(state)).rejects.toThrow('outra execução');
    expect((await sql.query('SELECT id FROM agent_studio_sessions')).rows).toHaveLength(1);
    expect((await sql.query<{ revision: string }>("SELECT metadata->'agent_studio'->>'revision' AS revision FROM autopilot_conversation_states")).rows[0].revision).toBe('1');
  });
  it('rolls back the checkpoint when the history write fails, preserving the pre-dispatch reservation', async () => {
    const store = await studioSessionStore(scope); const state = createStudioSession(agentId, releaseId, sessionId);
    state.inFlight = { key: 'operation', stepId: 'api' }; await store.checkpoint(state);
    await sql.exec("ALTER TABLE agent_studio_sessions ADD CONSTRAINT injected_failure CHECK (status <> 'resolved')");
    try {
      const completed = { ...state, status: 'resolved' as const, phase: 'done' as const, inFlight: null };
      await expect(store.checkpoint(completed)).rejects.toThrow();
      expect((await studioSessionStore(scope)).state?.inFlight?.key).toBe('operation');
      expect((await sql.query<{ status: string }>('SELECT status FROM agent_studio_sessions')).rows[0].status).toBe('running');
    } finally { await sql.exec('ALTER TABLE agent_studio_sessions DROP CONSTRAINT injected_failure'); }
  });
  it('preserves previous sessions when a new conversation turn starts a new session', async () => {
    const store = await studioSessionStore(scope); const first = createStudioSession(agentId, releaseId, sessionId);
    first.phase = 'done'; first.status = 'resolved'; await store.checkpoint(first);
    const next = createStudioSession(agentId, releaseId, '00000000-0000-4000-8000-000000000006');
    next.status = 'waiting_input'; await store.checkpoint(next);
    const results = await readStudioResults(workspaceId, agentId, 30);
    expect(results.sessions).toEqual(expect.arrayContaining([{ status: 'resolved', count: 1 }, { status: 'waiting_input', count: 1 }]));
    expect(results.recent).toHaveLength(2); expect(results.averageResolutionSeconds).not.toBeNull();
  });
  it('excludes old and foreign sessions from every metric and the timeline', async () => {
    const store = await studioSessionStore(scope); const state = createStudioSession(agentId, releaseId, sessionId);
    state.procedureStats = [{ id: 'billing', name: 'Fatura', selected: 1, completed: 0, failed: 1, collectionFailures: 2, integrationFailures: 1 }];
    await store.checkpoint(state);
    expect((await readStudioResults(workspaceId, agentId, 30)).procedures[0].collectionFailures).toBe(2);
    expect((await readStudioResults(releaseId, agentId, 30)).recent).toEqual([]);
    await sql.exec("UPDATE agent_studio_sessions SET started_at = NOW() - INTERVAL '35 days'");
    expect((await readStudioResults(workspaceId, agentId, 30)).sessions).toEqual([]);
    expect((await readStudioResults(workspaceId, agentId, 90)).sessions).toHaveLength(1);
    await expect(readStudioResults(workspaceId, agentId, 1000)).rejects.toThrow('período');
  });
  it('publishes successfully when catalog documents lack collectionIds and maps them to default collection', async () => {
    await sql.query('UPDATE autopilot_configs SET is_active = false, knowledge_collections = $1::jsonb, knowledge_base_documents = $2::jsonb', [
      JSON.stringify([{ id: 'general', name: 'Geral', isDefault: true }]),
      JSON.stringify([
        { id: 'doc-1', name: 'Plano 1', content: 'Detalhes do plano 1', status: 'active' },
        { id: 'doc-2', name: 'Plano 2', content: 'Detalhes do plano 2', status: 'active' },
      ]),
    ]);
    const document = createDefaultAgentStudioDocument(agentId, workspaceId);
    document.concludeStage.handoffTeam = 'Suporte';
    const migration = await getAgentStudioDataAction(agentId);
    if (migration.success && migration.migrationReport) {
      document.migrationReview = {
        sourceHash: migration.migrationReport.sourceHash,
        acknowledgedKeys: migration.migrationReport.items.map((i) => i.key),
      };
    }
    document.resolveStage.knowledgeCollectionIds = ['general', 'stale-ghost-id-123'];
    const published = await publishAgentStudioAction(agentId, document);
    if (!published.success) throw new Error(published.error);
    expect(published.manifest.knowledgeSnapshot).toHaveLength(2);
    expect(published.manifest.agentSnapshot.resolveStage.knowledgeCollectionIds).toEqual(['general']);
  });
  it('rejects publishing when selected collection has no active documents', async () => {
    await sql.query('UPDATE autopilot_configs SET is_active = false, knowledge_collections = $1::jsonb, knowledge_base_documents = $2::jsonb', [
      JSON.stringify([{ id: 'empty_col', name: 'Vazia' }]),
      JSON.stringify([]),
    ]);
    const document = createDefaultAgentStudioDocument(agentId, workspaceId);
    document.concludeStage.handoffTeam = 'Suporte';
    document.resolveStage.knowledgeCollectionIds = ['empty_col'];
    const published = await publishAgentStudioAction(agentId, document);
    expect(published.success).toBe(false);
    expect(published.error).toBe('Uma base ou documento selecionado não possui conteúdo ativo para publicar.');
  });
  it('denies history access through untrusted Data API roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      await sql.exec(`SET ROLE ${role}`);
      try { await expect(sql.query('SELECT * FROM agent_studio_sessions')).rejects.toThrow('permission denied'); }
      finally { await sql.exec('RESET ROLE'); }
    }
  });
  it('rejects a workspace mismatch without writing history', async () => {
    await expect(studioSessionStore({ ...scope, workspaceId: releaseId })).rejects.toThrow('workspace');
    const store = await studioSessionStore({ ...scope, agentId: releaseId });
    await expect(store.checkpoint(createStudioSession(releaseId, releaseId, sessionId))).rejects.toThrow('reservada');
    expect((await sql.query('SELECT * FROM agent_studio_sessions')).rows).toEqual([]);
  });
});
