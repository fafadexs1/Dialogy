import 'dotenv/config';

import { Pool } from 'pg';

/**
 * Diagnostico das credenciais do Google Ads. Nunca imprime valores de segredo:
 * apenas presenca, tamanho e o resultado do teste contra a API do Google.
 */

const ENV_KEYS = [
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_API_VERSION',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_SECRET_ENCRYPTION_KEY',
  'META_PAYLOAD_ENCRYPTION_KEY',
  'NEXTAUTH_URL',
] as const;

function describeEnv() {
  console.log('--- .env ---');
  for (const key of ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (!value) {
      console.log(`  ${key}: AUSENTE`);
      continue;
    }
    const shown = key === 'GOOGLE_ADS_API_VERSION' || key === 'NEXTAUTH_URL' ? value : `${value.length} chars`;
    console.log(`  ${key}: presente (${shown})`);
  }
}

async function describeStoredTokens(pool: Pool) {
  console.log('\n--- refresh tokens por workspace (workspace_integrations) ---');
  const result = await pool.query(`
    SELECT w.name AS workspace,
           wi.workspace_id::text AS workspace_id,
           wi.is_active,
           (wi.config ->> 'refreshToken') IS NOT NULL
             AND length(wi.config ->> 'refreshToken') > 0 AS tem_refresh_token,
           length(COALESCE(wi.config ->> 'refreshToken', '')) AS tamanho,
           COALESCE(wi.config ->> 'customerId', '') <> '' AS tem_customer_id
    FROM workspace_integrations wi
    LEFT JOIN workspaces w ON w.id = wi.workspace_id
    WHERE wi.provider = 'gads'
    ORDER BY wi.updated_at DESC
  `);

  if (result.rows.length === 0) {
    console.log('  Nenhum workspace com integracao gads configurada.');
    return [] as Array<{ workspace_id: string; workspace: string }>;
  }

  for (const row of result.rows) {
    console.log(
      `  ${row.workspace || row.workspace_id}: ativo=${row.is_active} ` +
        `refreshToken=${row.tem_refresh_token ? `sim (${row.tamanho} chars)` : 'NAO'} ` +
        `customerId=${row.tem_customer_id ? 'sim' : 'nao'}`
    );
  }

  return result.rows.filter((row) => row.tem_refresh_token);
}

async function testRefreshToken(refreshToken: string, label: string) {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.log(`  ${label}: impossivel testar, client id/secret ausentes.`);
    return null;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok || typeof payload.access_token !== 'string') {
    console.log(`  ${label}: INVALIDO -> ${response.status} ${payload.error || ''} ${payload.error_description || ''}`);
    return null;
  }

  console.log(`  ${label}: VALIDO (access token emitido, expira em ${payload.expires_in}s)`);
  return payload.access_token as string;
}

/**
 * Sem refresh token ainda da para saber se o par client id/secret e reconhecido
 * pelo Google: mandamos um refresh token propositalmente invalido e olhamos qual
 * erro volta. invalid_client acusa o par; invalid_grant acusa so o token.
 */
async function probeClientCredentials() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.log('  par client id/secret: AUSENTE');
    return;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: 'sonda-invalida-de-diagnostico',
      grant_type: 'refresh_token',
    }),
  });

  const payload = await response.json().catch(() => ({} as any));
  const error = String(payload.error || '');

  if (error === 'invalid_client') {
    console.log('  par client id/secret: REJEITADO pelo Google (invalid_client).');
  } else if (error === 'invalid_grant') {
    console.log('  par client id/secret: RECONHECIDO pelo Google (so o refresh token faltava).');
  } else {
    console.log(`  par client id/secret: resposta inesperada ${response.status} -> ${error || JSON.stringify(payload).slice(0, 200)}`);
  }
}

