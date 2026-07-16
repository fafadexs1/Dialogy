import type { SGPGlobalConfig, SGPUserConfig } from './types';

type RadiusSession = Record<string, unknown> & {
  username?: string;
  ip?: string;
  framedipv6prefix?: string;
  delegatedipv6prefix?: string;
  dataconexao?: string;
  mac?: string;
};

type RadiusLookupResult = {
  ok: boolean;
  sessions: RadiusSession[];
};

function normalize(value: unknown): string {
  return String(value ?? '').trim();
}

function contractLogin(contract: any): string {
  return normalize(contract?.rad_username) || normalize(contract?.servico_login);
}

function contractId(contract: any): string {
  return normalize(contract?.contrato_id ?? contract?.contrato ?? contract?.id);
}

async function fetchLiveRadiusSession(input: {
  global: SGPGlobalConfig;
  user: SGPUserConfig;
  username: string;
  fetchImpl: typeof fetch;
}): Promise<RadiusLookupResult> {
  if (!input.global.baseUrl || !input.global.appId || !input.global.appToken || !input.user.token) {
    return { ok: false, sessions: [] };
  }

  try {
    const response = await input.fetchImpl(
      `${input.global.baseUrl.replace(/\/+$/, '')}/ws/radius/radacct/list/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${input.user.token}`,
        },
        body: JSON.stringify({
          app: input.global.appId,
          token: input.global.appToken,
          username: input.username,
          tipopessoa: 'F',
          online: true,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) return { ok: false, sessions: [] };

    const payload = await response.json();
    return {
      ok: true,
      sessions: Array.isArray(payload) ? payload : [],
    };
  } catch (error) {
    console.warn(`[SGP_RADIUS] Falha ao consultar sessao ativa de ${input.username}:`, error);
    return { ok: false, sessions: [] };
  }
}

function applyAuthoritativeRadiusResult(contract: any, result: RadiusLookupResult): any {
  if (!result.ok) {
    return {
      ...contract,
      rad_ip: null,
      rad_framedipv6prefix: null,
      rad_delegatedipv6prefix: null,
      rad_dataconexao: null,
      servico_online: null,
      radius_lookup_status: 'unavailable',
    };
  }

  const session = result.sessions[0];
  if (!session) {
    return {
      ...contract,
      rad_ip: null,
      rad_framedipv6prefix: null,
      rad_delegatedipv6prefix: null,
      rad_dataconexao: null,
      servico_online: false,
      radius_lookup_status: 'offline',
    };
  }

  return {
    ...contract,
    rad_ip: normalize(session.ip) || null,
    rad_framedipv6prefix: normalize(session.framedipv6prefix) || null,
    rad_delegatedipv6prefix: normalize(session.delegatedipv6prefix) || null,
    rad_dataconexao: normalize(session.dataconexao) || null,
    rad_username: normalize(session.username) || contractLogin(contract) || null,
    servico_login: contractLogin(contract) || normalize(session.username) || null,
    rad_mac: normalize(session.mac) || normalize(contract?.rad_mac) || null,
    servico_online: true,
    radius_lookup_status: 'online',
  };
}

export async function enrichSupportContractsWithLiveRadius(input: {
  global: SGPGlobalConfig;
  user: SGPUserConfig;
  contracts: any[];
  fetchImpl?: typeof fetch;
}): Promise<any[]> {
  const contracts = Array.isArray(input.contracts) ? input.contracts : [];
  const uniqueLogins = Array.from(new Set(contracts.map(contractLogin).filter(Boolean))).slice(0, 100);
  const entries: Array<readonly [string, RadiusLookupResult]> = [];
  const concurrency = 8;
  for (let index = 0; index < uniqueLogins.length; index += concurrency) {
    const batch = uniqueLogins.slice(index, index + concurrency);
    entries.push(...await Promise.all(
      batch.map(async (username) => [
        username,
        await fetchLiveRadiusSession({
          global: input.global,
          user: input.user,
          username,
          fetchImpl: input.fetchImpl || fetch,
        }),
      ] as const),
    ));
  }
  const results = new Map(entries);

  const resultsByContract = new Map<string, RadiusLookupResult>();
  for (const contract of contracts) {
    const id = contractId(contract);
    const result = results.get(contractLogin(contract));
    if (!id || !result) continue;
    const current = resultsByContract.get(id);
    if (!current || (!current.sessions[0] && result.sessions[0])) resultsByContract.set(id, result);
  }

  return contracts.map((contract) => {
    const login = contractLogin(contract);
    const result = results.get(login) || resultsByContract.get(contractId(contract));
    if (result) return applyAuthoritativeRadiusResult(contract, result);
    return {
      ...contract,
      rad_ip: null,
      rad_framedipv6prefix: null,
      rad_delegatedipv6prefix: null,
      rad_dataconexao: null,
      servico_online: null,
      radius_lookup_status: 'missing_login',
    };
  });
}
