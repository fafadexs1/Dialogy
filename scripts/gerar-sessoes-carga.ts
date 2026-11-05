/**
 * Gera sessoes validas para o teste de carga.
 *
 * Assina JWTs com o SUPABASE_JWT_SECRET do proprio ambiente e monta o cookie de
 * sessao no formato que getSupabaseAccessTokenFromCookies espera. Nao cria
 * usuario nem escreve nada: reaproveita ids que ja existem no workspace.
 *
 * Uso:
 *   npx tsx scripts/gerar-sessoes-carga.ts --workspace <uuid> --agentes 400 > sessoes.json
 *
 * IMPORTANTE: os tokens gerados sao credenciais reais e de curta duracao.
 * sessoes.json fica no .gitignore-equivalente por convencao — nao versione.
 */

import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { Pool } from 'pg';

const TTL_SEGUNDOS = 2 * 60 * 60;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function assinarJwt(payload: Record<string, unknown>, segredo: string): string {
  const cabecalho = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = base64url(JSON.stringify(payload));
  const assinatura = createHmac('sha256', segredo).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

function nomeCookie(supabaseUrl: string): string {
  // O Supabase nomeia o cookie a partir do "ref" do projeto. Em self-hosted o
  // host nao tem ref, entao usamos o primeiro rotulo do dominio — o servidor
  // procura por qualquer cookie cujo nome contenha 'auth-token'.
  const host = new URL(supabaseUrl).hostname;
  return `sb-${host.split('.')[0]}-auth-token`;
}

function arg(nome: string, padrao?: string): string {
  const i = process.argv.indexOf(`--${nome}`);
  const valor = i >= 0 ? process.argv[i + 1] : undefined;
  if (!valor && padrao === undefined) throw new Error(`Faltou --${nome}`);
  return valor ?? padrao!;
}

async function main() {
  const segredo = process.env.SUPABASE_JWT_SECRET;
  if (!segredo) throw new Error('SUPABASE_JWT_SECRET ausente no ambiente.');

  const workspaceId = arg('workspace');
  const desejados = Number.parseInt(arg('agentes', '50'), 10);

  const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const { rows } = await db.query(
    `SELECT u.id::text AS id, u.email
     FROM users u
     JOIN user_workspace_roles uwr ON uwr.user_id = u.id
     WHERE uwr.workspace_id = $1
     ORDER BY u.id
     LIMIT $2`,
    [workspaceId, desejados],
  );
  await db.end();

  if (rows.length === 0) {
    throw new Error(`Nenhum usuario encontrado no workspace ${workspaceId}.`);
  }

  const agora = Math.floor(Date.now() / 1000);
  const cookie = nomeCookie(process.env.NEXT_PUBLIC_SUPABASE_URL!);

  // Menos usuarios reais que agentes desejados: cada um recebe varias "abas",
  // que e justamente o cenario multi-sessao que a presenca precisa aguentar.
  const sessoes = Array.from({ length: desejados }, (_, i) => {
    const usuario = rows[i % rows.length];
    const accessToken = assinarJwt(
      {
        sub: usuario.id,
        email: usuario.email,
        role: 'authenticated',
        aud: 'authenticated',
        iat: agora,
        exp: agora + TTL_SEGUNDOS,
      },
      segredo,
    );

    const valor = `base64-${base64url(JSON.stringify({ access_token: accessToken, token_type: 'bearer', expires_in: TTL_SEGUNDOS }))}`;

    return {
      userId: usuario.id,
      tabId: `carga-${i}`,
      cookieName: cookie,
      cookieValue: valor,
    };
  });

  process.stdout.write(
    JSON.stringify({ workspaceId, usuariosReais: rows.length, sessoes }, null, 2),
  );
  process.stderr.write(
    `\n${sessoes.length} sessao(oes) para ${rows.length} usuario(s) reais, validas por ${TTL_SEGUNDOS / 3600}h\n`,
  );
}

main().catch((error) => {
  console.error('Falhou:', error instanceof Error ? error.message : error);
  process.exit(1);
});
