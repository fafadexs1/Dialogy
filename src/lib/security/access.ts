import 'server-only';

import type { User } from '@supabase/supabase-js';
import { db } from '@/lib/db';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { createClient } from '@/lib/supabase/server';

export type AccessErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'workspace_mismatch'
  | 'rate_limited'
  | 'dependency_unavailable';

export class AccessError extends Error {
  readonly code: AccessErrorCode;
  readonly status: 401 | 403 | 429 | 503;

  constructor(code: AccessErrorCode, message: string, status: 401 | 403 | 429 | 503) {
    super(message);
    this.name = 'AccessError';
    this.code = code;
    this.status = status;
  }
}

export async function requireAuthenticatedUser(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new AccessError('unauthenticated', 'Authentication required.', 401);
  }

  return user;
}

export async function requireWorkspaceAccess(workspaceId: string): Promise<User> {
  if (!workspaceId) {
    throw new AccessError('workspace_mismatch', 'Workspace is required.', 403);
  }

  const user = await requireAuthenticatedUser();
  const result = await db.query(
    `SELECT 1
       FROM workspaces w
       LEFT JOIN users u ON u.id = $1
       LEFT JOIN user_workspace_roles uwr
         ON uwr.user_id = $1
        AND uwr.workspace_id = w.id
      WHERE w.id = $2
        AND (
          w.owner_id = $1
          OR COALESCE(u.is_superadmin, FALSE) = TRUE
          OR uwr.user_id IS NOT NULL
        )
      LIMIT 1`,
    [user.id, workspaceId],
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new AccessError('workspace_mismatch', 'Access denied for this workspace.', 403);
  }

  return user;
}

export async function requireWorkspacePermission(
  workspaceId: string,
  permissionId: string,
): Promise<User> {
  if (!workspaceId) {
    throw new AccessError('workspace_mismatch', 'Workspace is required.', 403);
  }

  const user = await requireAuthenticatedUser();
  const allowed = await hasWorkspacePermission(user.id, workspaceId, permissionId);
  if (!allowed) {
    throw new AccessError('forbidden', 'Access denied for this workspace.', 403);
  }

  return user;
}

export async function requireSuperadmin(): Promise<User> {
  const user = await requireAuthenticatedUser();
  const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [user.id]);

  if (!result.rows[0]?.is_superadmin) {
    throw new AccessError('forbidden', 'Superadmin access required.', 403);
  }

  return user;
}

export function toPublicAccessError(error: unknown): {
  code: AccessErrorCode;
  error: string;
  status: number;
} | null {
  if (!(error instanceof AccessError)) return null;
  return { code: error.code, error: error.message, status: error.status };
}
