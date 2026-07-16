import { describe, expect, it, vi } from 'vitest';

import { enrichSupportContractsWithLiveRadius } from '@/plugins/sgp/radius-session';
import { buildSGPContactPanelData } from '@/plugins/sgp/contact-panel-data';

const global = {
  baseUrl: 'https://sgp.example.com',
  appId: 'dialogy-app',
  appToken: 'app-token',
};
const user = {
  username: 'operator',
  token: Buffer.from('operator:secret').toString('base64'),
};

describe('SGP live Radius session enrichment', () => {
  it('uses Basic Auth and replaces the contract snapshot with the active Radius session', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{
      username: 'cliente.pppoe',
      ip: '100.66.15.159',
      framedipv6prefix: '2804:3cd0:80::/64',
      delegatedipv6prefix: '2804:3cd0:c1:3414::/62',
      dataconexao: '2026-07-13T16:22:10',
      mac: 'd8:e8:44:45:20:2d',
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await enrichSupportContractsWithLiveRadius({
      global,
      user,
      contracts: [{
        contrato_id: '16318',
        servico_login: 'cliente.pppoe',
        rad_ip: '100.64.0.1',
        servico_online: true,
      }],
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>)[0];
    expect(url).toBe('https://sgp.example.com/ws/radius/radacct/list/');
    expect(init?.headers).toMatchObject({ Authorization: `Basic ${user.token}` });
    expect(JSON.parse(String(init?.body))).toEqual({
      app: 'dialogy-app',
      token: 'app-token',
      username: 'cliente.pppoe',
      tipopessoa: 'F',
      online: true,
    });
    expect(result[0]).toMatchObject({
      rad_ip: '100.66.15.159',
      rad_framedipv6prefix: '2804:3cd0:80::/64',
      rad_delegatedipv6prefix: '2804:3cd0:c1:3414::/62',
      servico_online: true,
      radius_lookup_status: 'online',
    });
  });

  it('removes a stale IP when Radius confirms there is no active session', async () => {
    const result = await enrichSupportContractsWithLiveRadius({
      global,
      user,
      contracts: [{ contrato_id: '16318', rad_username: 'cliente.pppoe', rad_ip: '100.64.0.1' }],
      fetchImpl: vi.fn(async () => new Response('[]', { status: 200 })) as typeof fetch,
    });

    expect(result[0]).toMatchObject({
      rad_ip: null,
      servico_online: false,
      radius_lookup_status: 'offline',
    });
  });

  it('does not expose the cached IP when the authoritative lookup is unavailable', async () => {
    const result = await enrichSupportContractsWithLiveRadius({
      global,
      user,
      contracts: [{ contrato_id: '16318', servico_login: 'cliente.pppoe', rad_ip: '100.64.0.1' }],
      fetchImpl: vi.fn(async () => new Response('failure', { status: 503 })) as typeof fetch,
    });

    expect(result[0]).toMatchObject({
      rad_ip: null,
      servico_online: null,
      radius_lookup_status: 'unavailable',
    });

    const panel = buildSGPContactPanelData([
      {
        nome: 'Cliente',
        cpfcnpj: '00000000000',
        contratos: [{
          contrato: '16318',
          status: 'Ativo',
          servicos: [{
            tipo: 'internet',
            login: 'cliente.pppoe',
            ip: '100.64.0.1',
            onu: { conexao: { status: 'online', ip: '100.64.0.1' } },
          }],
        }],
        titulos: [],
      },
    ], result);

    expect(panel?.contracts[0]).toMatchObject({
      id: '16318',
      ip: null,
      connectionStatus: 'unknown',
    });
  });

  it('checks every PPPoE service when a customer has more than twenty logins', async () => {
    const contracts = Array.from({ length: 32 }, (_, index) => ({
      contrato_id: String(10000 + Math.floor(index / 2)),
      servico_login: `cliente.${index + 1}`,
      rad_ip: null,
    }));
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const suffix = Number(String(body.username).split('.').pop());
      return new Response(JSON.stringify(suffix > 29 ? [{ username: body.username, ip: `100.66.15.${suffix}` }] : []), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await enrichSupportContractsWithLiveRadius({
      global,
      user,
      contracts,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(32);
    expect(result.filter((contract) => contract.radius_lookup_status === 'online')).toHaveLength(3);
    expect(result.at(-1)).toMatchObject({ rad_ip: '100.66.15.32', radius_lookup_status: 'online' });
  });
});
