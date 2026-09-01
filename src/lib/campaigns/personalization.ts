import type { CampaignTemplate } from '@/lib/types';

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export type CampaignPersonalizationContext = {
  contactName?: string | null;
  campaignMessage?: string | null;
  now?: Date;
  timeZone?: string | null;
};

function normalizeTimeZone(value?: string | null): string {
  const candidate = value?.trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function normalizeVariableName(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function getCampaignFirstName(contactName?: string | null): string {
  const normalized = String(contactName || '').trim().replace(/\s+/g, ' ');
  return normalized.split(' ')[0] || '';
}

export function getCampaignGreeting(now = new Date(), timeZone?: string | null): string {
  const resolvedTimeZone = normalizeTimeZone(timeZone);
  const hourPart = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimeZone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now).find(part => part.type === 'hour')?.value;
  const hour = (Number(hourPart || 0) || 0) % 24;

  if (hour >= 5 && hour < 12) {
    return 'Bom dia';
  }
  if (hour >= 12 && hour < 18) {
    return 'Boa tarde';
  }
  return 'Boa noite';
}

function resolveCampaignVariable(name: string, context: CampaignPersonalizationContext): string | null {
  const normalizedName = normalizeVariableName(name);
  const contactName = String(context.contactName || '').trim();

  if (normalizedName === 'nome') {
    return contactName;
  }
  if (normalizedName === 'primeiro_nome') {
    return getCampaignFirstName(contactName);
  }
  if (normalizedName === 'saudacao') {
    return getCampaignGreeting(context.now, context.timeZone);
  }

  return null;
}

export function renderCampaignMessage(message: string, context: CampaignPersonalizationContext): string {
  if (!message) {
    return '';
  }

  return message.replace(VARIABLE_PATTERN, (placeholder, variableName: string) => {
    const replacement = resolveCampaignVariable(variableName, context);
    return replacement === null ? placeholder : replacement;
  });
}

function extractTemplateParameterValues(message: string, context: CampaignPersonalizationContext): string[] {
  return Array.from(message.matchAll(VARIABLE_PATTERN))
    .map(match => resolveCampaignVariable(match[1], context))
    .filter((value): value is string => value !== null);
}

export function getCampaignTemplateBodyParameterKeys(template: CampaignTemplate | null): string[] {
  const body = template?.components?.find(component => String(component.type).toUpperCase() === 'BODY');
  const keys = Array.from(
    String(body?.text || '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g),
    match => match[1].trim(),
  );
  const uniqueKeys = [...new Set(keys)];

  if (uniqueKeys.length > 0 && uniqueKeys.every(key => /^\d+$/.test(key))) {
    const highestPosition = Math.max(...uniqueKeys.map(Number));
    return Array.from({ length: highestPosition }, (_, index) => String(index + 1));
  }

  return uniqueKeys;
}

export function buildCampaignTemplateSendComponents(
  template: CampaignTemplate,
  context: CampaignPersonalizationContext,
): any[] {
  const parameterKeys = getCampaignTemplateBodyParameterKeys(template);
  const placeholderCount = parameterKeys.length;
  if (placeholderCount === 0) {
    return [];
  }

  const configuredValues = template.bodyParameterValues?.map(value =>
    renderCampaignMessage(String(value || ''), context)
  );
  const values = configuredValues?.length
    ? configuredValues
    : extractTemplateParameterValues(String(context.campaignMessage || ''), context);
  const fallback = String(context.contactName || '').trim();
  const parameters = Array.from({ length: placeholderCount }, (_, index) => {
    const parameterName = template.bodyParameterNames?.[index];
    return {
      type: 'text',
      text: values[index] ?? fallback,
      ...(parameterName && !/^\d+$/.test(parameterName) ? { parameter_name: parameterName } : {}),
    };
  });

  return [{
    type: 'body',
    parameters,
  }];
}
