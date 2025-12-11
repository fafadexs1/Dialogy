'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import type { MetaChannel } from '@/lib/types';

async function requireUserInWorkspace(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) {
    throw new Error('Usuário não autenticado.');
  }

  const membership = await db.query(
    `SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2 LIMIT 1`,
    [userId, workspaceId]
  );
  if ((membership.rowCount || 0) === 0) {
    throw new Error('Acesso negado para este workspace.');
  }
  return userId;
}

export async function listMetaChannels(workspaceId: string, type: 'instagram' | 'messenger'): Promise<MetaChannel[]> {
  await requireUserInWorkspace(workspaceId);
  const { rows } = await db.query(
    `SELECT * FROM meta_channels WHERE workspace_id = $1 AND type = $2 ORDER BY created_at DESC`,
    [workspaceId, type]
  );
  return rows;
}

export async function createMetaChannel(payload: {
  workspaceId: string;
  type: 'instagram' | 'messenger';
  name?: string;
  verifyToken: string;
  accessToken: string;
  appSecret?: string | null;
  igBusinessId?: string | null;
  externalPageId?: string | null;
  status?: string | null;
  fbUserId?: string | null;
}) {
  const userId = await requireUserInWorkspace(payload.workspaceId);

  // Evita reuso de verify_token dentro do mesmo workspace (boa prática/segurança)
  const existing = await db.query(
    `SELECT id FROM meta_channels WHERE workspace_id = $1 AND verify_token = $2 LIMIT 1`,
    [payload.workspaceId, payload.verifyToken]
  );
  if ((existing.rowCount || 0) > 0) {
    throw new Error('Já existe um canal com este verify_token neste workspace.');
  }

  const id = (await db.query('SELECT gen_random_uuid() as id')).rows[0].id as string;
  const now = new Date().toISOString();
  const settings = payload.fbUserId ? { fb_user_id: payload.fbUserId } : {};

  // --- AUTOMATION: Subscribe App to Page Webhooks ---
  if (payload.externalPageId && payload.accessToken) {
    try {
      let fields: string[] = [];

      if (payload.type === 'instagram') {
        fields = [
          'messages',
          'messaging_postbacks',
          'messaging_optins',
          'messaging_seen'
        ];
      } else {
        fields = [
          'messages',
          'messaging_postbacks',
          'messaging_optins',
          'messaging_seen'
        ];
      }

      const subscribeUrl = `https://graph.facebook.com/v18.0/${payload.externalPageId}/subscribed_apps?subscribed_fields=${fields.join(',')}&access_token=${payload.accessToken}`;

      const subRes = await fetch(subscribeUrl, { method: 'POST' });
      const subData = await subRes.json();

      if (!subData.success) {
        console.error('Falha ao inscrever App na Página (subscribed_apps):', subData);
      } else {
        console.log('App inscrito com sucesso na Página:', payload.externalPageId);
      }
    } catch (err) {
      console.error('Erro de conexão ao tentar inscrever App:', err);
    }
  }
  // --------------------------------------------------


  await db.query(
    `
      INSERT INTO meta_channels (
        id, workspace_id, type, external_page_id, ig_business_id,
        access_token, app_secret, verify_token, name, status, settings, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, COALESCE($10, 'active'), $12, $11, $11
      )
    `,
    [
      id,
      payload.workspaceId,
      payload.type,
      payload.externalPageId ?? null,
      payload.igBusinessId ?? null,
      payload.accessToken,
      payload.appSecret ?? null,
      payload.verifyToken,
      payload.name ?? null,
      payload.status ?? 'active',
      now,
      settings
    ]
  );

  return { success: true, id, created_by: userId };
}

export async function deleteMetaChannel(id: string, workspaceId: string) {
  await requireUserInWorkspace(workspaceId);
  const res = await db.query(
    `DELETE FROM meta_channels WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  return { success: (res.rowCount || 0) > 0 };
}

export async function exchangeInstagramToken(code: string, workspaceId: string, redirectUri: string) {
  const userId = await requireUserInWorkspace(workspaceId);

  const clientId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
  const clientSecret = process.env.FACEBOOK_APP_SECRET;

  // redirectUri is now passed from the client to ensure match

  if (!clientSecret) {
    throw new Error('FACEBOOK_APP_SECRET não configurado.');
  }

  // 1. Exchange Code for Short-Lived Token
  const form = new FormData();
  form.append('client_id', clientId || '');
  form.append('client_secret', clientSecret);
  form.append('grant_type', 'authorization_code');
  form.append('redirect_uri', redirectUri);
  form.append('code', code);

  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: form,
  });
  const shortData = await shortRes.json();

  if (shortData.error_type || !shortData.access_token) {
    console.error('Instagram Token Exchange Error:', shortData);
    throw new Error(shortData.error_message || 'Falha ao trocar código pelo token.');
  }

  const shortToken = shortData.access_token;
  const igUserId = shortData.user_id;

  // 2. Exchange Short-Lived for Long-Lived Token
  const longRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${shortToken}`
  );
  const longData = await longRes.json();

  if (!longData.access_token) {
    console.error('Instagram Long-Lived Token Error:', longData);
    throw new Error('Falha ao obter token de longa duração.');
  }

  const longToken = longData.access_token;

  // 3. Get User Details
  const userRes = await fetch(`https://graph.instagram.com/v19.0/me?fields=id,username,account_type&access_token=${longToken}`);
  const userData = await userRes.json();

  if (userData.error) {
    throw new Error('Falha ao obter dados do usuário Instagram.');
  }

  const name = userData.username;
  // Generate a random verify token for this channel
  const verifyToken = crypto.randomUUID().replace(/-/g, '');

  // 4. Save Channel
  return await createMetaChannel({
    workspaceId,
    type: 'instagram',
    name: name,
    verifyToken,
    accessToken: longToken,
    externalPageId: igUserId, // For webhook subscription and ID
    igBusinessId: igUserId,   // Main ID for the account
    appSecret: clientSecret,
  });
}
