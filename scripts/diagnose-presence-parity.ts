/**
 * Compara a presenca no Redis com a projecao em user_workspace_presence.
 *
 * Serve para dois momentos:
 *   - antes de virar PRESENCE_BACKEND=redis, como linha de base
 *   - depois de virar, para confirmar que a projecao continua batendo com quem
 *     esta de fato conectado
 *
 * O predicado do Postgres aqui e o MESMO que a distribuicao de chats e as rotas
 * de transferencia usam (is_online = TRUE AND last_seen > NOW() - ttl). Uma
 * divergencia nesta sonda significa, na pratica, chat sendo roteado para quem
 * nao esta na tela — ou deixando de ser roteado para quem esta.
 *
 * Somente leitura. Uso:  npm run diagnose:presence
 */

import 'dotenv/config';
import IORedis from 'ioredis';
import { Pool } from 'pg';

const TTL_SECONDS = Number.parseInt(process.env.PRESENCE_TTL_SECONDS ?? '', 10) || 180;
const RECENT_SECONDS = Number.parseInt(process.env.PRESENCE_RECENT_ACTIVITY_SECONDS ?? '', 10) || 90;

type Divergencia = {
  workspace: string;
  usuario: string;
  problema: string;
};

async function main() {
  const backend = (process.env.PRESENCE_BACKEND ?? 'postgres').toLowerCase();
  console.log(`\nPRESENCE_BACKEND = ${backend}   TTL = ${TTL_SECONDS}s\n`);

  const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const redis = new IORedis(process.env.REDIS_URL!.trim(), { maxRetriesPerRequest: 2 });

  try {
    // --- lado Redis ---
    const workspaceIds = await redis.smembers('presence:workspaces');
    const cutoff = Date.now() - TTL_SECONDS * 1000;
    const noRedis = new Map<string, Set<string>>();

    for (const workspaceId of workspaceIds) {
      const flat = await redis.zrangebyscore(`presence:w:${workspaceId}`, cutoff, '+inf');
      noRedis.set(workspaceId, new Set(flat));
    }

    // --- lado Postgres, com o predicado que os consumidores usam ---
    const projecao = await db.query(
      `
        SELECT workspace_id::text AS workspace_id, user_id::text AS user_id
        FROM user_workspace_presence uwp
        WHERE (
          (uwp.is_online = TRUE AND uwp.last_seen > NOW() - ($1 * interval '1 second'))
          OR (uwp.recent_activity_at IS NOT NULL
              AND uwp.recent_activity_at > NOW() - ($2 * interval '1 second'))
        )
      `,
      [TTL_SECONDS, RECENT_SECONDS],
    );

    const noPostgres = new Map<string, Set<string>>();
    for (const linha of projecao.rows) {
      if (!noPostgres.has(linha.workspace_id)) noPostgres.set(linha.workspace_id, new Set());
      noPostgres.get(linha.workspace_id)!.add(linha.user_id);
    }

    // --- comparacao ---
    // So faz sentido cobrar paridade quando o Redis e a fonte da verdade. Com
    // backend=postgres o lado Redis esta vazio por construcao, e apontar isso
    // como divergencia seria alarme falso.
    const compararLados = backend === 'redis';

    const resumo: Array<Record<string, unknown>> = [];
    const divergencias: Divergencia[] = [];
    const todos = new Set([...noRedis.keys(), ...noPostgres.keys()]);

    for (const workspaceId of todos) {
      const r = noRedis.get(workspaceId) ?? new Set<string>();
      const p = noPostgres.get(workspaceId) ?? new Set<string>();

      const soNoRedis = [...r].filter((u) => !p.has(u));
      const soNoPostgres = [...p].filter((u) => !r.has(u));

      resumo.push({
        workspace: workspaceId.slice(0, 8),
        redis: r.size,
        postgres: p.size,
        ...(compararLados
          ? {
              so_no_redis: soNoRedis.length,
              so_no_postgres: soNoPostgres.length,
              status: soNoRedis.length + soNoPostgres.length === 0 ? 'OK' : 'DIVERGE',
            }
          : { status: 'linha de base' }),
      });

      if (!compararLados) continue;

      soNoRedis.forEach((u) =>
        divergencias.push({
          workspace: workspaceId.slice(0, 8),
          usuario: u.slice(0, 8),
          problema: 'conectado, mas invisivel para a distribuicao de chats',
        }),
      );
      soNoPostgres.forEach((u) =>
        divergencias.push({
          workspace: workspaceId.slice(0, 8),
          usuario: u.slice(0, 8),
          problema: 'desconectado, mas ainda recebendo chats',
        }),
      );
    }

    if (resumo.length === 0) {
      console.log('Nenhuma presenca ativa dos dois lados.');
    } else {
      console.table(resumo);
    }

    if (!compararLados) {
      console.log(
        '\nLinha de base: com PRESENCE_BACKEND=postgres o lado Redis fica vazio\n' +
          'por definicao, entao nao ha paridade a cobrar. Rode de novo depois de\n' +
          'virar a flag para que a comparacao passe a valer.',
      );
    } else if (divergencias.length > 0) {
      console.log('\nDIVERGENCIAS:');
      console.table(divergencias);
      console.log(
        '\nAte ~15s de defasagem e esperado (ciclo do reconciliador).\n' +
          'Divergencia que persiste entre duas execucoes e problema real.',
      );
      process.exitCode = 1;
    } else {
      console.log('\nParidade completa.');
    }
  } finally {
    await redis.quit();
    await db.end();
  }
}

main().catch((error) => {
  console.error('Falhou:', error instanceof Error ? error.message : error);
  process.exit(1);
});
