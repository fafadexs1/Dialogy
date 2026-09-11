import type { CollectedFieldDefinition } from './types';
import { isValidCustomerIdentifier } from '@/services/autopilot/slots';
import { isStudioInformationQuestion, resolveStudioOption } from './option-resolution';
import { readStudioValue } from './data-mapping';
import { parseBrazilianDate } from './natural-values';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export function matchesStudioFieldLabel(field: CollectedFieldDefinition, label: string) {
  const normalized = normalize(label);
  return [field.name, ...(field.aliases || [])].some((candidate) => normalize(candidate) === normalized);
}

/** Keep display labels and typed integration IDs together for every consumer. */
export function resolveStudioCollectionOptions(field: CollectedFieldDefinition, values: Record<string, unknown>): {
  field: CollectedFieldDefinition;
  options?: Array<{ label: string; value: unknown }>;
} {
  if (!field.optionsSourceKey || !['single_select', 'multi_select'].includes(field.type)) return { field };
  const source = readStudioValue(values, field.optionsSourceKey);
  if (!Array.isArray(source) || !source.length || source.length > 100) throw new Error('A lista de opções está indisponível ou excede 100 itens.');
  const options = source.map((item) => ({
    label: String(field.optionLabelPath ? readStudioValue(item, field.optionLabelPath) ?? '' : item),
    value: field.optionValuePath ? readStudioValue(item, field.optionValuePath) : item,
  }));
  if (options.some((option) => !option.label.trim() || option.value === undefined) || new Set(options.map((option) => option.label)).size !== options.length) {
    throw new Error('A lista possui opções incompletas ou nomes repetidos.');
  }
  return { field: { ...field, options: options.map((option) => option.label) }, options };
}

/** Fixed-width patterns only: even bounded optional repetitions can cause exponential backtracking. */
export function isSafeStudioPattern(pattern: string): boolean {
  if (pattern.length > 200 || /[()|*+?]|\\[1-9]/.test(pattern)) return false;
  let width = pattern.length;
  const withoutCounts = pattern.replace(/\{(\d+)\}/g, (_, count: string) => { width += Number(count); return ''; });
  if (/[{}]/.test(withoutCounts) || width > 2000) return false;
  try { new RegExp(pattern, 'u'); return true; } catch { return false; }
}

