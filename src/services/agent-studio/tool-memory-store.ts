import 'server-only';
import { createHmac } from 'node:crypto';
import { db } from '@/lib/db';
import { decryptWithKey, encryptWithKey } from '@/lib/security/secret-box';
import { safeCompleteObservationResult, safeObservationResult, type StudioFlowState } from './flow-execution';

export type StudioToolMemoryScope = { workspaceId: string; contactId: string; agentId: string; releaseId: string };
type Observation = StudioFlowState['observations'][number];
const envName = 'WORKSPACE_CREDENTIALS_ENCRYPTION_KEY';
const key = () => process.env[envName] || process.env.META_PAYLOAD_ENCRYPTION_KEY;
const missingTable = (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === '42P01');
function configuredLimit(name: string, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) throw new Error(`Configuração inválida: ${name}.`);
  return parsed;
}
const retentionDays = () => configuredLimit('STUDIO_TOOL_MEMORY_RETENTION_DAYS', 36500);
const maxPerTool = () => configuredLimit('STUDIO_TOOL_MEMORY_MAX_PER_TOOL', 1000000);

/** The latest workspace or contact reset invalidates older operational results as well as stored memories. */
export async function readStudioToolMemoryReset(workspaceId: string, contactId: string): Promise<string | null> {
  try {
    const { rows } = await db.query(`SELECT string_agg(scope_key || '=' || generation::text, '|' ORDER BY scope_key) AS generation FROM public.studio_tool_memory_resets
      WHERE workspace_id=$1 AND scope_key = ANY($2::text[])`, [workspaceId, ['workspace', `contact:${contactId}`]]);
    return rows[0]?.generation ? String(rows[0].generation) : null;
  } catch (error) { if (!missingTable(error)) throw error; return null; }
}

/** Only server-side callers with an already-authorized active capability may provide its identity. */
export async function readStudioToolMemory(scope: StudioToolMemoryScope, allowed: Map<string, string>, options: { offset?: number; limit?: number } = {}): Promise<Observation[]> {
  if (!allowed.size) return [];
  const offset = Math.max(0, Math.min(10000, Math.trunc(options.offset || 0)));
  const limit = Math.max(1, Math.min(64, Math.trunc(options.limit || 64)));
  const generation = await readStudioToolMemoryReset(scope.workspaceId, scope.contactId);
  let result;
  try { result = await db.query(`SELECT m.tool_key, m.release_id, m.encrypted FROM public.studio_tool_memory m
    JOIN public.contacts c ON c.id=m.contact_id AND c.workspace_id=m.workspace_id
    JOIN public.autopilot_configs a ON a.id=m.agent_id AND a.workspace_id=m.workspace_id
    WHERE m.workspace_id=$1 AND m.contact_id=$2 AND m.agent_id=$3 AND m.tool_key = ANY($4::text[])
      AND ($5::integer = 0 OR m.observed_at > now() - make_interval(days => $5::integer))
      AND m.source_reset IS NOT DISTINCT FROM $8::text
      AND (SELECT string_agg(r.scope_key || '=' || r.generation::text, '|' ORDER BY r.scope_key) FROM public.studio_tool_memory_resets r
        WHERE r.workspace_id=m.workspace_id AND r.scope_key IN ('workspace', 'contact:' || m.contact_id::text)) IS NOT DISTINCT FROM $8::text
    ORDER BY m.observed_at DESC, m.observation_id DESC LIMIT $6 OFFSET $7`, [scope.workspaceId, scope.contactId, scope.agentId, [...allowed.keys()], retentionDays(), limit, offset, generation]); }
  catch (error) { if (!missingTable(error)) throw error; console.warn('[STUDIO_TOOL_MEMORY] Migration pendente; memória indisponível.'); return []; }
  return result.rows.flatMap((row) => {
    const payload = JSON.parse(decryptWithKey(String(row.encrypted), key(), envName));
    const name = allowed.get(String(row.tool_key));
    if (!name || payload.workspaceId !== scope.workspaceId || payload.contactId !== scope.contactId || payload.agentId !== scope.agentId
      || payload.releaseId !== String(row.release_id) || payload.toolKey !== row.tool_key || payload.observation?.name !== name) throw new Error('Memória de ferramenta fora do escopo autorizado.');
    return (payload.observation?.sourceReset || null) === generation ? [payload.observation as Observation] : [];
  }).reverse();
}

