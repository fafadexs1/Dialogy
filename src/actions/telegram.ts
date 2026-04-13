'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import type { TelegramBotInstance, TelegramBotProfileSettings } from '@/lib/types';
import {
  buildTelegramWebhookUrl,
  deleteTelegramWebhook,
  getTelegramBotProfileState,
  getTelegramWebhookInfo,
  normalizeTelegramBotToken,
  removeTelegramBotProfilePhoto,
  setTelegramWebhook,
  setTelegramBotProfilePhoto,
  updateTelegramBotIdentity,
  validateTelegramBotToken,
} from '@/services/telegram/bot-api';
import {
  getTelegramInstanceById,
  getTelegramInstanceByName,
  listTelegramInstances,
} from '@/services/telegram/instance-store';

type TelegramStatusResult = {
  status: TelegramBotInstance['status'];
};

function mapProfileSettings(
  instance: {
    id: string;
    instance_name: string;
    display_name: string;
  },
  profile: Awaited<ReturnType<typeof getTelegramBotProfileState>>
): TelegramBotProfileSettings {
  return {
    instance_id: instance.id,
    instance_name: instance.instance_name,
    dialogy_display_name: instance.display_name || instance.instance_name,
    bot_id: profile.bot_id,
    username: profile.username,
    default_name: profile.default_name,
    name: profile.name,
    description: profile.description,
    short_description: profile.short_description,
    photo_data_url: profile.photo_data_url,
    has_photo: profile.has_photo,
  };
}

async function syncTelegramInstanceMetadata(
  instanceId: string,
  payload: {
    dialogyDisplayName?: string;
    botName?: string | null;
    botUsername?: string | null;
    botId?: string | null;
  }
): Promise<void> {
  await db.query(
    `
      UPDATE telegram_bot_instances
      SET
        display_name = COALESCE($2, display_name),
        bot_name = COALESCE($3, bot_name),
        bot_username = COALESCE($4, bot_username),
        bot_id = COALESCE($5, bot_id),
        updated_at = timezone('utc', now())
      WHERE id = $1
    `,
    [
      instanceId,
      payload.dialogyDisplayName?.trim() || null,
      payload.botName || null,
      payload.botUsername || null,
      payload.botId || null,
    ]
  );
}

async function generateTelegramInstanceName(client: { query: typeof db.query }): Promise<string> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('dialogy_telegram_instance_name_generation'))`);

  const res = await client.query(
    `
      SELECT instance_name FROM evolution_api_instances WHERE instance_name LIKE 'tg%'
      UNION
      SELECT instance_name FROM telegram_bot_instances WHERE instance_name LIKE 'tg%'
    `
  );

  const reservedNames = new Set<string>(
    res.rows
      .map((row) => (typeof row.instance_name === 'string' ? row.instance_name.trim() : ''))
      .filter(Boolean)
  );

  let index = 1;
  while (reservedNames.has(`tg${index}`)) {
    index += 1;
  }

  return `tg${index}`;
}

function buildTelegramInstanceStatus(
  instance: {
    webhook_url: string | null;
    webhook_key: string | null;
  },
  webhookInfo: { url?: string | null } | null
): TelegramBotInstance['status'] {
  if (!webhookInfo?.url) {
    return 'disconnected';
  }

  const expectedUrl = instance.webhook_url || (instance.webhook_key ? buildTelegramWebhookUrl(instance.webhook_key) : null);
  return webhookInfo.url === expectedUrl ? 'connected' : 'pending';
}

export async function getTelegramInstances(
  workspaceId: string
): Promise<{ instances: Omit<TelegramBotInstance, 'status'>[] | null; error?: string }> {
  if (!workspaceId) {
    return { instances: null, error: 'Workspace nao informado.' };
  }

  try {
    const instances = await listTelegramInstances(workspaceId);
    return { instances };
  } catch (error) {
    console.error('[TELEGRAM_ACTION_GET_INSTANCES]', error);
    return { instances: null, error: 'Falha ao buscar bots do Telegram.' };
  }
}

export async function createTelegramInstance(
  payload: {
    displayName?: string;
    telegramBotToken?: string;
  },
  workspaceId: string
): Promise<{ success: boolean; error?: string | null }> {
  if (!workspaceId) {
    return { success: false, error: 'ID do workspace nao encontrado.' };
  }

  const telegramBotToken = normalizeTelegramBotToken(payload.telegramBotToken);
  if (!telegramBotToken) {
    return { success: false, error: 'Informe o token do bot Telegram gerado no BotFather.' };
  }

  let telegramBot: Awaited<ReturnType<typeof validateTelegramBotToken>>;
  try {
    telegramBot = await validateTelegramBotToken(telegramBotToken);
  } catch (error: any) {
    return { success: false, error: error?.message || 'Token do bot Telegram invalido.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const instanceName = await generateTelegramInstanceName(client);
    const webhookKey = randomUUID();
    const webhookUrl = buildTelegramWebhookUrl(webhookKey);
    const displayName =
      payload.displayName?.trim() ||
      `Telegram ${telegramBot.username ? `@${telegramBot.username}` : telegramBot.first_name}`;

    await client.query(
      `
        INSERT INTO telegram_bot_instances (
          workspace_id,
          instance_name,
          webhook_key,
          display_name,
          webhook_url,
          bot_token,
          bot_id,
          bot_username,
          bot_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        workspaceId,
        instanceName,
        webhookKey,
        displayName,
        webhookUrl,
        telegramBotToken,
        String(telegramBot.id),
        telegramBot.username || null,
        telegramBot.first_name || null,
      ]
    );

    await setTelegramWebhook(telegramBotToken, webhookUrl, webhookKey);

    await client.query('COMMIT');
    revalidatePath('/integrations/telegram');
    revalidatePath('/integrations');

    return { success: true, error: null };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[TELEGRAM_ACTION_CREATE_INSTANCE]', error);
    return { success: false, error: error?.message || 'Falha ao criar bot do Telegram.' };
  } finally {
    client.release();
  }
}

