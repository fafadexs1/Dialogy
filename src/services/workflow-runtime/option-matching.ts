import { isRecord } from './utils';

export type WorkflowOptionMatch = {
  index: number;
  id: string;
  value: string;
  label: string;
  strategy: 'number' | 'exact' | 'contains';
};

export function normalizeWorkflowOptionText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d+)\s*[ªº°]/g, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}

function optionNumber(raw: unknown, length: number) {
  const normalized = normalizeWorkflowOptionText(raw);
  const match = normalized.match(/^(\d+)$/)
    || normalized.match(/^(?:opcao|opc|item|numero|num|n)\s+(\d+)$/)
    || String(raw ?? '').trim().match(/^#\s*(\d+)$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return Number.isInteger(index) && index >= 0 && index < length ? index : null;
}

export function matchWorkflowOptionByHeuristics(optionsValue: unknown, rawMessage: unknown): WorkflowOptionMatch | null {
  const options = Array.isArray(optionsValue) ? optionsValue.filter(isRecord) : [];
  if (options.length === 0) return null;
  const normalizedMessage = normalizeWorkflowOptionText(rawMessage);
  if (!normalizedMessage) return null;
  const candidates = options.map((option, index) => {
    const id = String(option.id || option.value || `option_${index + 1}`);
    const value = String(option.value || option.label || id);
    const label = String(option.label || option.value || id);
    const normalizedTexts = [...new Set([id, value, label].map(normalizeWorkflowOptionText).filter(Boolean))];
    return { index, id, value, label, normalizedTexts };
  });
  const numericIndex = optionNumber(rawMessage, candidates.length);
  if (numericIndex !== null) return { ...candidates[numericIndex]!, strategy: 'number' };
  const exact = candidates.filter((candidate) => candidate.normalizedTexts.includes(normalizedMessage));
  if (exact.length === 1) return { ...exact[0]!, strategy: 'exact' };
  if (normalizedMessage.length < 3) return null;
  const contains = candidates.filter((candidate) => candidate.normalizedTexts.some((text) => (
    text !== normalizedMessage && (text.includes(normalizedMessage) || normalizedMessage.includes(text))
  )));
  return contains.length === 1 ? { ...contains[0]!, strategy: 'contains' } : null;
}
