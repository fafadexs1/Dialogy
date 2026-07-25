import 'server-only';

import IORedis from 'ioredis';

import { getPresenceTtlSeconds } from '@/lib/presence';

/**
 * Sessões de presença no Redis.
 *
 * O caminho quente da presença é o heartbeat: 2x por minuto por agente
 * conectado, e no Postgres ele custa 9 round-trips numa transação com advisory
 * lock (BEGIN, lock, SELECT FOR UPDATE, DELETE expiradas, SELECT, DELETE todas,
 * INSERT, UPSERT, COMMIT). Com 400 agentes isso dá ~120 round-trips por segundo
 * só para dizer "continuo aqui".
 *
 * Aqui o heartbeat vira uma operação O(1) e o Postgres só é tocado quando o
 * estado realmente muda (primeira aba abre, última aba fecha) — eventos raros.
 * A projeção `user_workspace_presence` continua sendo a fonte para os JOINs de
 * SQL que decidem distribuição de chat e transferência; quem a mantém fresca é
 * o reconciliador, em lote, e não cada agente individualmente.
 *
 * Estrutura:
 *   presence:s:{workspaceId}:{userId}  ZSET  membro=sessionId, score=lastSeenMs
 *   presence:w:{workspaceId}           ZSET  membro=userId,    score=lastSeenMs
 *   presence:workspaces                SET   workspaceIds com presença ativa
 */

declare global {
  // eslint-disable-next-line no-var
  var __dialogyPresenceRedis: IORedis | null | undefined;
}

const sessionsKey = (workspaceId: string, userId: string) =>
  `presence:s:${workspaceId}:${userId}`;
const workspaceKey = (workspaceId: string) => `presence:w:${workspaceId}`;
const WORKSPACES_KEY = 'presence:workspaces';

export function isRedisPresenceEnabled(): boolean {
  return (process.env.PRESENCE_BACKEND ?? 'postgres').trim().toLowerCase() === 'redis';
}

/**
 * Conexão dedicada. Não reaproveita a do BullMQ porque `enableOfflineQueue:
 * false` faria heartbeats falharem durante reconexões, e aqui preferimos que
 * eles enfileirem por alguns instantes.
 */
export function getPresenceRedis(): IORedis | null {
  if (globalThis.__dialogyPresenceRedis === null) return null;

  if (!globalThis.__dialogyPresenceRedis) {
    try {
      const client = new IORedis(process.env.REDIS_URL!.trim(), {
        maxRetriesPerRequest: 2,
        lazyConnect: false,
      });
      client.on('error', (error) => {
        console.error('[PRESENCE_REDIS] Erro de conexão:', error.message);
      });
      globalThis.__dialogyPresenceRedis = client;
    } catch (error) {
      console.error('[PRESENCE_REDIS] Falha ao conectar; presença volta ao Postgres.', error);
      globalThis.__dialogyPresenceRedis = null;
      return null;
    }
  }

  return globalThis.__dialogyPresenceRedis;
}

export type PresenceTransition = {
  /** Sessões vivas antes desta operação. */
  sessionsBefore: number;
  /** Sessões vivas depois. */
  sessionsAfter: number;
  /** O usuário cruzou a fronteira offline<->online agora? */
  changed: boolean;
  isOnline: boolean;
};

function toTransition(before: number, after: number): PresenceTransition {
  const wasOnline = before > 0;
  const isOnline = after > 0;
  return { sessionsBefore: before, sessionsAfter: after, changed: wasOnline !== isOnline, isOnline };
}

// Poda expiradas, registra a sessão e devolve a contagem antes/depois — tudo num
// round-trip, e atomicamente, para que dois heartbeats concorrentes da mesma
// pessoa não relatem transição em duplicidade.
const TOUCH_SCRIPT = `
  local cutoff = tonumber(ARGV[2]) - tonumber(ARGV[3])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
  local before = redis.call('ZCARD', KEYS[1])
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
  redis.call('PEXPIRE', KEYS[1], math.floor(tonumber(ARGV[3]) * 3))
  redis.call('ZADD', KEYS[2], ARGV[2], ARGV[4])
  redis.call('SADD', KEYS[3], ARGV[5])
  return {before, redis.call('ZCARD', KEYS[1])}
`;

