import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, fetchEvolutionAPIMock, getEvolutionApiConfigMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  fetchEvolutionAPIMock: vi.fn(),
  getEvolutionApiConfigMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { query: queryMock } }));
vi.mock('@/lib/whatsapp/evolution-api-client', () => ({ fetchEvolutionAPI: fetchEvolutionAPIMock }));
vi.mock('@/lib/whatsapp/evolution-config', () => ({ getEvolutionApiConfig: getEvolutionApiConfigMock }));

import { GET } from '@/app/api/agent/templates/route';

describe('GET /api/agent/templates', () => {
  beforeEach(() => {
    queryMock.mockReset();
    fetchEvolutionAPIMock.mockReset();
    getEvolutionApiConfigMock.mockReset();
  });

  it('returns summarized Cloud templates only from the agent workspace', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ workspace_id: 'ws-1', is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ instance_name: 'zap1' }] });
    getEvolutionApiConfigMock.mockResolvedValue({ api_url: 'https://evolution.test', api_key: 'secret' });
    fetchEvolutionAPIMock.mockResolvedValue([
      {
        name: 'segunda_via',
        language: 'pt_BR',
        status: 'APPROVED',
        components: [{ type: 'BODY', text: 'Seu código é {{1}}. Referência {{2}}.' }],
      },
    ]);

    const response = await GET(new Request('http://localhost/api/agent/templates', {
      headers: { Authorization: 'Bearer agent-token' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      templates: [{
        instanceName: 'zap1',
        name: 'segunda_via',
        language: 'pt_BR',
        status: 'APPROVED',
        bodyText: 'Seu código é {{1}}. Referência {{2}}.',
        bodyParameterCount: 2,
      }],
    });
    expect(getEvolutionApiConfigMock).toHaveBeenCalledWith('zap1', { workspaceId: 'ws-1' });
    expect(fetchEvolutionAPIMock).toHaveBeenCalledWith('/template/find/zap1', expect.any(Object));
  });
});
