import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { query: mocks.dbQuery } }));

import { runSgpWorkspaceTool } from '@/services/agent-tools/sgp-tools';

describe('SGP explicit customer identifier', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mocks.dbQuery.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses the CPF collected by Nexus when the mapped CRM field is empty', async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            provider: 'sgp',
            config: {
              baseUrl: 'https://sgp.example.com',
              cpfFieldId: 'cpf-field',
              appId: 'app-id',
              appToken: 'app-token',
            },
          },
          {
            provider: 'sgp_user_operator',
            config: { username: 'operator', token: 'basic-token' },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ contact_id: 'contact-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        clientes: [{
          contratos: [{
            id: 123,
            servicos: [{ plano: { descricao: 'Fibra' }, endereco: { cidade: 'Brasília' } }],
          }],
        }],
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await runSgpWorkspaceTool(
      {
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
        customerIdentifier: '066.468.821-77',
      },
      { type: 'sgp_fetch_contracts', reason: 'NexusFlow', payload: {} },
    );

    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sgp.example.com/api/ura/clientes/',
      expect.objectContaining({
        body: JSON.stringify({
          cpfcnpj: '06646882177',
          exibir_conexao: 1,
          app: 'app-id',
          token: 'app-token',
        }),
      }),
    );
  });
});
