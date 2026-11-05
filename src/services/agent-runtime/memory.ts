import type { JsonObject } from './types';

export const AGENT_MEMORY_LAYERS = [
  'turn_context',
  'operational_state',
  'contact_fact',
  'knowledge',
  'case_memory',
] as const;

export type AgentMemoryLayer = (typeof AGENT_MEMORY_LAYERS)[number];
export type AgentMemorySourceType = 'conversation' | 'tool' | 'user' | 'document' | 'case_memory' | 'system';
export type AgentMemoryStatus = 'active' | 'superseded' | 'conflicted' | 'expired';

export type AgentMemoryEntry = {
  id: string;
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
  confidence: number;
  observedAt: string;
  validFrom?: string | null;
  validUntil?: string | null;
  status: AgentMemoryStatus;
  conflictGroup?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AgentMemoryConflict = {
  key: string;
  winnerId: string;
  conflictingIds: string[];
  reason: 'different_values' | 'same_value_different_source';
};

export type MergedAgentMemory = {
  entries: AgentMemoryEntry[];
  conflicts: AgentMemoryConflict[];
};

function asTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) || String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function scopeKey(entry: AgentMemoryEntry): string {
  const scope = entry.scope || {};
  return [
    entry.workspaceId,
    entry.layer,
    entry.key,
    entry.contactId || scope.contactId || '',
    entry.chatId || scope.chatId || '',
    entry.taskExecutionId || scope.taskExecutionId || '',
  ].join('|');
}

export function isAgentMemoryEntryUsable(
  entry: AgentMemoryEntry,
  now = Date.now(),
): boolean {
  if (entry.status !== 'active') return false;
  const validFrom = asTimestamp(entry.validFrom);
  const validUntil = asTimestamp(entry.validUntil);
  if (validFrom > 0 && validFrom > now) return false;
  if (validUntil > 0 && validUntil < now) return false;
  return Number.isFinite(entry.confidence) && entry.confidence >= 0;
}

function compareMemoryEntries(left: AgentMemoryEntry, right: AgentMemoryEntry): number {
  return right.confidence - left.confidence
    || asTimestamp(right.observedAt) - asTimestamp(left.observedAt)
    || asTimestamp(right.updatedAt) - asTimestamp(left.updatedAt)
    || left.id.localeCompare(right.id);
}

/**
 * Selects one operationally usable value per scope/key while retaining an
 * explicit conflict record. A conflict never becomes an implicit permission
 * to repeat a tool action.
 */
export function mergeAgentMemory(
  entries: AgentMemoryEntry[],
  options?: { now?: number },
): MergedAgentMemory {
  const groups = new Map<string, AgentMemoryEntry[]>();
  for (const entry of entries || []) {
    if (!isAgentMemoryEntryUsable(entry, options?.now ?? Date.now())) continue;
    const key = scopeKey(entry);
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }

  const merged: AgentMemoryEntry[] = [];
  const conflicts: AgentMemoryConflict[] = [];
  for (const [key, group] of groups) {
    const ordered = [...group].sort(compareMemoryEntries);
    const winner = ordered[0];
    if (!winner) continue;
    merged.push(winner);
    const values = new Set(ordered.map((entry) => canonicalValue(entry.value)));
    if (values.size > 1) {
      conflicts.push({
        key,
        winnerId: winner.id,
        conflictingIds: ordered.slice(1).map((entry) => entry.id),
        reason: 'different_values',
      });
    } else if (new Set(ordered.map((entry) => entry.sourceType)).size > 1) {
      conflicts.push({
        key,
        winnerId: winner.id,
        conflictingIds: ordered.slice(1).map((entry) => entry.id),
        reason: 'same_value_different_source',
      });
    }
  }

  return {
    entries: merged.sort((left, right) => left.key.localeCompare(right.key)),
    conflicts,
  };
}

export function selectAgentMemoryForStage(input: {
  entries: AgentMemoryEntry[];
  layers?: AgentMemoryLayer[];
  keys?: string[];
  contactId?: string | null;
  chatId?: string | null;
  taskExecutionId?: string | null;
  now?: number;
}): MergedAgentMemory {
  const layers = input.layers ? new Set(input.layers) : null;
  const keys = input.keys ? new Set(input.keys) : null;
  const filtered = (input.entries || []).filter((entry) => {
    if (layers && !layers.has(entry.layer)) return false;
    if (keys && !keys.has(entry.key)) return false;
    if (input.contactId && entry.contactId && entry.contactId !== input.contactId) return false;
    if (input.chatId && entry.chatId && entry.chatId !== input.chatId) return false;
    if (input.taskExecutionId && entry.taskExecutionId && entry.taskExecutionId !== input.taskExecutionId) return false;
    return true;
  });
  return mergeAgentMemory(filtered, { now: input.now });
}

