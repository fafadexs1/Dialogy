import jsonata from 'jsonata';

import { isRecord, materializeValue } from './utils';

const DEFAULT_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 2_000;
const MAX_INPUT_BYTES = 1_000_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const MAX_STACK_DEPTH = 128;
const MAX_SEQUENCE_LENGTH = 10_000;

type JsonataRuntimeError = Error & {
  code?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

function runtimeError(code: string, message: string, details?: Record<string, unknown>): JsonataRuntimeError {
  const error = new Error(message) as JsonataRuntimeError;
  error.code = code;
  error.retryable = false;
  error.details = details;
  return error;
}

function jsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
  } catch {
    throw runtimeError('JSONATA_INPUT_NOT_SERIALIZABLE', 'A entrada da transformação precisa ser um valor JSON válido.');
  }
}

function normalizeJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw runtimeError('JSONATA_OUTPUT_NOT_SERIALIZABLE', 'O resultado da expressão não pode ser salvo como JSON.');
  }
}

export function resolveJsonataInput(rawSource: unknown, context: Record<string, unknown>, current: Record<string, unknown>): unknown {
  if (rawSource === undefined || rawSource === null || rawSource === '') return structuredClone(current);
  const materialized = materializeValue(rawSource, context);
  if (typeof materialized !== 'string') return materialized;
  const trimmed = materialized.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return materialized;
  }
}

export async function executeJsonataTransform(input: {
  expression: string;
  source: unknown;
  context: Record<string, unknown>;
  current: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<unknown> {
  const source = resolveJsonataInput(input.source, input.context, input.current);
  const inputBytes = jsonSize(source);
  if (inputBytes > MAX_INPUT_BYTES) {
    throw runtimeError('JSONATA_INPUT_TOO_LARGE', 'A entrada JSONata ultrapassa o limite de 1 MB.', { inputBytes });
  }

  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(25, Math.floor(input.timeoutMs || DEFAULT_TIMEOUT_MS)));
  let expression: ReturnType<typeof jsonata>;
  try {
    expression = jsonata(input.expression, {
      timeout: timeoutMs,
      stack: MAX_STACK_DEPTH,
      sequence: MAX_SEQUENCE_LENGTH,
    });
  } catch (cause) {
    const details = isRecord(cause)
      ? { code: String(cause.code || ''), position: Number(cause.position || 0) }
      : undefined;
    throw runtimeError('JSONATA_EXPRESSION_INVALID', 'A expressão JSONata é inválida.', details);
  }

  let evaluated: unknown;
  try {
    evaluated = await expression.evaluate(source);
  } catch (cause) {
    const candidate = isRecord(cause) ? cause : {};
    const code = String(candidate.code || '');
    const message = code === 'D1012'
      ? `A expressão JSONata excedeu o limite de ${timeoutMs} ms.`
      : 'Não foi possível avaliar a expressão JSONata.';
    throw runtimeError(
      code === 'D1012' ? 'JSONATA_TIMEOUT' : 'JSONATA_EVALUATION_FAILED',
      message,
      code ? { jsonataCode: code } : undefined,
    );
  }

  const normalized = normalizeJsonValue(evaluated);
  const outputBytes = jsonSize(normalized);
  if (outputBytes > MAX_OUTPUT_BYTES) {
    throw runtimeError('JSONATA_OUTPUT_TOO_LARGE', 'O resultado JSONata ultrapassa o limite de 1 MB.', { outputBytes });
  }
  return normalized;
}
