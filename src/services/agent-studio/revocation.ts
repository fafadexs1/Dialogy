import 'server-only';

import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AgentReleaseManifestSchema, type AgentReleaseManifest } from './types';

const ReasonSchema = z.string().trim().min(10, 'Explique o motivo em pelo menos 10 caracteres.').max(1000);

export async function revokeStudioRelease(client: PoolClient, input: {
  workspaceId: string; agentId: string; releaseId: string; sourceId?: string; reason: string; userId: string;
}) {
  z.string().uuid().parse(input.releaseId);
  const reason = ReasonSchema.parse(input.reason);
  const selected = await client.query(`SELECT snapshot->'agent_release_manifest' AS release FROM autopilot_config_versions
    WHERE workspace_id = $1 AND config_id = $2 AND snapshot->'agent_release_manifest'->>'releaseId' = $3
    FOR SHARE`, [input.workspaceId, input.agentId, input.releaseId]);
  if (!selected.rows[0]?.release) throw new Error('Versão publicada não encontrada.');
  const parsedRelease = AgentReleaseManifestSchema.safeParse(selected.rows[0].release);
  const release = parsedRelease.success ? parsedRelease.data : (selected.rows[0].release as AgentReleaseManifest);

  if (input.sourceId) {
    const sourceId = z.string().min(1).max(500).parse(input.sourceId);
    if (!(release.knowledgeSnapshot || []).some((source: { id?: string }) => String(source.id || '') === sourceId)) throw new Error('Fonte não encontrada nesta versão.');
    const inserted = await client.query(`INSERT INTO agent_studio_knowledge_revocations
      (workspace_id, agent_id, release_id, source_id, reason, revoked_by) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING RETURNING source_id`, [input.workspaceId, input.agentId, input.releaseId, sourceId, reason, input.userId]);
    if (!inserted.rows.length) throw new Error('Esta fonte já foi revogada nesta versão.');
    return { scope: 'knowledge' as const, releaseId: input.releaseId, sourceId };
  }

  const inserted = await client.query(`INSERT INTO agent_studio_release_revocations
    (release_id, workspace_id, agent_id, reason, revoked_by) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT DO NOTHING RETURNING release_id`, [input.releaseId, input.workspaceId, input.agentId, reason, input.userId]);
  if (!inserted.rows.length) throw new Error('Esta versão já foi revogada.');
  return { scope: 'release' as const, releaseId: input.releaseId };
}
