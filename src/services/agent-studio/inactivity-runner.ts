import 'server-only';

import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import { recordAgentDecisionLedger } from '@/services/autopilot/decision-ledger';
import { studioAutomationKilled } from './automation';
import { decideInactivityAction, inactivityConfigFromAutomation, type InactivityAction } from './inactivity';
import { StudioAutomationSchema } from './types';

const ADVISORY_LOCK_KEY = 6_178_202_611;
const BATCH = 25;
const INTERVAL_MS = 120_000;
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

type Candidate = {
  chat_id: string; workspace_id: string; system_agent_id: string; system_agent_name: string | null; agent_id: string; session_id: string;
  last_ai_at: Date; last_customer_at: Date | null; followup_at: Date | null;
  /** The automation settings of the release this chat's session is pinned to, exactly as the company published them. */
  automation: unknown; time_zone: string | null;
};

/**
 * Open chats owned by an AI agent whose last word was the AI's, in a session that is waiting for the customer or
 * already resolved, and whose agent turned the watchdog on in the Studio. Human-owned, closed and flow-owned chats
 * never match, and neither does any agent that did not opt in: each company decides for its own agents.
 */
export async function findInactivityCandidates(database: Pick<typeof db, 'query'> = db): Promise<Candidate[]> {
  const result = await database.query(
    `WITH latest AS (
       SELECT DISTINCT ON (s.chat_id) s.chat_id, s.id AS session_id, s.agent_id, s.release_id, s.status
         FROM agent_studio_sessions s ORDER BY s.chat_id, s.updated_at DESC)
     SELECT c.id AS chat_id, c.workspace_id, c.assigned_system_agent_id AS system_agent_id, sa.name AS system_agent_name,
            l.agent_id, l.session_id, rel.automation, rel.time_zone,
            (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id AND m.from_me = TRUE AND m.type <> 'system') AS last_ai_at,
            (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id AND m.from_me = FALSE AND m.type <> 'system') AS last_customer_at,
            (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id AND m.type = 'system'
               AND m.metadata->>'event' = 'studio_inactivity_followup'
               AND m.created_at > COALESCE((SELECT max(x.created_at) FROM messages x WHERE x.chat_id = c.id AND x.workspace_id = c.workspace_id
                                             AND x.from_me = FALSE AND x.type <> 'system'), 'epoch'::timestamptz)) AS followup_at
       FROM chats c
       JOIN latest l ON l.chat_id = c.id
       JOIN LATERAL (
         SELECT v.snapshot->'agent_release_manifest'->'agentSnapshot'->'concludeStage'->'automation' AS automation,
                v.snapshot->'agent_release_manifest'->'agentSnapshot'->'rules'->>'timeZone' AS time_zone
           FROM autopilot_config_versions v
          WHERE v.config_id = l.agent_id AND v.workspace_id = c.workspace_id
            AND v.snapshot->'agent_release_manifest'->>'releaseId' = l.release_id::text
          LIMIT 1) rel ON rel.automation->'inactivity'->>'enabled' = 'true'
       LEFT JOIN system_agents sa ON sa.id = c.assigned_system_agent_id AND sa.workspace_id = c.workspace_id
      WHERE c.status <> 'encerrados' AND c.agent_id IS NULL AND c.assigned_system_agent_id IS NOT NULL AND c.is_autopilot_active = TRUE
        AND l.status IN ('waiting_input', 'resolved')
      ORDER BY c.updated_at ASC
      LIMIT $1`,
    [BATCH * 4]);
  return result.rows as Candidate[];
}

export type InactivityDeps = {
  now: () => Date;
  sendMessage: (chatId: string, systemAgentId: string, text: string) => Promise<{ success: boolean }>;
  closeChat: (candidate: Candidate, notes: string) => Promise<{ success: boolean }>;
  database?: Pick<typeof db, 'query'>;
};

