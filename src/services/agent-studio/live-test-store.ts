import 'server-only';

import { randomUUID, createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { withStudioTransaction } from './repository';
import { createStudioSession, type StudioSession } from './engine';
import { sealStudioSession, openStudioSession } from './session-store';
import { AgentReleaseManifestSchema, type AgentReleaseManifest } from './types';

export type LiveTestScope = { workspaceId: string; agentId: string; userId: string; sessionId: string };
export type LiveTestRow = {
  id: string; chat_id: string; workspace_id: string; agent_id: string; user_id: string;
  release: AgentReleaseManifest; encrypted_state: string; revision: number; flow_input: Record<string, unknown>;
  expires_at: Date; lease_token: string | null; lease_expires_at: Date | null;
};
const args = (scope: LiveTestScope) => [scope.sessionId, scope.workspaceId, scope.agentId, scope.userId];
const cipherScope = (scope: LiveTestScope, chatId: string) => ({ workspaceId: scope.workspaceId, agentId: scope.agentId, chatId, contextId: `live-test:${scope.userId}:${scope.sessionId}` });

export async function loadLiveTest(scope: LiveTestScope): Promise<LiveTestRow> {
  const result = await db.query('SELECT * FROM agent_studio_live_tests WHERE id=$1 AND workspace_id=$2 AND agent_id=$3 AND user_id=$4', args(scope));
  if (!result.rows[0]) throw new Error('Teste não encontrado para este agente e usuário.');
  return result.rows[0];
}

export function decodeLiveTest(scope: LiveTestScope, row: LiveTestRow) {
  const release = AgentReleaseManifestSchema.parse(row.release);
  if (release.agentId !== scope.agentId || release.workspaceId !== scope.workspaceId || release.releaseId !== scope.sessionId) throw new Error('Configuração do teste fora do escopo.');
  const state = openStudioSession(cipherScope(scope, row.chat_id), row.encrypted_state);
  if (state.releaseId !== release.releaseId) throw new Error('Estado do teste incompatível com a configuração.');
  return { release, state };
}

export async function createLiveTest(scope: LiveTestScope, release: AgentReleaseManifest, contact: { name: string; phone?: string; email?: string }, flowInput: Record<string, unknown>) {
  return withStudioTransaction(async (client) => {
    // Serializes retries of start only; no transaction is held during a model/tool call.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`studio-live:${scope.sessionId}`]);
    const existing = await client.query('SELECT * FROM agent_studio_live_tests WHERE id=$1', [scope.sessionId]);
    if (existing.rows[0]) {
      const row = existing.rows[0] as LiveTestRow;
      if (row.workspace_id !== scope.workspaceId || row.agent_id !== scope.agentId || row.user_id !== scope.userId) throw new Error('Identificador de teste já utilizado.');
      return row;
    }
    const chatId = randomUUID(), contactId = randomUUID();
    const encrypted = sealStudioSession(cipherScope(scope, chatId), createStudioSession(scope.agentId, scope.sessionId, scope.sessionId));
    // Some installations require contacts.phone NOT NULL. Keep an absent phone
    // empty; the webchat JID identifies this test without inventing a number.
    await client.query(`INSERT INTO contacts (id, workspace_id, name, phone, email, phone_number_jid, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())`, [contactId, scope.workspaceId, `[Teste IA] ${contact.name}`, contact.phone?.trim() || '', contact.email || null, `webchat:studio:${scope.sessionId}`]);
    await client.query(`INSERT INTO chats (id, workspace_id, contact_id, agent_id, status, protocol, autopilot_config_id, is_autopilot_active, copilot_mode, last_activity_at)
      VALUES ($1,$2,$3,$4,'atendimentos',$5,$6,FALSE,'off',NOW())`, [chatId, scope.workspaceId, contactId, scope.userId, `TESTE-${chatId.slice(0, 8).toUpperCase()}`, scope.agentId]);
    const result = await client.query(`INSERT INTO agent_studio_live_tests (id, workspace_id, agent_id, user_id, chat_id, release, encrypted_state, flow_input)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb) RETURNING *`, [...args(scope), chatId, JSON.stringify(release), encrypted, JSON.stringify(flowInput)]);
    return result.rows[0] as LiveTestRow;
  });
}

/** Atomic lease + CAS checkpoints: a retry must read persisted state before dispatching anything. */
export async function claimLiveTest(scope: LiveTestScope) {
  const token = randomUUID();
  const claimed = await db.query(`UPDATE agent_studio_live_tests SET lease_token=$5, lease_expires_at=clock_timestamp()+interval '5 minutes'
    WHERE id=$1 AND workspace_id=$2 AND agent_id=$3 AND user_id=$4 AND expires_at>clock_timestamp()
      AND (lease_token IS NULL OR lease_expires_at<clock_timestamp()) RETURNING *`, [...args(scope), token]);
  if (!claimed.rows[0]) throw new Error('O teste está processando outra mensagem ou expirou. Aguarde e consulte o histórico.');
  const row = claimed.rows[0] as LiveTestRow;
  let revision = row.revision;
  return {
    row,
    checkpoint: async (state: StudioSession) => {
      const saved = await db.query(`UPDATE agent_studio_live_tests SET encrypted_state=$6, revision=revision+1, updated_at=clock_timestamp()
        WHERE id=$1 AND workspace_id=$2 AND agent_id=$3 AND user_id=$4 AND lease_token=$5 AND revision=$7 AND lease_expires_at>clock_timestamp() RETURNING id`,
      [...args(scope), token, sealStudioSession(cipherScope(scope, row.chat_id), state), revision]);
      if (!saved.rows.length) throw new Error('O estado do teste mudou. A operação foi interrompida para evitar duplicação.');
      revision++;
    },
    assertCurrent: async () => {
      const current = await db.query(`SELECT id FROM agent_studio_live_tests WHERE id=$1 AND workspace_id=$2 AND agent_id=$3 AND user_id=$4
        AND lease_token=$5 AND lease_expires_at>clock_timestamp() AND expires_at>clock_timestamp()`, [...args(scope), token]);
      if (!current.rows.length) throw new Error('A execução do teste perdeu a reserva.');
    },
    release: async () => { await db.query('UPDATE agent_studio_live_tests SET lease_token=NULL, lease_expires_at=NULL WHERE id=$1 AND workspace_id=$2 AND agent_id=$3 AND user_id=$4 AND lease_token=$5', [...args(scope), token]); },
  };
}

export function liveTestReplyId(messageId: string) {
  const hex = createHash('sha256').update(`studio-live-reply:${messageId}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export async function readLiveTestView(scope: LiveTestScope) {
  const row = await loadLiveTest(scope);
  const { state, release } = decodeLiveTest(scope, row);
  const chat = await db.query(`SELECT c.status, c.team_id, c.agent_id, c.contact_id, c.protocol, ct.name, ct.phone, ct.email
    FROM chats c JOIN contacts ct ON ct.id=c.contact_id AND ct.workspace_id=c.workspace_id WHERE c.id=$1 AND c.workspace_id=$2`, [row.chat_id, scope.workspaceId]);
  if (!chat.rows[0]) throw new Error('Atendimento do teste indisponível.');
  const messages = await db.query(`SELECT * FROM (SELECT id, type, content, from_me, created_at, metadata FROM messages
    WHERE chat_id=$1 AND workspace_id=$2 AND type<>'system' AND COALESCE((metadata->>'isInternalNote')::boolean,FALSE)=FALSE
    ORDER BY created_at DESC, id DESC LIMIT 100) recent ORDER BY created_at, id`, [row.chat_id, scope.workspaceId]);
  return { sessionId: scope.sessionId, chatId: row.chat_id, state, document: release.agentSnapshot,
    model: release.runtimeConfig?.aiModel || '', chat: chat.rows[0] as { status: string; team_id: string | null; agent_id: string | null; contact_id: string; protocol: string; name: string; phone: string | null; email: string | null },
    expired: new Date(row.expires_at).getTime() <= Date.now(), busy: Boolean(row.lease_token && new Date(row.lease_expires_at!).getTime() > Date.now()),
    messages: messages.rows.map((m) => ({ id: String(m.id), role: m.from_me ? 'bot' as const : 'user' as const,
      text: String(m.content || ''), attachmentUrl: typeof m.metadata?.storageKey === 'string' && m.metadata.storageKey.startsWith(`workspaces/${scope.workspaceId}/message-media/`)
        ? `/api/storage/object?key=${encodeURIComponent(m.metadata.storageKey)}` : null,
      time: new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) })) };
}

export type LiveTestView = Awaited<ReturnType<typeof readLiveTestView>>;
