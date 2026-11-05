'use server';

import { z } from 'zod';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { requireWorkspaceAccess } from '@/lib/security/access';

async function identity() {
  const {data:{user}} = await (await createClient()).auth.getUser();
  if (!user) throw new Error('Faça login para continuar.');
  const result = await db.query('SELECT last_active_workspace_id FROM users WHERE id=$1', [user.id]);
  const workspaceId = result.rows[0]?.last_active_workspace_id;
  if (!workspaceId) throw new Error('Workspace indisponível.');
  await requireWorkspaceAccess(workspaceId);
  return { userId: user.id, workspaceId: String(workspaceId) };
}
const settingsSchema = z.object({ minutes: z.number().int().min(0).max(43200), message: z.string().trim().max(4096) });
export async function getPersonalInactivitySettings() {
  const {userId, workspaceId} = await identity();
  const result = await db.query('SELECT timeout_minutes, message FROM agent_inactivity_settings WHERE workspace_id=$1 AND user_id=$2', [workspaceId,userId]);
  return { minutes: Number(result.rows[0]?.timeout_minutes ?? 0), message: String(result.rows[0]?.message ?? '') };
}
export async function savePersonalInactivitySettings(input: {minutes:number; message:string}) {
  const {userId, workspaceId} = await identity();
  const value = settingsSchema.parse(input);
  await db.query(`INSERT INTO agent_inactivity_settings(workspace_id,user_id,timeout_minutes,message)
    VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,user_id) DO UPDATE SET timeout_minutes=EXCLUDED.timeout_minutes,message=EXCLUDED.message,updated_at=clock_timestamp()`, [workspaceId,userId,value.minutes,value.message]);
  return {success:true};
}
