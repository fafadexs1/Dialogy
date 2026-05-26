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

type CreateTrackedWhatsappClickInput = {
  workspaceId: string;
  instanceName: string;
  requestUrl: URL;
  message?: string | null;
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
      keyword, device, match_type, gclid, gbraid, wbraid, raw_params
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
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

  const attributionMetadata = buildAttributionMetadata(row);
  await params.client.query(
    `
    UPDATE messages
    SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
    WHERE id = $1
    `,
    [params.messageId, JSON.stringify(attributionMetadata)]
  );

  await params.client.query(
    `
    INSERT INTO conversion_exports (
      workspace_id, ad_attribution_id, event_name, conversion_action_id,
      conversion_value, currency, status, payload
    )
    SELECT
      aa.workspace_id,
      aa.id,
      $2,
      NULLIF(w.google_ads_conversion_action_whatsapp_message, ''),
      1,
      'BRL',
      'pending',
      jsonb_build_object(
        'event_name', $2,
        'message_id', aa.message_id,
        'chat_id', aa.chat_id,
        'contact_id', aa.contact_id,
        'ad_click_id', aa.ad_click_id
      )
    FROM ad_attributions aa
    JOIN workspaces w ON w.id::text = aa.workspace_id
    JOIN ad_clicks ac ON ac.id = aa.ad_click_id
    WHERE aa.id = $1
      AND (ac.gclid IS NOT NULL OR ac.gbraid IS NOT NULL OR ac.wbraid IS NOT NULL)
    ON CONFLICT (ad_attribution_id, event_name) DO NOTHING
    `,
    [row.attribution_id, WHATSAPP_MESSAGE_EVENT]
  );

  return attributionMetadata.attribution;
}
