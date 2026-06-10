import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSupabaseAdmin } from '@/lib/supabase';
import { normalizeSupabaseStorageUrl } from '@/lib/storage-url';
import { normalizePlanKey } from '@/lib/plans';
import { normalizeInterfaceTheme } from '@/lib/theme';
import type { User, Workspace } from '@/lib/types';

export type MobileAuthContext = {
  authUser: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
  };
  user: User;
  workspace: Workspace;
};

export function unauthorized(message = 'Nao autenticado.') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function getBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function loadUserProfile(userId: string, requestedWorkspaceId?: string | null): Promise<User | null> {
  const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  if ((userRes.rowCount ?? 0) === 0) return null;

  const dbUser = userRes.rows[0];
  const workspacesRes = await db.query(
    `
      SELECT
        w.id,
        w.name,
        w.avatar_url,
        w.timezone,
        w.close_message_template,
        w.transfer_team_message_template,
        w.marketing_auto_close_seconds,
        w.queue_auto_close_seconds,
        (w.owner_id = $1) AS is_owner,
        (SELECT plan FROM billing_info WHERE workspace_id = w.id LIMIT 1) as plan
      FROM workspaces w
      JOIN user_workspace_roles uwr ON w.id = uwr.workspace_id
      WHERE uwr.user_id = $1
      ORDER BY w.created_at ASC
    `,
    [userId],
  );

  const workspaces: Workspace[] = workspacesRes.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    avatar: normalizeSupabaseStorageUrl(row.avatar_url) || '',
    timezone: row.timezone || undefined,
    closeMessageTemplate: row.close_message_template || '',
    transferTeamMessageTemplate: row.transfer_team_message_template || '',
    marketingAutoCloseSeconds: row.marketing_auto_close_seconds ?? undefined,
    queueAutoCloseSeconds: row.queue_auto_close_seconds ?? undefined,
    isOwner: !!row.is_owner,
    plan: normalizePlanKey(row.plan),
  }));

  const preferredWorkspaceId =
    requestedWorkspaceId && workspaces.some((workspace) => workspace.id === requestedWorkspaceId)
      ? requestedWorkspaceId
      : dbUser.last_active_workspace_id && workspaces.some((workspace) => workspace.id === dbUser.last_active_workspace_id)
        ? dbUser.last_active_workspace_id
        : workspaces[0]?.id;

  return {
    id: dbUser.id,
    name: dbUser.full_name,
    firstName: dbUser.full_name?.split(' ')[0] || '',
    lastName: dbUser.full_name?.split(' ').slice(1).join(' ') || '',
    avatar: normalizeSupabaseStorageUrl(dbUser.avatar_url) || '',
    email: dbUser.email,
    workspaces,
    activeWorkspaceId: preferredWorkspaceId,
    is_superadmin: dbUser.is_superadmin,
    themePreference: normalizeInterfaceTheme(dbUser.theme_preference),
  };
}

export async function requireMobileAuth(
  request: NextRequest,
  requestedWorkspaceId?: string | null,
): Promise<{ context: MobileAuthContext } | { response: NextResponse }> {
  const token = getBearerToken(request);
  if (!token) return { response: unauthorized() };

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    return { response: unauthorized('Sessao invalida ou expirada.') };
  }

  const user = await loadUserProfile(data.user.id, requestedWorkspaceId);
  if (!user) return { response: unauthorized('Usuario nao encontrado.') };

  const workspace = user.workspaces?.find((item) => item.id === user.activeWorkspaceId) ?? user.workspaces?.[0];
  if (!workspace) {
    return { response: NextResponse.json({ error: 'Usuario sem workspace.' }, { status: 403 }) };
  }

  return {
    context: {
      authUser: {
        id: data.user.id,
        email: data.user.email,
        user_metadata: data.user.user_metadata,
      },
      user,
      workspace,
    },
  };
}
