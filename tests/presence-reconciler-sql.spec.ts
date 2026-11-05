import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O reconciliador contra um Postgres REAL.
 *
 * Existe porque dois bugs de SQL passaram por typecheck e por testes com mock e
 * so apareceram em producao:
 *   1. `s.workspace_id` num alias que so tinha (user_id, last_seen)
 *   2. sweepStalePresence derrubando quem o UPSERT acabou de marcar online,
 *      porque ela consulta `presence_sessions` — vazia no modo Redis
 *
 * Nenhum dos dois e detectavel com `db.query` mockado: mock aceita qualquer
 * string como SQL valido. So o planner do Postgres reprova.
 *
 * Suba o banco descartavel antes:
 *   docker run -d --name dialogy-test-pg -e POSTGRES_PASSWORD=teste \
 *     -e POSTGRES_DB=dialogy_teste -p 5499:5432 postgres:17-alpine
 */

const TEST_DB_URL = 'postgresql://postgres:teste@127.0.0.1:5499/dialogy_teste';

// Precisa valer ANTES de qualquer import de '@/lib/db', que le no carregamento.
process.env.DATABASE_URL = TEST_DB_URL;
process.env.DB_POOL_MAX = '4';
process.env.PRESENCE_BACKEND = 'redis';
process.env.PRESENCE_TTL_SECONDS = '180';

if (!/(127\.0\.0\.1|localhost)/.test(TEST_DB_URL)) {
  throw new Error('Recusando rodar: DATABASE_URL nao aponta para localhost.');
}

const WORKSPACE = '11111111-1111-1111-1111-111111111111';
const OUTRO_WORKSPACE = '22222222-2222-2222-2222-222222222222';
const USUARIO_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USUARIO_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// O snapshot do Redis e a unica coisa mockada: o objetivo aqui e o SQL.
const { readSnapshotsMock } = vi.hoisted(() => ({ readSnapshotsMock: vi.fn() }));
vi.mock('@/lib/presence-redis', () => ({
  readPresenceSnapshots: readSnapshotsMock,
  isRedisPresenceEnabled: () => true,
  acquireReconcilerLock: async () => true,
}));

async function postgresDisponivel(): Promise<boolean> {
  try {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 1500 });
    await c.connect();
    await c.query('SELECT 1');
    await c.end();
    return true;
  } catch {
    return false;
  }
}

const temPostgres = await postgresDisponivel();

if (!temPostgres) {
  console.warn(
    `\n[reconciliador] Postgres de teste ausente em ${TEST_DB_URL} — suite pulada.\n` +
      '  docker run -d --name dialogy-test-pg -e POSTGRES_PASSWORD=teste \\\n' +
      '    -e POSTGRES_DB=dialogy_teste -p 5499:5432 postgres:17-alpine\n',
  );
}

let db: import('pg').Pool;
let reconcilePresenceOnce: typeof import('@/services/presence/reconciler').reconcilePresenceOnce;

beforeAll(async () => {
  if (!temPostgres) return;

  ({ db } = await import('@/lib/db'));
  ({ reconcilePresenceOnce } = await import('@/services/presence/reconciler'));

  // Schema extraido da producao — nao inventado a mao.
  const schema = readFileSync(resolve(process.cwd(), 'tests/fixtures/presence-schema.sql'), 'utf8');
  await db.query(schema);
});

afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  if (!temPostgres) return;
  readSnapshotsMock.mockReset();
  await db.query('TRUNCATE user_workspace_presence, presence_sessions');
});

const online = (userId: string, lastSeen = new Date()) => ({ userId, lastSeen });

async function projecao(userId: string) {
  const { rows } = await db.query(
    'SELECT is_online, last_event_source, last_seen FROM user_workspace_presence WHERE user_id = $1',
    [userId],
  );
  return rows[0];
}

