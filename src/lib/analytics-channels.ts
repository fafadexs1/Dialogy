export const ANALYTICS_CHANNEL_COLORS = {
  WhatsApp: '#25D366',
  Telegram: '#229ED9',
  Instagram: '#E1306C',
  Messenger: '#0084FF',
  Outros: '#64748B',
} as const;

export type AnalyticsChannelName = keyof typeof ANALYTICS_CHANNEL_COLORS;

export function normalizeAnalyticsChannel(channel: string | null | undefined): AnalyticsChannelName {
  const normalized = (channel || '').trim().toLowerCase();
  const compact = normalized.replace(/[\s-]+/g, '_');

  if (!normalized) {
    return 'Outros';
  }

  if (normalized.includes('instagram')) {
    return 'Instagram';
  }

  if (normalized.includes('messenger') || normalized.includes('facebook')) {
    return 'Messenger';
  }

  if (normalized.includes('telegram') || normalized.startsWith('tg')) {
    return 'Telegram';
  }

  if (
    normalized.includes('whatsapp') ||
    normalized.includes('baileys') ||
    compact.includes('wa_cloud') ||
    normalized.includes('@s.whatsapp.net') ||
    normalized.includes('@g.us') ||
    normalized.includes('@lid')
  ) {
    return 'WhatsApp';
  }

  return 'Outros';
}

export function getAnalyticsChannelColor(channel: AnalyticsChannelName): string {
  return ANALYTICS_CHANNEL_COLORS[channel];
}
