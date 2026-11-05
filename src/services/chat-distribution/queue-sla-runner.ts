import 'server-only';

import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import { recordAgentDecisionLedger } from '@/services/autopilot/decision-ledger';
import { studioAutomationKilled } from '../agent-studio/automation';
import { StudioAutomationSchema } from '../agent-studio/types';
import { decideQueueSlaAction, queueSlaConfigFromAutomation, type QueueSlaAction, type QueueSlaConfig } from './queue-sla';

const ADVISORY_LOCK_KEY = 6_178_202_612;
const BATCH = 50;
const INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

type Candidate = {
  chat_id: string; workspace_id: string; queued_at: Date; team_id: string | null; current_team_id: string | null;
  breach_at: Date | null; needed_at: Date | null; notice_agent_id: string | null; team_name: string | null;
  /** The AI agent that handed the chat over, and its current published automation settings. */
  agent_id: string; automation: unknown;
};

/**
 * Chats waiting in a team queue with nobody from the team having answered since, handed over by an agent whose company
 * turned the queue follow-up on in the Studio. A "human" reply is a message with `sender_user_id`: the queue notice
 * itself is sent by a system agent and must not satisfy the SLA.
 */
export async function findQueuedWithoutAnswer(database: Pick<typeof db, 'query'> = db): Promise<Candidate[]> {
  const result = await database.query(
    `WITH q AS (
       SELECT DISTINCT ON (m.chat_id) m.chat_id, m.workspace_id, m.created_at AS queued_at, m.metadata->>'to_team_id' AS team_id,
              m.metadata->>'reason' AS reason, m.metadata->>'agentId' AS agent_id
         FROM messages m
        WHERE m.type = 'system' AND m.metadata->>'event' = 'transfer_queued' AND m.created_at > now() - interval '3 days'
        ORDER BY m.chat_id, m.created_at DESC)
     SELECT q.chat_id, q.workspace_id, q.queued_at, q.team_id, q.agent_id, rel.automation, c.team_id AS current_team_id, t.name AS team_name,
            (SELECT max(x.created_at) FROM messages x WHERE x.chat_id = q.chat_id AND x.workspace_id = q.workspace_id AND x.type = 'system'
                AND x.metadata->>'event' = 'queue_sla_breached' AND x.created_at > q.queued_at) AS breach_at,
            (SELECT max(x.created_at) FROM messages x WHERE x.chat_id = q.chat_id AND x.workspace_id = q.workspace_id AND x.type = 'system'
                AND x.metadata->>'event' = 'queue_sla_escalation_needed' AND x.created_at > q.queued_at) AS needed_at,
            (SELECT x.sender_system_agent_id::text FROM messages x WHERE x.chat_id = q.chat_id AND x.workspace_id = q.workspace_id
                AND x.from_me = TRUE AND x.sender_system_agent_id IS NOT NULL ORDER BY x.created_at DESC LIMIT 1) AS notice_agent_id
       FROM q
       JOIN chats c ON c.id = q.chat_id AND c.workspace_id = q.workspace_id
       JOIN LATERAL (
         SELECT v.snapshot->'agent_release_manifest'->'agentSnapshot'->'concludeStage'->'automation' AS automation
           FROM autopilot_config_versions v
          WHERE v.workspace_id = q.workspace_id AND v.config_id::text = q.agent_id AND v.snapshot ? 'agent_release_manifest'
          ORDER BY v.version_number DESC LIMIT 1) rel ON rel.automation->'queue'->>'enabled' = 'true'
       LEFT JOIN teams t ON t.id::text = q.team_id AND t.workspace_id = q.workspace_id
      WHERE c.status = 'gerais' AND c.agent_id IS NULL AND COALESCE(q.reason, '') <> 'outside_business_hours'
        AND NOT EXISTS (SELECT 1 FROM messages h WHERE h.chat_id = q.chat_id AND h.workspace_id = q.workspace_id
                          AND h.from_me = TRUE AND h.type <> 'system' AND h.sender_user_id IS NOT NULL AND h.created_at > q.queued_at)
      ORDER BY q.queued_at ASC
      LIMIT $1`, [BATCH * 2]);
  return result.rows as Candidate[];
}

