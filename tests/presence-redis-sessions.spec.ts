import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Testes da maquina de estado da presenca no Redis.
 *
 * Roda contra um Redis REAL, nao um mock: o que precisa ser verificado aqui sao
 * os scripts Lua — poda por TTL, contagem antes/depois e atomicidade — e um
 * mock de ioredis nao executa EVAL de verdade.
 *
 * Suba o Redis descartavel antes:
 *   docker run -d --name dialogy-test-redis -p 6399:6379 redis:7-alpine
 */

const TEST_REDIS_URL = 'redis://127.0.0.1:6399';

// Cinto de seguranca: o vitest.config carrega o .env, que aponta para o Redis
// de producao. Sobrescrevemos antes de qualquer import do modulo e abortamos se
// algo reintroduzir um host remoto.
process.env.REDIS_URL = TEST_REDIS_URL;
process.env.PRESENCE_BACKEND = 'redis';
process.env.PRESENCE_TTL_SECONDS = '2';

if (!/(127\.0\.0\.1|localhost)/.test(process.env.REDIS_URL)) {
  throw new Error('Recusando rodar: REDIS_URL nao aponta para localhost.');
}

type PresenceModule = typeof import('@/lib/presence-redis');

let presenca: PresenceModule;
let cliente: import('ioredis').default;

const WORKSPACE = 'ws-teste';
const USUARIO = 'user-teste';

beforeAll(async () => {
  presenca = await import('@/lib/presence-redis');
  const client = presenca.getPresenceRedis();
  if (!client) throw new Error('Redis de teste indisponivel na porta 6399.');
  cliente = client;
});

afterAll(async () => {
  await cliente?.quit();
});

beforeEach(async () => {
  await cliente.flushdb();
});

const toque = (sessionId: string) =>
  presenca.touchPresenceSession({ workspaceId: WORKSPACE, userId: USUARIO, sessionId });

const solta = (sessionId: string, forceAll = false) =>
  presenca.releasePresenceSession({ workspaceId: WORKSPACE, userId: USUARIO, sessionId, forceAll });

describe('presenca no Redis — transicoes', () => {
  it('a primeira aba marca transicao para online', async () => {
    const resultado = await toque('aba-1');
    expect(resultado).toMatchObject({ sessionsBefore: 0, sessionsAfter: 1, changed: true, isOnline: true });
  });

  it('heartbeat repetido da mesma aba nao repete a transicao', async () => {
    await toque('aba-1');
    const segundo = await toque('aba-1');
    const terceiro = await toque('aba-1');

    expect(segundo?.changed).toBe(false);
    expect(terceiro?.changed).toBe(false);
    // Continua uma sessao so: o ZADD atualiza o score, nao duplica o membro.
    expect(terceiro?.sessionsAfter).toBe(1);
  });

  it('segunda aba do mesmo usuario nao gera transicao', async () => {
    await toque('aba-1');
    const segunda = await toque('aba-2');

    expect(segunda).toMatchObject({ changed: false, isOnline: true, sessionsAfter: 2 });
  });

  it('fechar uma de duas abas mantem o usuario online', async () => {
    await toque('aba-1');
    await toque('aba-2');

    const resultado = await solta('aba-1');
    expect(resultado).toMatchObject({ changed: false, isOnline: true, sessionsAfter: 1 });
  });

  it('fechar a ultima aba marca transicao para offline', async () => {
    await toque('aba-1');
    const resultado = await solta('aba-1');

    expect(resultado).toMatchObject({ sessionsBefore: 1, sessionsAfter: 0, changed: true, isOnline: false });
  });

  it('forceAll derruba todas as abas de uma vez', async () => {
    await toque('aba-1');
    await toque('aba-2');
    await toque('aba-3');

    const resultado = await solta('aba-1', true);
    expect(resultado).toMatchObject({ sessionsAfter: 0, changed: true, isOnline: false });
  });

  it('sessao expirada pelo TTL some, e a proxima aba conta como nova transicao', async () => {
    const primeira = await toque('aba-1');
    expect(primeira?.changed).toBe(true);

    // TTL do teste e 2s.
    await new Promise((resolve) => setTimeout(resolve, 2300));

    const depois = await toque('aba-2');
    expect(depois).toMatchObject({ sessionsBefore: 0, changed: true, isOnline: true });
  });

  it('heartbeats concorrentes reportam a transicao uma unica vez', async () => {
    // A propriedade que importa: sem atomicidade, N abas abrindo juntas
    // gerariam N gravacoes no Postgres e N broadcasts.
    const resultados = await Promise.all(
      Array.from({ length: 12 }, (_, i) => toque(`aba-${i}`)),
    );

    const transicoes = resultados.filter((r) => r?.changed);
    expect(transicoes).toHaveLength(1);
    expect(resultados.every((r) => r?.isOnline)).toBe(true);
  });

  it('o indice de workspaces registra o workspace com presenca', async () => {
    await toque('aba-1');
    const membros = await cliente.smembers('presence:workspaces');
    expect(membros).toContain(WORKSPACE);
  });
});

describe('presenca no Redis — leitura para o reconciliador', () => {
  it('o snapshot lista quem esta online por workspace', async () => {
    await toque('aba-1');
    await presenca.touchPresenceSession({
      workspaceId: WORKSPACE,
      userId: 'outro-usuario',
      sessionId: 'aba-x',
    });

    const snapshots = await presenca.readPresenceSnapshots();
    const alvo = snapshots?.find((s) => s.workspaceId === WORKSPACE);

    expect(alvo?.online.map((o) => o.userId).sort()).toEqual([USUARIO, 'outro-usuario'].sort());
    expect(alvo?.online[0]?.lastSeen).toBeInstanceOf(Date);
  });

  it('quem expirou nao aparece no snapshot', async () => {
    await toque('aba-1');
    await new Promise((resolve) => setTimeout(resolve, 2300));

    const snapshots = await presenca.readPresenceSnapshots();
    const alvo = snapshots?.find((s) => s.workspaceId === WORKSPACE);

    expect(alvo?.online ?? []).toHaveLength(0);
  });

  it('o lock do reconciliador so e concedido a um processo', async () => {
    const tentativas = await Promise.all(
      Array.from({ length: 5 }, () => presenca.acquireReconcilerLock(5_000)),
    );

    expect(tentativas.filter(Boolean)).toHaveLength(1);
  });
});
