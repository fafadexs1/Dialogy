import 'server-only';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';

const isDangerousAdminEnabled = () =>
  process.env.NODE_ENV !== 'production' ||
  process.env.ALLOW_DANGEROUS_ADMIN_OPERATIONS === 'true';

export type DangerousAdminAccess =
  | { ok: true; userId: string }
  | {
      ok: false;
      reason: 'disabled' | 'unauthenticated' | 'forbidden';
      status: 404 | 401 | 403;
      message: string;
    };

export async function getDangerousAdminAccess(): Promise<DangerousAdminAccess> {
  if (!isDangerousAdminEnabled()) {
    return {
      ok: false,
      reason: 'disabled',
      status: 404,
      message: 'Not found.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      reason: 'unauthenticated',
      status: 401,
      message: 'Authentication required.',
    };
  }

  const userRes = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [user.id]);
  if (!userRes.rows[0]?.is_superadmin) {
    return {
      ok: false,
      reason: 'forbidden',
      status: 403,
      message: 'Superadmin access required.',
    };
  }

  return { ok: true, userId: user.id };
}

export function getDangerousAdminActionMessage(access: Exclude<DangerousAdminAccess, { ok: true }>) {
  if (access.reason === 'disabled') {
    return 'Operacao desabilitada neste ambiente.';
  }

  return 'Acesso nao autorizado.';
}
