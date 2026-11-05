import { db } from '@/lib/db';
import type { JsonObject } from './types';
import {
  AGENT_MEMORY_LAYERS,
  selectAgentMemoryForStage,
  type AgentMemoryEntry,
  type AgentMemoryLayer,
  type AgentMemorySourceType,
  type AgentMemoryStatus,
} from './memory';

type MemoryRow = {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  chat_id: string | null;
  task_execution_id: string | null;
  layer: AgentMemoryLayer;
  memory_key: string;
  value: unknown;
  source_type: AgentMemorySourceType;
  source_ref: string | null;
  scope: JsonObject | null;
  confidence: string | number;
  observed_at: string | Date;
  valid_from: string | Date | null;
  valid_until: string | Date | null;
  status: AgentMemoryStatus;
  conflict_group: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function timestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMemory(row: MemoryRow): AgentMemoryEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    contactId: row.contact_id,
    chatId: row.chat_id,
    taskExecutionId: row.task_execution_id,
    layer: row.layer,
    key: row.memory_key,
    value: row.value,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    scope: row.scope || {},
    confidence: Number(row.confidence || 0),
    observedAt: timestamp(row.observed_at) || new Date().toISOString(),
    validFrom: timestamp(row.valid_from),
    validUntil: timestamp(row.valid_until),
    status: row.status,
    conflictGroup: row.conflict_group,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function missingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /agent_memory_entries/.test(message) && /does not exist|undefined table|relation .* does not exist/i.test(message);
}

function logStoreError(scope: string, error: unknown) {
  if (missingTable(error)) return;
  console.error(`[AGENT_MEMORY:${scope}]`, error);
}

function validLayer(value: AgentMemoryLayer): boolean {
  return AGENT_MEMORY_LAYERS.includes(value);
}

export type SaveAgentMemoryInput = {
  id?: string | null;
  workspaceId: string;
  contactId?: string | null;
  chatId?: string | null;
  taskExecutionId?: string | null;
  layer: AgentMemoryLayer;
  key: string;
  value: unknown;
  sourceType: AgentMemorySourceType;
  sourceRef?: string | null;
  scope?: JsonObject;
  confidence?: number;
  observedAt?: string | Date;
  validFrom?: string | Date | null;
  validUntil?: string | Date | null;
  status?: AgentMemoryStatus;
  conflictGroup?: string | null;
};

export async function saveAgentMemoryEntry(input: SaveAgentMemoryInput): Promise<AgentMemoryEntry | null> {
  if (!input.workspaceId || !validLayer(input.layer) || !input.key.trim()) return null;
  const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0.5)));
  try {
    const result = await db.query<MemoryRow>(
      `INSERT INTO public.agent_memory_entries (
        id,
        workspace_id,
        contact_id,
        chat_id,
        task_execution_id,
        layer,
        memory_key,
        value,
        source_type,
        source_ref,
        scope,
        confidence,
        observed_at,
        valid_from,
        valid_until,
        status,
        conflict_group
      ) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12, COALESCE($13::timestamptz, timezone('utc', now())), $14::timestamptz, $15::timestamptz, $16, $17)
      ON CONFLICT (id) DO UPDATE SET
        value = EXCLUDED.value,
        source_type = EXCLUDED.source_type,
        source_ref = EXCLUDED.source_ref,
        scope = EXCLUDED.scope,
        confidence = EXCLUDED.confidence,
        observed_at = EXCLUDED.observed_at,
        valid_from = EXCLUDED.valid_from,
        valid_until = EXCLUDED.valid_until,
        status = EXCLUDED.status,
        conflict_group = EXCLUDED.conflict_group,
        updated_at = timezone('utc', now())
      RETURNING *`,
      [
        input.id ?? null,
        input.workspaceId,
        input.contactId ?? null,
        input.chatId ?? null,
        input.taskExecutionId ?? null,
        input.layer,
        input.key.trim().slice(0, 180),
        JSON.stringify(input.value ?? null),
        input.sourceType,
        input.sourceRef ?? null,
        JSON.stringify(input.scope || {}),
        confidence,
        input.observedAt instanceof Date ? input.observedAt.toISOString() : input.observedAt ?? null,
        input.validFrom instanceof Date ? input.validFrom.toISOString() : input.validFrom ?? null,
        input.validUntil instanceof Date ? input.validUntil.toISOString() : input.validUntil ?? null,
        input.status || 'active',
        input.conflictGroup ?? null,
      ],
    );
    return result.rows[0] ? mapMemory(result.rows[0]) : null;
  } catch (error) {
    logStoreError('save', error);
    return null;
  }
}

export async function listAgentMemoryEntries(input: {
  workspaceId: string;
  contactId?: string | null;
  chatId?: string | null;
  taskExecutionId?: string | null;
  layers?: AgentMemoryLayer[];
  keys?: string[];
  asOf?: string | Date;
  limit?: number;
}): Promise<AgentMemoryEntry[]> {
  if (!input.workspaceId) return [];
  if (input.layers && input.layers.length === 0) return [];
  if (input.keys && input.keys.length === 0) return [];
  const params: unknown[] = [input.workspaceId];
  const filters = [`workspace_id = $1`, `status = 'active'`];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (input.contactId) {
    const parameter = add(input.contactId);
    filters.push(`(contact_id = ${parameter} OR contact_id IS NULL)`);
  }
  if (input.chatId) {
    const parameter = add(input.chatId);
    filters.push(`(chat_id = ${parameter} OR chat_id IS NULL)`);
  }
  if (input.taskExecutionId) {
    const parameter = add(input.taskExecutionId);
    filters.push(`(task_execution_id = ${parameter} OR task_execution_id IS NULL)`);
  }
  if (input.layers && input.layers.length > 0) {
    const parameter = add(input.layers);
    filters.push(`layer = ANY(${parameter}::text[])`);
  }
  if (input.keys && input.keys.length > 0) {
    const parameter = add(input.keys);
    filters.push(`memory_key = ANY(${parameter}::text[])`);
  }
  if (input.asOf) {
    const parameter = add(input.asOf instanceof Date ? input.asOf.toISOString() : input.asOf);
    filters.push(`observed_at <= ${parameter}::timestamptz`);
  }
  const limit = Math.max(1, Math.min(500, Math.trunc(input.limit || 100)));
  params.push(limit);
  try {
    const result = await db.query<MemoryRow>(
      `SELECT *
         FROM public.agent_memory_entries
        WHERE ${filters.join(' AND ')}
        ORDER BY observed_at DESC, confidence DESC
        LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(mapMemory);
  } catch (error) {
    logStoreError('list', error);
    return [];
  }
}

export async function resolveAgentMemoryForStage(input: {
  workspaceId: string;
  contactId?: string | null;
  chatId?: string | null;
  taskExecutionId?: string | null;
  layers?: AgentMemoryLayer[];
  keys?: string[];
  asOf?: string | Date;
  limit?: number;
}) {
  const entries = await listAgentMemoryEntries(input);
  return selectAgentMemoryForStage({
    entries,
    layers: input.layers,
    keys: input.keys,
    contactId: input.contactId,
    chatId: input.chatId,
    taskExecutionId: input.taskExecutionId,
    now: input.asOf ? Date.parse(input.asOf instanceof Date ? input.asOf.toISOString() : input.asOf) : undefined,
  });
}
