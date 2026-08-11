import type { PoolClient } from 'pg';

import { db } from '@/lib/db';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';
import {
  buildAttributionMetadata,
  buildWhatsappRedirectUrl,
  collectAdClickParams,
  generateAttributionToken,
  normalizeWhatsappDestinationPhone,
  WHATSAPP_MESSAGE_EVENT,
} from '@/lib/marketing-attribution';

/**
 * Janela do casamento por proximidade. Curta de proposito: quanto maior, maior
 * a chance de atribuir a conversa errada a um clique.
 */
const PROXIMITY_WINDOW_MINUTES = Math.max(
  1,
  Number(process.env.GOOGLE_ADS_PROXIMITY_WINDOW_MINUTES || 30)
);

type CreateTrackedWhatsappClickInput = {
  workspaceId: string;
  instanceName: string;
  requestUrl: URL;
  message?: string | null;
  userAgent?: string | null;
  ipHash?: string | null;
};

type TrackedWhatsappClick = {
  token: string;
  redirectUrl: string;
  destinationPhone: string;
};

export async function createTrackedWhatsappClick(
  input: CreateTrackedWhatsappClickInput
): Promise<TrackedWhatsappClick | null> {
  await ensureWorkspaceIntegrationsTable();

  const integrationRes = await db.query(
    `
    SELECT config
    FROM workspace_integrations
    WHERE workspace_id = $1
      AND provider = 'gads'
      AND is_active = true
    LIMIT 1
    `,
    [input.workspaceId]
  );
  const gadsConfig = integrationRes.rows[0]?.config || {};
  const destinationSlug = input.requestUrl.searchParams.get('dest')?.trim();
  const destinations = Array.isArray(gadsConfig.destinations)
    ? gadsConfig.destinations
    : gadsConfig.destination
      ? [gadsConfig.destination]
      : [];
  const configuredDestination =
    destinations.find((destination: any) =>
      destination?.instanceName === input.instanceName &&
      (!destinationSlug || destination?.slug === destinationSlug)
    ) || {};
  const configuredPhone =
    configuredDestination.instanceName === input.instanceName
      ? normalizeWhatsappDestinationPhone(configuredDestination.phone)
      : null;

  const instanceRes = configuredPhone ? { rows: [] } : await db.query(
    `
    SELECT display_phone_number
    FROM evolution_api_instances
    WHERE workspace_id = $1
      AND instance_name = $2
    LIMIT 1
    `,
    [input.workspaceId, input.instanceName]
  );

  const destinationPhone =
    configuredPhone ||
    normalizeWhatsappDestinationPhone(input.requestUrl.searchParams.get('phone')) ||
    normalizeWhatsappDestinationPhone(instanceRes.rows[0]?.display_phone_number);
  if (!destinationPhone) return null;

  const adParams = collectAdClickParams(input.requestUrl.searchParams);
  const token = generateAttributionToken();
  const redirectUrl = buildWhatsappRedirectUrl({
    phone: destinationPhone,
    token,
    message: input.message || configuredDestination.defaultMessage,
  });

  await db.query(
    `
    INSERT INTO ad_clicks (
      workspace_id, instance_name, token, destination_phone, destination_url,
      source, medium, campaign, campaign_id, ad_group_id, creative_id,
      keyword, device, match_type, gclid, gbraid, wbraid, raw_params,
      user_agent, ip_hash
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20)
    `,
    [
      input.workspaceId,
      input.instanceName,
      token,
      destinationPhone,
      redirectUrl,
      adParams.source,
      adParams.medium ?? null,
      adParams.campaign ?? null,
      adParams.campaignId ?? null,
      adParams.adGroupId ?? null,
      adParams.creativeId ?? null,
      adParams.keyword ?? null,
      adParams.device ?? null,
      adParams.matchType ?? null,
      adParams.gclid ?? null,
      adParams.gbraid ?? null,
      adParams.wbraid ?? null,
      JSON.stringify(adParams.rawParams),
      input.userAgent?.slice(0, 500) ?? null,
      input.ipHash ?? null,
    ]
  );

  return { token, redirectUrl, destinationPhone };
}

export async function attributeInboundWhatsappMessageByToken(params: {
  client: PoolClient;
  workspaceId: string;
  instanceName: string;
  token: string;
  contactId: string;
  chatId: string;
  messageId: string;
}) {
  const attributionRes = await params.client.query(
    `
    WITH click_row AS (
      SELECT *
      FROM ad_clicks
      WHERE token = $1
        AND workspace_id = $2
        AND instance_name = $3
        AND expires_at >= timezone('utc', now())
      LIMIT 1
    ),
    updated_click AS (
      UPDATE ad_clicks ac
      SET matched_at = COALESCE(ac.matched_at, timezone('utc', now())),
          matched_contact_id = COALESCE(ac.matched_contact_id, $4),
          matched_chat_id = COALESCE(ac.matched_chat_id, $5),
          matched_message_id = COALESCE(ac.matched_message_id, $6)
      FROM click_row cr
      WHERE ac.id = cr.id
      RETURNING ac.*
    ),
    inserted_attribution AS (
      INSERT INTO ad_attributions (
        workspace_id, ad_click_id, contact_id, chat_id, message_id,
        source, medium, campaign, campaign_id, match_type, confidence
      )
      SELECT
        workspace_id, id, $4, $5, $6,
        source, medium, campaign, campaign_id, 'token', 'deterministic'
      FROM updated_click
      ON CONFLICT (ad_click_id) DO UPDATE SET
        contact_id = EXCLUDED.contact_id,
        chat_id = EXCLUDED.chat_id,
        message_id = EXCLUDED.message_id
      RETURNING *
    )
    SELECT
      ia.id AS attribution_id,
      ia.ad_click_id,
      ia.source,
      ia.medium,
      ia.campaign,
      ia.campaign_id,
      ia.match_type,
      ia.confidence,
      uc.gclid,
      uc.gbraid,
      uc.wbraid,
      uc.token
    FROM inserted_attribution ia
    JOIN updated_click uc ON uc.id = ia.ad_click_id
    `,
    [params.token, params.workspaceId, params.instanceName, params.contactId, params.chatId, params.messageId]
  );

  const row = attributionRes.rows[0];
  if (!row) return null;

  return finalizeAttribution(params.client, row, params.messageId);
}

