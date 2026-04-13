import type { Chat, Contact, Message } from '@/lib/types';

export type ResolvedChatPlatform = 'instagram' | 'messenger' | 'telegram' | 'wa_cloud' | 'baileys';

function normalizeSignal(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isInstagramSignal(signal: string): boolean {
  return signal.includes('instagram');
}

function isMessengerSignal(signal: string): boolean {
  return signal.includes('messenger') || signal.includes('facebook');
}

function isTelegramSignal(signal: string): boolean {
  return (
    signal === 'telegram' ||
    signal.startsWith('telegram:') ||
    signal.includes('telegram') ||
    /^tg\d+$/i.test(signal)
  );
}

function isCloudApiSignal(signal: string): boolean {
  return signal === 'wa_cloud' || signal.includes('wa_cloud');
}

function collectMessageSignals(messages: Message[] | undefined): string[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const signals: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const signal =
      normalizeSignal(message?.platform) ||
      normalizeSignal(message?.source_from_api) ||
      normalizeSignal(message?.instance_name) ||
      (message?.metadata?.telegram ? 'telegram' : '');

    if (signal) {
      signals.push(signal);
    }
  }

  return signals;
}

export function resolveChatPlatform(chat: Chat | null | undefined): ResolvedChatPlatform {
  if (!chat) {
    return 'baileys';
  }

  const metaPlatform = normalizeSignal(chat.metaPlatform);
  const messageSignals = collectMessageSignals(chat.messages);
  const contactJid = normalizeSignal(chat.contact?.phone_number_jid);
  const contactPhone = normalizeSignal(chat.contact?.phone);
  const chatSignals = [
    ...messageSignals,
    normalizeSignal(chat.source),
    normalizeSignal(chat.instance_type),
    normalizeSignal(chat.instance_name),
    contactJid,
    contactPhone,
  ].filter(Boolean);

  const hasMetaContact = Boolean(chat.metaContactExternalId || chat.metaContactUsername);
  const isMetaUser = (chat.contact?.name || '').startsWith('Meta User');

  if (metaPlatform === 'instagram' || metaPlatform === 'messenger') {
    return metaPlatform;
  }

  if (chatSignals.some(isInstagramSignal)) {
    return 'instagram';
  }

  if (chatSignals.some(isMessengerSignal)) {
    return 'messenger';
  }

  if (hasMetaContact && !chatSignals.some(isMessengerSignal)) {
    return 'instagram';
  }

  if (isMetaUser || hasMetaContact) {
    return 'messenger';
  }

  if (chatSignals.some(isTelegramSignal)) {
    return 'telegram';
  }

  if (chatSignals.some(isCloudApiSignal)) {
    return 'wa_cloud';
  }

  return 'baileys';
}

export function getChatPlatformLabel(platform: ResolvedChatPlatform): string {
  switch (platform) {
    case 'instagram':
      return 'Instagram';
    case 'messenger':
      return 'Messenger';
    case 'telegram':
      return 'Telegram';
    case 'wa_cloud':
      return 'Cloud API';
    default:
      return 'Baileys';
  }
}

export function getChatContactDisplayValue(
  contact: Pick<Contact, 'phone' | 'phone_number_jid'> | undefined,
  platform: ResolvedChatPlatform
): string | null {
  const rawValue = (contact?.phone_number_jid || contact?.phone || '').trim();
  if (!rawValue) {
    return null;
  }

  if (platform === 'telegram') {
    return rawValue.replace(/^telegram:/i, '');
  }

  return rawValue.replace(/@.*$/, '');
}
