import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export type WhatsappCostPeriod = 'current' | 'previous' | string;
export const WHATSAPP_COST_TIMEZONE = 'America/Sao_Paulo';

export function resolveWhatsappCostPeriod(input: WhatsappCostPeriod = 'current', now = new Date()) {
  const local = toZonedTime(now, WHATSAPP_COST_TIMEZONE);
  const currentIndex = local.getFullYear() * 12 + local.getMonth();
  let index: number;
  if (input === 'current') index = currentIndex;
  else if (input === 'previous') index = currentIndex - 1;
  else {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(input);
    if (!match) throw new Error('Escolha um mês válido.');
    index = Number(match[1]) * 12 + Number(match[2]) - 1;
  }
  if (index > currentIndex || index < currentIndex - 11) throw new Error('Escolha um mês dentro dos últimos 12 meses.');
  const monthValue = (value: number) => `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, '0')}`;
  const month = monthValue(index);
  const start = fromZonedTime(`${month}-01T00:00:00`, WHATSAPP_COST_TIMEZONE);
  const next = fromZonedTime(`${monthValue(index + 1)}-01T00:00:00`, WHATSAPP_COST_TIMEZONE);
  return {
    month,
    currentMonth: monthValue(currentIndex),
    earliestMonth: monthValue(currentIndex - 11),
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(Math.min(next.getTime(), now.getTime()) / 1000),
    timeZone: WHATSAPP_COST_TIMEZONE,
    partial: index === currentIndex,
  };
}
