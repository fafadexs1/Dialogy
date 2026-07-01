import type { McpServerConfig } from './types';

type McpCircuitServer = Pick<McpServerConfig, 'id' | 'transport' | 'url' | 'command'>;

type McpCircuitState = {
  consecutiveFailures: number;
  lastFailureAt: number;
  openUntil: number;
  probeInFlight: boolean;
};

type McpCircuitOptions = {
  now?: number;
  failureThreshold?: number;
  openMs?: number;
  failureWindowMs?: number;
};

const circuits = new Map<string, McpCircuitState>();

function positiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function failureThreshold(options?: McpCircuitOptions): number {
  return positiveInteger(
    options?.failureThreshold ?? process.env.MCP_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    2,
    1,
    20,
  );
}

function openDurationMs(options?: McpCircuitOptions): number {
  return positiveInteger(
    options?.openMs ?? process.env.MCP_CIRCUIT_BREAKER_OPEN_MS,
    60_000,
    1_000,
    15 * 60_000,
  );
}

function failureWindowMs(options?: McpCircuitOptions): number {
  return positiveInteger(
    options?.failureWindowMs ?? process.env.MCP_CIRCUIT_BREAKER_FAILURE_WINDOW_MS,
    5 * 60_000,
    10_000,
    60 * 60_000,
  );
}

function circuitKey(server: McpCircuitServer): string {
  return [
    server.id,
    server.transport,
    server.url || server.command || '',
  ].join('|');
}

export class McpCircuitOpenError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Circuito MCP temporariamente aberto; nova tentativa em ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = 'McpCircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

export function beginMcpCircuitRequest(
  server: McpCircuitServer,
  options?: Pick<McpCircuitOptions, 'now'>,
): void {
  const state = circuits.get(circuitKey(server));
  if (!state) return;
  const now = options?.now ?? Date.now();

  if (state.openUntil > now) {
    throw new McpCircuitOpenError(state.openUntil - now);
  }
  if (state.openUntil > 0) {
    if (state.probeInFlight) {
      throw new McpCircuitOpenError(1_000);
    }
    state.probeInFlight = true;
  }
}

export function recordMcpCircuitSuccess(server: McpCircuitServer): void {
  circuits.delete(circuitKey(server));
}

export function recordMcpCircuitFailure(
  server: McpCircuitServer,
  options?: McpCircuitOptions,
): void {
  const key = circuitKey(server);
  const now = options?.now ?? Date.now();
  const previous = circuits.get(key);
  const withinFailureWindow = previous
    ? now - previous.lastFailureAt <= failureWindowMs(options)
    : false;
  const consecutiveFailures = withinFailureWindow
    ? previous!.consecutiveFailures + 1
    : 1;
  const shouldOpen = Boolean(previous?.probeInFlight)
    || consecutiveFailures >= failureThreshold(options);

  circuits.set(key, {
    consecutiveFailures,
    lastFailureAt: now,
    openUntil: shouldOpen ? now + openDurationMs(options) : 0,
    probeInFlight: false,
  });
}

export function isMcpTransportFailure(error: unknown): boolean {
  const cause = error && typeof error === 'object' ? (error as any).cause : null;
  const code = String(cause?.code || (error as any)?.code || '').toUpperCase();
  const message = [
    error instanceof Error ? error.message : String(error || ''),
    cause instanceof Error ? cause.message : String(cause?.message || ''),
  ].join(' ').toLowerCase();

  return (
    /^(?:UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EPIPE)$/.test(code) ||
    /\b(fetch failed|connect timeout|connection refused|connection reset|network error|socket hang up|terminated)\b/.test(message)
  );
}

export function getMcpCircuitState(
  server: McpCircuitServer,
): Readonly<McpCircuitState> | null {
  const state = circuits.get(circuitKey(server));
  return state ? { ...state } : null;
}

export function clearMcpCircuitBreakers(): void {
  circuits.clear();
}
