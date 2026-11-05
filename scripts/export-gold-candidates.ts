// Phase 0, step 2 of docs/PLAN-ia-autonoma-transferir-encerrar.md: candidate conversations for the gold dataset.
//
//   npx tsx scripts/export-gold-candidates.ts [--days=30] [--workspace-id=<uuid>]            (dry run: counts only)
//   npx tsx scripts/export-gold-candidates.ts --export --confirm-sensitive --per-stratum=50 [--out=.gold-dataset]
//
// Dry run prints aggregates and nothing else. Export reads in a READ ONLY transaction, masks personal data
// (src/lib/privacy/mask-conversation-pii.ts) and writes JSONL under a git-ignored folder. Masking is best effort:
// treat the files as sensitive, share them only with the raters, and delete them when labelling ends.
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { maskConversationText, nameTokens } from '../src/lib/privacy/mask-conversation-pii';

config({ quiet: true });

const arg = (name: string, fallback: string | null = null) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const days = Number(arg('days', '30'));
const perStratum = Number(arg('per-stratum', '50'));
const workspaceId = arg('workspace-id');
const outDir = arg('out', '.gold-dataset')!;
if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error('--days must be between 1 and 365');
if (!Number.isInteger(perStratum) || perStratum < 1 || perStratum > 500) throw new Error('--per-stratum must be between 1 and 500');
if (workspaceId && !/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error('--workspace-id must be a UUID');
const exporting = flag('export');
if (exporting && !flag('confirm-sensitive')) throw new Error('Export writes customer conversations (masked) to disk. Re-run with --confirm-sensitive to proceed.');

const end = new Date();
const start = new Date(end.getTime() - days * 86_400_000);

// Strata are ordered by priority: a chat lands in the first one that matches. They mirror the two decisions to be learned:
// when a human (or bot) handed over, and when a conversation was closed, with extra weight on suspicious early closes.
const STRATA_SQL = `
  WITH base AS (
    SELECT c.id, c.workspace_id, c.closed_at,
      EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id AND m.type = 'system' AND m.metadata->>'event' = 'transfer') AS has_transfer,
      EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id AND m.type = 'system' AND m.metadata->>'event' = 'close' AND m.metadata ? 'closed_by_system_agent_id') AS closed_by_system,
      extract(epoch FROM c.closed_at - (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id AND m.from_me = false AND m.created_at <= c.closed_at)) AS gap_s,
      (SELECT count(*) FROM messages m WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id AND m.type <> 'system') AS content_messages
    FROM chats c
    WHERE c.status = 'encerrados' AND c.closed_at >= $1 AND c.closed_at < $2 AND ($3::uuid IS NULL OR c.workspace_id = $3)
  ), labelled AS (
    SELECT id, workspace_id,
      CASE WHEN has_transfer THEN 'transferred'
           WHEN closed_by_system THEN 'closed_by_system_agent'
           WHEN gap_s IS NOT NULL AND gap_s < 60 THEN 'closed_under_60s_after_customer'
           ELSE 'closed_other' END AS stratum
    FROM base WHERE content_messages >= 4
  )`;

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await db.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL statement_timeout = '60s'");
    const counts = (await db.query(`${STRATA_SQL} SELECT stratum, count(*)::int AS chats FROM labelled GROUP BY 1 ORDER BY 2 DESC`, [start, end, workspaceId])).rows;
    console.log(JSON.stringify({ mode: exporting ? 'export' : 'dry-run', start, end, days, workspaceId, eligibleByStratum: counts,
      note: 'Somente conversas encerradas com pelo menos 4 mensagens de conteúdo. Nenhum texto é lido em dry-run.' }));
    if (!exporting) return;

    mkdirSync(outDir, { recursive: true });
    for (const { stratum } of counts as Array<{ stratum: string }>) {
      const sample = (await db.query(
        `${STRATA_SQL} SELECT l.id, l.workspace_id, ct.name AS contact_name FROM labelled l JOIN chats ch ON ch.id = l.id
           LEFT JOIN contacts ct ON ct.id = ch.contact_id WHERE l.stratum = $4 ORDER BY md5(l.id::text || $5) LIMIT $6`,
        [start, end, workspaceId, stratum, 'gold-v1', perStratum])).rows;
      const lines: string[] = [];
      for (const chat of sample) {
        const names = nameTokens(chat.contact_name);
        const messages = (await db.query(
          `SELECT m.created_at, m.from_me, m.type, m.content, m.metadata->>'event' AS event,
                  (m.metadata ? 'autopilotSourceMessageId') AS from_ai, (m.metadata ? 'closed_by_system_agent_id') AS closed_by_system
             FROM messages m WHERE m.chat_id = $1 AND m.workspace_id = $2 ORDER BY m.created_at, m.id`, [chat.id, chat.workspace_id])).rows;
        const t0 = new Date(messages[0].created_at).getTime();
        const turns = messages.map((m, index) => ({
          idx: index,
          t: Math.round((new Date(m.created_at).getTime() - t0) / 1000),
          role: m.type === 'system' ? 'system' : m.from_me ? (m.from_ai ? 'ai' : 'agent_or_bot') : 'customer',
          event: m.event || undefined,
          text: m.type === 'system' || m.type === 'text' || !m.type ? maskConversationText(String(m.content ?? ''), names) : `[MIDIA:${m.type}]`,
        }));
        // Anonymous id: the real chat id never leaves the database. Weak labels come from what really happened;
        // raters fill `gold` with what SHOULD have happened at each customer turn.
        lines.push(JSON.stringify({
          conversationId: `gold-${stratum}-${lines.length + 1}`, stratum,
          weakLabel: { transferred: stratum === 'transferred', closedBySystemAgent: stratum === 'closed_by_system_agent' },
          turns,
          gold: { rater: null, decisions: [], note: '' },
        }));
      }
      writeFileSync(join(outDir, `${stratum}.jsonl`), lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
      console.log(JSON.stringify({ wrote: `${stratum}.jsonl`, conversations: lines.length }));
    }
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
  }
}
main().catch((error) => { console.error(error?.code || error?.name, String(error?.message).slice(0, 200)); process.exitCode = 1; });
