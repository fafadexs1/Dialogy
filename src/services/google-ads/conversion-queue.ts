import { db } from '@/lib/db';
import {
  LEAD_QUALIFIED_EVENT,
  SALE_WON_EVENT,
  WHATSAPP_MESSAGE_EVENT,
} from '@/lib/marketing-attribution';

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

/**
 * Cada evento tem a sua propria acao de conversao no Google Ads. O mapa e fixo
 * para que o nome da coluna nunca venha de entrada do usuario.
 */
const CONVERSION_ACTION_COLUMN_BY_EVENT: Record<string, string> = {
  [WHATSAPP_MESSAGE_EVENT]: 'google_ads_conversion_action_whatsapp_message',
  [LEAD_QUALIFIED_EVENT]: 'google_ads_conversion_action_lead_qualified',
  [SALE_WON_EVENT]: 'google_ads_conversion_action_sale_won',
};

export function conversionActionColumnForEvent(eventName: string): string | null {
  return CONVERSION_ACTION_COLUMN_BY_EVENT[eventName] ?? null;
}

export function buildDeterministicOrderId(eventName: string, anchorId: string): string {
  return `${eventName}:${anchorId}`;
}

export function buildDeterministicTransactionId(
  workspaceId: string,
  eventName: string,
  anchorId: string
): string {
  return `dialogy:${workspaceId}:${eventName}:${anchorId}`;
}

export function extractNumericProductDestinationId(
  rawConversionAction: string | null | undefined
): string | null {
  if (!rawConversionAction) return null;
  const raw = String(rawConversionAction).trim();
  let target = raw;
  if (target.includes('conversionActions/')) {
    target = target.split('conversionActions/')[1] || target;
  } else if (target.includes('/')) {
    target = target.split('/').pop() || target;
  }
  const digits = target.replace(/\D/g, '');
  return digits || null;
}

export type EnqueueResult = { enqueued: boolean; reason?: string };

type EnqueueParams = {
  workspaceId: string;
  contactId: string;
  eventName: string;
  value?: number | null;
  currency?: string | null;
  dealId?: string | null;
  orderId?: string | null;
  transactionId?: string | null;
  executor?: Queryable;
  expectedCustomerId?: string;
  expectedConversionActionId?: string;
};

/**
 * Enfileira uma conversao para o contato, desde que ele tenha vindo de um
 * anuncio e seja elegivel para export (protegendo o Smart Bidding).
 */
