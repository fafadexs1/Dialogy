import { describe, expect, it } from 'vitest';
import type { CampaignScheduleConfig } from '@/lib/types';
import {
  buildCampaignRecipientSchedule,
  normalizeCampaignScheduleConfig,
} from '@/services/campaigns/schedule';

function customConfig(overrides: Partial<CampaignScheduleConfig> = {}): CampaignScheduleConfig {
  return normalizeCampaignScheduleConfig({
    mode: 'custom',
    timeZone: 'America/Sao_Paulo',
    endAt: '2026-07-07T21:00:00.000Z',
    windowStart: '09:00',
    windowEnd: '18:00',
    allowedWeekdays: [1, 2, 3, 4, 5],
    intervalMode: 'fixed',
    intervalSeconds: 60,
    minIntervalSeconds: 20,
    maxIntervalSeconds: 60,
    dailyLimit: 250,
    maxAttempts: 3,
    autoPauseFailureRate: 20,
    autoPauseMinAttempts: 20,
    consentConfirmed: true,
    ...overrides,
  });
}

describe('campaign scheduling', () => {
  it('starts immediate campaigns now while spacing recipients', () => {
    const schedule = buildCampaignRecipientSchedule({
      recipientIds: ['a', 'b', 'c'],
      config: normalizeCampaignScheduleConfig({
        mode: 'immediate',
        consentConfirmed: true,
      }),
      now: new Date('2026-07-03T12:00:00.000Z'),
    });

    expect(schedule.map(item => item.status)).toEqual(['waiting', 'waiting', 'waiting']);
    expect(schedule.map(item => item.scheduledAt.toISOString())).toEqual([
      '2026-07-03T12:00:00.000Z',
      '2026-07-03T12:00:02.000Z',
      '2026-07-03T12:00:04.000Z',
    ]);
  });

  it('respects the local window, allowed weekdays, and daily limit', () => {
    const schedule = buildCampaignRecipientSchedule({
      recipientIds: ['a', 'b', 'c'],
      config: customConfig({
        allowedWeekdays: [1, 5],
        windowStart: '09:00',
        windowEnd: '12:00',
        intervalSeconds: 3_600,
        dailyLimit: 2,
      }),
      now: new Date('2026-07-03T13:00:00.000Z'),
    });

    expect(schedule.map(item => item.scheduledAt.toISOString())).toEqual([
      '2026-07-03T13:00:00.000Z',
      '2026-07-03T14:00:00.000Z',
      '2026-07-06T12:00:00.000Z',
    ]);
  });

  it('produces deterministic variable intervals inside the configured range', () => {
    const config = customConfig({
      intervalMode: 'variable',
      minIntervalSeconds: 20,
      maxIntervalSeconds: 40,
    });
    const params = {
      recipientIds: ['recipient-a', 'recipient-b', 'recipient-c'],
      config,
      now: new Date('2026-07-03T13:00:00.000Z'),
    };
    const first = buildCampaignRecipientSchedule(params);
    const second = buildCampaignRecipientSchedule(params);

    expect(second.map(item => item.scheduledAt.toISOString()))
      .toEqual(first.map(item => item.scheduledAt.toISOString()));
    const gaps = first.slice(1).map((item, index) =>
      (item.scheduledAt.getTime() - first[index].scheduledAt.getTime()) / 1000
    );
    expect(gaps.every(gap => gap >= 20 && gap <= 40)).toBe(true);
  });

  it('rejects schedules that cannot fit before the deadline', () => {
    expect(() => buildCampaignRecipientSchedule({
      recipientIds: ['a', 'b', 'c'],
      config: customConfig({
        endAt: '2026-07-03T13:30:00.000Z',
        intervalSeconds: 3_600,
      }),
      now: new Date('2026-07-03T13:00:00.000Z'),
    })).toThrow(/nao comporta/i);
  });

  it('requires consent for every mode', () => {
    expect(() => buildCampaignRecipientSchedule({
      recipientIds: ['a'],
      config: normalizeCampaignScheduleConfig({ mode: 'immediate' }),
    })).toThrow(/consentimento/i);
  });
});