export async function deleteTelegramInstance(instanceId: string): Promise<{ error: string | null }> {
  if (!instanceId) {
    return { error: 'Instance ID is required.' };
  }

  try {
    const instance = await getTelegramInstanceById(instanceId);
    if (!instance) {
      return { error: 'Bot do Telegram nao encontrado.' };
    }

    if (instance.bot_token) {
      await deleteTelegramWebhook(instance.bot_token).catch((error) => {
        console.error('[TELEGRAM_ACTION_DELETE_INSTANCE] Falha ao remover webhook Telegram:', error);
      });
    }

    await db.query('DELETE FROM telegram_bot_instances WHERE id = $1', [instanceId]);
    revalidatePath('/integrations/telegram');
    revalidatePath('/integrations');
    return { error: null };
  } catch (error: any) {
    console.error('[TELEGRAM_ACTION_DELETE_INSTANCE]', error);
    return { error: error?.message || 'Falha ao excluir bot do Telegram.' };
  }
}

export async function checkTelegramInstanceStatus(instanceName: string): Promise<TelegramStatusResult> {
  try {
    const instance = await getTelegramInstanceByName(instanceName);
    if (!instance?.bot_token) {
      return { status: 'disconnected' };
    }

    await validateTelegramBotToken(instance.bot_token);
    const webhookInfo = await getTelegramWebhookInfo(instance.bot_token);
    return { status: buildTelegramInstanceStatus(instance, webhookInfo) };
  } catch (error) {
    console.error('[TELEGRAM_ACTION_CHECK_STATUS]', error);
    return { status: 'disconnected' };
  }
}

export async function connectTelegramInstance(instanceName: string): Promise<TelegramStatusResult> {
  try {
    const instance = await getTelegramInstanceByName(instanceName);
    if (!instance?.bot_token || !instance.webhook_key) {
      return { status: 'disconnected' };
    }

    const webhookUrl = instance.webhook_url || buildTelegramWebhookUrl(instance.webhook_key);
    await setTelegramWebhook(instance.bot_token, webhookUrl, instance.webhook_key);
    return { status: 'connected' };
  } catch (error) {
    console.error('[TELEGRAM_ACTION_CONNECT]', error);
    return { status: 'disconnected' };
  }
}

export async function disconnectTelegramInstance(instanceName: string): Promise<TelegramStatusResult> {
  try {
    const instance = await getTelegramInstanceByName(instanceName);
    if (!instance?.bot_token) {
      return { status: 'disconnected' };
    }

    await deleteTelegramWebhook(instance.bot_token);
    return { status: 'disconnected' };
  } catch (error) {
    console.error('[TELEGRAM_ACTION_DISCONNECT]', error);
    return { status: 'disconnected' };
  }
}