export type QueueSlaDeps = {
  now: () => Date;
  sendNotice: (chatId: string, systemAgentId: string, text: string) => Promise<{ success: boolean }>;
  escalate: (candidate: Candidate, escalationTeamId: string, operationId: string) => Promise<{ queued: boolean; teamName?: string }>;
  alert: (payload: Record<string, unknown>, config: QueueSlaConfig) => Promise<void>;
  database?: Pick<typeof db, 'query'>;
};

const NOTICE = 'Ainda estamos buscando um atendente disponível. Seu atendimento continua na fila e você será atendido assim que possível. Obrigado pela paciência!';

async function marker(database: Pick<typeof db, 'query'>, candidate: Candidate, event: string, content: string, extra: Record<string, unknown> = {}) {
  await database.query(
    `INSERT INTO messages (id, workspace_id, chat_id, type, content, metadata, created_at) VALUES ($1, $2, $3, 'system', $4, $5::jsonb, clock_timestamp())`,
    [randomUUID(), candidate.workspace_id, candidate.chat_id, content, JSON.stringify({ event, queuedAt: new Date(candidate.queued_at).toISOString(), ...extra })]);
}

export async function runQueueSlaOnce(deps: QueueSlaDeps) {
  const summary = { examined: 0, breached: 0, escalated: 0, needsAttention: 0, failed: 0 };
  if (studioAutomationKilled()) return summary;
  const database = deps.database || db;
  const now = deps.now();
  for (const candidate of await findQueuedWithoutAnswer(database)) {
    if (summary.breached + summary.escalated + summary.needsAttention >= BATCH) break;
    summary.examined += 1;
    const settings = StudioAutomationSchema.safeParse(candidate.automation ?? {});
    const config = settings.success ? queueSlaConfigFromAutomation(settings.data) : null;
    if (!config) continue;
    const queuedAt = new Date(candidate.queued_at);
    const action: QueueSlaAction = decideQueueSlaAction({ now, queuedAt, config, currentTeamId: candidate.team_id || candidate.current_team_id,
      breachAt: candidate.breach_at ? new Date(candidate.breach_at) : null, neededAt: candidate.needed_at ? new Date(candidate.needed_at) : null });
    if (action === 'wait') continue;
    const minutes = Math.round((now.getTime() - queuedAt.getTime()) / 60_000);
    // No customer text, names or chat content leave the system in an alert: ids, team and minutes only.
    const alertBase = { workspaceId: candidate.workspace_id, agentId: candidate.agent_id, chatId: candidate.chat_id, teamId: candidate.team_id, minutesWaiting: minutes };
    try {
      if (action === 'breach') {
        await marker(database, candidate, 'queue_sla_breached', `Fila sem atendimento há ${minutes} minutos${candidate.team_name ? ` (equipe ${candidate.team_name})` : ''}.`, { minutes });
        if (config.customerNotice && candidate.notice_agent_id) await deps.sendNotice(candidate.chat_id, candidate.notice_agent_id, NOTICE).catch(() => undefined);
        summary.breached += 1;
        await deps.alert({ ...alertBase, event: 'queue_sla_breached' }, config).catch(() => undefined);
      } else if (action === 'escalate' && config.escalationTeamId) {
        const moved = await deps.escalate(candidate, config.escalationTeamId, `sla:${candidate.chat_id}:${queuedAt.toISOString()}`);
        if (!moved.queued) { summary.failed += 1; continue; }
        await marker(database, candidate, 'queue_sla_escalated', `Escalonado para a equipe ${moved.teamName || 'de escalonamento'} após ${minutes} minutos sem atendimento.`, { minutes, toTeamId: config.escalationTeamId });
        summary.escalated += 1;
        await deps.alert({ ...alertBase, event: 'queue_sla_escalated', toTeamId: config.escalationTeamId }, config).catch(() => undefined);
      } else {
        await marker(database, candidate, 'queue_sla_escalation_needed', `Fila sem atendimento há ${minutes} minutos e sem equipe de escalonamento configurada. Precisa de atenção.`, { minutes });
        summary.needsAttention += 1;
        await deps.alert({ ...alertBase, event: 'queue_sla_escalation_needed' }, config).catch(() => undefined);
      }
      await recordAgentDecisionLedger({ workspaceId: candidate.workspace_id, chatId: candidate.chat_id, autopilotConfigId: candidate.agent_id, decisionStage: 'queue_sla',
        decisionType: 'handoff', evidence: [{ source: 'queue_sla', reason: action }], metadata: { source: 'queue_sla', basis: action, minutesWaiting: minutes, teamId: candidate.team_id } });
    } catch (error) {
      summary.failed += 1;
      console.error('[QUEUE_SLA] Falha ao tratar a conversa:', error);
    }
  }
  return summary;
}

