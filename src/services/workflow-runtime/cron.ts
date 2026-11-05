const WEEKDAY_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_NAMES: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function valueOf(raw: string, names?: Record<string, number>) {
  const normalized = raw.trim().toLowerCase();
  if (names?.[normalized] !== undefined) return names[normalized]!;
  const number = Number(normalized);
  if (!Number.isInteger(number)) throw new Error(`Valor cron inválido: ${raw}.`);
  return number;
}

function fieldMatches(input: {
  expression: string;
  value: number;
  minimum: number;
  maximum: number;
  names?: Record<string, number>;
  normalize?: (value: number) => number;
}) {
  const normalize = input.normalize || ((value: number) => value);
  let matched = false;
  const segments = input.expression.split(',');
  if (segments.length === 0 || segments.some((segment) => !segment.trim())) throw new Error('Campo cron vazio.');
  for (const segmentValue of segments) {
    const pieces = segmentValue.trim().split('/');
    if (pieces.length > 2) throw new Error(`Passo cron inválido: ${segmentValue}.`);
    const [segment, stepValue] = pieces;
    const step = stepValue === undefined ? 1 : valueOf(stepValue);
    if (step < 1) throw new Error('O passo cron precisa ser maior que zero.');
    let start = input.minimum;
    let end = input.maximum;
    if (segment && segment !== '*') {
      const range = segment.split('-');
      if (range.length > 2) throw new Error(`Faixa cron inválida: ${segmentValue}.`);
      start = valueOf(range[0]!, input.names);
      end = range[1] === undefined ? start : valueOf(range[1], input.names);
    }
    if (start < input.minimum || end > input.maximum || start > end) throw new Error(`Faixa cron inválida: ${segmentValue}.`);
    const current = normalize(input.value);
    const normalizedStart = normalize(start);
    const normalizedEnd = normalize(end);
    if (current >= normalizedStart && current <= normalizedEnd && ((current - normalizedStart) % step === 0)) matched = true;
  }
  return matched;
}

function fields(expression: string) {
  const parsed = expression.trim().split(/\s+/);
  if (parsed.length !== 5) throw new Error('Use uma expressão cron de 5 campos: minuto hora dia mês semana.');
  return parsed as [string, string, string, string, string];
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return {
    minute: Number(part('minute')),
    hour: Number(part('hour')),
    dayOfMonth: Number(part('day')),
    month: Number(part('month')),
    dayOfWeek: WEEKDAY_NAMES[part('weekday').slice(0, 3).toLowerCase()]!,
  };
}

function evaluate(expression: string, values: ReturnType<typeof zonedParts>) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields(expression);
  const results = [
    fieldMatches({ expression: minute, value: values.minute, minimum: 0, maximum: 59 }),
    fieldMatches({ expression: hour, value: values.hour, minimum: 0, maximum: 23 }),
    fieldMatches({ expression: dayOfMonth, value: values.dayOfMonth, minimum: 1, maximum: 31 }),
    fieldMatches({ expression: month, value: values.month, minimum: 1, maximum: 12, names: MONTH_NAMES }),
    fieldMatches({ expression: dayOfWeek, value: values.dayOfWeek, minimum: 0, maximum: 7, names: WEEKDAY_NAMES, normalize: (value) => value === 7 ? 0 : value }),
  ];
  return results.every(Boolean);
}

export function assertValidCronExpression(expression: string, timeZone = 'UTC') {
  const values = zonedParts(new Date('2026-01-05T12:34:00.000Z'), timeZone);
  evaluate(expression, values);
}

export function cronMatchesDate(expression: string, date: Date, timeZone = 'UTC') {
  return evaluate(expression, zonedParts(date, timeZone));
}

export function minuteFloor(date: Date) {
  const result = new Date(date);
  result.setUTCSeconds(0, 0);
  return result;
}