export async function writeStudioToolMemory(scope: StudioToolMemoryScope, toolKey: string, observation: Observation) {
  if (!/^[a-f0-9]{64}$/.test(toolKey) || !observation.observedAt || observation.result.status !== 'completed' || observation.result.approval) return;
  observation = { ...observation, result: safeCompleteObservationResult(observation.result) };
  const complete = JSON.stringify(observation.result);
  if (Buffer.byteLength(complete, 'utf8') > 12_000_000) throw new Error('Resultado excede o limite de memória completa de 12 MB.');
  const id = createHmac('sha256', key()!).update(JSON.stringify({ ...scope, toolKey, observation })).digest('hex');
  const pieces: string[] = [];
  for (let index = 0; index < complete.length;) {
    let end = Math.min(index + 3000, complete.length);
    if (end < complete.length && /[\uD800-\uDBFF]/.test(complete[end - 1])) end--;
    pieces.push(complete.slice(index, end)); index = end;
  }
  if (pieces.length > 5000) throw new Error('Resultado excede o limite de páginas da memória.');
  let preview: Observation = { ...observation, result: safeObservationResult(observation.result), content: { id, pages: pieces.length, format: 'json' } };
  let payload = JSON.stringify({ ...scope, toolKey, observation: preview });
  if (Buffer.byteLength(payload, 'utf8') > 24_000) {
    preview = { ...preview, result: { status: 'completed', response: preview.result.response.slice(0, 1000), data: { omitted: 'Consulte as páginas para o conteúdo completo.' } } };
    payload = JSON.stringify({ ...scope, toolKey, observation: preview });
  }
  if (Buffer.byteLength(payload, 'utf8') > 24_000) throw new Error('Resultado excede o limite de memória da ferramenta.');
  const encrypted = encryptWithKey(payload, key(), envName);
  const pages = pieces.map((content, page) => encryptWithKey(JSON.stringify({ ...scope, toolKey, id, page, content }), key(), envName));
  const days = retentionDays(), maximum = maxPerTool();
  try {
    await db.query(`WITH saved AS (INSERT INTO public.studio_tool_memory(workspace_id,contact_id,agent_id,release_id,tool_key,observation_id,encrypted,observed_at,source_reset)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$10::text FROM public.contacts c
      JOIN public.autopilot_configs a ON a.id=$3 AND a.workspace_id=c.workspace_id
      WHERE c.id=$2 AND c.workspace_id=$1 AND ($9::integer = 0 OR $8::timestamptz > now() - make_interval(days => $9::integer))
        AND (SELECT string_agg(r.scope_key || '=' || r.generation::text, '|' ORDER BY r.scope_key) FROM public.studio_tool_memory_resets r WHERE r.workspace_id=$1
          AND r.scope_key IN ('workspace', 'contact:' || $2::text)) IS NOT DISTINCT FROM $10::text
      ON CONFLICT DO NOTHING RETURNING 1)
      INSERT INTO public.studio_tool_memory_content(workspace_id,contact_id,agent_id,release_id,tool_key,observation_id,page,encrypted)
      SELECT $1,$2,$3,$4,$5,$6,(p.ordinality-1)::integer,p.encrypted FROM saved CROSS JOIN unnest($11::text[]) WITH ORDINALITY AS p(encrypted, ordinality)`,
    [scope.workspaceId, scope.contactId, scope.agentId, scope.releaseId, toolKey, id, encrypted, observation.observedAt, days, observation.sourceReset || null, pages]);
    if (days || maximum) await db.query(`DELETE FROM public.studio_tool_memory WHERE workspace_id=$1 AND contact_id=$2 AND agent_id=$3 AND release_id=$4 AND tool_key=$5
      AND (($6::integer > 0 AND observed_at <= now() - make_interval(days => $6::integer)) OR ($7::integer > 0 AND observation_id IN (
        SELECT observation_id FROM public.studio_tool_memory WHERE workspace_id=$1 AND contact_id=$2 AND agent_id=$3 AND release_id=$4 AND tool_key=$5
        ORDER BY observed_at DESC, observation_id DESC OFFSET $7::integer)))`, [scope.workspaceId, scope.contactId, scope.agentId, scope.releaseId, toolKey, days, maximum]);
  }
  catch (error) { if (!missingTable(error)) throw error; throw new Error('Migração de memória completa pendente.'); }
}

