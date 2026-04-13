import 'server-only';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export type TelegramBotProfile = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

type TelegramBotNameResult = {
  name?: string;
};

type TelegramBotDescriptionResult = {
  description?: string;
};

type TelegramBotShortDescriptionResult = {
  short_description?: string;
};

type TelegramFileResult = {
  file_path?: string;
};

type TelegramPhotoSize = {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
};

type TelegramUserProfilePhotos = {
  total_count: number;
  photos: TelegramPhotoSize[][];
};

export type TelegramBotProfileState = {
  bot_id: string;
  username: string | null;
  default_name: string;
  name: string;
  description: string;
  short_description: string;
  photo_data_url: string | null;
  has_photo: boolean;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

type TelegramMessageResult = {
  message_id: number;
  date?: number;
  chat?: {
    id: number | string;
  };
};

export function normalizeTelegramBotToken(token: string | undefined | null): string {
  return (token || '').trim();
}

export function buildTelegramChatJid(chatId: string | number): string {
  const raw = String(chatId).trim();
  return raw.startsWith('telegram:') ? raw : `telegram:${raw}`;
}

export function parseTelegramChatId(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('telegram:') ? trimmed.slice('telegram:'.length) : trimmed;
}

export function buildTelegramWebhookUrl(webhookKey: string): string {
  const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    throw new Error('Defina NEXTAUTH_URL ou NEXT_PUBLIC_APP_URL para ativar o webhook do Telegram.');
  }

  return `${baseUrl.replace(/\/+$/, '')}/api/webhooks/telegram/${webhookKey}`;
}

async function callTelegramApi<T>(
  botToken: string,
  method: string,
  payload?: Record<string, unknown>
): Promise<T> {
  const token = normalizeTelegramBotToken(botToken);
  if (!token) {
    throw new Error('Token do bot Telegram nao informado.');
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });

  let data: TelegramApiResponse<T>;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram respondeu ${response.status} sem JSON valido.`);
  }

  if (!response.ok || !data.ok) {
    const details = data.description || response.statusText || 'erro desconhecido';
    throw new Error(`Telegram API (${method}) falhou: ${details}`);
  }

  return data.result as T;
}

async function callTelegramApiMultipart<T>(
  botToken: string,
  method: string,
  formData: FormData
): Promise<T> {
  const token = normalizeTelegramBotToken(botToken);
  if (!token) {
    throw new Error('Token do bot Telegram nao informado.');
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    body: formData,
  });

  let data: TelegramApiResponse<T>;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram respondeu ${response.status} sem JSON valido.`);
  }

  if (!response.ok || !data.ok) {
    const details = data.description || response.statusText || 'erro desconhecido';
    throw new Error(`Telegram API (${method}) falhou: ${details}`);
  }

  return data.result as T;
}

async function getTelegramFileDataUrl(botToken: string, filePath: string): Promise<string | null> {
  const token = normalizeTelegramBotToken(botToken);
  if (!token || !filePath) {
    return null;
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`);
  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

export async function validateTelegramBotToken(botToken: string): Promise<TelegramBotProfile> {
  const bot = await callTelegramApi<TelegramBotProfile>(botToken, 'getMe');
  if (!bot?.is_bot) {
    throw new Error('O token informado nao pertence a um bot Telegram.');
  }
  return bot;
}

export async function getTelegramBotProfileState(botToken: string): Promise<TelegramBotProfileState> {
  const bot = await validateTelegramBotToken(botToken);

  const [nameRes, descriptionRes, shortDescriptionRes, photosRes] = await Promise.all([
    callTelegramApi<TelegramBotNameResult>(botToken, 'getMyName'),
    callTelegramApi<TelegramBotDescriptionResult>(botToken, 'getMyDescription'),
    callTelegramApi<TelegramBotShortDescriptionResult>(botToken, 'getMyShortDescription'),
    callTelegramApi<TelegramUserProfilePhotos>(botToken, 'getUserProfilePhotos', {
      user_id: bot.id,
      limit: 1,
    }),
  ]);

  const primaryPhoto = photosRes.photos?.[0]?.[photosRes.photos[0].length - 1];
  let photoDataUrl: string | null = null;
  if (primaryPhoto?.file_id) {
    const fileRes = await callTelegramApi<TelegramFileResult>(botToken, 'getFile', {
      file_id: primaryPhoto.file_id,
    });
    if (fileRes.file_path) {
      photoDataUrl = await getTelegramFileDataUrl(botToken, fileRes.file_path);
    }
  }

  return {
    bot_id: String(bot.id),
    username: bot.username || null,
    default_name: bot.first_name,
    name: nameRes.name || bot.first_name,
    description: descriptionRes.description || '',
    short_description: shortDescriptionRes.short_description || '',
    photo_data_url: photoDataUrl,
    has_photo: Boolean(photoDataUrl),
  };
}

export async function updateTelegramBotIdentity(
  botToken: string,
  payload: {
    name: string;
    description: string;
    shortDescription: string;
  }
): Promise<boolean> {
  const name = payload.name.trim();
  if (!name) {
    throw new Error('Informe um nome publico para o bot.');
  }

  await callTelegramApi<boolean>(botToken, 'setMyName', { name });
  await callTelegramApi<boolean>(botToken, 'setMyDescription', { description: payload.description.trim() });
  await callTelegramApi<boolean>(botToken, 'setMyShortDescription', {
    short_description: payload.shortDescription.trim(),
  });
  return true;
}

function isJpegFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return file.type === 'image/jpeg' || file.type === 'image/jpg' || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg');
}

export async function setTelegramBotProfilePhoto(botToken: string, file: File): Promise<boolean> {
  if (!isJpegFile(file)) {
    throw new Error('A foto do perfil do Telegram deve estar em JPG.');
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error('A foto do perfil do Telegram deve ter no maximo 10 MB.');
  }

  const attachName = 'profile_photo';
  const formData = new FormData();
  formData.set(
    'photo',
    JSON.stringify({
      type: 'static',
      photo: `attach://${attachName}`,
    })
  );
  formData.set(attachName, file, file.name || 'telegram-profile.jpg');

  return callTelegramApiMultipart<boolean>(botToken, 'setMyProfilePhoto', formData);
}

export async function removeTelegramBotProfilePhoto(botToken: string): Promise<boolean> {
  return callTelegramApi<boolean>(botToken, 'removeMyProfilePhoto');
}

export async function setTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken: string
): Promise<boolean> {
  return callTelegramApi<boolean>(botToken, 'setWebhook', {
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ['message', 'edited_message'],
    drop_pending_updates: false,
  });
}

export async function deleteTelegramWebhook(botToken: string): Promise<boolean> {
  return callTelegramApi<boolean>(botToken, 'deleteWebhook', {
    drop_pending_updates: false,
  });
}

export async function getTelegramWebhookInfo(botToken: string): Promise<{
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
}> {
  return callTelegramApi(botToken, 'getWebhookInfo');
}

export async function sendTelegramTextMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<TelegramMessageResult> {
  return callTelegramApi<TelegramMessageResult>(botToken, 'sendMessage', {
    chat_id: parseTelegramChatId(chatId),
    text,
    disable_web_page_preview: false,
  });
}
