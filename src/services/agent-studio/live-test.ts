import 'server-only';

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import type { AutopilotConfig, Contact } from '@/lib/types';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';
import { claimLiveTest, decodeLiveTest, liveTestReplyId, readLiveTestView, type LiveTestScope } from './live-test-store';
import { runStudioConversation } from './runtime';
import type { AgentToolAction } from '@/services/agent-tools/types';

export type LiveTestAttachment = { file: File };

async function runLiveNative(scope: LiveTestScope, chatId: string, action: AgentToolAction, confirmed: boolean, outOfHoursMessage: string) {
  // Use normal authenticated actions: team availability, chat access, audit and event dispatch still apply.
  const { closeChatAction, transferChatAction } = await import('@/actions/chats');
  if (action.type === 'close_chat') {
    if (!confirmed) throw new Error('Confirme o encerramento no chat antes de continuar.');
    const result = await closeChatAction(chatId, null, action.reason || 'Teste real do Estúdio', false, { studioLiveTestId: scope.sessionId });
    if (!result.success) throw new Error(result.error || 'Não foi possível encerrar o atendimento.');
    return;
  }
  if (action.type !== 'transfer_chat') throw new Error('Ação nativa não suportada.');
  const team = await db.query('SELECT id, name FROM teams WHERE workspace_id=$1 AND (id::text=$2 OR name=$3) LIMIT 1', [scope.workspaceId, action.payload?.teamId || '', action.payload?.teamName || '']);
  if (!team.rows[0]) throw new Error('Equipe de destino indisponível neste workspace.');
  const result = await transferChatAction({ chatId, teamId: team.rows[0].id });
  if (result.success) return { message: `Vou encaminhar seu atendimento para a equipe ${team.rows[0].name} continuar com você.` };
  if (!result.reasonCode) throw new Error(result.error || 'Não foi possível transferir o atendimento.');
  const queued = await db.query(`UPDATE chats SET agent_id=NULL, assigned_system_agent_id=NULL, team_id=$3,
      is_autopilot_active=FALSE, copilot_mode='off', status='gerais', assigned_at=NULL, updated_at=clock_timestamp()
    WHERE id=$1 AND workspace_id=$2 AND status<>'encerrados' RETURNING id`, [chatId, scope.workspaceId, team.rows[0].id]);
  if (!queued.rows.length) throw new Error('O atendimento mudou antes de entrar na fila da equipe.');
  await db.query(`INSERT INTO messages (id,workspace_id,chat_id,type,content,metadata,created_at)
    VALUES ($1,$2,$3,'system',$4,$5::jsonb,clock_timestamp())`, [randomUUID(), scope.workspaceId, chatId,
    `Atendimento encaminhado para a fila de ${team.rows[0].name}.`, JSON.stringify({ event: 'transfer_queued', to_team_id: team.rows[0].id, reason: result.reasonCode })]);
  return { message: result.reasonCode === 'outside_business_hours'
    ? outOfHoursMessage
    : `Recebi seus dados. A equipe ${team.rows[0].name} está indisponível agora, mas seu atendimento ficou na fila para acompanhamento.` };
}

