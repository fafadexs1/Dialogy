'use server';

import { db } from '@/lib/db';
import { PERMISSIONS } from '@/lib/permissions-catalog';

export async function ensurePermissionsSeed() {
  const existing = await db.query('SELECT id FROM permissions');
  const existingIds = new Set(existing.rows.map((row: { id: string }) => row.id));

  const permissionsToInsert = PERMISSIONS.filter(permission => !existingIds.has(permission.id));
  if (permissionsToInsert.length === 0) {
    return;
  }

  const values: string[] = [];
  const placeholders = permissionsToInsert
    .map((permission, index) => {
      const baseIndex = index * 3;
      values.push(permission.id, permission.category, permission.description);
      return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3})`;
    })
    .join(',');

  await db.query(
    `INSERT INTO permissions (id, category, description) VALUES ${placeholders}`,
    values
  );
}
