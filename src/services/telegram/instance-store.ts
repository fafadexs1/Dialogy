import { db } from '@/lib/db';
import type { TelegramBotInstance } from '@/lib/types';

export type TelegramInstanceRow = {
  id: string;
  workspace_id: string;
  instance_name: string;
  webhook_key: string | null;
  display_name: string;
  webhook_url: string | null;
  bot_token: string | null;
  bot_id: string | null;
  bot_username: string | null;
  bot_name: string | null;
  created_at?: string;
  updated_at?: string;
};

function mapTelegramRow(row: TelegramInstanceRow): Omit<TelegramBotInstance, 'status'> {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    instance_name: row.instance_name,
    webhook_key: row.webhook_key,
    display_name: row.display_name || row.instance_name,
    type: 'telegram',
    webhook_url: row.webhook_url,
    telegram_bot_id: row.bot_id,
    telegram_bot_username: row.bot_username,
    telegram_bot_name: row.bot_name,
    telegram_webhook_url: row.webhook_url,
  };
}

async function queryTelegramInstance(whereClause: string, params: unknown[]): Promise<TelegramInstanceRow | null> {
  const res = await db.query(
    `
      SELECT
        id,
        workspace_id,
        instance_name,
        webhook_key,
        display_name,
        webhook_url,
        bot_token,
        bot_id,
        bot_username,
        bot_name,
        created_at,
        updated_at
      FROM telegram_bot_instances
      WHERE ${whereClause}
      LIMIT 1
    `,
    params
  );

  return res.rows[0] || null;
}

export async function getTelegramInstanceById(id: string): Promise<TelegramInstanceRow | null> {
  return queryTelegramInstance('id = $1', [id]);
}

export async function getTelegramInstanceByName(
  instanceName: string,
  workspaceId?: string
): Promise<TelegramInstanceRow | null> {
  if (workspaceId) {
    return queryTelegramInstance('instance_name = $1 AND workspace_id = $2', [instanceName, workspaceId]);
  }

  return queryTelegramInstance('instance_name = $1', [instanceName]);
}

export async function getTelegramInstanceByWebhookKey(webhookKey: string): Promise<TelegramInstanceRow | null> {
  return queryTelegramInstance('webhook_key = $1', [webhookKey]);
}

export async function listTelegramInstances(
  workspaceId: string
): Promise<Omit<TelegramBotInstance, 'status'>[]> {
  const res = await db.query(
    `
      SELECT
        id,
        workspace_id,
        instance_name,
        webhook_key,
        display_name,
        webhook_url,
        bot_id,
        bot_username,
        bot_name
      FROM telegram_bot_instances
      WHERE workspace_id = $1
      ORDER BY created_at DESC
    `,
    [workspaceId]
  );

  return res.rows.map((row) => mapTelegramRow(row));
}
