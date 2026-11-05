import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ db: { query } }));
import { lookupSgpCustomerContracts } from '@/services/agent-tools/sgp-tools';

describe('SGP read-only identification boundary', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [
      { provider: 'sgp', config: { baseUrl: 'https://sgp.example.test', cpfFieldId: 'cpf-field' } },
      { provider: 'sgp_user_operator', config: { username: 'operator', token: 'test-token' } },
    ] }).mockResolvedValueOnce({ rows: [{ contact_id: 'contact-for-chat' }] })
      .mockResolvedValueOnce({ rows: [{ value: '52998224725' }] });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('resolves from chat/workspace and projects only contract selection fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ clientes: [{ contratos: [
      { id: 123, status: 'Ativo', contratoCentralSenha: 'secret-must-not-leave', servicos: [] },
    ] }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await lookupSgpCustomerContracts({ workspaceId: 'workspace', chatId: 'chat', contactId: 'untrusted-contact' });
    expect(result.status).toBe('found');
    expect(query.mock.calls[1][1]).toEqual(['chat', 'workspace']);
    expect(query.mock.calls[2][1]).toEqual(['contact-for-chat', 'cpf-field']);
    expect(query.mock.calls.every(([sql]) => /^\s*SELECT/.test(sql))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret-must-not-leave');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).cpfcnpj).toBe('52998224725');
  });
  it.each([
    [{ clientes: [] }, 'not-found'],
    [{ error: 'provider-rejected' }, 'unavailable'],
  ])('distinguishes empty customer results from malformed provider replies', async (payload, status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(payload) }));
    expect(await lookupSgpCustomerContracts({ workspaceId: 'workspace', chatId: 'chat' })).toEqual({ status });
  });
  it('returns unavailable on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' }));
    expect(await lookupSgpCustomerContracts({ workspaceId: 'workspace', chatId: 'chat' })).toEqual({ status: 'unavailable' });
  });
});
