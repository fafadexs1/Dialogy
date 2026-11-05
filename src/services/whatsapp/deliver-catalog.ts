import 'server-only';

import { db } from '@/lib/db';
import { getEvolutionApiConfig } from '@/lib/whatsapp/evolution-config';
import { getWorkspaceBillingStatus, isBillingBlocked } from '@/lib/billing-logic';
import { buildCatalogPreview, CATALOG_CONNECTION_HELP, supportsWhatsappCatalog, whatsappCatalogSchema } from '@/lib/whatsapp/catalog';
import { sendCatalogMessage } from '@/services/whatsapp/send-catalog-message';
import { archiveOutboundMediaSafely, isTemporaryMediaUrl } from '@/services/messages/archive-outbound-media';
import { resolveSafeAutopilotWebhookTarget } from '@/services/autopilot/automation-rules';
import type { Message, MessageMetadata } from '@/lib/types';

export async function getCatalogTarget(chatId: string, workspaceId: string) {
  const { rows } = await db.query(
    `SELECT c.workspace_id, c.status, ct.phone_number_jid,
            i.instance_name, i.type AS instance_type
     FROM chats c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN LATERAL (
       SELECT m.instance_name FROM messages m
       WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL
       ORDER BY m.created_at DESC LIMIT 1
     ) last_message ON TRUE
     LEFT JOIN evolution_api_instances i
       ON i.workspace_id = c.workspace_id AND i.instance_name = last_message.instance_name
     WHERE c.id = $1 AND c.workspace_id = $2`, [chatId, workspaceId],
  );
  const target = rows[0];
  if (!target) throw new Error('Conversa não encontrada.');
  if (target.status === 'encerrados') throw new Error('Reabra o atendimento antes de enviar o catálogo.');
  if (!supportsWhatsappCatalog(target.instance_type)) throw new Error(CATALOG_CONNECTION_HELP);
  if (!target.phone_number_jid) throw new Error('Contato sem número de WhatsApp.');
  return target as { workspace_id: string; instance_name: string; phone_number_jid: string };
}

export async function deliverWhatsappCatalog(input: {
  chatId: string; workspaceId: string; requestId: string;
  catalog: unknown; senderUserId?: string; senderSystemAgentId?: string;
}): Promise<{ success: boolean; error?: string; warning?: string; message?: Message }> {
  const parsed = whatsappCatalogSchema.safeParse(input.catalog);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message || 'Catálogo inválido.' };
  const { chatId, requestId } = input;
  const catalog = parsed.data;
  let reserved = false;
  let dispatched = false;
  let providerId: string | undefined;
  try {
    const target = await getCatalogTarget(chatId, input.workspaceId);
    if (!input.senderUserId && !input.senderSystemAgentId) throw new Error('Remetente do catálogo não informado.');
    if (isBillingBlocked(await getWorkspaceBillingStatus(target.workspace_id))) {
      throw new Error('Regularize a assinatura do workspace para enviar mensagens.');
    }
    for (const card of catalog.cards) await resolveSafeAutopilotWebhookTarget(card.imageUrl);
    const config = await getEvolutionApiConfig(target.instance_name, { workspaceId: target.workspace_id });
    if (!config) throw new Error('Configuração da conexão WhatsApp não encontrada.');

    const metadata: MessageMetadata = { interactiveType: 'carousel', interactivePayload: { kind: 'carousel', ...catalog } };
    // Reserve the attempt before calling the provider. A repeated request never sends twice,
    // including when the provider accepted but the response or status update was lost.
    const inserted = await db.query(
      `INSERT INTO messages (id, workspace_id, chat_id, type, content, from_me,
         api_message_status, instance_name, source_from_api, metadata, is_read, sender_user_id, sender_system_agent_id)
       VALUES ($1, $2, $3, 'text', $4, true, 'PENDING', $5, 'whatsapp', $6, true, $7, $8)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [requestId, target.workspace_id, chatId, buildCatalogPreview(catalog), target.instance_name, metadata, input.senderUserId || null, input.senderSystemAgentId || null],
    );
    if (!inserted.rows[0]) {
      const existing = await db.query(
        'SELECT * FROM messages WHERE id = $1 AND workspace_id = $2 AND chat_id = $3 AND sender_user_id IS NOT DISTINCT FROM $4 AND sender_system_agent_id IS NOT DISTINCT FROM $5',
        [requestId, target.workspace_id, chatId, input.senderUserId || null, input.senderSystemAgentId || null],
      );
      const row = existing.rows[0];
      if (!row || row.metadata?.interactiveType !== 'carousel') throw new Error('Identificador de envio já utilizado.');
      if (row.api_message_status === 'FAILED') return { success: false, error: 'A tentativa anterior falhou. Revise o catálogo e tente novamente.' };
      return {
        success: true,
        warning: row.message_id_from_api ? undefined : 'Este envio já foi iniciado. Confira o histórico antes de enviar novamente.',
        message: toMessage(row),
      };
    }
    reserved = true;
    // Archive uploaded photos for the conversation history; the provider still receives
    // their public upload URLs, because the private archive requires authentication.
    const storedCards = [];
    for (const card of catalog.cards) {
      const archived = isTemporaryMediaUrl(card.imageUrl)
        ? await archiveOutboundMediaSafely({ workspaceId: target.workspace_id, sourceUrl: card.imageUrl, mimetype: 'image/jpeg' })
        : null;
      storedCards.push({ ...card, imageUrl: archived?.url || card.imageUrl });
    }
    const storedMetadata: MessageMetadata = { ...metadata, interactivePayload: { kind: 'carousel', ...catalog, cards: storedCards } };
    await db.query('UPDATE messages SET metadata = $2 WHERE id = $1', [requestId, storedMetadata]);
    dispatched = true;
    providerId = await sendCatalogMessage(config, target.instance_name, target.phone_number_jid, catalog);
    const saved = await db.query(
      `UPDATE messages SET message_id_from_api = $2, api_message_status = 'SENT'
       WHERE id = $1 RETURNING *`, [requestId, providerId],
    );
    return { success: true, message: toMessage(saved.rows[0]) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Falha ao enviar catálogo.';
    const rejected = /^Evolution API Error: 4(?!08)\d\d\b/.test(detail);
    if (reserved) {
      try {
        await db.query(
          `UPDATE messages SET api_message_status = $2,
             metadata = metadata || $3::jsonb WHERE id = $1`,
          [requestId, providerId ? 'SENT' : dispatched && !rejected ? 'UNKNOWN' : 'FAILED', JSON.stringify({ send_error: detail })],
        );
      } catch { /* The reserved attempt still prevents another provider send. */ }
    }
    console.error('[WHATSAPP_CATALOG]', detail);
    if (dispatched && !rejected) {
      return {
        success: true,
        warning: providerId
          ? 'Catálogo aceito pelo WhatsApp; houve uma falha ao atualizar o histórico.'
          : 'O envio foi iniciado, mas a confirmação não chegou. Confira o WhatsApp antes de reenviar.',
      };
    }
    return { success: false, error: detail };
  }
}

function toMessage(row: Record<string, unknown>): Message {
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return { ...row, createdAt, timestamp: createdAt } as Message;
}