// RFB: https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf
export function isValidStudioCnpj(value: string): boolean {
  const cnpj = value.toUpperCase().replace(/[.\/-]/g, '');
  if (!/^[A-Z\d]{12}\d{2}$/.test(cnpj) || /^(.)\1+$/.test(cnpj)) return false;
  const digit = (base: string) => {
    let sum = 0;
    for (let index = base.length - 1, weight = 2; index >= 0; index--, weight = weight === 9 ? 2 : weight + 1) {
      sum += (base.charCodeAt(index) - 48) * weight;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digit(cnpj.slice(0, 12)) === Number(cnpj[12]) && digit(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

export function validateStudioField(field: CollectedFieldDefinition, input: unknown): { valid: true; value: unknown } | { valid: false; error: string } {
  const invalid = (fallback: string) => ({ valid: false as const, error: field.errorMessage || fallback });
  if (input === undefined || input === null || input === '') return invalid(`Informe ${field.name}.`);
  if (field.type === 'file') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('Envie um arquivo pelo canal de atendimento.');
    const file = input as Record<string, unknown>;
    if (typeof file.id !== 'string' || typeof file.name !== 'string' || typeof file.mimeType !== 'string' || typeof file.size !== 'number' || file.size <= 0 || file.size > 20_000_000) {
      return invalid('Envie um arquivo válido de até 20 MB.');
    }
    // The channel adapter supplies an authorized attachment ID; arbitrary URLs are not files.
    return { valid: true, value: { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size } };
  }
  if (typeof input === 'object' && field.type !== 'multi_select') return invalid('Informe um valor simples.');
  const raw = String(input).trim();
  if (!raw) return invalid(`Informe ${field.name}.`);
  if (raw.length > 4000) return invalid('A informação é muito longa. Envie uma resposta mais curta.');
  let value: unknown = raw;
  if (field.type === 'cpf_cnpj') {
    const normalized = raw.toUpperCase().replace(/[.\/\s-]/g, '');
    if (!(/^\d{11}$/.test(normalized) ? isValidCustomerIdentifier(normalized) : isValidStudioCnpj(normalized))) return invalid('Informe um CPF ou CNPJ válido.');
    value = normalized;
  } else if (field.type === 'cpf') {
    value = raw.replace(/[.\-\s]/g, '');
    if (!/^\d{11}$/.test(String(value)) || !isValidCustomerIdentifier(String(value))) return invalid('O CPF não é válido. Confira os 11 dígitos.');
  } else if (field.type === 'cnpj') {
    if (!isValidStudioCnpj(raw)) return invalid('O CNPJ não é válido. Confira os caracteres e dígitos verificadores.');
    value = raw.toUpperCase().replace(/[.\/-]/g, '');
  } else if (field.type === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return invalid('Informe um e-mail válido.');
    value = raw.toLowerCase();
  } else if (field.type === 'phone') {
    const digits = raw.replace(/[+\s().-]/g, '');
    if (!/^\d{10,15}$/.test(digits)) return invalid('Informe o telefone com código de área.');
    value = digits;
  } else if (field.type === 'cep') {
    value = raw.replace(/[\s-]/g, '');
    if (!/^\d{8}$/.test(String(value))) return invalid('Informe um CEP com 8 dígitos.');
  } else if (field.type === 'number' || field.type === 'currency') {
    const numeric = raw.replace(/^R\$\s*/, '').replace(/\s/g, '');
    const normalized = numeric.includes(',') ? numeric.replace(/\./g, '').replace(',', '.') : numeric;
    if (!/^-?\d+(\.\d+)?$/.test(normalized) || !Number.isFinite(Number(normalized))) return invalid('Informe um número válido.');
    value = Number(normalized);
    if (field.minValue !== undefined && Number(value) < field.minValue) return invalid(`O valor mínimo é ${field.minValue}.`);
    if (field.maxValue !== undefined && Number(value) > field.maxValue) return invalid(`O valor máximo é ${field.maxValue}.`);
  } else if (field.type === 'date') {
    const parsed = parseBrazilianDate(raw);
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    const iso = parsed || (match ? `${match[3]}-${match[2]}-${match[1]}` : raw);
    const date = new Date(`${iso}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return invalid('Informe uma data válida no formato dia/mês/ano.');
    value = iso;
  } else if (field.type === 'time') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return invalid('Informe um horário válido, como 14:30.');
  } else if (field.type === 'url') {
    try { const url = new URL(raw); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(); value = url.toString(); }
    catch { return invalid('Informe um link HTTP ou HTTPS válido.'); }
  } else if (field.type === 'boolean') {
    if (typeof input === 'boolean') return { valid: true, value: input };
    if (['sim', 'true', 'yes'].includes(normalize(raw))) value = true;
    else if (['nao', 'false', 'no'].includes(normalize(raw))) value = false;
    else return invalid('Responda sim ou não.');
  } else if (field.type === 'single_select' || field.type === 'multi_select') {
    const options = field.options || [];
    const requested = field.type === 'multi_select' ? (Array.isArray(input) ? input.map(String) : raw.split(',')) : [raw];
    const selected = requested.map((item) => {
      const resolved = resolveStudioOption(options, item);
      return resolved.kind === 'selected' ? resolved.value : undefined;
    });
    if (!selected.length || selected.some((item) => !item)) return invalid(`Escolha entre: ${options.join(', ')}.`);
    value = field.type === 'single_select' ? selected[0] : [...new Set(selected)];
  }
  if (field.validationRegex) {
    if (!isSafeStudioPattern(field.validationRegex)) return invalid('A validação deste campo precisa ser revisada pelo responsável.');
    try { if (!new RegExp(field.validationRegex, 'u').test(String(value))) return invalid('A informação não corresponde ao formato esperado.'); }
    catch { return invalid('A validação deste campo precisa ser revisada pelo responsável.'); }
  }
  return { valid: true, value };
}

export function extractStudioFieldCandidate(field: CollectedFieldDefinition, message: string, directAnswer: boolean): unknown {
  // Explicit labels disambiguate multiple fields of the same type without guessing ownership.
  const labelled = message.split(/[;\n]/).map((part) => part.trim()).filter((part) => part.includes(':') && matchesStudioFieldLabel(field, part.slice(0, part.indexOf(':'))));
  if (labelled.length === 1) return labelled[0].slice(labelled[0].indexOf(':') + 1).trim();
  if (field.type === 'single_select') {
    const resolved = resolveStudioOption(field.options || [], message, directAnswer);
    if (resolved.kind === 'selected') return resolved.value;
  }
  const patterns: Partial<Record<CollectedFieldDefinition['type'], RegExp>> = {
    cpf: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,
    cnpj: /\b[A-Z\d]{2}\.?[A-Z\d]{3}\.?[A-Z\d]{3}\/?[A-Z\d]{4}-?\d{2}\b/i,
    cpf_cnpj: /\b(?:[A-Z\d]{2}\.?[A-Z\d]{3}\.?[A-Z\d]{3}\/?[A-Z\d]{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/i,
    email: /[^\s@]+@[^\s@]+\.[^\s@]+/,
    date: /\b(?:\d{1,2}\s*(?:de\s+)?(?:jan(?:eiro)?|fev(?:ereiro)?|mar(?:co)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)\b(?:\s+(?:de\s+)?\d{2,4})?|\d{1,2}[\/\.-]\d{1,2}(?:[\/\.-]\d{2,4})?)\b/i,
    time: /\b\d{2}:\d{2}\b/,
    cep: /\b\d{5}-?\d{3}\b/,
  };
  const pattern = patterns[field.type];
  if (pattern) {
    const matches = [...message.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))].map((match) => match[0]);
    return matches.length === 1 ? matches[0] : directAnswer ? message : undefined;
  }
  return directAnswer ? message : undefined;
}

/** Valid structured values (e.g. URLs with query strings) are still answers. */
export function isStudioFieldQuestion(field: CollectedFieldDefinition, message: string): boolean {
  if (!isStudioInformationQuestion(message)) return false;
  return field.type === 'text' || !validateStudioField(field, extractStudioFieldCandidate(field, message, true)).valid;
}