export async function enqueueContactConversionExport(params: EnqueueParams): Promise<EnqueueResult> {
  const column = conversionActionColumnForEvent(params.eventName);
  if (!column) return { enqueued: false, reason: 'evento_desconhecido' };
  if (!params.workspaceId || !params.contactId) return { enqueued: false, reason: 'parametros_incompletos' };

  const executor = params.executor ?? db;
  const anchorId = params.dealId || params.contactId;
  const orderId = params.orderId || buildDeterministicOrderId(params.eventName, anchorId);
  const transactionId =
    params.transactionId || buildDeterministicTransactionId(params.workspaceId, params.eventName, anchorId);

  const result = await executor.query(
    `
    INSERT INTO conversion_exports (
      workspace_id, ad_attribution_id, event_name, conversion_action_id,
      product_destination_id, google_ads_customer_id, transaction_id,
      conversion_value, currency, status, kind, deal_id, order_id, payload
    )
    SELECT
      aa.workspace_id,
      aa.id,
      $3::text,
      NULLIF(w.${column}, ''),
      NULLIF(regexp_replace(regexp_replace(w.${column}, '^.*/', ''), '\\D', '', 'g'), ''),
      NULLIF(regexp_replace(w.google_ads_customer_id, '\\D', '', 'g'), ''),
      $8::text,
      $4::numeric,
      $5::text,
      'pending',
      'conversion',
      $6::text,
      $7::text,
      jsonb_build_object(
        'event_name', $3::text,
        'contact_id', aa.contact_id,
        'chat_id', aa.chat_id,
        'message_id', aa.message_id,
        'ad_click_id', aa.ad_click_id,
        'deal_id', $6::text,
        'transaction_id', $8::text
      )
    FROM ad_attributions aa
    JOIN workspaces w ON w.id = aa.workspace_id::uuid
    WHERE aa.workspace_id = $1
      AND aa.contact_id = $2
      AND COALESCE(aa.export_eligible, true) = true
      AND NULLIF(w.${column}, '') IS NOT NULL
      AND ($9::text IS NULL OR regexp_replace(w.google_ads_customer_id, '\\D', '', 'g') = $9)
      AND ($10::text IS NULL OR w.${column} = $10)
    ORDER BY aa.attributed_at DESC
    LIMIT 1
    ON CONFLICT (workspace_id, event_name, transaction_id) WHERE kind = 'conversion' DO NOTHING
    `,
    [
      params.workspaceId,
      params.contactId,
      params.eventName,
      params.value ?? 1,
      params.currency || 'BRL',
      params.dealId ?? null,
      orderId,
      transactionId,
      params.expectedCustomerId ?? null,
      params.expectedConversionActionId ?? null,
    ]
  );

  if ((result.rowCount ?? 0) === 0 && params.expectedCustomerId && params.expectedConversionActionId) {
    const existing = await executor.query(`SELECT id FROM conversion_exports
      WHERE workspace_id = $1 AND event_name = $2 AND transaction_id = $3 AND kind = 'conversion'
      AND google_ads_customer_id = $4 AND conversion_action_id = $5
      AND status IN ('pending', 'processing', 'sent', 'submitted', 'confirmed') LIMIT 1`,
    [params.workspaceId, params.eventName, transactionId, params.expectedCustomerId, params.expectedConversionActionId]);
    if (existing.rows.length) return { enqueued: false, reason: 'already_queued' };
  }
  return (result.rowCount ?? 0) > 0
    ? { enqueued: true }
    : { enqueued: false, reason: 'sem_atribuicao_ou_acao_nao_configurada' };
}

type AdjustmentParams = {
  workspaceId: string;
  contactId: string;
  eventName: string;
  adjustmentType: 'RESTATEMENT' | 'RETRACTION';
  value?: number | null;
  currency?: string | null;
  dealId?: string | null;
  transactionId?: string | null;
};

/**
 * Corrige uma conversao ja enviada. So faz sentido se a conversao original
 * chegou ao Google — senao nao ha o que ajustar.
 */
export async function enqueueConversionAdjustment(params: AdjustmentParams): Promise<EnqueueResult> {
  const column = conversionActionColumnForEvent(params.eventName);
  if (!column) return { enqueued: false, reason: 'evento_desconhecido' };

  const anchorId = params.dealId || params.contactId;
  const orderId = buildDeterministicOrderId(params.eventName, anchorId);
  const transactionId =
    params.transactionId || buildDeterministicTransactionId(params.workspaceId, params.eventName, anchorId);

  const result = await db.query(
    `
    INSERT INTO conversion_exports (
      workspace_id, ad_attribution_id, event_name, conversion_action_id,
      product_destination_id, google_ads_customer_id, transaction_id,
      conversion_value, currency, status, kind, adjustment_type, deal_id, order_id, payload
    )
    SELECT
      original.workspace_id,
      original.ad_attribution_id,
      original.event_name,
      original.conversion_action_id,
      original.product_destination_id,
      original.google_ads_customer_id,
      $6,
      $4,
      $5,
      'pending',
      'adjustment',
      $3,
      original.deal_id,
      original.order_id,
      jsonb_build_object(
        'event_name', original.event_name,
        'adjustment_type', $3,
        'adjusts_export_id', original.id,
        'transaction_id', $6
      )
    FROM conversion_exports original
    WHERE original.workspace_id = $1
      AND (original.transaction_id = $6 OR original.order_id = $2)
      AND original.kind = 'conversion'
      AND original.status IN ('sent', 'submitted', 'confirmed')
    ORDER BY original.created_at DESC
    LIMIT 1
    `,
    [params.workspaceId, orderId, params.adjustmentType, params.value ?? 0, params.currency || 'BRL', transactionId]
  );

  return (result.rowCount ?? 0) > 0
    ? { enqueued: true }
    : { enqueued: false, reason: 'conversao_original_nao_enviada' };
}
