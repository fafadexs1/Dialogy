import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import type { TeamAvailabilityReason } from './team-availability';

export { isQueueableTeamReason } from './queueable-reasons';

/** Same wording as the Autopilot tool path (agent-tools/runtime.ts), so the customer hears one voice. */
export function buildQueueNotice(reason: TeamAvailabilityReason, teamName: string, businessHoursText?: string | null): string {
  if (reason === 'outside_business_hours') {
    const hours = businessHoursText ? ` (${businessHoursText})` : '';
    return `Agradeço o seu contato! No momento, a equipe ${teamName} está fora do expediente${hours}. Seu atendimento foi colocado na fila para a equipe acompanhar quando estiver disponível.`;
  }
  return `Agradeço o seu contato! No momento, todos os atendentes do setor ${teamName} estão ocupados. Seu atendimento já está na fila de espera e assim que um atendente ficar disponível você será atendido!`;
}

export type QueueUnavailableTeamResult = {
  queued: boolean;
  /** The same operation already queued this chat; nothing was repeated, including the customer notice. */
  alreadyQueued?: boolean;
  /** Why nothing was queued: the chat is closed or gone, or the team does not belong to the workspace. */
  skipped?: 'chat_closed_or_missing' | 'team_not_found';
  teamName?: string;
  notificationDelivered?: boolean | null;
};

type Queryable = Pick<typeof db, 'query'>;

export async function queueChatForUnavailableTeam(input: {
  workspaceId: string;
  chatId: string;
  teamId: string;
  reasonCode: TeamAvailabilityReason;
  /** Stable per handoff attempt; replays return `alreadyQueued` instead of notifying twice. */
  operationId: string;
  /** Customer-facing notice. Omit to queue silently (the flow sends its own message). */
  sendNotice?: (text: string) => Promise<{ success?: boolean } | void>;
  database?: Queryable;
  /** Best-effort side effects, injectable so the SQL core stays unit-testable. */
  afterQueued?: (info: { teamId: string; tag: string; color: string }) => Promise<void>;
  describeBusinessHours?: (teamId: string) => Promise<string | null>;
}): Promise<QueueUnavailableTeamResult> {
  const database = input.database || db;

  const previous = await database.query(
    `SELECT 1 FROM messages WHERE chat_id = $1 AND workspace_id = $2 AND type = 'system'
       AND metadata->>'event' = 'transfer_queued' AND metadata->>'operationId' = $3 LIMIT 1`,
    [input.chatId, input.workspaceId, input.operationId],
  );
  if ((previous.rowCount ?? previous.rows.length) > 0) return { queued: true, alreadyQueued: true };

  const team = await database.query(
    `SELECT t.name, COALESCE(tg.label, t.name) AS tag, COALESCE(tg.color, t.color, '#cccccc') AS color
       FROM teams t LEFT JOIN tags tg ON tg.id = t.tag_id AND tg.workspace_id = t.workspace_id
      WHERE t.id = $1 AND t.workspace_id = $2`,
    [input.teamId, input.workspaceId],
  );
  const teamRow = team.rows[0];
  if (!teamRow) return { queued: false, skipped: 'team_not_found' };
  const teamName = String(teamRow.name || 'Atendimento');

  // One statement: the chat only moves to the queue together with its audit message.
  const queued = await database.query(
    `WITH moved AS (
       UPDATE chats
          SET agent_id = NULL, assigned_system_agent_id = NULL, is_autopilot_active = FALSE, copilot_mode = 'off',
              status = 'gerais', team_id = $3, tag = $4, color = $5, assigned_at = NULL, updated_at = clock_timestamp()
        WHERE id = $1 AND workspace_id = $2 AND status <> 'encerrados'
        RETURNING id)
     INSERT INTO messages (id, workspace_id, chat_id, type, content, metadata, created_at)
     SELECT $6, $2, moved.id, 'system', $7, $8::jsonb, clock_timestamp() FROM moved RETURNING chat_id`,
    [input.chatId, input.workspaceId, input.teamId, teamRow.tag, teamRow.color, randomUUID(),
      `Atendimento encaminhado para a fila de ${teamName}.`,
      JSON.stringify({ event: 'transfer_queued', to_team_id: input.teamId, reason: input.reasonCode, operationId: input.operationId })],
  );
  if ((queued.rowCount ?? queued.rows.length) === 0) return { queued: false, skipped: 'chat_closed_or_missing', teamName };

  let notificationDelivered: boolean | null = null;
  if (input.sendNotice) {
    try {
      const hours = input.reasonCode === 'outside_business_hours' && input.describeBusinessHours
        ? await input.describeBusinessHours(input.teamId).catch(() => null) : null;
      const delivery = await input.sendNotice(buildQueueNotice(input.reasonCode, teamName, hours));
      notificationDelivered = !delivery || delivery.success !== false;
    } catch (error) {
      notificationDelivered = false;
      console.error('[HANDOFF_QUEUE] Chat queued but the customer notice failed:', error);
    }
  }
  if (input.afterQueued) {
    await input.afterQueued({ teamId: input.teamId, tag: teamRow.tag, color: teamRow.color })
      .catch((error) => console.error('[HANDOFF_QUEUE] Chat queued but a follow-up step failed:', error));
  }
  return { queued: true, teamName, notificationDelivered };
}
