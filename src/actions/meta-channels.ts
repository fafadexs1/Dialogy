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
