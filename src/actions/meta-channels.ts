'use server';

import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { MetaChannel } from '@/lib/types';
import { findChannelByExternalId } from '@/services/meta/meta-channel.service';

export async function listMetaChannels(
  workspaceId: string,
  type: 'messenger' | 'instagram'
): Promise<MetaChannel[]> {
  const { rows } = await db.query(
    `SELECT * FROM meta_channels WHERE workspace_id = $1 AND type = $2 ORDER BY created_at DESC`,
    [workspaceId, type]
  );

  return rows.map(row => ({
    id: row.id,
    workspace_id: row.workspace_id,
    type: row.type,
    external_page_id: row.external_page_id,
    ig_business_id: row.ig_business_id,
    access_token: row.access_token,
    verify_token: row.verify_token,
    app_secret: row.app_secret,
    name: row.name,
    status: row.status,
    settings: row.settings,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

export async function getMetaVerifyToken(): Promise<string | null> {
  return process.env.META_VERIFY_TOKEN || null;
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
    igBusinessId
  } = data;
  const effectiveVerifyToken = process.env.META_VERIFY_TOKEN || verifyToken;

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

  await db.query(
    `
      INSERT INTO meta_channels (
        id, workspace_id, type, name, 
        external_page_id, ig_business_id, 
        access_token, verify_token, app_secret, 
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
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
      appSecret || null
    ]
  );

  revalidatePath('/integrations/meta-messenger');
  revalidatePath('/integrations/meta-instagram');

  return { id };
}

export async function deleteMetaChannel(id: string, workspaceId: string) {
  await db.query(`DELETE FROM meta_channels WHERE id = $1 AND workspace_id = $2`, [id, workspaceId]);
  revalidatePath('/integrations/meta-messenger');
  revalidatePath('/integrations/meta-instagram');
}

export async function exchangeInstagramToken(
  code: string,
  workspaceId: string,
  redirectUri: string
) {
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

  const tokenRes = await fetch(tokenUrl, {
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
    const longLiveRes = await fetch(longLiveUrl);
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
  const meRes = await fetch(meUrl);
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