export async function runInactivityWatchdogOnce(deps: InactivityDeps) {
  const summary = { examined: 0, followups: 0, closed: 0, failed: 0 };
  if (studioAutomationKilled()) return summary;
  const database = deps.database || db;
  const now = deps.now();
  for (const candidate of await findInactivityCandidates(database)) {
    if (summary.followups + summary.closed >= BATCH) break;
    summary.examined += 1;
    const settings = StudioAutomationSchema.safeParse(candidate.automation ?? {});
    const config = settings.success ? inactivityConfigFromAutomation(settings.data, candidate.time_zone) : null;
    if (!config) continue;
    const action: InactivityAction = decideInactivityAction({ now, config,
      lastAiAt: new Date(candidate.last_ai_at), lastCustomerAt: candidate.last_customer_at ? new Date(candidate.last_customer_at) : null,
      followupAt: candidate.followup_at ? new Date(candidate.followup_at) : null });
    if (action === 'wait') continue;
    try {
      if (action === 'followup') {
        const sent = await deps.sendMessage(candidate.chat_id, candidate.system_agent_id, config.followupText);
        if (!sent.success) { summary.failed += 1; continue; }
        // Written right after the delivery: it is what makes the next stage (close) and the "only once" rule work.
        await database.query(
          `INSERT INTO messages (id, workspace_id, chat_id, type, content, metadata, created_at)
           VALUES ($1, $2, $3, 'system', 'Aviso de inatividade enviado ao cliente.', $4::jsonb, clock_timestamp())`,
          [randomUUID(), candidate.workspace_id, candidate.chat_id, JSON.stringify({ event: 'studio_inactivity_followup', sessionId: candidate.session_id })]);
        summary.followups += 1;
        await recordAgentDecisionLedger({ workspaceId: candidate.workspace_id, chatId: candidate.chat_id, systemAgentId: candidate.system_agent_id,
          autopilotConfigId: candidate.agent_id, decisionStage: 'studio_inactivity', decisionType: 'answer',
          evidence: [{ source: 'inactivity_watchdog', reason: 'inactivity_followup' }], metadata: { source: 'studio', basis: 'inactivity_followup', studioSessionId: candidate.session_id } });
      } else {
        // The customer is told why the chat ends. If that message cannot be delivered, the chat stays open.
        if (action === 'close') {
          const sent = await deps.sendMessage(candidate.chat_id, candidate.system_agent_id, config.closeText);
          if (!sent.success) { summary.failed += 1; continue; }
        }
        const closed = await deps.closeChat(candidate, 'Encerrado por inatividade do cliente após aviso.');
        if (!closed.success) { summary.failed += 1; continue; }
        summary.closed += 1;
        await recordAgentDecisionLedger({ workspaceId: candidate.workspace_id, chatId: candidate.chat_id, systemAgentId: candidate.system_agent_id,
          autopilotConfigId: candidate.agent_id, decisionStage: 'studio_inactivity', decisionType: 'close',
          evidence: [{ source: 'inactivity_watchdog', reason: action === 'close' ? 'inatividade_pos_followup' : 'inatividade_fora_da_janela' }],
          metadata: { source: 'studio', basis: action === 'close' ? 'inatividade_pos_followup' : 'inatividade_fora_da_janela', chatClosed: true, studioSessionId: candidate.session_id } });
      }
    } catch (error) {
      summary.failed += 1;
      console.error('[STUDIO_INACTIVITY] Falha ao tratar a conversa:', error);
    }
  }
  return summary;
}

async function productionDeps(): Promise<InactivityDeps> {
  const [{ sendAutomatedMessageAction }, { closeChatAction }, { createTrustedActorContext }] = await Promise.all([
    import('@/actions/messages'), import('@/actions/chats'), import('@/lib/security/trusted-server-context'),
  ]);
  return {
    now: () => new Date(),
    sendMessage: async (chatId, systemAgentId, text) => {
      const result = await sendAutomatedMessageAction(chatId, text, systemAgentId, true);
      return { success: result.success === true };
    },
    closeChat: async (candidate, notes) => {
      const actor = createTrustedActorContext({ user: { id: candidate.system_agent_id, name: candidate.system_agent_name || 'Atendente Inteligente' }, isSystemAgent: true });
      return closeChatAction(candidate.chat_id, null, notes, false, { event: 'studio_inactivity_close', studioSessionId: candidate.session_id }, actor);
    },
  };
}

export async function runStudioInactivityWatchdogLocked() {
  const client = await db.connect();
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [ADVISORY_LOCK_KEY]);
    if (!lock.rows[0]?.acquired) return { skipped: true as const };
    try { return { skipped: false as const, ...await runInactivityWatchdogOnce(await productionDeps()) }; }
    finally { await client.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEY]); }
  } finally { client.release(); }
}

/** Always started: the query only returns chats of agents whose company turned the watchdog on in the Studio. */
export function startStudioInactivityWatchdog() {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    void runStudioInactivityWatchdogLocked().then((result) => {
      if (!result.skipped && (result.followups || result.closed || result.failed)) console.log('[STUDIO_INACTIVITY]', result);
    }).catch((error) => console.error('[STUDIO_INACTIVITY] Ciclo falhou:', error)).finally(() => { running = false; });
  };
  const initial = setTimeout(tick, 45_000); (initial as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  timer = setInterval(tick, INTERVAL_MS); (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
}

export function stopStudioInactivityWatchdog() {
  if (timer) clearInterval(timer);
  timer = undefined; running = false;
}
