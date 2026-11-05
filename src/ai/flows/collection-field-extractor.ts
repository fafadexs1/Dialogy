import { requestDecisionJson } from '@/services/ai/platform-json';
import { z } from 'zod';
import { acceptCollectionFieldValue } from '@/services/autopilot/collection-completion';

/**
 * Reads the customer reply and pulls out the collection fields the
 * deterministic parser could not resolve.
 *
 * The deterministic parser only accepts "label: value" replies, single-field
 * answers, or a lone remaining field. Everything else — "Joao Silva, 11
 * 99999-8888, joao@x.com", or any field name outside its hardcoded PT/EN
 * vocabulary — was silently dropped and re-asked. This runs only on what it
 * missed, and every value it returns still goes through the same validators.
 */

const MAX_FIELDS_PER_CALL = 12;

const ExtractedFieldsSchema = z.record(z.string().nullable().optional());

export type CollectionFieldExtractionInput = {
  customerMessage: string;
  /** Field names still missing after deterministic extraction. */
  pendingFields: string[];
  previousQuestion?: string | null;
  chatHistory?: string;
  model?: string;
  apiKey?: string;
  workspaceId?: string;
  timeoutMs?: number;
};

/** Providers vary in how they handle exotic property names; index them instead. */
function buildFieldKeyMap(pendingFields: string[]): Map<string, string> {
  const map = new Map<string, string>();
  pendingFields.slice(0, MAX_FIELDS_PER_CALL).forEach((field, index) => {
    map.set(`field_${index}`, field);
  });
  return map;
}

function buildJsonSchema(keyMap: Map<string, string>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, field] of keyMap) {
    properties[key] = {
      type: ['string', 'null'],
      description: `Valor informado pelo cliente para "${field}". null se o cliente nao informou.`,
    };
  }
  return {
    type: 'object',
    properties,
    required: Array.from(keyMap.keys()),
    additionalProperties: false,
  };
}

function buildPrompt(input: {
  customerMessage: string;
  keyMap: Map<string, string>;
  previousQuestion?: string | null;
  chatHistory?: string;
}): string {
  const fieldLines = Array.from(input.keyMap)
    .map(([key, field]) => `- ${key}: "${field}"`)
    .join('\n');

  return [
    'Extraia da MENSAGEM DO CLIENTE os valores dos campos listados abaixo.',
    '',
    'Regras:',
    '- Retorne o valor exatamente como o cliente escreveu, sem reformatar, corrigir ou completar.',
    '- Se o cliente nao informou um campo, retorne null para esse campo.',
    '- NUNCA invente, deduza ou complete um valor. Na duvida, retorne null.',
    '- Nao copie valores da PERGUNTA ANTERIOR nem do historico: apenas o que o cliente informou na mensagem atual.',
    '- Uma unica mensagem pode conter varios campos, separados por virgula, quebra de linha ou espaco.',
    '- Se o cliente fez uma pergunta em vez de responder, retorne null para todos os campos.',
    '- Se o cliente recusou, pediu para falar com humano ou quer cancelar, retorne null para todos os campos.',
    '',
    'Campos a extrair:',
    fieldLines,
    '',
    input.previousQuestion ? `PERGUNTA ANTERIOR DO ATENDENTE (apenas contexto, nao extraia dela):\n${input.previousQuestion.slice(0, 400)}` : '',
    input.chatHistory ? `HISTORICO RECENTE (apenas contexto, nao extraia dele):\n${input.chatHistory.slice(-800)}` : '',
    '',
    `MENSAGEM DO CLIENTE:\n${input.customerMessage}`,
  ].filter(Boolean).join('\n');
}

export function acceptExtractedFields(raw: Record<string, unknown>, keyMap: Map<string, string>): Record<string, string> {
  const accepted: Record<string, string> = {};
  for (const [key, field] of keyMap) {
    const value = acceptCollectionFieldValue(field, raw?.[key] ?? null);
    if (value) accepted[field] = value;
  }
  return accepted;
}

export async function extractCollectionFieldsWithAi(
  input: CollectionFieldExtractionInput,
): Promise<Record<string, string>> {
  const pendingFields = input.pendingFields.filter((field) => String(field || '').trim());
  const message = String(input.customerMessage || '').trim();
  if (pendingFields.length === 0 || !message || message.length > 2_000) return {};

  const keyMap = buildFieldKeyMap(pendingFields);
  const jsonSchema = buildJsonSchema(keyMap);
  const userPrompt = buildPrompt({
    customerMessage: message,
    keyMap,
    previousQuestion: input.previousQuestion,
    chatHistory: input.chatHistory,
  });
  const systemPrompt = 'Voce extrai dados literais de mensagens de clientes. Responda somente o JSON solicitado. Campo nao informado e sempre null.';

  const maxTokens = Math.min(600, 80 + keyMap.size * 40);

  try {
    const parsed = await requestDecisionJson('fieldExtractor', {
      workspaceId: input.workspaceId,
      schema: ExtractedFieldsSchema,
      schemaName: 'dialogy_collection_fields',
      jsonSchema, systemPrompt, userPrompt, maxTokens,
    });
    return acceptExtractedFields(parsed as Record<string, unknown>, keyMap);
  } catch (error) {
    console.warn('[AI_FIELD_EXTRACTOR] Extraction failed, keeping deterministic fields only:', error);
    return {};
  }
}
