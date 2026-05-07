import { describe, expect, it } from 'vitest';
import {
  getAnalyticsChannelColor,
  normalizeAnalyticsChannel,
} from '@/lib/analytics-channels';

describe('analytics channel helpers', () => {
  it('normalizes instagram and messenger aliases', () => {
    expect(normalizeAnalyticsChannel('instagram')).toBe('Instagram');
    expect(normalizeAnalyticsChannel('meta_instagram')).toBe('Instagram');
    expect(normalizeAnalyticsChannel('messenger')).toBe('Messenger');
    expect(normalizeAnalyticsChannel('fb_messenger')).toBe('Messenger');
    expect(normalizeAnalyticsChannel('facebook')).toBe('Messenger');
  });

  it('normalizes whatsapp signals from provider names and jids', () => {
    expect(normalizeAnalyticsChannel('whatsapp')).toBe('WhatsApp');
    expect(normalizeAnalyticsChannel('baileys')).toBe('WhatsApp');
    expect(normalizeAnalyticsChannel('wa_cloud')).toBe('WhatsApp');
    expect(normalizeAnalyticsChannel('wa-cloud')).toBe('WhatsApp');
    expect(normalizeAnalyticsChannel('wa cloud')).toBe('WhatsApp');
    expect(normalizeAnalyticsChannel('5511999999999@s.whatsapp.net')).toBe('WhatsApp');
    expect(normalizeAnalyticsChannel('5511999999999@lid')).toBe('WhatsApp');
    expect(normalizeAnalyticsChannel('telegram')).toBe('Telegram');
    expect(normalizeAnalyticsChannel('telegram:123456')).toBe('Telegram');
    expect(normalizeAnalyticsChannel('tg123456')).toBe('Telegram');
  });

  it('falls back to Outros for unknown values', () => {
    expect(normalizeAnalyticsChannel('sms')).toBe('Outros');
    expect(normalizeAnalyticsChannel(null)).toBe('Outros');
    expect(getAnalyticsChannelColor('Outros')).toBe('#64748B');
  });
});
