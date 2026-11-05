import 'server-only';

import { db } from '@/lib/db';
import { pruneProcessedEvolutionWebhookEvents } from '@/services/whatsapp/evolution-webhook-inbox';

/**
 * Poda periodica da caixa de entrada durável de webhooks da Evolution.
 *
 * A tabela é uma fila de trabalho e nunca teve retenção: chegou a 482 mil linhas
 * (779 MB) com todas já processadas. Sem poda ela só cresce, encarecendo
 * autovacuum, backup e as próprias varreduras da fila.
 *
 * Roda no worker (não no processo web) porque é manutenção de background e o
 * worker é o único processo de instância única previsível.
 */

const DEFAULT_INTERVAL_MS = 60 * 60_000;
const DEFAULT_RETENTION_DAYS = 7;
// Chave arbitrária e fixa: só precisa não colidir com outros advisory locks.
const RETENTION_ADVISORY_LOCK_KEY = 4_820_110_593;

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRetentionEnabled(): boolean {
  return (process.env.EVOLUTION_WEBHOOK_RETENTION_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

/**
 * Executa uma passagem. Exportada para permitir disparo manual (script/CLI) sem
 * subir o agendador.
 */
export async function runEvolutionWebhookRetentionOnce(): Promise<
  { deleted: number; batches: number; reachedLimit: boolean; skipped: false }
  | { skipped: true }
> {
  const client = await db.connect();
  try {
    // Sem espera: se outra réplica já está podando, esta passagem não faz falta.
    const lock = await client.query(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [RETENTION_ADVISORY_LOCK_KEY],
    );

    if (!lock.rows[0]?.acquired) {
      return { skipped: true };
    }

    try {
      const result = await pruneProcessedEvolutionWebhookEvents({
        retentionDays: readPositiveInt(
          process.env.EVOLUTION_WEBHOOK_RETENTION_DAYS,
          DEFAULT_RETENTION_DAYS,
        ),
        batchSize: readPositiveInt(process.env.EVOLUTION_WEBHOOK_RETENTION_BATCH_SIZE, 5_000),
        maxBatches: readPositiveInt(process.env.EVOLUTION_WEBHOOK_RETENTION_MAX_BATCHES, 20),
      });
      return { ...result, skipped: false };
    } finally {
      await client.query(
        'SELECT pg_advisory_unlock($1::bigint)',
        [RETENTION_ADVISORY_LOCK_KEY],
      );
    }
  } finally {
    client.release();
  }
}

export function startEvolutionWebhookRetention(): void {
  if (!isRetentionEnabled()) {
    console.log('[WEBHOOK_RETENTION] Desabilitada por EVOLUTION_WEBHOOK_RETENTION_ENABLED=false.');
    return;
  }

  if (timer) return;

  const intervalMs = readPositiveInt(
    process.env.EVOLUTION_WEBHOOK_RETENTION_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
  );
  const retentionDays = readPositiveInt(
    process.env.EVOLUTION_WEBHOOK_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
  );

  console.log(
    `[WEBHOOK_RETENTION] Iniciada (ciclo de ${Math.round(intervalMs / 60_000)}min, retencao de ${retentionDays} dia(s)).`,
  );

  const tick = () => {
    void (async () => {
      if (running) return;
      running = true;
      try {
        const result = await runEvolutionWebhookRetentionOnce();
        if (!result.skipped && result.deleted > 0) {
          console.log(
            `[WEBHOOK_RETENTION] ${result.deleted} evento(s) removido(s) em ${result.batches} lote(s).`
            + `${result.reachedLimit ? ' Backlog restante sera tratado no proximo ciclo.' : ''}`,
          );
        }
      } catch (error) {
        console.error('[WEBHOOK_RETENTION] Ciclo falhou:', error);
      } finally {
        running = false;
      }
    })();
  };

  // Primeira passagem logo após o boot: é ela que drena o backlog acumulado.
  const initialTimer = setTimeout(tick, 30_000);
  (initialTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();

  timer = setInterval(tick, intervalMs);
  (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
}

export function stopEvolutionWebhookRetention(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
