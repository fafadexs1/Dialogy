'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/lib/db';
import { getCurrentUser } from '@/actions/user';

const webchatConfigSchema = z.object({
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  welcomeMessage: z.string().trim().max(500),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  position: z.enum(['left', 'right']),
  allowedDomains: z.array(z.string().trim().min(1).max(255)).max(50),
  requireName: z.boolean(),
  requireEmail: z.boolean(),
  isActive: z.boolean(),
  autopilotConfigId: z.string().trim().nullable(),
});

export type WebchatConfigInput = z.infer<typeof webchatConfigSchema>;

export async function getWebchatConfigAction(workspaceId: string) {
  const user = await getCurrentUser();
  if (!user || user.activeWorkspaceId !== workspaceId) return { config: null, agents: [], error: 'Acesso negado.' };
  const [widgetRes, agentsRes] = await Promise.all([
    db.query('SELECT * FROM webchat_widgets WHERE workspace_id = $1 ORDER BY created_at LIMIT 1', [workspaceId]),
    db.query(
      `SELECT ac.id, COALESCE(sa.name, ac.name) AS name,
              (ac.is_active AND sa.is_active) AS is_active
       FROM autopilot_configs ac
       JOIN system_agents sa
         ON sa.autopilot_config_id = ac.id
        AND sa.workspace_id = ac.workspace_id
        AND sa.type = 'intelligent_attendant'
       WHERE ac.workspace_id = $1
       ORDER BY COALESCE(sa.name, ac.name)`,
      [workspaceId],
    ),
  ]);
  const row = widgetRes.rows[0];
  return {
    config: row ? {
      id: row.id,
      publicKey: row.public_key,
      name: row.name,
      title: row.title,
      welcomeMessage: row.welcome_message,
      primaryColor: row.primary_color,
      position: row.position,
      allowedDomains: row.allowed_domains || [],
      requireName: row.require_name,
      requireEmail: row.require_email,
      isActive: row.is_active,
      autopilotConfigId: row.autopilot_config_id,
    } : null,
    agents: agentsRes.rows.map((agent) => ({ id: agent.id, name: agent.name, isActive: Boolean(agent.is_active) })),
  };
}

export async function saveWebchatConfigAction(workspaceId: string, input: WebchatConfigInput) {
  const user = await getCurrentUser();
  if (!user || user.activeWorkspaceId !== workspaceId) return { success: false, error: 'Acesso negado.' };
  const parsed = webchatConfigSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Revise os campos da configuração.' };
  if (parsed.data.autopilotConfigId) {
    const agent = await db.query(
      `SELECT 1 FROM autopilot_configs ac
       JOIN system_agents sa ON sa.autopilot_config_id=ac.id AND sa.workspace_id=ac.workspace_id AND sa.type='intelligent_attendant'
       WHERE ac.id=$1 AND ac.workspace_id=$2`,
      [parsed.data.autopilotConfigId, workspaceId],
    );
    if (!agent.rowCount) return { success: false, error: 'Agente de IA inválido.' };
  }
  const existing = await db.query('SELECT id, public_key FROM webchat_widgets WHERE workspace_id = $1 ORDER BY created_at LIMIT 1', [workspaceId]);
  const id = existing.rows[0]?.id || randomUUID();
  const publicKey = existing.rows[0]?.public_key || `wdg_${randomUUID().replace(/-/g, '')}`;
  const value = parsed.data;
  await db.query(
    `INSERT INTO webchat_widgets (id, workspace_id, public_key, name, title, welcome_message, primary_color, position, allowed_domains, require_name, require_email, is_active, autopilot_config_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET name=$4,title=$5,welcome_message=$6,primary_color=$7,position=$8,allowed_domains=$9,require_name=$10,require_email=$11,is_active=$12,autopilot_config_id=$13,updated_at=NOW()`,
    [id, workspaceId, publicKey, value.name, value.title, value.welcomeMessage, value.primaryColor, value.position, value.allowedDomains, value.requireName, value.requireEmail, value.isActive, value.autopilotConfigId || null],
  );
  await db.query(
    `INSERT INTO workspace_integrations (workspace_id, provider, config, is_active, updated_at)
     VALUES ($1, 'webchat', $2, $3, NOW())
     ON CONFLICT (workspace_id, provider) DO UPDATE SET config=$2,is_active=$3,updated_at=NOW()`,
    [workspaceId, JSON.stringify({ widgetId: id, publicKey }), value.isActive],
  );
  revalidatePath('/integrations');
  revalidatePath('/integrations/webchat');
  return { success: true, publicKey };
}
