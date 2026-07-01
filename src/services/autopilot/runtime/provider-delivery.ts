import { db } from '@/lib/db';

type ProviderDeliveryDatabase = {
  query: (query: string, params?: unknown[]) => Promise<{
    rows: Array<{
      api_message_status?: string | null;
      message_id_from_api?: string | null;
      metadata?: Record<string, unknown> | string | null;
    }>;
    rowCount?: number | null;
  }>;
};

type AutomatedSendResult = {
  success: boolean;
  error?: string;
  providerAccepted?: boolean;
  message?: {
    id?: string | null;
  } | null;
};

const ACCEPTED_PROVIDER_STATUSES = new Set([
  'SENT',
  'DELIVERY_ACK',
  'DELIVERED',
  'READ',
  'PLAYED',
]);
const FAILED_PROVIDER_STATUSES = new Set(['FAILED', 'ERROR']);

export class UncertainProviderDeliveryError extends Error {
  readonly code = 'AUTOPILOT_PROVIDER_DELIVERY_UNCERTAIN';

  constructor(message: string) {
    super(message);
    this.name = 'UncertainProviderDeliveryError';
  }
}

export class ProviderDeliveryRejectedError extends Error {
  readonly code = 'AUTOPILOT_PROVIDER_DELIVERY_REJECTED';
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderDeliveryRejectedError';
  }
}

export function isUncertainProviderDeliveryError(
  error: unknown,
): error is UncertainProviderDeliveryError {
  return error instanceof UncertainProviderDeliveryError
    || (
      error instanceof Error
      && (error as Error & { code?: string }).code === 'AUTOPILOT_PROVIDER_DELIVERY_UNCERTAIN'
    );
}

export function isProviderDeliveryError(error: unknown): error is Error {
  if (isUncertainProviderDeliveryError(error)) return true;
  return error instanceof ProviderDeliveryRejectedError
    || (
      error instanceof Error
      && (error as Error & { code?: string }).code === 'AUTOPILOT_PROVIDER_DELIVERY_REJECTED'
    );
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function isUncertainProviderFailureMetadata(value: unknown): boolean {
  const metadata = parseMetadata(value);
  const details = parseMetadata(metadata.send_error_details);
  const reason = [
    metadata.send_error,
    details.reason,
    details.raw_payload,
  ]
    .map((item) => (
      typeof item === 'string' ? item : JSON.stringify(item || '')
    ))
    .join(' ')
    .toLowerCase();
  if (!reason) return false;

  return /\b(abort(?:ed|error)?|timeout|timed out|fetch failed|network|socket|econnreset|econnaborted|und_err)\b/i
    .test(reason)
    && !/evolution api error:\s*[45]\d\d/i.test(reason);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isProviderAcceptedMessageState(input: {
  status: unknown;
  externalMessageId?: unknown;
}): boolean {
  const status = String(input.status || '').trim().toUpperCase();
  if (!ACCEPTED_PROVIDER_STATUSES.has(status)) return false;

  // Delivery/read receipts can only exist after provider acceptance. Some
  // Evolution-compatible providers omit the external id from the send response,
  // so SENT must also remain a valid terminal acknowledgement.
  return status === 'SENT' || Boolean(String(input.externalMessageId || '').trim());
}

export async function waitForAutomatedProviderAcceptance(input: {
  result: AutomatedSendResult;
  chatId: string;
  database?: ProviderDeliveryDatabase;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (durationMs: number) => Promise<void>;
}): Promise<void> {
  if (!input.result.success) {
    throw new Error(
      `Falha ao enviar resposta automatizada para o chat ${input.chatId}: `
      + `${input.result.error || 'erro desconhecido'}`,
    );
  }
  if (input.result.providerAccepted) return;

  const messageId = String(input.result.message?.id || '').trim();
  if (!messageId) {
    throw new Error(
      `Resposta automatizada do chat ${input.chatId} nao informou aceite do provedor nem mensagem persistida.`,
    );
  }

  const database = input.database || db;
  const timeoutMs = input.timeoutMs
    ?? parsePositiveInteger(process.env.AUTOPILOT_PROVIDER_DELIVERY_TIMEOUT_MS, 45_000);
  const pollIntervalMs = input.pollIntervalMs
    ?? parsePositiveInteger(process.env.AUTOPILOT_PROVIDER_DELIVERY_POLL_MS, 200);
  const sleep = input.sleep || ((durationMs: number) => (
    new Promise((resolve) => setTimeout(resolve, durationMs))
  ));
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const state = await database.query(
      `SELECT api_message_status, message_id_from_api, metadata
       FROM messages
       WHERE id = $1
         AND chat_id = $2
       LIMIT 1`,
      [messageId, input.chatId],
    );
    const row = state.rows[0];
    if (!row) {
      throw new Error(
        `Mensagem automatizada ${messageId} nao foi encontrada no chat ${input.chatId}.`,
      );
    }

    const status = String(row.api_message_status || '').trim().toUpperCase();
    if (isProviderAcceptedMessageState({
      status,
      externalMessageId: row.message_id_from_api,
    })) {
      return;
    }
    if (FAILED_PROVIDER_STATUSES.has(status)) {
      if (isUncertainProviderFailureMetadata(row.metadata)) {
        throw new UncertainProviderDeliveryError(
          `Nao foi possivel determinar se o provedor aceitou a mensagem automatizada `
          + `${messageId} do chat ${input.chatId}; reenvio automatico bloqueado.`,
        );
      }
      throw new ProviderDeliveryRejectedError(
        `Provedor rejeitou a mensagem automatizada ${messageId} do chat ${input.chatId}.`,
      );
    }
    if (Date.now() >= deadline) {
      throw new UncertainProviderDeliveryError(
        `Tempo esgotado sem confirmar aceite do provedor para a mensagem automatizada `
        + `${messageId} do chat ${input.chatId}. Reenvio automatico bloqueado. `
        + `status=${status || 'PENDING'}`,
      );
    }

    await sleep(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 1)));
  }
}
