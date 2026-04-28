import { db } from '@/lib/db';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from './types';

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stringifyFieldValue(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function resolveContactId(context: AgentToolRuntimeContext): Promise<string | null> {
  if (context.contact?.id) return context.contact.id;
  const { rows } = await db.query(
    'SELECT contact_id FROM public.chats WHERE id = $1 AND workspace_id = $2 LIMIT 1',
    [context.chat.id, context.workspaceId]
  );
  return rows[0]?.contact_id || null;
}

export async function runCrmUpdateContactCustomFieldsTool(
  context: AgentToolRuntimeContext,
  action: Extract<AgentToolAction, { type: 'crm_update_contact_custom_fields' }>
): Promise<AgentToolExecutionResult> {
  const requestedFields = action.payload?.fields || {};
  const entries = Object.entries(requestedFields)
    .map(([key, value]) => [key.trim(), stringifyFieldValue(value)] as const)
    .filter(([key, value]) => key && value);

  if (entries.length === 0) {
    return {
      toolName: action.type,
      status: 'rejected',
      input: action,
      error: 'Nenhum campo customizado valido informado.',
    };
  }

  const contactId = await resolveContactId(context);
  if (!contactId) {
    return {
      toolName: action.type,
      status: 'error',
      input: action,
      error: 'Contato do chat nao encontrado.',
    };
  }

  const { rows: fieldRows } = await db.query(
    `SELECT id, label, type
     FROM public.custom_field_definitions
     WHERE workspace_id = $1`,
    [context.workspaceId]
  );

  const fieldById = new Map(fieldRows.map((row) => [String(row.id), row]));
  const fieldByLabel = new Map(fieldRows.map((row) => [normalizeLabel(String(row.label || '')), row]));
  const updated: Array<{ fieldId: string; label: string; value: string }> = [];
  const skipped: Array<{ key: string; reason: string }> = [];

  for (const [key, value] of entries) {
    const field = fieldById.get(key) || fieldByLabel.get(normalizeLabel(key));
    if (!field) {
      skipped.push({ key, reason: 'Campo customizado nao encontrado neste workspace.' });
      continue;
    }

    await db.query(
      `INSERT INTO public.contact_custom_field_values (contact_id, field_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (contact_id, field_id)
       DO UPDATE SET value = EXCLUDED.value`,
      [contactId, field.id, value]
    );

    updated.push({ fieldId: field.id, label: field.label, value });
  }

  if (updated.length === 0) {
    return {
      toolName: action.type,
      status: 'error',
      input: action,
      error: 'Nenhum campo foi atualizado.',
      output: { skipped },
    };
  }

  return {
    toolName: action.type,
    status: 'success',
    input: action,
    output: {
      contactId,
      updated,
      skipped,
    },
  };
}
