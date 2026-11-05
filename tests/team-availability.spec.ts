import { describe, expect, it } from 'vitest';

import {
  describeTeamUnavailability,
  evaluateTeamBusinessHours,
} from '@/services/chat-distribution/team-availability';

// Quarta-feira, 10:00 em America/Sao_Paulo (UTC-3).
const WEDNESDAY_10H_BRT = new Date('2026-08-05T13:00:00Z');
const TIMEZONE = 'America/Sao_Paulo';

function openWednesday(startTime = '09:00', endTime = '18:00') {
  return [
    { day_of_week: 'Quarta-feira', is_enabled: true, start_time: startTime, end_time: endTime },
  ];
}

describe('team business hours', () => {
  it('treats a team without any schedule as always open', () => {
    const verdict = evaluateTeamBusinessHours({
      businessHours: [],
      scheduleExceptions: [],
      timezone: TIMEZONE,
      now: WEDNESDAY_10H_BRT,
    });

    expect(verdict.isOpen).toBe(true);
    expect(verdict.verdict).toBe('open_no_schedule_configured');
  });

  it('treats the default seeded schedule as unconfigured rather than closed', () => {
    // `createTeam` insere sete dias apenas com `day_of_week`; is_enabled nasce
    // false e os horarios nascem nulos. Ler isso como "fechada" fazia toda
    // equipe recem-criada recusar transferencias com os agentes online.
    const seededDays = [
      'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
      'Quinta-feira', 'Sexta-feira', 'Sábado',
    ].map((day) => ({ day_of_week: day, is_enabled: false, start_time: null, end_time: null }));

    const verdict = evaluateTeamBusinessHours({
      businessHours: seededDays,
      scheduleExceptions: [],
      timezone: TIMEZONE,
      now: WEDNESDAY_10H_BRT,
    });

    expect(verdict.isOpen).toBe(true);
    expect(verdict.verdict).toBe('open_no_schedule_configured');
  });

  it('closes a configured team outside its window and opens it inside', () => {
    expect(
      evaluateTeamBusinessHours({
        businessHours: openWednesday(),
        scheduleExceptions: [],
        timezone: TIMEZONE,
        now: WEDNESDAY_10H_BRT,
      })
    ).toMatchObject({ isOpen: true, verdict: 'open_by_schedule' });

    expect(
      evaluateTeamBusinessHours({
        businessHours: openWednesday('14:00', '18:00'),
        scheduleExceptions: [],
        timezone: TIMEZONE,
        now: WEDNESDAY_10H_BRT,
      })
    ).toMatchObject({ isOpen: false, verdict: 'closed_by_schedule_hours' });
  });

  it('closes a day that the configured schedule does not cover', () => {
    const verdict = evaluateTeamBusinessHours({
      businessHours: [
        { day_of_week: 'Segunda-feira', is_enabled: true, start_time: '09:00', end_time: '18:00' },
      ],
      scheduleExceptions: [],
      timezone: TIMEZONE,
      now: WEDNESDAY_10H_BRT,
    });

    expect(verdict).toMatchObject({ isOpen: false, verdict: 'closed_day_off' });
  });

  it('supports windows that cross midnight', () => {
    // Quarta-feira, 23:00 em Sao Paulo.
    const wednesday23h = new Date('2026-08-06T02:00:00Z');

    expect(
      evaluateTeamBusinessHours({
        businessHours: openWednesday('22:00', '02:00'),
        scheduleExceptions: [],
        timezone: TIMEZONE,
        now: wednesday23h,
      })
    ).toMatchObject({ isOpen: true });
  });

  it('lets a same-day exception override the regular schedule', () => {
    const closedByException = evaluateTeamBusinessHours({
      businessHours: openWednesday(),
      scheduleExceptions: [{ date: '2026-08-05', is_closed: true }],
      timezone: TIMEZONE,
      now: WEDNESDAY_10H_BRT,
    });
    expect(closedByException).toMatchObject({ isOpen: false, verdict: 'closed_by_exception' });

    const openByException = evaluateTeamBusinessHours({
      businessHours: [],
      scheduleExceptions: [
        { date: new Date('2026-08-05T00:00:00Z'), is_closed: false, start_time: '08:00', end_time: '12:00' },
      ],
      timezone: TIMEZONE,
      now: WEDNESDAY_10H_BRT,
    });
    expect(openByException).toMatchObject({ isOpen: true, verdict: 'open_by_exception' });
  });

  it('ignores exceptions from other days', () => {
    const verdict = evaluateTeamBusinessHours({
      businessHours: openWednesday(),
      scheduleExceptions: [{ date: '2026-08-04', is_closed: true }],
      timezone: TIMEZONE,
      now: WEDNESDAY_10H_BRT,
    });

    expect(verdict).toMatchObject({ isOpen: true, verdict: 'open_by_schedule' });
  });

  it('evaluates the window in the workspace timezone', () => {
    const hours = openWednesday('10:00', '18:00');

    expect(
      evaluateTeamBusinessHours({
        businessHours: hours,
        scheduleExceptions: [],
        timezone: 'America/Sao_Paulo',
        now: WEDNESDAY_10H_BRT,
      }).isOpen
    ).toBe(true);

    // Mesmo instante, 09:00 em Manaus (UTC-4): ainda fechado.
    expect(
      evaluateTeamBusinessHours({
        businessHours: hours,
        scheduleExceptions: [],
        timezone: 'America/Manaus',
        now: WEDNESDAY_10H_BRT,
      }).isOpen
    ).toBe(false);
  });
});

describe('unavailability messages', () => {
  it('names a distinct cause per reason', () => {
    const reasons = [
      'no_members',
      'all_offline',
      'not_accepting',
      'portfolio_full',
      'load_protected',
      'outside_business_hours',
    ] as const;

    const messages = reasons.map((reason) => describeTeamUnavailability(reason, 'Comercial'));

    expect(new Set(messages).size).toBe(reasons.length);
    expect(messages.every((message) => message.includes('Comercial'))).toBe(true);
    expect(describeTeamUnavailability('outside_business_hours', 'Comercial')).toContain('horário de atendimento');
    expect(describeTeamUnavailability('all_offline', 'Comercial')).toContain('online');
  });
});
