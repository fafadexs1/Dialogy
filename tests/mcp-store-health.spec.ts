import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  ensureTable: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  db: {
    query: mocks.dbQuery,
  },
}));

vi.mock('@/lib/workspace-integrations', () => ({
  ensureWorkspaceIntegrationsTable: mocks.ensureTable,
}));

import { getMcpWorkspaceConfig, recordMcpServerHealth } from '@/services/mcp/store';

describe('MCP workspace health persistence', () => {
  beforeEach(() => {
    mocks.dbQuery.mockReset();
    mocks.ensureTable.mockReset();
    mocks.ensureTable.mockResolvedValue(undefined);
  });

  it('preserves health diagnostics when loading persisted server config', async () => {
    mocks.dbQuery.mockResolvedValue({
      rows: [{
        config: {
          servers: [{
            id: 'server-1',
            name: 'Router MCP',
            url: 'http://127.0.0.1:8090/mcp',
            transport: 'streamable_http',
            isActive: true,
            tools: [],
            healthStatus: 'unreachable',
            healthCheckedAt: '2026-06-27T23:59:00.000Z',
            healthLatencyMs: 5001,
            lastError: 'tcp timeout',
          }],
        },
      }],
      rowCount: 1,
    });

    const config = await getMcpWorkspaceConfig('workspace-1');

    expect(config.servers[0]).toMatchObject({
      healthStatus: 'unreachable',
      healthCheckedAt: '2026-06-27T23:59:00.000Z',
      healthLatencyMs: 5001,
      lastError: 'tcp timeout',
    });
  });

  it('normalizes malformed health values instead of dropping the server', async () => {
    mocks.dbQuery.mockResolvedValue({
      rows: [{
        config: {
          servers: [{
            id: 'server-1',
            name: 'Router MCP',
            url: 'http://127.0.0.1:8090/mcp',
            isActive: true,
            healthStatus: 'broken',
            healthLatencyMs: 'not-a-number',
          }],
        },
      }],
      rowCount: 1,
    });

    const config = await getMcpWorkspaceConfig('workspace-1');

    expect(config.servers[0]).toMatchObject({
      healthStatus: 'unknown',
      healthLatencyMs: null,
    });
  });

  it('updates only the targeted server health atomically inside the JSON config', async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await recordMcpServerHealth({
      workspaceId: 'workspace-1',
      serverId: 'server-1',
      status: 'unreachable',
      latencyMs: 5000.7,
      error: 'connect timeout',
    });

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    const [query, params] = mocks.dbQuery.mock.calls[0];
    expect(query).toContain('jsonb_array_elements');
    expect(query).toContain(`server.item->>'id' = $3`);
    expect(params.slice(0, 3)).toEqual(['workspace-1', 'mcp', 'server-1']);
    expect(JSON.parse(params[3])).toMatchObject({
      healthStatus: 'unreachable',
      healthLatencyMs: 5001,
      lastError: 'connect timeout',
    });
  });
});
