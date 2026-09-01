import 'server-only';

import type { PoolClient } from 'pg';
import { db } from '@/lib/db';
import { AgentReleaseManifestSchema, AgentStudioDocumentSchema, type AgentReleaseManifest, type AgentStudioDocument } from './types';

export function parseStudioSnapshot(value: unknown): AgentStudioDocument | null {
  const snapshot = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const stored = snapshot.agent_studio_document ?? snapshot.studio_document;
  if (stored === undefined) return null;
  const parsed = AgentStudioDocumentSchema.safeParse(stored);
  if (!parsed.success) throw new Error('O rascunho salvo não pôde ser lido. Ele foi preservado; não substitua por um modelo.');
  return parsed.data;
}

export async function loadStudioRelease(workspaceId: string, agentId: string, releaseId?: string): Promise<AgentReleaseManifest | null> {
  const result = await db.query(
    `SELECT v.snapshot, r.release_id AS revoked,
        (SELECT array_agg(k.source_id) FROM agent_studio_knowledge_revocations k
          WHERE k.workspace_id = v.workspace_id AND k.agent_id = v.config_id
            AND k.release_id::text = v.snapshot->'agent_release_manifest'->>'releaseId') AS revoked_sources
      FROM autopilot_config_versions v
      LEFT JOIN agent_studio_release_revocations r ON r.workspace_id = v.workspace_id AND r.agent_id = v.config_id
        AND r.release_id::text = v.snapshot->'agent_release_manifest'->>'releaseId'
      WHERE v.workspace_id = $1 AND v.config_id = $2
        ${releaseId ? "AND v.snapshot->'agent_release_manifest'->>'releaseId' = $3" : ''}
      ORDER BY v.version_number DESC LIMIT 1`,
    releaseId ? [workspaceId, agentId, releaseId] : [workspaceId, agentId],
  );
  const stored = result.rows[0]?.snapshot?.agent_release_manifest;
  if (!stored) {
    if (releaseId) throw new Error('A versão fixada do agente não está disponível.');
    return null;
  }
  if (result.rows[0]?.revoked) throw new Error('Esta versão do agente foi revogada por um administrador e não pode mais executar.');
  const release = AgentReleaseManifestSchema.parse(stored);
  if (release.workspaceId !== workspaceId || release.agentId !== agentId) throw new Error('A versão não pertence a este agente e workspace.');
  if (release.runtimeVersion !== 'studio-v1') throw new Error('Esta publicação antiga do Estúdio precisa ser revisada e publicada novamente.');
  const revokedSources = new Set((result.rows[0]?.revoked_sources || []).map(String));
  return revokedSources.size ? { ...release, knowledgeSnapshot: (release.knowledgeSnapshot || []).filter((source) => !revokedSources.has(String(source.id || ''))) } : release;
}

export async function lockStudioDraft(client: PoolClient, workspaceId: string, agentId: string, expectedRevision: number) {
  const config = await client.query('SELECT * FROM autopilot_configs WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [workspaceId, agentId]);
  if (!config.rows[0]) throw new Error('Agente não encontrado.');
  const drafts = await client.query('SELECT snapshot FROM autopilot_config_drafts WHERE workspace_id = $1 AND config_id = $2', [workspaceId, agentId]);
  const versions = await client.query('SELECT snapshot, version_number FROM autopilot_config_versions WHERE workspace_id = $1 AND config_id = $2 ORDER BY version_number DESC LIMIT 1', [workspaceId, agentId]);
  const draft = drafts.rows[0]?.snapshot as Record<string, unknown> | undefined;
  const published = versions.rows[0]?.snapshot as Record<string, unknown> | undefined;
  const current = parseStudioSnapshot(draft) || parseStudioSnapshot(published);
  const revision = current?.draftRevision || 0;
  if (revision !== expectedRevision) throw new Error('Este agente foi alterado em outra aba. Recarregue para revisar as mudanças; suas alterações locais não foram sobrescritas.');
  return { row: config.rows[0] as Record<string, unknown>, draft: draft || {}, published: published || {}, revision, nextVersion: Number(versions.rows[0]?.version_number || 0) + 1 };
}

/** All authoring mutations share the config-row lock, including draft deletion at publish. */
export async function withStudioTransaction<T>(task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const result = await task(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
