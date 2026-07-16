import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: queryMock } }));

import { GET } from '@/app/api/agent/transfer-targets/route';

describe('GET /api/agent/transfer-targets', () => {
  beforeEach(() => queryMock.mockReset());

  it('returns only targets from the authenticated agent workspace', async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'agent-1', workspace_id: 'ws-1', workspace_name: 'Atendimento', is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'team-1', name: 'Comercial' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ai-1', name: 'Recepção IA' }] });

    const response = await GET(new Request('http://localhost/api/agent/transfer-targets', {
      headers: { Authorization: 'Bearer token-1' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workspace: { id: 'ws-1', name: 'Atendimento' },
      teams: [{ id: 'team-1', name: 'Comercial' }],
      intelligentAgents: [{ id: 'ai-1', name: 'Recepção IA' }],
    });
    expect(queryMock).toHaveBeenNthCalledWith(2, expect.stringContaining('WHERE workspace_id = $1'), ['ws-1']);
    expect(queryMock).toHaveBeenNthCalledWith(3, expect.stringContaining("type = 'intelligent_attendant'"), ['ws-1']);
  });
});
