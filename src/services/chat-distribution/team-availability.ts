import { toZonedTime, format as formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';

import { buildPresenceAvailabilitySql } from '@/lib/presence';

/**
 * Fonte única de verdade sobre "quem pode receber um atendimento agora".
 *
 * Antes existiam quatro definições diferentes espalhadas pelo código — a
 * contagem exibida no diálogo de transferência, o pré-check da rota de API, a
 * escolha de equipe da transferência automática e o balanceador propriamente
 * dito. Cada uma filtrava por um conjunto diferente de condições, então a tela
 * dizia "2 agentes online" enquanto o balanceador respondia "nenhum agente
 * disponível". Tudo aqui é compartilhado justamente para que as duas respostas
 * não possam mais divergir.
 */

export const DEFAULT_DISTRIBUTION_TIMEZONE = 'America/Sao_Paulo';

/** Carga simultânea desejada por agente. Limite flexível: ver `rankDistributionCandidates`. */
export const DEFAULT_CAPACITY = 6;
/** Teto rígido de atendimentos em carteira por agente. */
export const DEFAULT_MAX_PORTFOLIO = 25;

export type TeamAvailabilityReason =
    | 'available'
    | 'no_members'
    | 'all_offline'
    | 'not_accepting'
    | 'portfolio_full'
    | 'outside_business_hours';

/**
 * Mensagem de erro por motivo. Cada motivo tem texto próprio: dizer "nenhum
 * agente disponível" quando a equipe está fora do expediente (ou quando todos
 * bateram o teto de carteira) manda o operador procurar o problema no lugar
 * errado.
 */
export function describeTeamUnavailability(
    reason: TeamAvailabilityReason,
    teamName?: string | null
): string {
    const team = teamName ? `a equipe ${teamName}` : 'esta equipe';
    const teamCapitalized = teamName ? `A equipe ${teamName}` : 'Esta equipe';

    switch (reason) {
        case 'available':
            return '';
        case 'no_members':
            return `${teamCapitalized} não tem nenhum agente cadastrado.`;
        case 'all_offline':
            return `Nenhum agente de ${team} está online no momento.`;
        case 'not_accepting':
            return `Os agentes de ${team} estão com a distribuição pausada no momento.`;
        case 'portfolio_full':
            return `Todos os agentes de ${team} atingiram o limite de atendimentos simultâneos.`;
        case 'outside_business_hours':
            return `${teamCapitalized} está fora do horário de atendimento no momento.`;
    }
}

/** Rótulo curto para exibir junto da contagem de agentes na interface. */
export function shortTeamAvailabilityLabel(reason: TeamAvailabilityReason): string {
    switch (reason) {
        case 'available':
            return 'disponível';
        case 'no_members':
            return 'sem agentes na equipe';
        case 'all_offline':
            return 'ninguém online';
        case 'not_accepting':
            return 'distribuição pausada';
        case 'portfolio_full':
            return 'limite de atendimentos atingido';
        case 'outside_business_hours':
            return 'fora do expediente';
    }
}

// --- Horário de atendimento -------------------------------------------------

export type BusinessHourRow = {
    day_of_week?: string | null;
    is_enabled?: boolean | null;
    start_time?: string | null;
    end_time?: string | null;
};

export type ScheduleExceptionRow = {
    date?: string | Date | null;
    is_closed?: boolean | null;
    start_time?: string | null;
    end_time?: string | null;
    description?: string | null;
};

export type BusinessHoursVerdict =
    | 'open_no_schedule_configured'
    | 'open_by_exception'
    | 'open_by_schedule'
    | 'closed_by_exception'
    | 'closed_by_exception_hours'
    | 'closed_by_schedule_hours'
    | 'closed_day_off';

export type BusinessHoursEvaluation = {
    isOpen: boolean;
    verdict: BusinessHoursVerdict;
    currentDate: string;
    currentTime: string;
    currentDayOfWeek: string;
};

function timeToMinutes(timeStr: string | null | undefined): number | null {
    if (!timeStr) return null;
    const [hoursPart, minutesPart] = String(timeStr).split(':');
    const hours = Number(hoursPart);
    const minutes = Number(minutesPart);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
}

function isTimeInRange(
    timeStr: string,
    startStr: string | null | undefined,
    endStr: string | null | undefined
): boolean {
    const time = timeToMinutes(timeStr);
    const start = timeToMinutes(startStr);
    const end = timeToMinutes(endStr);
    if (time === null || start === null || end === null) return false;
    // Janelas que viram o dia (ex.: 22:00 às 02:00) precisam da comparação em OR.
    if (end <= start) return time >= start || time < end;
    return time >= start && time < end;
}

function normalizeExceptionDate(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().split('T')[0];
    return String(value).split('T')[0];
}

/**
 * Avalia se a equipe está em expediente.
 *
 * Regra que corrigiu o bug: `business_hours.is_enabled` nasce `false` e
 * `start_time`/`end_time` nascem nulos — toda equipe recém-criada tem sete dias
 * desabilitados. Tratar isso como "fechada" faz a equipe nunca receber
 * transferência, mesmo com agentes online, sem que ninguém tenha configurado
 * nada. Agenda não configurada significa 24/7; a trava só existe depois que
 * alguém habilita pelo menos um dia.
 */
export function evaluateTeamBusinessHours(input: {
    businessHours?: BusinessHourRow[] | null;
    scheduleExceptions?: ScheduleExceptionRow[] | null;
    timezone?: string | null;
    now?: Date;
}): BusinessHoursEvaluation {
    const timezone = input.timezone || DEFAULT_DISTRIBUTION_TIMEZONE;
    const zonedNow = toZonedTime(input.now ?? new Date(), timezone);

    const currentDate = formatInTimeZone(zonedNow, 'yyyy-MM-dd', { timeZone: timezone });
    const currentTime = formatInTimeZone(zonedNow, 'HH:mm', { timeZone: timezone });
    const currentDayOfWeek = formatInTimeZone(zonedNow, 'EEEE', { locale: ptBR, timeZone: timezone });

    const base = { currentDate, currentTime, currentDayOfWeek };

    const businessHours = Array.isArray(input.businessHours) ? input.businessHours : [];
    const scheduleExceptions = Array.isArray(input.scheduleExceptions) ? input.scheduleExceptions : [];

    const todayException = scheduleExceptions.find(
        (exception) => normalizeExceptionDate(exception?.date) === currentDate
    );

    if (todayException) {
        if (todayException.is_closed) {
            return { ...base, isOpen: false, verdict: 'closed_by_exception' };
        }
        const openByException = isTimeInRange(
            currentTime,
            todayException.start_time,
            todayException.end_time
        );
        return {
            ...base,
            isOpen: openByException,
            verdict: openByException ? 'open_by_exception' : 'closed_by_exception_hours',
        };
    }

    const configuredDays = businessHours.filter(
        (hour) => hour?.is_enabled && hour?.start_time && hour?.end_time
    );

    if (configuredDays.length === 0) {
        return { ...base, isOpen: true, verdict: 'open_no_schedule_configured' };
    }

    const todayBusinessHour = configuredDays.find(
        (hour) => String(hour.day_of_week ?? '').toLowerCase() === currentDayOfWeek.toLowerCase()
    );

    if (!todayBusinessHour) {
        return { ...base, isOpen: false, verdict: 'closed_day_off' };
    }

    const openBySchedule = isTimeInRange(
        currentTime,
        todayBusinessHour.start_time,
        todayBusinessHour.end_time
    );

    return {
        ...base,
        isOpen: openBySchedule,
        verdict: openBySchedule ? 'open_by_schedule' : 'closed_by_schedule_hours',
    };
}

// --- Presença ---------------------------------------------------------------

/**
 * Predicado de presença usado por *todas* as consultas de distribuição.
 *
 * Delegado a `buildPresenceAvailabilitySql` de propósito: é o mesmo predicado
 * que alimenta a lista de agentes online da interface. Enquanto o balanceador
 * usava só `is_online AND last_seen`, quem tinha atividade recente sem sessão
 * ativa aparecia na tela e sumia da distribuição.
 */
export function buildDistributionPresenceSql(
    presenceAlias: string,
    ttlParam: string,
    recentActivityParam: string
): string {
    return buildPresenceAvailabilitySql(presenceAlias, ttlParam, recentActivityParam);
}

/** Predicado completo: presente **e** aceitando novos atendimentos. */
export function buildAssignableMemberSql(
    presenceAlias: string,
    distributionStateAlias: string,
    ttlParam: string,
    recentActivityParam: string
): string {
    return `(
    ${buildDistributionPresenceSql(presenceAlias, ttlParam, recentActivityParam)}
    AND COALESCE(${distributionStateAlias}.accepting_assignments, TRUE) = TRUE
  )`;
}
