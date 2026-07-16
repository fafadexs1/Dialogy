'use server';

import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { MetaChannel } from '@/lib/types';
import { exchangeFacebookUserToken, findChannelByExternalId } from '@/services/meta/meta-channel.service';
import { resilientFetch } from '@/lib/http/resilient-fetch';
import { requireWorkspaceAccess, requireWorkspacePermission } from '@/lib/security/access';

export async function listMetaChannels(
  workspaceId: string,
  type: 'messenger' | 'instagram'
): Promise<MetaChannel[]> {
    await requireWorkspaceAccess(workspaceId);
  const { rows } = await db.query(
    `SELECT
       id, workspace_id, type, external_page_id, ig_business_id, name, status,
       created_at, updated_at,
       (NULLIF(access_token, '') IS NOT NULL) AS has_credential,
       (NULLIF(app_secret, '') IS NOT NULL) AS has_app_secret,
       (NULLIF(verify_token, '') IS NOT NULL) AS has_verify_token
     FROM meta_channels
     WHERE workspace_id = $1 AND type = $2
     ORDER BY created_at DESC`,
    [workspaceId, type]
  );

  return rows.map(row => ({
    id: row.id,
    workspace_id: row.workspace_id,
    type: row.type,
    external_page_id: row.external_page_id,
    ig_business_id: row.ig_business_id,
    name: row.name,
    status: row.status,
    hasCredential: Boolean(row.has_credential),
    hasAppSecret: Boolean(row.has_app_secret),
    hasVerifyToken: Boolean(row.has_verify_token),
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

export async function getMetaVerifyTokenStatus(workspaceId: string): Promise<{ configured: boolean }> {
    await requireWorkspaceAccess(workspaceId);
  return { configured: Boolean(process.env.META_VERIFY_TOKEN) };
}

export async function createMetaChannel(data: {
  workspaceId: string;
  type: 'messenger' | 'instagram';
  name: string;
  externalPageId: string;
  verifyToken: string;
  accessToken: string;
  appSecret?: string | null;
  fbUserId?: string;
  fbUserAccessToken?: string;
  fbUserTokenExpiresAt?: string;
  igBusinessId?: string; // Add optional support just in case
}) {
  const {
    workspaceId,
    type,
    name,
    externalPageId,
    verifyToken,
    accessToken,
    appSecret,
    fbUserId,
    fbUserAccessToken,
    fbUserTokenExpiresAt,
    igBusinessId,
  } = data;

  await requireWorkspacePermission(workspaceId, 'workspace:settings:edit');

  // IF we have a global verify token, we use it for verification (in the webhook route),
  // BUT we cannot store it in the DB for multiple channels due to the unique constraint (workspace_id, verify_token).
  // Since the DB value is ignored by the webhook when ENV is set, we can store a random unique token.
  const isGlobalTokenMode = !!process.env.META_VERIFY_TOKEN;
  const effectiveVerifyToken = isGlobalTokenMode ? randomUUID() : (verifyToken || randomUUID());

  if (type === 'instagram') {
    if (!igBusinessId) {
      throw new Error('ID da conta Instagram Business obrigatorio.');
    }
    if (!externalPageId) {
      throw new Error('Page ID obrigatorio para Instagram.');
    }
  }

  // Check if already exists
  const existing = await findChannelByExternalId(type, externalPageId);
  const existingByIg = igBusinessId ? await findChannelByExternalId(type, igBusinessId) : null;
  if (existing || existingByIg) {
    throw new Error('Canal já conectado com este ID.');
  }

  // Determine IDs
  const pageId = externalPageId;
  const igId = type === 'instagram' ? igBusinessId : null;

  const id = randomUUID();
  const settings: Record<string, any> = {};
  if (fbUserId) {
    settings.fb_user_id = fbUserId;
  }

  let resolvedUserToken = fbUserAccessToken;
  let resolvedUserTokenExpiresAt = fbUserTokenExpiresAt;
  if (resolvedUserToken) {
    const exchanged = await exchangeFacebookUserToken(resolvedUserToken);
    if (exchanged?.accessToken) {
      resolvedUserToken = exchanged.accessToken;
      resolvedUserTokenExpiresAt = exchanged.expiresAt || resolvedUserTokenExpiresAt;
    }
  }

  if (resolvedUserToken) {
    settings.fb_user_access_token = resolvedUserToken;
  }
  if (resolvedUserTokenExpiresAt) {
    settings.fb_user_token_expires_at = resolvedUserTokenExpiresAt;
  }

  const settingsPayload = Object.keys(settings).length > 0 ? settings : null;

  await db.query(
    `
      INSERT INTO meta_channels (
        id, workspace_id, type, name, 
        external_page_id, ig_business_id, 
        access_token, verify_token, app_secret, 
        settings,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active')
    `,
    [
      id,
      workspaceId,
      type,
      name,
      pageId, // external_page_id
      igId,   // ig_business_id
      accessToken,
      effectiveVerifyToken,
      appSecret || null,
      settingsPayload,
    ]
  );

  // Subscribe App to Page Webhooks (Justifies pages_manage_metadata)
  try {
    await subscribeAppToPage(pageId, accessToken);
  } catch (error) {
    console.error('Failed to subscribe app to page webhooks:', error);
    // Non-blocking, but logged
  }

  revalidatePath('/integrations/meta-messenger');
  revalidatePath('/integrations/meta-instagram');

  return { id };
}

async function subscribeAppToPage(pageId: string, pageAccessToken: string) {
  // Fields we need for messaging
  const fields = [
    'messages',
    'messaging_postbacks',
    'messaging_optins',
    'message_deliveries',
    'message_reads',
    'message_echoes'
  ].join(',');

  const url = `https://graph.facebook.com/v20.0/${pageId}/subscribed_apps?subscribed_fields=${fields}&access_token=${pageAccessToken}`;

  const res = await resilientFetch(url, { method: 'POST' });
  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

export async function deleteMetaChannel(id: string, workspaceId: string) {
  await requireWorkspacePermission(workspaceId, 'workspace:settings:edit');
  await db.query(`DELETE FROM meta_channels WHERE id = $1 AND workspace_id = $2`, [id, workspaceId]);
  revalidatePath('/integrations/meta-messenger');
  revalidatePath('/integrations/meta-instagram');
}

export async function exchangeInstagramToken(
  code: string,
  workspaceId: string,
  redirectUri: string
) {
  await requireWorkspacePermission(workspaceId, 'workspace:settings:edit');
  const clientId = process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID;
  const clientSecret = process.env.INSTAGRAM_APP_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Credenciais do Instagram não configuradas no servidor.');
  }

  // 1. Exchange code for short-lived access token
  const tokenUrl = 'https://api.instagram.com/oauth/access_token';
  const formData = new URLSearchParams();
  formData.append('client_id', clientId);
  formData.append('client_secret', clientSecret);
  formData.append('grant_type', 'authorization_code');
  formData.append('redirect_uri', redirectUri);
  formData.append('code', code);

  const tokenRes = await resilientFetch(tokenUrl, {
    method: 'POST',
    body: formData,
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error_message || !tokenData.access_token) {
    console.error('[INSTAGRAM_EXCHANGE_ERROR]', tokenData);
    throw new Error(tokenData.error_message || 'Falha ao trocar código por token.');
  }

  const shortLivedToken = tokenData.access_token;
  const userId = tokenData.user_id; // Instagram User ID

  // 2. Exchange for long-lived token (optional, but good)
  // GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret={client-secret}&access_token={short-lived-access-token}

  let finalToken = shortLivedToken;
  try {
    const longLiveUrl = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${shortLivedToken}`;
    const longLiveRes = await resilientFetch(longLiveUrl);
    const longLiveData = await longLiveRes.json();
    if (longLiveData.access_token) {
      finalToken = longLiveData.access_token;
    }
  } catch (e) {
    console.warn('Falha ao obter token de longa duração, usando curto.', e);
  }

  // 3. Get User Details (to get username/name)
  // GET https://graph.instagram.com/me?fields=id,username&access_token={token}
  const meUrl = `https://graph.instagram.com/me?fields=id,username,account_type&access_token=${finalToken}`;
  const meRes = await resilientFetch(meUrl);
  const meData = await meRes.json();

  if (!meData.id) {
    throw new Error('Falha ao obter dados do usuário Instagram.');
  }

  const name = meData.username || `Instagram ${meData.id}`;
  const igId = meData.id;

  // 4. Save Channel
  const verifyToken = randomUUID().replace(/-/g, '');

  await createMetaChannel({
    workspaceId,
    type: 'instagram',
    name,
    externalPageId: igId, // Using IG ID as external ID
    igBusinessId: igId,
    verifyToken,
    accessToken: finalToken,
    appSecret: clientSecret
  });

  return true;
}
