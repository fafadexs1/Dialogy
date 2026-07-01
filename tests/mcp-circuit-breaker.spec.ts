import { createServer } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { callMcpServerTool } from '@/services/mcp/client';
import {
  beginMcpCircuitRequest,
  clearMcpCircuitBreakers,
  getMcpCircuitState,
  isMcpTransportFailure,
  McpCircuitOpenError,
  recordMcpCircuitFailure,
  recordMcpCircuitSuccess,
} from '@/services/mcp/circuit-breaker';

const server = {
  id: 'router',
  transport: 'streamable_http' as const,
  url: 'http://192.0.2.10:8090/mcp',
};

afterEach(() => {
  clearMcpCircuitBreakers();
  delete process.env.MCP_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
  delete process.env.MCP_CIRCUIT_BREAKER_OPEN_MS;
});

describe('MCP circuit breaker', () => {
  it('opens after consecutive transport failures and fails fast during the window', () => {
    recordMcpCircuitFailure(server, {
      now: 1_000,
      failureThreshold: 2,
      openMs: 60_000,
    });
    expect(getMcpCircuitState(server)).toMatchObject({
      consecutiveFailures: 1,
      openUntil: 0,
    });
    expect(() => beginMcpCircuitRequest(server, { now: 1_500 })).not.toThrow();

    recordMcpCircuitFailure(server, {
      now: 2_000,
      failureThreshold: 2,
      openMs: 60_000,
    });
    expect(getMcpCircuitState(server)).toMatchObject({
      consecutiveFailures: 2,
      openUntil: 62_000,
    });
    expect(() => beginMcpCircuitRequest(server, { now: 3_000 })).toThrow(McpCircuitOpenError);
  });

  it('allows one half-open probe and closes after it succeeds', () => {
    recordMcpCircuitFailure(server, {
      now: 1_000,
      failureThreshold: 1,
      openMs: 10_000,
    });

    expect(() => beginMcpCircuitRequest(server, { now: 11_001 })).not.toThrow();
    expect(() => beginMcpCircuitRequest(server, { now: 11_001 })).toThrow(McpCircuitOpenError);

    recordMcpCircuitSuccess(server);
    expect(getMcpCircuitState(server)).toBeNull();
    expect(() => beginMcpCircuitRequest(server, { now: 11_002 })).not.toThrow();
  });

  it('reopens when the half-open probe fails', () => {
    recordMcpCircuitFailure(server, {
      now: 1_000,
      failureThreshold: 1,
      openMs: 10_000,
    });
    beginMcpCircuitRequest(server, { now: 11_001 });
    recordMcpCircuitFailure(server, {
      now: 11_002,
      failureThreshold: 2,
      openMs: 20_000,
    });

    expect(getMcpCircuitState(server)).toMatchObject({
      openUntil: 31_002,
      probeInFlight: false,
    });
  });

  it('counts transport errors but not ordinary tool validation errors', () => {
    expect(isMcpTransportFailure(Object.assign(new Error('fetch failed'), {
      cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
    }))).toBe(true);
    expect(isMcpTransportFailure(Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    }))).toBe(true);
    expect(isMcpTransportFailure(new Error('Invalid arguments: order_id is required'))).toBe(false);
  });

  it('opens through the real MCP client and rejects the next request before network I/O', async () => {
    const reservedPort = await new Promise<number>((resolve, reject) => {
      const socket = createServer();
      socket.once('error', reject);
      socket.listen(0, '127.0.0.1', () => {
        const address = socket.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        socket.close((error) => error ? reject(error) : resolve(port));
      });
    });
    const unavailableServer = {
      id: 'unavailable-local',
      name: 'Unavailable local MCP',
      transport: 'streamable_http' as const,
      url: `http://127.0.0.1:${reservedPort}/mcp`,
      isActive: true,
    };
    process.env.MCP_CIRCUIT_BREAKER_FAILURE_THRESHOLD = '2';
    process.env.MCP_CIRCUIT_BREAKER_OPEN_MS = '60000';

    await expect(callMcpServerTool({
      server: unavailableServer,
      toolName: 'noop',
    })).rejects.toThrow(/Falha na comunicacao com MCP/);
    await expect(callMcpServerTool({
      server: unavailableServer,
      toolName: 'noop',
    })).rejects.toThrow(/Falha na comunicacao com MCP/);

    expect(getMcpCircuitState(unavailableServer)?.openUntil).toBeGreaterThan(Date.now());
    await expect(callMcpServerTool({
      server: unavailableServer,
      toolName: 'noop',
    })).rejects.toThrow(/Circuito MCP temporariamente aberto/);
  });
});
