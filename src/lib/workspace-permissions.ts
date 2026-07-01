import { db } from '@/lib/db';

/**
 * Central RBAC check for server actions.
 *
 * Workspace owners and platform superadmins keep implicit full access. Every
 * other member must receive the requested permission through their assigned
 * workspace role.
 */
export async function hasWorkspacePermission(
    userId: string,
    workspaceId: string,
    permissionId: string
): Promise<boolean> {
    if (!userId || !workspaceId || !permissionId) return false;

    const result = await db.query(
        `
            SELECT 1
            FROM workspaces w
            LEFT JOIN users u ON u.id = $1
            LEFT JOIN user_workspace_roles uwr
                ON uwr.user_id = $1
               AND uwr.workspace_id = w.id
            LEFT JOIN role_permissions rp
                ON rp.role_id = uwr.role_id
               AND rp.permission_id = $3
            WHERE w.id = $2
              AND (
                    w.owner_id = $1
                 OR COALESCE(u.is_superadmin, FALSE) = TRUE
                 OR rp.permission_id IS NOT NULL
              )
            LIMIT 1
        `,
        [userId, workspaceId, permissionId]
    );

    return (result.rowCount ?? 0) > 0;
}
