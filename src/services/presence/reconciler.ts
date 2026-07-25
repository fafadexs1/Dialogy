import 'server-only';

import { db } from '@/lib/db';
import { getPresenceTtlSeconds } from '@/lib/presence';
import { sweepStalePresence } from '@/lib/presence-server';
import {
  acquireReconcilerLock,
  isRedisPresenceEnabled,
  readPresenceSnapshots,
} from '@/lib/presence-redis';

/**
 * Mantém `user_workspace_presence` alinhada com o Redis.
 *
 * Existe porque a projeção no Postgres não é opcional: sete consultas em SQL
 * dependem dela, e duas delas decidem roteamento — a distribuição justa de
 * chats (services/chat-distribution/fair-distribution.ts) e as rotas de
 * transferência. Todas filtram por
 *   `is_online = TRUE AND last_seen > NOW() - ttl`
 * então deixar `last_seen` envelhecer além do TTL faria todos os agentes
 * sumirem da distribuição.
 *
 * O que muda em relação ao modelo anterior não é *se* o Postgres é escrito, e
 * sim quantas vezes: antes era uma transação de 9 round-trips por agente a cada
 * 30s; agora é um UPSERT em lote por ciclo, cobrindo todos os agentes de uma
 * vez. Com 400 conectados, sai de ~800 transações/minuto para 4.
 *
 * Transições (primeira aba abre, última fecha) continuam sendo gravadas na hora
 * pelo caminho de escrita, para a distribuição reagir sem esperar o ciclo.
 */

const INTERVALO_MS = 15_000;
// Maior que o intervalo para o lock sobreviver a um ciclo lento, menor que dois
// ciclos para não travar a fila se um processo morrer no meio.
const LOCK_TTL_MS = 25_000;

let timer: ReturnType<typeof setInterval> | undefined;
let executando = false;

export async function reconcilePresenceOnce(): Promise<{
  workspaces: number;
  online: number;
  desligados: number;
} | null> {
  const snapshots = await readPresenceSnapshots();
  if (!snapshots) return null;

  let online = 0;
  let desligados = 0;

  for (const snapshot of snapshots) {
    const userIds = snapshot.online.map((entry) => entry.userId);

    if (userIds.length > 0) {
      await db.query(
        `
          INSERT INTO user_workspace_presence (
            user_id, workspace_id, is_online, online_since, last_seen,
            last_event_at, last_event_source, metadata
          )
          SELECT s.user_id, s.workspace_id, TRUE, s.last_seen, s.last_seen,
                 NOW(), 'reconciler', '{}'::jsonb
          FROM unnest($1::uuid[], $2::timestamptz[]) AS s(user_id, last_seen)
          CROSS JOIN (SELECT $3::uuid AS workspace_id) w
          ON CONFLICT (user_id, workspace_id) DO UPDATE SET
            is_online = TRUE,
            online_since = COALESCE(user_workspace_presence.online_since, EXCLUDED.online_since),
            last_seen = GREATEST(
              COALESCE(user_workspace_presence.last_seen, EXCLUDED.last_seen),
              EXCLUDED.last_seen
            ),
            last_event_at = NOW(),
            last_event_source = 'reconciler'
        `,
        [userIds, snapshot.online.map((entry) => entry.lastSeen), snapshot.workspaceId],
      );
      online += userIds.length;
    }

    // Quem o Postgres ainda considera online mas sumiu do Redis (aba fechada
    // sem beacon, queda de rede) cai aqui.
    const derrubados = await db.query(
      `
        UPDATE user_workspace_presence
        SET is_online = FALSE,
            online_since = NULL,
            last_event_at = NOW(),
            last_event_source = 'reconciler'
        WHERE workspace_id = $1
          AND is_online = TRUE
          AND NOT (user_id = ANY($2::uuid[]))
      `,
      [snapshot.workspaceId, userIds],
    );
    desligados += derrubados.rowCount ?? 0;
  }

  // Rede de segurança para workspaces que o Redis nunca viu — inclui linhas
  // deixadas para trás pelo modelo antigo, na virada da flag.
  await sweepStalePresence();

  return { workspaces: snapshots.length, online, desligados };
}

export function startPresenceReconciler(): void {
  if (!isRedisPresenceEnabled()) {
    console.log('[PRESENCE_RECONCILER] PRESENCE_BACKEND != redis; reconciliador nao iniciado.');
    return;
  }

  if (timer) return;

  console.log(`[PRESENCE_RECONCILER] iniciado (ciclo de ${INTERVALO_MS / 1000}s, TTL ${getPresenceTtlSeconds()}s)`);

  timer = setInterval(() => {
    void (async () => {
      if (executando) return;
      executando = true;
      try {
        // Só uma réplica trabalha por ciclo.
        if (!(await acquireReconcilerLock(LOCK_TTL_MS))) return;

        const resultado = await reconcilePresenceOnce();
        if (resultado && (resultado.online > 0 || resultado.desligados > 0)) {
          console.log(
            `[PRESENCE_RECONCILER] ${resultado.workspaces} workspace(s), ${resultado.online} online, ${resultado.desligados} desligado(s)`,
          );
        }
      } catch (error) {
        console.error('[PRESENCE_RECONCILER] ciclo falhou:', error);
      } finally {
        executando = false;
      }
    })();
  }, INTERVALO_MS);

  // Nao segura o processo aberto no shutdown.
  (timer as { unref?: () => void }).unref?.();
}

export function stopPresenceReconciler(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
