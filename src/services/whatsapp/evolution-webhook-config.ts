import 'server-only';

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { buildEvolutionWebhookUrl } from '@/lib/whatsapp/evolution-config';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';

// One contract for provisioning and repairing existing instances.
export function buildEvolutionWebhookConfig(url: string) {
  return {
    enabled: true,
    url,
    byEvents: false,
    events: [
      'APPLICATION_STARTUP', 'QRCODE_UPDATED', 'MESSAGES_SET', 'MESSAGES_UPSERT',
      'MESSAGES_EDITED', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'SEND_MESSAGE',
      'SEND_MESSAGE_UPDATE', 'CONTACTS_SET', 'CONTACTS_UPSERT', 'CONTACTS_UPDATE',
      'PRESENCE_UPDATE', 'CHATS_SET', 'CHATS_UPSERT', 'CHATS_UPDATE', 'CHATS_DELETE',
      'GROUPS_UPSERT', 'GROUP_UPDATE', 'GROUP_PARTICIPANTS_UPDATE', 'CONNECTION_UPDATE',
      'LABELS_EDIT', 'LABELS_ASSOCIATION', 'CALL', 'TYPEBOT_START', 'TYPEBOT_CHANGE_STATUS',
      'REMOVE_INSTANCE', 'LOGOUT_INSTANCE', 'INSTANCE_CREATE', 'INSTANCE_DELETE', 'STATUS_INSTANCE',
    ],
  };
}

/** Call only after checking workspace:settings:edit for workspaceId. */
export async function configureEvolutionInstanceWebhook(instanceId: string, workspaceId: string): Promise<string> {
  const result = await db.query(
    `SELECT i.instance_name, to_jsonb(i)->>'webhook_key' AS webhook_key, c.api_url, c.api_key
       FROM evolution_api_instances i
       LEFT JOIN whatsapp_clusters c ON c.id = i.cluster_id
      WHERE i.id = $1 AND i.workspace_id = $2 AND i.type IN ('baileys', 'wa_cloud')`,
    [instanceId, workspaceId],
  );
  const instance = result.rows[0];
  if (!instance) throw new Error('Instancia WhatsApp nao encontrada neste workspace.');
  if (!instance.api_url || !instance.api_key) throw new Error('Cluster Evolution API nao configurado.');

  // Validate the public base URL before making changes or generating a legacy key.
  buildEvolutionWebhookUrl(instance.webhook_key || instance.instance_name);
  const endpointName = encodeURIComponent(instance.instance_name);
  const apiConfig = { api_url: instance.api_url, api_key: instance.api_key };
  const current = await fetchEvolutionAPI(`/webhook/find/${endpointName}`, apiConfig);

  let webhookKey = instance.webhook_key;
  if (!webhookKey) {
    // Persist before enabling remote delivery. Concurrent repairs reuse the same key.
    const keyResult = await db.query(
      `UPDATE evolution_api_instances
          SET webhook_key = COALESCE(NULLIF(webhook_key, ''), $3)
        WHERE id = $1 AND workspace_id = $2
        RETURNING webhook_key`,
      [instanceId, workspaceId, randomUUID()],
    );
    webhookKey = keyResult.rows[0]?.webhook_key;
    if (!webhookKey) throw new Error('Nao foi possivel registrar a chave do webhook.');
  }

  const url = buildEvolutionWebhookUrl(webhookKey);
  const webhook = buildEvolutionWebhookConfig(url);
  await fetchEvolutionAPI(`/webhook/set/${endpointName}`, apiConfig, {
    method: 'POST',
    body: JSON.stringify({ webhook: {
      ...webhook,
      // Preserve provider-specific authentication headers and media settings.
      ...(current?.headers ? { headers: current.headers } : {}),
      base64: current?.webhookBase64 ?? current?.base64 ?? false,
    } }),
  });

  const saved = await fetchEvolutionAPI(`/webhook/find/${endpointName}`, apiConfig);
  if (saved?.enabled !== true || saved?.url !== url
      || (saved?.webhookByEvents ?? saved?.byEvents) !== false
      || !webhook.events.every((event) => saved?.events?.includes(event))) {
    throw new Error('A Evolution API nao confirmou a configuracao do webhook.');
  }

  const updated = await db.query(
    `UPDATE evolution_api_instances SET webhook_url = $3 WHERE id = $1 AND workspace_id = $2 RETURNING id`,
    [instanceId, workspaceId, url],
  );
  if (!updated.rows[0]) throw new Error('Nao foi possivel salvar o endereco do webhook.');
  return url;
}