async function finalizeAttribution(client: PoolClient, row: any, messageId: string) {
  const attributionMetadata = buildAttributionMetadata(row);
  await client.query(
    `
    UPDATE messages
    SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
    WHERE id = $1
    `,
    [messageId, JSON.stringify(attributionMetadata)]
  );

  await client.query(
    `
    INSERT INTO conversion_exports (
      workspace_id, ad_attribution_id, event_name, conversion_action_id,
      conversion_value, currency, status, kind, order_id, payload
    )
    SELECT
      aa.workspace_id,
      aa.id,
      $2,
      NULLIF(w.google_ads_conversion_action_whatsapp_message, ''),
      1,
      'BRL',
      'pending',
      'conversion',
      $2 || ':' || aa.chat_id || ':' || aa.message_id,
      jsonb_build_object(
        'event_name', $2,
        'message_id', aa.message_id,
        'chat_id', aa.chat_id,
        'contact_id', aa.contact_id,
        'ad_click_id', aa.ad_click_id
      )
    FROM ad_attributions aa
    JOIN workspaces w ON w.id = aa.workspace_id::uuid
    WHERE aa.id = $1
      AND NULLIF(w.google_ads_conversion_action_whatsapp_message, '') IS NOT NULL
    ON CONFLICT (ad_attribution_id, event_name) WHERE kind = 'conversion' DO NOTHING
    `,
    [row.attribution_id, WHATSAPP_MESSAGE_EVENT]
  );

  return attributionMetadata.attribution;
}

/**
 * Rede de seguranca para quem apagou o codigo da mensagem pre-preenchida do
 * WhatsApp: casa a primeira mensagem do contato com o clique mais recente ainda
 * nao casado da mesma instancia. O clique e reivindicado de forma atomica, entao
 * duas conversas simultaneas nunca disputam o mesmo clique.
 */
export async function attributeInboundWhatsappMessageByProximity(params: {
  client: PoolClient;
  workspaceId: string;
  instanceName: string;
  contactId: string;
  chatId: string;
  messageId: string;
  windowMinutes?: number;
}) {
  const windowMinutes = Math.max(1, params.windowMinutes ?? PROXIMITY_WINDOW_MINUTES);

  const attributionRes = await params.client.query(
    `
    WITH claimed_click AS (
      UPDATE ad_clicks ac
      SET matched_at = timezone('utc', now()),
          matched_contact_id = $4,
          matched_chat_id = $5,
          matched_message_id = $6
      WHERE ac.id = (
        SELECT id
        FROM ad_clicks
        WHERE workspace_id = $1
          AND instance_name = $2
          AND matched_at IS NULL
          AND expires_at >= timezone('utc', now())
          AND clicked_at >= timezone('utc', now()) - ($3 * interval '1 minute')
          -- Contato que ja tem atribuicao nao pode roubar outro clique.
          AND NOT EXISTS (
            SELECT 1 FROM ad_attributions
            WHERE workspace_id = $1 AND contact_id = $4
          )
        ORDER BY clicked_at DESC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING ac.*
    ),
    inserted_attribution AS (
      INSERT INTO ad_attributions (
        workspace_id, ad_click_id, contact_id, chat_id, message_id,
        source, medium, campaign, campaign_id, match_type, confidence
      )
      SELECT
        workspace_id, id, $4, $5, $6,
        source, medium, campaign, campaign_id, 'proximity', 'probabilistic'
      FROM claimed_click
      ON CONFLICT (ad_click_id) DO NOTHING
      RETURNING *
    )
    SELECT
      ia.id AS attribution_id,
      ia.ad_click_id,
      ia.source,
      ia.medium,
      ia.campaign,
      ia.campaign_id,
      ia.match_type,
      ia.confidence,
      cc.gclid,
      cc.gbraid,
      cc.wbraid,
      cc.token
    FROM inserted_attribution ia
    JOIN claimed_click cc ON cc.id = ia.ad_click_id
    `,
    [params.workspaceId, params.instanceName, windowMinutes, params.contactId, params.chatId, params.messageId]
  );

  const row = attributionRes.rows[0];
  if (!row) return null;

  return finalizeAttribution(params.client, row, params.messageId);
}
