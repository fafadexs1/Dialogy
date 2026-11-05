import 'server-only';

import { z } from 'zod';
import { db } from '@/lib/db';
import type { NodeRuntimeInput } from '@/services/workflow-runtime';
import { enqueueContactConversionExport } from '@/services/google-ads/conversion-queue';

export const GoogleAdsLeadConfig = z.object({
  customerId: z.string().regex(/^\d+$/),
  eventName: z.enum(['lead_qualified', 'sale_won', 'whatsapp_message_received']),
  conversionActionId: z.string().min(1),
});

export async function loadNexusGoogleAdsOptions(workspaceId: string) {
  const result = await db.query(`SELECT w.google_ads_customer_id,
    w.google_ads_conversion_action_lead_qualified,
    w.google_ads_conversion_action_sale_won,
    w.google_ads_conversion_action_whatsapp_message,
    EXISTS (SELECT 1 FROM workspace_integrations wi WHERE wi.workspace_id = w.id AND wi.provider = 'gads' AND wi.is_active = true
      AND COALESCE(wi.config->>'refreshToken', '') <> '') AS connected
    FROM workspaces w WHERE w.id = $1`, [workspaceId]);
  const row = result.rows[0];
  const customerId = String(row?.google_ads_customer_id || '').replace(/\D/g, '');
  const conversions = [
    { eventName: 'lead_qualified', label: 'Lead qualificado', conversionActionId: row?.google_ads_conversion_action_lead_qualified },
    { eventName: 'sale_won', label: 'Venda concluída', conversionActionId: row?.google_ads_conversion_action_sale_won },
    { eventName: 'whatsapp_message_received', label: 'Contato pelo WhatsApp', conversionActionId: row?.google_ads_conversion_action_whatsapp_message },
  ].filter((item) => typeof item.conversionActionId === 'string' && item.conversionActionId.trim())
    .map((item) => ({ ...item, conversionActionId: String(item.conversionActionId) }));
  return { customerId, connected: Boolean(row?.connected && customerId), conversions };
}

export async function assertNexusGoogleAdsBinding(workspaceId: string, config: Record<string, unknown>) {
  const selected = GoogleAdsLeadConfig.parse(config);
  const options = await loadNexusGoogleAdsOptions(workspaceId);
  if (!options.connected || options.customerId !== selected.customerId
    || !options.conversions.some((item) => item.eventName === selected.eventName && item.conversionActionId === selected.conversionActionId)) {
    throw new Error('Selecione a conta conectada e uma conversão disponível nesta workspace.');
  }
  return selected;
}

export async function sendNexusGoogleAdsLead(input: NodeRuntimeInput) {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('Workspace ausente.');
  const selected = await assertNexusGoogleAdsBinding(workspaceId, input.node.config);
  const chatId = input.execution.conversationId;
  const contactId = input.execution.input.contactId;
  const contact = chatId
    ? await db.query('SELECT c.id FROM contacts c JOIN chats ch ON ch.contact_id = c.id AND ch.workspace_id = c.workspace_id WHERE ch.id = $1 AND c.workspace_id = $2', [chatId, workspaceId])
    : typeof contactId === 'string'
      ? await db.query('SELECT id FROM contacts WHERE id = $1 AND workspace_id = $2', [contactId, workspaceId])
      : { rows: [] };
  if (!contact.rows[0]) throw new Error('O fluxo precisa de um contato desta workspace.');
  const result = await enqueueContactConversionExport({
    workspaceId, contactId: String(contact.rows[0].id), eventName: selected.eventName,
    expectedCustomerId: selected.customerId, expectedConversionActionId: selected.conversionActionId,
  });
  if (!result.enqueued) {
    if (result.reason === 'already_queued') return { status: 'already_queued', enqueued: false, delivered: false };
    throw new Error('Lead não enfileirado: verifique a atribuição do anúncio e a configuração da conversão.');
  }
  return { status: 'queued', enqueued: true, delivered: false };
}
