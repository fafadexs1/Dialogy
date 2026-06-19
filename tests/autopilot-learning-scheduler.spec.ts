import { describe, expect, it } from 'vitest';

import {
  buildScheduledAutopilotLearningPayload,
  getNextAutopilotLearningRunAt,
  isAutopilotLearningSchedulerEnabled,
} from '@/services/autopilot/learning-cycle-scheduler';

describe('autopilot learning cycle scheduler', () => {
  it('is enabled by default in production and disabled by default outside production', () => {
    expect(isAutopilotLearningSchedulerEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(isAutopilotLearningSchedulerEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isAutopilotLearningSchedulerEnabled({
      NODE_ENV: 'production',
      AUTOPILOT_LEARNING_SCHEDULER_ENABLED: 'false',
    })).toBe(false);
  });

  it('computes the next UTC run using the configured schedule', () => {
    const env = {
      AUTOPILOT_LEARNING_SCHEDULE_HOUR_UTC: '4',
      AUTOPILOT_LEARNING_SCHEDULE_MINUTE_UTC: '15',
    };

    expect(getNextAutopilotLearningRunAt(
      new Date('2026-06-16T04:14:59.000Z'),
      env
    ).toISOString()).toBe('2026-06-16T04:15:00.000Z');

    expect(getNextAutopilotLearningRunAt(
      new Date('2026-06-16T04:15:00.000Z'),
      env
    ).toISOString()).toBe('2026-06-17T04:15:00.000Z');
  });

  it('builds a daily idempotent queue payload from environment settings', () => {
    const payload = buildScheduledAutopilotLearningPayload(
      new Date('2026-06-16T12:00:00.000Z'),
      {
        AUTOPILOT_LEARNING_WORKSPACE_ID: 'workspace-1',
        AUTOPILOT_LEARNING_VERTICAL: 'isp',
        AUTOPILOT_LEARNING_SINCE_DAYS: '14',
        AUTOPILOT_LEARNING_WORKSPACE_LIMIT: '7',
        AUTOPILOT_LEARNING_DRY_RUN: 'true',
        AUTOPILOT_LEARNING_SKIP_ECOSYSTEM_PROMOTION: 'true',
        AUTOPILOT_LEARNING_SKIP_SCORE_SUGGESTIONS: 'false',
      }
    );

    expect(payload).toEqual({
      workspaceId: 'workspace-1',
      vertical: 'isp',
      sinceDays: 14,
      limit: 7,
      dryRun: true,
      promoteEcosystem: false,
      createScoreSuggestions: true,
      jobKey: 'daily__2026-06-16__workspace-1__isp__14__7',
    });
  });
});