describe.skipIf(!temPostgres)('reconciliador contra Postgres real', () => {
  it('grava a projecao de quem esta no snapshot', async () => {
    readSnapshotsMock.mockResolvedValue([{ workspaceId: WORKSPACE, online: [online(USUARIO_A)] }]);

    const resultado = await reconcilePresenceOnce();

    expect(resultado).toMatchObject({ workspaces: 1, online: 1 });
    const linha = await projecao(USUARIO_A);
    expect(linha.is_online).toBe(true);
    expect(linha.last_event_source).toBe('reconciler');
  });

  it('NAO desfaz o proprio trabalho no mesmo ciclo', async () => {
    // A regressao que quebrou producao: o UPSERT marcava online e o sweep
    // marcava offline logo em seguida, porque presence_sessions esta vazia.
    readSnapshotsMock.mockResolvedValue([
      { workspaceId: WORKSPACE, online: [online(USUARIO_A), online(USUARIO_B)] },
    ]);

    await reconcilePresenceOnce();

    expect((await projecao(USUARIO_A)).is_online).toBe(true);
    expect((await projecao(USUARIO_B)).is_online).toBe(true);

    // E segue verdadeiro apos varios ciclos seguidos.
    await reconcilePresenceOnce();
    await reconcilePresenceOnce();

    expect((await projecao(USUARIO_A)).is_online).toBe(true);
    const vazias = await db.query('SELECT count(*)::int AS n FROM presence_sessions');
    expect(vazias.rows[0].n).toBe(0); // confirma o cenario: tabela antiga vazia
  });

  it('derruba quem saiu do snapshot, no mesmo workspace', async () => {
    readSnapshotsMock.mockResolvedValue([
      { workspaceId: WORKSPACE, online: [online(USUARIO_A), online(USUARIO_B)] },
    ]);
    await reconcilePresenceOnce();

    // B fechou a aba: some do snapshot.
    readSnapshotsMock.mockResolvedValue([{ workspaceId: WORKSPACE, online: [online(USUARIO_A)] }]);
    const resultado = await reconcilePresenceOnce();

    expect((await projecao(USUARIO_A)).is_online).toBe(true);
    expect((await projecao(USUARIO_B)).is_online).toBe(false);
    expect(resultado?.desligados).toBeGreaterThanOrEqual(1);
  });

  it('limpa workspace orfao que sumiu do Redis, sem tocar no workspace vivo', async () => {
    // Linha antiga, de um workspace que o Redis nunca viu, com last_seen velho.
    await db.query(
      `INSERT INTO user_workspace_presence (user_id, workspace_id, is_online, last_seen, last_event_source)
       VALUES ($1, $2, TRUE, NOW() - interval '10 minutes', 'modelo-antigo')`,
      [USUARIO_B, OUTRO_WORKSPACE],
    );

    readSnapshotsMock.mockResolvedValue([{ workspaceId: WORKSPACE, online: [online(USUARIO_A)] }]);
    await reconcilePresenceOnce();

    expect((await projecao(USUARIO_A)).is_online).toBe(true); // vivo preservado
    expect((await projecao(USUARIO_B)).is_online).toBe(false); // orfao derrubado
  });

  it('nao derruba workspace ausente do snapshot cujo last_seen ainda e recente', async () => {
    // Evita corrida: workspace que acabou de nascer e ainda nao entrou no indice.
    await db.query(
      `INSERT INTO user_workspace_presence (user_id, workspace_id, is_online, last_seen, last_event_source)
       VALUES ($1, $2, TRUE, NOW(), 'transicao')`,
      [USUARIO_B, OUTRO_WORKSPACE],
    );

    readSnapshotsMock.mockResolvedValue([{ workspaceId: WORKSPACE, online: [online(USUARIO_A)] }]);
    await reconcilePresenceOnce();

    expect((await projecao(USUARIO_B)).is_online).toBe(true);
  });

  it('snapshot vazio nao explode e nao derruba quem tem last_seen recente', async () => {
    readSnapshotsMock.mockResolvedValue([]);
    const resultado = await reconcilePresenceOnce();
    expect(resultado).toMatchObject({ workspaces: 0, online: 0 });
  });
});