export async function restartTelegramInstance(
  instanceName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const instance = await getTelegramInstanceByName(instanceName);
    if (!instance?.bot_token || !instance.webhook_key) {
      throw new Error('Credenciais Telegram ausentes para este bot.');
    }

    const webhookUrl = instance.webhook_url || buildTelegramWebhookUrl(instance.webhook_key);
    await setTelegramWebhook(instance.bot_token, webhookUrl, instance.webhook_key);
    return { success: true };
  } catch (error: any) {
    console.error('[TELEGRAM_ACTION_RESTART]', error);
    return { success: false, error: error?.message || 'Falha ao reiniciar webhook do Telegram.' };
  }
}

export async function getTelegramInstanceProfile(
  instanceId: string
): Promise<{ profile: TelegramBotProfileSettings | null; error?: string }> {
  if (!instanceId) {
    return { profile: null, error: 'Bot do Telegram nao informado.' };
  }

  try {
    const instance = await getTelegramInstanceById(instanceId);
    if (!instance?.bot_token) {
      return { profile: null, error: 'Bot do Telegram nao encontrado.' };
    }

    const profile = await getTelegramBotProfileState(instance.bot_token);
    await syncTelegramInstanceMetadata(instance.id, {
      botName: profile.name,
      botUsername: profile.username,
      botId: profile.bot_id,
    });

    return {
      profile: mapProfileSettings(instance, profile),
    };
  } catch (error: any) {
    console.error('[TELEGRAM_ACTION_GET_PROFILE]', error);
    return { profile: null, error: error?.message || 'Falha ao carregar o perfil do bot.' };
  }
}

function readFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function updateTelegramInstanceProfile(
  formData: FormData
): Promise<{ success: boolean; error?: string; profile?: TelegramBotProfileSettings | null }> {
  const instanceId = readFormString(formData, 'instanceId');
  const dialogyDisplayName = readFormString(formData, 'dialogyDisplayName');
  const botName = readFormString(formData, 'botName');
  const description = readFormString(formData, 'description');
  const shortDescription = readFormString(formData, 'shortDescription');
  const photoEntry = formData.get('photo');
  const photo = photoEntry instanceof File && photoEntry.size > 0 ? photoEntry : null;

  if (!instanceId) {
    return { success: false, error: 'Bot do Telegram nao informado.' };
  }

  if (!dialogyDisplayName) {
    return { success: false, error: 'Informe um apelido interno para o bot.' };
  }

  if (!botName) {
    return { success: false, error: 'Informe o nome publico do bot.' };
  }

  try {
    const instance = await getTelegramInstanceById(instanceId);
    if (!instance?.bot_token) {
      return { success: false, error: 'Bot do Telegram nao encontrado.' };
    }

    await updateTelegramBotIdentity(instance.bot_token, {
      name: botName,
      description,
      shortDescription,
    });

    if (photo) {
      await setTelegramBotProfilePhoto(instance.bot_token, photo);
    }

    const profile = await getTelegramBotProfileState(instance.bot_token);
    await syncTelegramInstanceMetadata(instance.id, {
      dialogyDisplayName,
      botName: profile.name,
      botUsername: profile.username,
      botId: profile.bot_id,
    });

    revalidatePath('/integrations/telegram');
    revalidatePath('/integrations');

    return {
      success: true,
      profile: mapProfileSettings(
        {
          id: instance.id,
          instance_name: instance.instance_name,
          display_name: dialogyDisplayName,
        },
        profile
      ),
    };
  } catch (error: any) {
    console.error('[TELEGRAM_ACTION_UPDATE_PROFILE]', error);
    return { success: false, error: error?.message || 'Falha ao atualizar o perfil do bot.' };
  }
}

export async function removeTelegramInstancePhoto(
  instanceId: string
): Promise<{ success: boolean; error?: string; profile?: TelegramBotProfileSettings | null }> {
  if (!instanceId) {
    return { success: false, error: 'Bot do Telegram nao informado.' };
  }

  try {
    const instance = await getTelegramInstanceById(instanceId);
    if (!instance?.bot_token) {
      return { success: false, error: 'Bot do Telegram nao encontrado.' };
    }

    await removeTelegramBotProfilePhoto(instance.bot_token);
    const profile = await getTelegramBotProfileState(instance.bot_token);
    await syncTelegramInstanceMetadata(instance.id, {
      botName: profile.name,
      botUsername: profile.username,
      botId: profile.bot_id,
    });

    revalidatePath('/integrations/telegram');
    revalidatePath('/integrations');

    return {
      success: true,
      profile: mapProfileSettings(instance, profile),
    };
  } catch (error: any) {
    console.error('[TELEGRAM_ACTION_REMOVE_PHOTO]', error);
    return { success: false, error: error?.message || 'Falha ao remover a foto do bot.' };
  }
}