/** Retrieve a single independently encrypted JSON page; callers must recheck tool authorization. */
export async function readStudioToolMemoryContent(scope: StudioToolMemoryScope, toolKey: string, id: string, page: number): Promise<{ content: string; page: number; nextPage: number | null } | null> {
  if (!/^[a-f0-9]{64}$/.test(toolKey) || !/^[a-f0-9]{64}$/.test(id) || !Number.isInteger(page) || page < 0 || page >= 5000) throw new Error('Página de memória inválida.');
  const generation = await readStudioToolMemoryReset(scope.workspaceId, scope.contactId);
  const result = await db.query(`SELECT c.encrypted, c.release_id, m.encrypted AS metadata FROM public.studio_tool_memory_content c
    JOIN public.studio_tool_memory m USING(workspace_id,contact_id,agent_id,release_id,tool_key,observation_id)
    JOIN public.contacts ct ON ct.id=m.contact_id AND ct.workspace_id=m.workspace_id
    JOIN public.autopilot_configs a ON a.id=m.agent_id AND a.workspace_id=m.workspace_id
    WHERE m.workspace_id=$1 AND m.contact_id=$2 AND m.agent_id=$3 AND m.tool_key=$4 AND m.observation_id=$5 AND c.page=$6
      AND ($7::integer = 0 OR m.observed_at > now() - make_interval(days => $7::integer)) AND m.source_reset IS NOT DISTINCT FROM $8::text
      AND (SELECT string_agg(r.scope_key || '=' || r.generation::text, '|' ORDER BY r.scope_key) FROM public.studio_tool_memory_resets r
        WHERE r.workspace_id=m.workspace_id AND r.scope_key IN ('workspace', 'contact:' || m.contact_id::text)) IS NOT DISTINCT FROM $8::text`,
  [scope.workspaceId, scope.contactId, scope.agentId, toolKey, id, page, retentionDays(), generation]);
  if (!result.rows.length) return null;
  const row = result.rows[0];
  const item = JSON.parse(decryptWithKey(String(row.encrypted), key(), envName));
  const metadata = JSON.parse(decryptWithKey(String(row.metadata), key(), envName));
  if (item.workspaceId !== scope.workspaceId || item.contactId !== scope.contactId || item.agentId !== scope.agentId || item.releaseId !== String(row.release_id)
    || item.toolKey !== toolKey || item.id !== id || item.page !== page || typeof item.content !== 'string'
    || metadata.observation?.content?.id !== id || (metadata.observation?.sourceReset || null) !== generation) throw new Error('Conteúdo de memória fora do escopo autorizado.');
  if (await readStudioToolMemoryReset(scope.workspaceId, scope.contactId) !== generation) return null;
  const pages = Number(metadata.observation.content.pages);
  return { content: item.content, page, nextPage: page + 1 < pages ? page + 1 : null };
}

/** Erase all remembered results for a contact and agent; access remains server-only. */
export async function deleteStudioToolMemory(scope: Omit<StudioToolMemoryScope, 'releaseId'>) {
  await db.query('DELETE FROM public.studio_tool_memory WHERE workspace_id=$1 AND contact_id=$2 AND agent_id=$3', [scope.workspaceId, scope.contactId, scope.agentId]);
}

export async function purgeExpiredStudioToolMemory() {
  const days = retentionDays();
  try { return await db.query(`DELETE FROM public.studio_tool_memory m WHERE
    ($1::integer > 0 AND m.observed_at <= now() - make_interval(days => $1::integer)) OR m.source_reset IS DISTINCT FROM (
      SELECT string_agg(r.scope_key || '=' || r.generation::text, '|' ORDER BY r.scope_key) FROM public.studio_tool_memory_resets r
      WHERE r.workspace_id=m.workspace_id AND r.scope_key IN ('workspace', 'contact:' || m.contact_id::text))`, [days]); }
  catch (error) { if (!missingTable(error)) throw error; return { rowCount: 0 }; }
}
