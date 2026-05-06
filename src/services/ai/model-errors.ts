export type AiModelErrorCode =
  | 'auth_error'
  | 'rate_limit'
  | 'timeout'
  | 'model_unavailable'
  | 'safety_block'
  | 'schema_error'
  | 'empty_response'
  | 'unknown';

export type AiModelErrorClassification = {
  code: AiModelErrorCode;
  retryable: boolean;
  message: string;
  status?: number | null;
};

export type AiModelAttemptSummary = {
  model: string;
  keySource: string;
  attempt: number;
  durationMs: number;
  status: 'success' | 'error';
  errorCode?: AiModelErrorCode;
  errorMessage?: string;
  retryable?: boolean;
};

export class AiModelClientError extends Error {
  code: AiModelErrorCode;
  retryable: boolean;
  status?: number | null;
  attempts: AiModelAttemptSummary[];

  constructor(
    message: string,
    options: {
      code?: AiModelErrorCode;
      retryable?: boolean;
      status?: number | null;
      cause?: unknown;
      attempts?: AiModelAttemptSummary[];
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = 'AiModelClientError';
    this.code = options.code || 'unknown';
    this.retryable = Boolean(options.retryable);
    this.status = options.status ?? null;
    this.attempts = options.attempts || [];
  }
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as Record<string, unknown>;
  const candidates = [
    value.status,
    value.statusCode,
    value.code,
    (value.response as Record<string, unknown> | undefined)?.status,
    (value.cause as Record<string, unknown> | undefined)?.status,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate)) {
      return Number(candidate);
    }
  }

  return null;
}

export function getAiModelErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` ${error.cause.message}` : '';
    return `${error.message}${cause}`.trim();
  }

  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function classifyAiModelError(error: unknown): AiModelErrorClassification {
  if (error instanceof AiModelClientError) {
    return {
      code: error.code,
      retryable: error.retryable,
      message: error.message,
      status: error.status ?? null,
    };
  }

  const status = getErrorStatus(error);
  const rawMessage = getAiModelErrorMessage(error);
  const message = rawMessage || 'Unknown AI model error';
  const normalized = message.toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    /api[_\s-]?key[_\s-]?invalid|api key expired|api key not valid|invalid api key|permission_denied|unauthenticated|forbidden/.test(normalized)
  ) {
    return { code: 'auth_error', retryable: false, message, status };
  }

  if (
    status === 429 ||
    /rate limit|rate_limit|quota|resource exhausted|too many requests|exceeded.*limit/.test(normalized)
  ) {
    return { code: 'rate_limit', retryable: true, message, status };
  }

  if (
    /timed out|timeout|deadline exceeded|etimedout|aborterror|the operation was aborted/.test(normalized)
  ) {
    return { code: 'timeout', retryable: true, message, status };
  }

  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /unavailable|overloaded|service unavailable|temporarily unavailable|internal error|backend error|bad gateway|gateway timeout/.test(normalized)
  ) {
    return { code: 'model_unavailable', retryable: true, message, status };
  }

  if (/safety|blocked|finishreason.*safety|candidate.*blocked|recitation/.test(normalized)) {
    return { code: 'safety_block', retryable: false, message, status };
  }

  if (/schema|zod|validation|invalid json|json parse|parse error|malformed/.test(normalized)) {
    return { code: 'schema_error', retryable: false, message, status };
  }

  if (/empty response|no output|missing output|undefined output|model returned no/.test(normalized)) {
    return { code: 'empty_response', retryable: true, message, status };
  }

  return { code: 'unknown', retryable: false, message, status };
}

