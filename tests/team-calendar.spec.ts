import { describe, expect, it } from 'vitest';
import { format, parseISO } from 'date-fns';
import { scheduleDateKey, splitScheduleExceptions } from '@/lib/team-calendar';
import type { ScheduleException } from '@/lib/types';

const exception = (date: string): ScheduleException => ({ id: date, team_id: 'team', date, description: date, is_closed: true, start_time: null, end_time: null });

describe('team calendar history', () => {
  it('keeps today upcoming and sorts past dates from newest to oldest across years', () => {
    const input = ['2026-12-25', '2025-12-25', '2026-10-12', '2026-10-26', '2026-11-02'].map(exception);
    const result = splitScheduleExceptions(input, '2026-10-26');
    expect(result.upcoming.map(item => item.date)).toEqual(['2026-10-26', '2026-11-02', '2026-12-25']);
    expect(result.history.map(item => item.date)).toEqual(['2026-10-12', '2025-12-25']);
    expect(input[0].date).toBe('2026-12-25');
  });

  it('moves a date into history after midnight without removing it', () => {
    const dates = [exception('2026-10-26')];
    expect(splitScheduleExceptions(dates, '2026-10-26').upcoming).toHaveLength(1);
    expect(splitScheduleExceptions(dates, '2026-10-27').history).toEqual(dates);
  });

  it.each(['2026-11-02', '2026-11-02T00:00:00.000Z'])('displays calendar date %s without shifting a day', date => {
    const key = scheduleDateKey(date);
    expect(format(parseISO(key), 'yyyy-MM-dd')).toBe('2026-11-02');
    expect(splitScheduleExceptions([exception(date)], '2026-11-02').history).toEqual([]);
  });

  it('supports no records and history with no upcoming records', () => {
    expect(splitScheduleExceptions([], '2026-10-26')).toEqual({ upcoming: [], history: [] });
    expect(splitScheduleExceptions([exception('2020-01-01')], '2026-10-26').history).toHaveLength(1);
  });
});