const RELEASE_SCRIPT = `
  local cutoff = tonumber(ARGV[2]) - tonumber(ARGV[3])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
  local before = redis.call('ZCARD', KEYS[1])
  if ARGV[4] == '1' then
    redis.call('DEL', KEYS[1])
  else
    redis.call('ZREM', KEYS[1], ARGV[1])
  end
  local after = redis.call('ZCARD', KEYS[1])
  if after == 0 then
    redis.call('ZREM', KEYS[2], ARGV[5])
  end
  return {before, after}
`;

/** Registra atividade de uma aba. Devolve null se o Redis estiver indisponível. */
export async function touchPresenceSession(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}): Promise<PresenceTransition | null> {
  const client = getPresenceRedis();
  if (!client) return null;

  const ttlMs = getPresenceTtlSeconds() * 1000;
  try {
    const [before, after] = (await client.eval(
      TOUCH_SCRIPT,
      3,
      sessionsKey(input.workspaceId, input.userId),
      workspaceKey(input.workspaceId),
      WORKSPACES_KEY,
      input.sessionId,
      String(Date.now()),
      String(ttlMs),
      input.userId,
      input.workspaceId,
    )) as [number, number];

    return toTransition(Number(before), Number(after));
  } catch (error) {
    console.error('[PRESENCE_REDIS] touch falhou:', error);
    return null;
  }
}

/** Encerra uma aba (ou todas, com forceAll). */
export async function releasePresenceSession(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  forceAll?: boolean;
}): Promise<PresenceTransition | null> {
  const client = getPresenceRedis();
  if (!client) return null;

  const ttlMs = getPresenceTtlSeconds() * 1000;
  try {
    const [before, after] = (await client.eval(
      RELEASE_SCRIPT,
      2,
      sessionsKey(input.workspaceId, input.userId),
      workspaceKey(input.workspaceId),
      input.sessionId,
      String(Date.now()),
      String(ttlMs),
      input.forceAll ? '1' : '0',
      input.userId,
    )) as [number, number];

    return toTransition(Number(before), Number(after));
  } catch (error) {
    console.error('[PRESENCE_REDIS] release falhou:', error);
    return null;
  }
}

export type WorkspacePresenceSnapshot = {
  workspaceId: string;
  online: Array<{ userId: string; lastSeen: Date }>;
};

/** Lê, por workspace, quem tem sessão viva. Usado pelo reconciliador. */
export async function readPresenceSnapshots(): Promise<WorkspacePresenceSnapshot[] | null> {
  const client = getPresenceRedis();
  if (!client) return null;

  const ttlMs = getPresenceTtlSeconds() * 1000;
  const cutoff = Date.now() - ttlMs;

  try {
    const workspaceIds = await client.smembers(WORKSPACES_KEY);
    if (workspaceIds.length === 0) return [];

    const snapshots: WorkspacePresenceSnapshot[] = [];
    for (const workspaceId of workspaceIds) {
      const key = workspaceKey(workspaceId);
      await client.zremrangebyscore(key, '-inf', cutoff);
      const flat = await client.zrange(key, 0, -1, 'WITHSCORES');

      const online: Array<{ userId: string; lastSeen: Date }> = [];
      for (let i = 0; i < flat.length; i += 2) {
        online.push({ userId: flat[i], lastSeen: new Date(Number(flat[i + 1])) });
      }

      // Workspace sem ninguém online sai do índice para o SMEMBERS não crescer
      // indefinidamente, mas continua no snapshot para o reconciliador poder
      // derrubar quem ficou marcado como online no Postgres.
      if (online.length === 0) {
        await client.srem(WORKSPACES_KEY, workspaceId);
      }

      snapshots.push({ workspaceId, online });
    }

    return snapshots;
  } catch (error) {
    console.error('[PRESENCE_REDIS] leitura do snapshot falhou:', error);
    return null;
  }
}

/**
 * Lock cooperativo para que apenas uma réplica execute o reconciliador por
 * ciclo. Sem isto, N réplicas fariam o mesmo UPDATE em lote simultaneamente.
 */
export async function acquireReconcilerLock(ttlMs: number): Promise<boolean> {
  const client = getPresenceRedis();
  if (!client) return false;

  try {
    const result = await client.set('presence:reconciler:lock', String(process.pid), 'PX', ttlMs, 'NX');
    return result === 'OK';
  } catch (error) {
    console.error('[PRESENCE_REDIS] lock do reconciliador falhou:', error);
    return false;
  }
}
