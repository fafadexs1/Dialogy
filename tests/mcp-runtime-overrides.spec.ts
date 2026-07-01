import { describe, expect, it } from 'vitest';

import { applyMcpRuntimeEndpointOverride } from '@/services/mcp/runtime-overrides';
import type { McpServerConfig } from '@/services/mcp/types';

const server: McpServerConfig = {
  id: 'router-server',
  name: 'Router MCP',
  transport: 'streamable_http',
  url: 'http://10.0.0.10:8090/mcp',
  isActive: true,
};

describe('MCP runtime endpoint overrides', () => {
  it('requires explicit opt-in and exact server id matching', () => {
    const raw = JSON.stringify({
      'router-server': 'http://127.0.0.1:8090/mcp',
    });
    expect(applyMcpRuntimeEndpointOverride(server, {
      MCP_HTTP_ENDPOINT_OVERRIDES: raw,
    })).toBe(server);

    expect(applyMcpRuntimeEndpointOverride(server, {
      MCP_ALLOW_ENDPOINT_OVERRIDES: 'true',
      MCP_HTTP_ENDPOINT_OVERRIDES: raw,
    }).url).toBe('http://127.0.0.1:8090/mcp');
  });

  it('rejects credential-bearing and non-HTTP override URLs', () => {
    for (const invalidUrl of [
      'file:///tmp/mcp',
      'http://user:secret@127.0.0.1:8090/mcp',
      'not-a-url',
    ]) {
      expect(applyMcpRuntimeEndpointOverride(server, {
        MCP_ALLOW_ENDPOINT_OVERRIDES: 'true',
        MCP_HTTP_ENDPOINT_OVERRIDES: JSON.stringify({
          'router-server': invalidUrl,
        }),
      })).toBe(server);
    }
  });
});
