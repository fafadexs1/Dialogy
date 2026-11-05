import type { ScheduleException } from '@/lib/types';

// These are calendar dates, not instants. Keep the date key independent of UTC.
export function scheduleDateKey(date: string): string {
  return date.slice(0, 10);
}

export function splitScheduleExceptions(exceptions: ScheduleException[], today: string) {
  const upcoming: ScheduleException[] = [];
  const history: ScheduleException[] = [];
  for (const exception of exceptions) {
    (scheduleDateKey(exception.date) < today ? history : upcoming).push(exception);
  }
  upcoming.sort((a, b) => scheduleDateKey(a.date).localeCompare(scheduleDateKey(b.date)));
  history.sort((a, b) => scheduleDateKey(b.date).localeCompare(scheduleDateKey(a.date)));
  return { upcoming, history };
}