async function testDeveloperToken(accessToken: string) {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!developerToken) {
    console.log('  developer token: AUSENTE, nao da para consultar a API.');
    return;
  }

  const version = process.env.GOOGLE_ADS_API_VERSION?.trim() || 'v24';
  const response = await fetch(
    `https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
      },
    }
  );

  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    console.log(
      `  API Google Ads (${version}): ERRO ${response.status} -> ` +
        String(payload?.error?.message || JSON.stringify(payload)).slice(0, 300)
    );
    return;
  }

  const contas = (payload.resourceNames || []).length;
  console.log(`  API Google Ads (${version}): OK, ${contas} conta(s) acessivel(is).`);
}

/**
 * A listagem de contas usa um endpoint REST simples, mas a descoberta de contas
 * e de acoes de conversao usa GAQL. Se so o GAQL falhar, o sintoma na tela e uma
 * lista vazia sem erro claro — por isso testamos as consultas separadamente.
 */
async function testGaqlQueries(accessToken: string, pool: Pool) {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const version = process.env.GOOGLE_ADS_API_VERSION?.trim() || 'v24';
  if (!developerToken) return;

  const configRes = await pool.query(
    `SELECT config ->> 'customerId' AS customer_id,
            config ->> 'loginCustomerId' AS login_customer_id
       FROM workspace_integrations
      WHERE provider = 'gads' AND config ->> 'customerId' IS NOT NULL
      LIMIT 1`
  );
  const customerId = String(configRes.rows[0]?.customer_id || '').replace(/\D/g, '');
  const loginCustomerId = String(configRes.rows[0]?.login_customer_id || '').replace(/\D/g, '');
  if (!customerId) {
    console.log('  GAQL: nenhum customerId configurado ainda.');
    return;
  }

  console.log(`\n--- consultas GAQL na conta ${customerId} ---`);

  const consultas: Array<[string, string]> = [
    ['contas filhas (customer_client)', 'SELECT customer_client.id, customer_client.descriptive_name FROM customer_client'],
    ['dados da conta (customer)', 'SELECT customer.id, customer.descriptive_name, customer.manager FROM customer'],
    [
      'acoes de conversao',
      'SELECT conversion_action.resource_name, conversion_action.name, conversion_action.status, conversion_action.type FROM conversion_action',
    ],
  ];

  for (const [rotulo, query] of consultas) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    };
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

    const response = await fetch(
      `https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify({ query, pageSize: 50 }) }
    );

    const payload = await response.json().catch(() => ({} as any));
    if (!response.ok) {
      const detalhe = payload?.error?.details?.[0]?.errors?.[0];
      console.log(`  ${rotulo}: ERRO ${response.status}`);
      console.log(`     motivo: ${JSON.stringify(detalhe?.errorCode || payload?.error?.status || 'desconhecido')}`);
      console.log(`     mensagem: ${String(detalhe?.message || payload?.error?.message || '').slice(0, 300)}`);
      continue;
    }

    const linhas = payload.results?.length ?? 0;
    console.log(`  ${rotulo}: OK, ${linhas} resultado(s)`);
    if (rotulo.startsWith('acoes') && linhas > 0) {
      for (const linha of payload.results.slice(0, 10)) {
        const acao = linha.conversionAction || {};
        console.log(`     - ${acao.name} | status=${acao.status} | type=${acao.type}`);
      }
    }
  }
}

async function main() {
  describeEnv();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const stored = await describeStoredTokens(pool);

    console.log('\n--- teste contra o Google ---');

    const envToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
    let accessToken: string | null = null;

    if (envToken) {
      accessToken = await testRefreshToken(envToken, 'refresh token do .env');
    }

    if (!accessToken && stored.length > 0) {
      const { readGoogleAdsSecret } = await import('@/services/google-ads/credentials');
      for (const row of stored) {
        const configRes = await pool.query(
          `SELECT config ->> 'refreshToken' AS token FROM workspace_integrations
            WHERE workspace_id = $1::uuid AND provider = 'gads' LIMIT 1`,
          [row.workspace_id]
        );
        try {
          const plain = readGoogleAdsSecret(configRes.rows[0]?.token);
          accessToken = await testRefreshToken(plain, `workspace ${row.workspace || row.workspace_id}`);
          if (accessToken) break;
        } catch (error) {
          console.log(
            `  workspace ${row.workspace || row.workspace_id}: falha ao decifrar -> ` +
              (error instanceof Error ? error.message : String(error))
          );
        }
      }
    }

    if (!accessToken) {
      console.log('  Nenhum refresh token valido disponivel. Sondando so o cliente OAuth:');
      await probeClientCredentials();
      console.log(
        `\n  Redirect URI que precisa estar autorizada no Google Cloud Console:\n` +
          `    ${process.env.NEXTAUTH_URL}/api/integrations/google-ads/callback`
      );
    }

    if (accessToken) {
      await testDeveloperToken(accessToken);
      await testGaqlQueries(accessToken, pool);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