export async function sendLiveTestMessage(scope: LiveTestScope, config: AutopilotConfig, messageId: string, text: string, attachment?: LiveTestAttachment) {
  const lease = await claimLiveTest(scope);
  try {
    const { row } = lease;
    const { state, release } = decodeLiveTest(scope, row);
    const chat = await db.query(`SELECT c.*, to_jsonb(ct) AS contact FROM chats c JOIN contacts ct ON ct.id=c.contact_id AND ct.workspace_id=c.workspace_id
      WHERE c.id=$1 AND c.workspace_id=$2`, [row.chat_id, scope.workspaceId]);
    if (!chat.rows[0]) throw new Error('Atendimento do teste indisponível.');
    const replay = state.lastTurn?.messageId === messageId || state.processedMessageIds?.includes(messageId);
    if (!replay && state.inFlight) throw new Error('Uma operação anterior ficou sem confirmação. Confira o resultado no sistema antes de iniciar outro teste; ela não será repetida.');
    if (!replay && (chat.rows[0].status === 'encerrados' || ['resolved', 'failed', 'cancelled'].includes(state.status))) throw new Error('Este teste terminou. Inicie um novo teste para conversar novamente com o agente.');
    if (!replay && state.status !== 'transferred' && chat.rows[0].agent_id !== scope.userId) {
      state.phase = 'done'; state.status = 'transferred'; state.pendingField = null; state.confirmation = null;
      state.events.push({ stepId: 'handoff', label: 'Atendimento assumido pela equipe no Inbox', kind: 'transferred', at: new Date().toISOString() });
      await lease.checkpoint(state);
    }
    const assertCurrent = async () => {
      await lease.assertCurrent();
      const current = await db.query("SELECT id FROM chats WHERE id=$1 AND workspace_id=$2 AND status<>'encerrados' AND agent_id=$3", [row.chat_id, scope.workspaceId, scope.userId]);
      if (!current.rows.length) throw new Error('O atendimento foi encerrado ou assumido pela equipe. A execução do agente foi interrompida.');
    };
    const existing = await db.query('SELECT chat_id, workspace_id, content, metadata FROM messages WHERE id=$1', [messageId]);
    if (existing.rows[0] && (existing.rows[0].chat_id !== row.chat_id || existing.rows[0].workspace_id !== scope.workspaceId || existing.rows[0].content !== text || existing.rows[0].metadata?.studioLiveTestId !== scope.sessionId)) {
      throw new Error('Identificador de mensagem já utilizado.');
    }
    if (!existing.rows[0]) {
      const recent = await db.query(`SELECT count(*)::int AS count FROM messages WHERE chat_id=$1 AND workspace_id=$2 AND from_me=FALSE AND created_at>clock_timestamp()-interval '1 minute'`, [row.chat_id, scope.workspaceId]);
      if (Number(recent.rows[0]?.count || 0) >= 20) throw new Error('Muitas mensagens. Aguarde um minuto antes de continuar.');
      const metadata: Record<string, unknown> = { studioLiveTestId: scope.sessionId, testedBy: scope.userId };
      if (attachment) {
        const { file } = attachment;
        const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv' };
        // Leave space for FormData fields under the app's 10 MB server-action limit.
        if (!extensions[file.type] || file.size <= 0 || file.size > 9 * 1024 * 1024) throw new Error('Envie PDF, imagem, TXT ou CSV com até 9 MB.');
        const { putPrivateObject } = await import('@/lib/storage/private-s3');
        const key = `workspaces/${scope.workspaceId}/message-media/${messageId}.${extensions[file.type]}`;
        await putPrivateObject({ key, body: Buffer.from(await file.arrayBuffer()), contentType: file.type });
        Object.assign(metadata, { storageKey: key, mediaUrl: `/api/storage/object?key=${encodeURIComponent(key)}`, storageProvider: 'minio',
          fileName: file.name.slice(0, 255), mimetype: file.type, archivedContentType: file.type, archivedSize: file.size });
      }
      await db.query(`INSERT INTO messages (id,workspace_id,chat_id,type,content,from_me,is_read,api_message_status,instance_name,source_from_api,metadata,created_at)
        VALUES ($1,$2,$3,$4,$5,FALSE,FALSE,'RECEIVED','Estúdio IA','webchat',$6::jsonb,clock_timestamp())`,
      [messageId, scope.workspaceId, row.chat_id, attachment ? (attachment.file.type.startsWith('image/') ? 'image' : 'document') : 'text', text, JSON.stringify(metadata)]);
      await db.query('UPDATE chats SET last_activity_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1 AND workspace_id=$2', [row.chat_id, scope.workspaceId]);
    }
    // Once a human takes over, messages still reach the real inbox; the AI no longer replies.
    if (state.status === 'transferred' && !replay) return;
    const history = await db.query(`SELECT * FROM (SELECT content, from_me, created_at, id FROM messages
      WHERE chat_id=$1 AND workspace_id=$2 AND id<>$3 AND type<>'system' AND COALESCE((metadata->>'isInternalNote')::boolean,FALSE)=FALSE
      ORDER BY created_at DESC,id DESC LIMIT 40) recent ORDER BY created_at,id`, [row.chat_id, scope.workspaceId, messageId]);
    const runtimeContact = { ...chat.rows[0].contact } as Contact;
    if (/^\[Teste IA\]\s*Cliente de teste$/i.test(runtimeContact.name || '')) runtimeContact.name = '';
    const result = replay
      ? { state, response: state.lastTurn?.messageId === messageId ? state.lastTurn.response : '' }
      : await runStudioConversation({ release, state, config, chatId: row.chat_id, messageId, message: text,
        contact: runtimeContact, flowInput: row.flow_input, testMode: true,
        chatHistory: history.rows.map((m) => `${m.from_me ? 'Agente' : 'Cliente'}: ${m.content || ''}`).join('\n'),
        checkpoint: lease.checkpoint, assertCurrent,
        runNative: async (action, operation) => {
          await assertCurrent();
          return runLiveNative(scope, row.chat_id, action, operation.confirmed, release.agentSnapshot.rules.outOfHoursMessage);
        },
      });
    // A checkpoint may have succeeded before the response delivery failed. A retry only redelivers.
    const response = result.response || (result.state.status === 'resolved' ? release.agentSnapshot.concludeStage.successClosingMessage : '');
    if (response) await db.query(`INSERT INTO messages (id,workspace_id,chat_id,type,content,from_me,is_read,api_message_status,instance_name,source_from_api,metadata,created_at)
      VALUES ($1,$2,$3,'text',$4,TRUE,TRUE,'SENT','Estúdio IA','webchat',$5::jsonb,clock_timestamp()) ON CONFLICT (id) DO NOTHING`,
    [liveTestReplyId(messageId), scope.workspaceId, row.chat_id, response, JSON.stringify({ studioLiveTestId: scope.sessionId, sourceMessageId: messageId, agentId: scope.agentId })]);
  } finally {
    await lease.release();
    await broadcastHydratedChatUpdate(scope.workspaceId, lease.row.chat_id).catch(() => {});
  }
}

export { readLiveTestView };
