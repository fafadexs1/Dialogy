import 'server-only';

import { createHash, createHmac } from 'node:crypto';
import { db } from '@/lib/db';
import { decryptWithKey, encryptWithKey } from '@/lib/security/secret-box';
import { StudioMemoryEventSchema, type StudioMemoryEvent, type StudioMemoryPage, type StudioMemoryScope } from './durable-memory';

const KEY_NAME = 'WORKSPACE_CREDENTIALS_ENCRYPTION_KEY';
const secret = () => process.env.WORKSPACE_CREDENTIALS_ENCRYPTION_KEY || process.env.META_PAYLOAD_ENCRYPTION_KEY;
const MAX_EVENT_BYTES = 32_768;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
};

export function sealStudioMemoryEvent(scope: StudioMemoryScope, input: StudioMemoryEvent) {
  const event = StudioMemoryEventSchema.parse(input);
  const payload = canonical({ ...scope, event });
  if (Buffer.byteLength(payload) > MAX_EVENT_BYTES) throw new Error('A escolha excede o limite de armazenamento por registro.');
  const encrypted = encryptWithKey(payload, secret(), KEY_NAME);
  // Keyed fingerprints do not disclose low-entropy customer choices through a public hash.
  const eventId = createHmac('sha256', secret()!).update(payload).digest('hex');
  const entityKey = createHash('sha256').update(canonical([event.requestId, event.kind, event.key])).digest('hex');
  return { eventId, entityKey, encrypted };
}

export function openStudioMemoryEvent(scope: StudioMemoryScope, row: { eventId: string; encrypted: string }): StudioMemoryEvent {
  if (row.encrypted.length > MAX_EVENT_BYTES * 3) throw new Error('Registro de memória inválido.');
  const payload = JSON.parse(decryptWithKey(row.encrypted, secret(), KEY_NAME));
  if (payload.workspaceId !== scope.workspaceId || payload.chatId !== scope.chatId || payload.agentId !== scope.agentId) {
    throw new Error('A memória não pertence a este atendimento.');
  }
  const event = StudioMemoryEventSchema.parse(payload.event);
  const fingerprint = createHmac('sha256', secret()!).update(canonical({ ...scope, event })).digest('hex');
  if (fingerprint !== row.eventId) throw new Error('A origem do registro de memória é inválida.');
  return event;
}

/** Read current revisions, or the complete revision history, without loading the entire chat. */
export async function readStudioDurableMemory(scope: StudioMemoryScope, options: {
  cursor?: string | null; limit?: number; history?: boolean;
} = {}): Promise<StudioMemoryPage> {
  const limit = options.limit ?? 40;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Página de memória inválida.');
  if (options.cursor && !/^[1-9][0-9]{0,18}$/.test(options.cursor)) throw new Error('Cursor de memória inválido.');
  const result = await db.query(`WITH scoped AS (
      SELECT m.sequence, m.event_id, m.entity_key, m.encrypted
      FROM agent_studio_memory_events m
      JOIN chats c ON c.id = m.chat_id AND c.workspace_id = m.workspace_id
      JOIN autopilot_configs a ON a.id = m.agent_id AND a.workspace_id = m.workspace_id
      WHERE m.workspace_id = $1 AND m.chat_id = $2 AND m.agent_id = $3
    ), selected AS (
      ${options.history ? 'SELECT * FROM scoped' : 'SELECT DISTINCT ON (entity_key) * FROM scoped ORDER BY entity_key, sequence DESC'}
    ) SELECT sequence::text, event_id, encrypted FROM selected
      WHERE ($4::bigint IS NULL OR sequence < $4::bigint)
      ORDER BY selected.sequence DESC LIMIT $5`, [scope.workspaceId, scope.chatId, scope.agentId, options.cursor || null, limit + 1]);
  const records = result.rows.slice(0, limit).map((row) => ({
    sequence: String(row.sequence), eventId: String(row.event_id),
    event: openStudioMemoryEvent(scope, { eventId: row.event_id, encrypted: row.encrypted }),
  }));
  return { records, nextCursor: result.rows.length > limit ? records.at(-1)!.sequence : null };
}
