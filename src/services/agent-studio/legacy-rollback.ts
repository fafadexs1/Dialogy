import 'server-only';

import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AgentStudioDocumentSchema } from './types';

const LegacyBackupSchema = z.object({
  name: z.string().min(1),
  ai_model: z.string().nullable().optional(),
  transcription_model: z.string().nullable().optional(),
  knowledge_base: z.string().nullable().optional(),
  knowledge_base_documents: z.unknown().nullable().optional(),
  knowledge_collections: z.unknown().nullable().optional(),
  enabled_tool_names: z.unknown().nullable().optional(),
  flow_graph: z.unknown().nullable().optional(),
  workflow_definition: z.unknown().nullable().optional(),
  workflow_builder_mode: z.enum(['legacy', 'native_v2']).nullable().optional(),
  workflow_runtime_v2_mode: z.enum(['off', 'shadow', 'primary']).nullable().optional(),
  active_workflow_id: z.string().nullable().optional(),
  active_workflow_version: z.string().nullable().optional(),
  agent_domain_pack_id: z.string().uuid().nullable().optional(),
  default_fallback_reply: z.string().nullable().optional(),
  escalation_policy: z.string().nullable().optional(),
  closing_policy: z.string().nullable().optional(),
  inactivity_timeout_seconds: z.number().int().nullable().optional(),
  is_active: z.boolean(),
  is_private: z.boolean(),
});

type RollbackInput = { workspaceId: string; agentId: string; userId: string };

/** Creates an audited legacy publication. Studio releases and active pinned sessions are retained. */
export async function rollbackStudioAgentToLegacy(client: PoolClient, input: RollbackInput) {
  const config = await client.query('SELECT id FROM autopilot_configs WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [input.workspaceId, input.agentId]);
  if (!config.rows[0]) throw new Error('Agente não encontrado.');
  const current = await client.query(`SELECT version_number, snapshot FROM autopilot_config_versions
    WHERE workspace_id = $1 AND config_id = $2 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`, [input.workspaceId, input.agentId]);
  const snapshot = current.rows[0]?.snapshot as Record<string, unknown> | undefined;
  const manifest = snapshot?.agent_release_manifest as Record<string, unknown> | undefined;
  if (!snapshot || !manifest || manifest.runtimeVersion !== 'studio-v1') throw new Error('O agente já está no modo anterior ou não possui uma publicação do Estúdio ativa.');
  const parsedBackup = LegacyBackupSchema.safeParse(snapshot.agent_studio_legacy_backup);
  if (!parsedBackup.success) throw new Error('A cópia de segurança anterior não está disponível. O agente não foi alterado.');
  const backup = parsedBackup.data;
  const nextVersion = Number(current.rows[0].version_number) + 1;

  await client.query(`UPDATE autopilot_configs SET
      name = $3, ai_model = $4, transcription_model = $5, knowledge_base = $6,
      knowledge_base_documents = $7::jsonb, knowledge_collections = $8::jsonb,
      enabled_tool_names = $9::jsonb, flow_graph = $10::jsonb,
      workflow_builder_mode = $11, workflow_runtime_v2_mode = $12,
      active_workflow_id = $13, active_workflow_version = $14, agent_domain_pack_id = $15,
      default_fallback_reply = $16, escalation_policy = $17, closing_policy = $18,
      inactivity_timeout_seconds = $19, is_active = $20, is_private = $21, updated_at = NOW()
    WHERE workspace_id = $1 AND id = $2`, [
    input.workspaceId, input.agentId, backup.name, backup.ai_model ?? null, backup.transcription_model ?? null,
    backup.knowledge_base ?? null, JSON.stringify(backup.knowledge_base_documents ?? []), JSON.stringify(backup.knowledge_collections ?? []),
    JSON.stringify(backup.enabled_tool_names ?? []), backup.flow_graph == null ? null : JSON.stringify(backup.flow_graph),
    backup.workflow_builder_mode || 'legacy', backup.workflow_runtime_v2_mode || 'off', backup.active_workflow_id ?? null,
    backup.active_workflow_version ?? null, backup.agent_domain_pack_id ?? null, backup.default_fallback_reply ?? null,
    backup.escalation_policy ?? null, backup.closing_policy ?? null, backup.inactivity_timeout_seconds ?? null,
    backup.is_active, backup.is_private,
  ]);

  const legacySnapshot = {
    ...backup,
    agent_studio_rollback: {
      fromReleaseId: String(manifest.releaseId || ''),
      fromVersion: Number(current.rows[0].version_number),
      rolledBackAt: new Date().toISOString(),
      rolledBackByUserId: input.userId,
    },
  };
  await client.query(`INSERT INTO autopilot_config_versions
    (config_id, workspace_id, user_id, version_number, label, snapshot)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [input.agentId, input.workspaceId, input.userId, nextVersion, `Retorno ao modo anterior v${nextVersion}`, JSON.stringify(legacySnapshot)]);

  const document = AgentStudioDocumentSchema.parse(manifest.agentSnapshot);
  const preservedDocument = AgentStudioDocumentSchema.parse({
    ...document,
    status: 'draft',
    draftRevision: (document.draftRevision || 0) + 1,
    updatedAt: new Date().toISOString(),
  });
  const preservedDraft = {
    ...snapshot,
    agent_release_manifest: undefined,
    agent_studio_document: preservedDocument,
  };
  delete preservedDraft.agent_release_manifest;
  await client.query(`INSERT INTO autopilot_config_drafts (config_id, workspace_id, user_id, snapshot, updated_at)
    VALUES ($1, $2, $3, $4::jsonb, NOW()) ON CONFLICT (config_id) DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id, user_id = EXCLUDED.user_id, snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at`,
  [input.agentId, input.workspaceId, input.userId, JSON.stringify(preservedDraft)]);

  return { version: nextVersion, previousReleaseId: String(manifest.releaseId), document: preservedDraft.agent_studio_document };
}
