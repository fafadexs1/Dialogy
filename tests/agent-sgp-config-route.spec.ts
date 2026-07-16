import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: queryMock } }));

import { GET } from '@/app/api/agent/sgp-config/route';

describe('GET /api/agent/sgp-config', () => {
  beforeEach(() => queryMock.mockReset());

  it('returns the active SGP application credentials from the agent workspace', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ workspace_id: 'ws-1', is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ config: {
        baseUrl: 'https://velpro.sgp.tsmx.com.br/',
        appId: 'dialogy-app',
        appToken: 'dialogy-token',
      } }] });

    const response = await GET(new Request('http://localhost/api/agent/sgp-config', {
      headers: { Authorization: 'Bearer agent-token' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      endpoint: 'https://velpro.sgp.tsmx.com.br/api/ura/clientes/',
      paymentPromiseEndpoint: 'https://velpro.sgp.tsmx.com.br/api/ura/liberacaopromessa/',
      app: 'dialogy-app',
      token: 'dialogy-token',
    });
    expect(queryMock.mock.calls[1][1]).toEqual(['ws-1']);
  });
});