async function productionDeps(): Promise<QueueSlaDeps> {
  const [{ sendAutomatedMessageAction }, { queueChatForUnavailableTeam }, { broadcastChatUpdate }, { abortActiveProcedures }] = await Promise.all([
    import('@/actions/messages'), import('./queue-unavailable-team'), import('@/lib/realtime/chat-broadcast'), import('@/services/autopilot/procedure-store'),
  ]);
  return {
    now: () => new Date(),
    sendNotice: async (chatId, systemAgentId, text) => ({ success: (await sendAutomatedMessageAction(chatId, text, systemAgentId, true)).success === true }),
    escalate: async (candidate, teamId, operationId) => queueChatForUnavailableTeam({
      workspaceId: candidate.workspace_id, chatId: candidate.chat_id, teamId, reasonCode: 'all_offline', recordedReason: 'sla_escalation', operationId, agentId: candidate.agent_id,
      afterQueued: async ({ tag, color }) => {
        await broadcastChatUpdate(candidate.workspace_id, candidate.chat_id, { agent_id: null, assigned_system_agent_id: null, is_autopilot_active: false,
          copilot_mode: 'off', status: 'gerais', team_id: teamId, tag, color, assigned_at: null });
        await abortActiveProcedures(candidate.chat_id);
      },
    }),
    alert: async (payload, config) => {
      if (!config.alertWebhookUrl) { console.warn('[QUEUE_SLA]', JSON.stringify(payload)); return; }
      const { validateRemoteUrl } = await import('@/lib/security/safe-remote-url');
      await validateRemoteUrl(config.alertWebhookUrl);
      await fetch(config.alertWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'dialogy.queue_sla', at: new Date().toISOString(), ...payload }), signal: AbortSignal.timeout(5000), redirect: 'error' });
    },
  };
}

export async function runQueueSlaLocked() {
  const client = await db.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [ADVISORY_LOCK_KEY]);
    if (!lock.rows[0]?.acquired) return { skipped: true as const };
    try { return { skipped: false as const, ...await runQueueSlaOnce(await productionDeps()) }; }
    finally { await client.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEY]); }
  } finally { client.release(); }
}

/** Always started: the query only returns chats handed over by agents whose company turned the follow-up on in the Studio. */
export function startQueueSla() {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    void runQueueSlaLocked().then((result) => {
      if (!result.skipped && (result.breached || result.escalated || result.needsAttention || result.failed)) console.log('[QUEUE_SLA]', result);
    }).catch((error) => console.error('[QUEUE_SLA] Ciclo falhou:', error)).finally(() => { running = false; });
  };
  const initial = setTimeout(tick, 50_000); (initial as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  timer = setInterval(tick, INTERVAL_MS); (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
}

export function stopQueueSla() {
  if (timer) clearInterval(timer);
  timer = undefined; running = false;
}
