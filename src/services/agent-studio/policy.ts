import type { AgentStudioDocument, CollectedFieldDefinition } from './types';

const SYSTEM_PROHIBITED_DATA = [
  'senha', 'password', 'token secreto', 'token de acesso', 'chave de api', 'api key',
  'codigo de autenticacao', 'codigo 2fa', 'codigo otp', 'otp', 'cvv',
];

const normalizePolicyText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function containsPhrase(text: string, phrase: string) {
  const normalizedText = ` ${normalizePolicyText(text)} `;
  const normalizedPhrase = normalizePolicyText(phrase);
  return Boolean(normalizedPhrase && normalizedText.includes(` ${normalizedPhrase} `));
}

export function matchExcludedStudioTopic(message: string, document: AgentStudioDocument): string | null {
  return (document.rules.excludedTopics || []).find((topic) => containsPhrase(message, topic)) || null;
}

export function prohibitedStudioDataTerms(document: AgentStudioDocument) {
  return [...new Set([...SYSTEM_PROHIBITED_DATA, ...(document.rules.prohibitedDataLabels || [])].map(normalizePolicyText).filter(Boolean))];
}

export function matchProhibitedStudioField(field: CollectedFieldDefinition, document: AgentStudioDocument): string | null {
  const text = [field.name, field.variableKey, field.promptMessage].join(' ');
  return prohibitedStudioDataTerms(document).find((term) => containsPhrase(text, term)) || null;
}

export function matchProhibitedStudioRequest(text: string, document: AgentStudioDocument): string | null {
  const normalized = normalizePolicyText(text);
  if (!/\b(informe|envie|digite|forneca|compartilhe|qual|preciso|solicito)\b/.test(normalized)) return null;
  return prohibitedStudioDataTerms(document).find((term) => containsPhrase(normalized, term)) || null;
}
