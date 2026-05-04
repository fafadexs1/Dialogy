import { describe, expect, it } from 'vitest';

import { normalizeMcpToolArguments } from '@/services/agent-tools/mcp-arguments';

describe('MCP arguments normalization', () => {
  it('parses arguments when the model returns a JSON string', () => {
    const normalized = normalizeMcpToolArguments(
      '{"device_id":"router-1","client_ip":"192.0.2.10","reason":"Cliente solicitou reinicializacao"}'
    );

    expect(normalized).toEqual({
      success: true,
      arguments: {
        device_id: 'router-1',
        client_ip: '192.0.2.10',
        reason: 'Cliente solicitou reinicializacao',
      },
    });
  });

  it('rejects arguments when the model returns a plain string', () => {
    const normalized = normalizeMcpToolArguments('192.0.2.10');

    expect(normalized).toMatchObject({
      success: false,
      error: expect.stringContaining('JSON valido'),
    });
  });
});
