import { db } from '@/lib/db';
import {
  sanitizeAgentDomainPackDefinition,
  validateAgentDomainPackDefinition,
  type AgentDomainPack,
  type AgentDomainPackDefinition,
  type AgentDomainPackStatus,
  type JsonObject,
} from './types';

type DomainPackRow = {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  version: number;
  status: AgentDomainPackStatus;
  definition: AgentDomainPackDefinition | null;
  created_by_user_id: string | null;
  published_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function timestamp(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapDomainPack(row: DomainPackRow): AgentDomainPack {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    version: Number(row.version || 1),
    status: row.status,
    definition: sanitizeAgentDomainPackDefinition(row.definition),
    createdByUserId: row.created_by_user_id,
    publishedAt: timestamp(row.published_at),
    createdAt: timestamp(row.created_at) || new Date().toISOString(),
    updatedAt: timestamp(row.updated_at) || new Date().toISOString(),
  };
}

function normalizeSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function missingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /agent_domain_packs/.test(message) && /does not exist|undefined table|relation .* does not exist/i.test(message);
}

function logError(scope: string, error: unknown) {
  if (missingTable(error)) return;
  console.error(`[AGENT_DOMAIN_PACK:${scope}]`, error);
}

export type SaveAgentDomainPackInput = {
  workspaceId: string;
  slug: string;
  name: string;
  version?: number;
  definition: unknown;
  createdByUserId?: string | null;
  status?: Extract<AgentDomainPackStatus, 'draft' | 'archived'>;
};

export function validateAgentDomainPackInput(input: SaveAgentDomainPackInput): string[] {
  const errors: string[] = [];
  const slug = normalizeSlug(input.slug);
  if (!input.workspaceId) errors.push('workspaceId e obrigatorio.');
  if (!slug || !/^[a-z0-9][a-z0-9_.-]{1,119}$/.test(slug)) {
    errors.push('slug invalido; use letras, numeros, ponto, hifen ou underscore.');
  }
  if (!input.name?.trim()) errors.push('name e obrigatorio.');
  if (input.version != null && (!Number.isInteger(input.version) || input.version < 1)) {
    errors.push('version precisa ser um inteiro positivo.');
  }
  errors.push(...validateAgentDomainPackDefinition(sanitizeAgentDomainPackDefinition(input.definition)));
  return errors;
}

export async function saveAgentDomainPack(input: SaveAgentDomainPackInput): Promise<AgentDomainPack | null> {
  const errors = validateAgentDomainPackInput(input);
  if (errors.length > 0) throw new Error(errors.join(' '));

  const slug = normalizeSlug(input.slug);
  const definition = sanitizeAgentDomainPackDefinition(input.definition);
  try {
    const version = input.version ?? await nextDomainPackVersion(input.workspaceId, slug);
    const result = await db.query<DomainPackRow>(
      `INSERT INTO public.agent_domain_packs (
        workspace_id,
        slug,
        name,
        version,
        status,
        definition,
        created_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      ON CONFLICT (workspace_id, slug, version) DO UPDATE SET
        name = EXCLUDED.name,
        status = CASE
          WHEN public.agent_domain_packs.status = 'published' THEN public.agent_domain_packs.status
          ELSE EXCLUDED.status
        END,
        definition = EXCLUDED.definition,
        updated_at = timezone('utc', now())
      WHERE public.agent_domain_packs.status <> 'published'
      RETURNING *`,
      [
        input.workspaceId,
        slug,
        input.name.trim().slice(0, 160),
        version,
        input.status || 'draft',
        JSON.stringify(definition),
        input.createdByUserId ?? null,
      ],
    );
    if (result.rows[0]) return mapDomainPack(result.rows[0]);

    // Published versions are immutable. Returning the existing version keeps
    // idempotent save requests safe without silently replacing production
    // configuration.
    const existing = await db.query<DomainPackRow>(
      `SELECT *
         FROM public.agent_domain_packs
        WHERE workspace_id = $1 AND slug = $2 AND version = $3
        LIMIT 1`,
      [input.workspaceId, slug, version],
    );
    return existing.rows[0] ? mapDomainPack(existing.rows[0]) : null;
  } catch (error) {
    logError('save', error);
    return null;
  }
}

async function nextDomainPackVersion(workspaceId: string, slug: string): Promise<number> {
  const result = await db.query<{ next_version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM public.agent_domain_packs
      WHERE workspace_id = $1 AND slug = $2`,
    [workspaceId, slug],
  );
  return Math.max(1, Number(result.rows[0]?.next_version || 1));
}

export async function getAgentDomainPack(input: {
  workspaceId: string;
  id?: string | null;
  slug?: string | null;
  version?: number | null;
  publishedOnly?: boolean;
}): Promise<AgentDomainPack | null> {
  if (!input.workspaceId || (!input.id && !input.slug)) return null;
  try {
    const result = await db.query<DomainPackRow>(
      `SELECT *
         FROM public.agent_domain_packs
        WHERE workspace_id = $1
          AND ($2::uuid IS NULL OR id = $2::uuid)
          AND ($3::text IS NULL OR slug = $3::text)
          AND ($4::int IS NULL OR version = $4::int)
          AND ($5::boolean = false OR status = 'published')
        ORDER BY version DESC
        LIMIT 1`,
      [input.workspaceId, input.id ?? null, input.slug ? normalizeSlug(input.slug) : null, input.version ?? null, Boolean(input.publishedOnly)],
    );
    return result.rows[0] ? mapDomainPack(result.rows[0]) : null;
  } catch (error) {
    logError('get', error);
    return null;
  }
}

export async function listAgentDomainPacks(input: {
  workspaceId: string;
  status?: AgentDomainPackStatus | null;
  limit?: number;
}): Promise<AgentDomainPack[]> {
  if (!input.workspaceId) return [];
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 50)));
  try {
    const result = await db.query<DomainPackRow>(
      `SELECT *
         FROM public.agent_domain_packs
        WHERE workspace_id = $1
          AND ($2::text IS NULL OR status = $2::text)
        ORDER BY slug, version DESC
        LIMIT $3`,
      [input.workspaceId, input.status ?? null, limit],
    );
    return result.rows.map(mapDomainPack);
  } catch (error) {
    logError('list', error);
    return [];
  }
}

export async function publishAgentDomainPack(input: {
  workspaceId: string;
  packId: string;
}): Promise<AgentDomainPack | null> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<DomainPackRow>(
      `SELECT *
         FROM public.agent_domain_packs
        WHERE id = $1 AND workspace_id = $2
        FOR UPDATE`,
      [input.packId, input.workspaceId],
    );
    const pack = current.rows[0];
    if (!pack) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `UPDATE public.agent_domain_packs
          SET status = 'archived', updated_at = timezone('utc', now())
        WHERE workspace_id = $1
          AND slug = $2
          AND status = 'published'
          AND id <> $3`,
      [input.workspaceId, pack.slug, input.packId],
    );
    const published = await client.query<DomainPackRow>(
      `UPDATE public.agent_domain_packs
          SET status = 'published',
              published_at = COALESCE(published_at, timezone('utc', now())),
              updated_at = timezone('utc', now())
        WHERE id = $1 AND workspace_id = $2
        RETURNING *`,
      [input.packId, input.workspaceId],
    );
    await client.query('COMMIT');
    return published.rows[0] ? mapDomainPack(published.rows[0]) : null;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original error is more useful to the caller/log.
    }
    logError('publish', error);
    return null;
  } finally {
    client.release();
  }
}

export async function archiveAgentDomainPack(input: {
  workspaceId: string;
  packId: string;
}): Promise<boolean> {
  try {
    const result = await db.query(
      `UPDATE public.agent_domain_packs
          SET status = 'archived', updated_at = timezone('utc', now())
        WHERE id = $1 AND workspace_id = $2
        RETURNING id`,
      [input.packId, input.workspaceId],
    );
    return Boolean(result.rows[0]);
  } catch (error) {
    logError('archive', error);
    return false;
  }
}

export function buildDomainPackDefinition(input: {
  businessName?: string | null;
  niche?: string | null;
  description?: string | null;
  toolNames?: string[];
  knowledgeSourceIds?: string[];
  goals?: AgentDomainPackDefinition['goals'];
  procedures?: AgentDomainPackDefinition['procedures'];
  policies?: AgentDomainPackDefinition['policies'];
  responseStyle?: AgentDomainPackDefinition['responseStyle'];
  metadata?: JsonObject;
}): AgentDomainPackDefinition {
  return sanitizeAgentDomainPackDefinition({
    identity: {
      businessName: input.businessName || undefined,
      niche: input.niche || undefined,
      description: input.description || undefined,
    },
    toolNames: input.toolNames || [],
    knowledgeSourceIds: input.knowledgeSourceIds || [],
    goals: input.goals || [],
    procedures: input.procedures || [],
    policies: input.policies || [],
    responseStyle: input.responseStyle || {},
    metadata: input.metadata || {},
  });
}

type AutopilotConfigDomainPackSource = {
  id?: string | null;
  name?: string | null;
  businessName?: string | null;
  niche?: string | null;
  description?: string | null;
  knowledgeBase?: string | null;
  knowledgeBaseDocuments?: Array<Record<string, unknown>> | string[] | null;
  enabledToolNames?: string[] | null;
  flowGraph?: unknown;
  goals?: unknown;
  procedures?: unknown;
  rules?: unknown;
  responseStyle?: unknown;
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/\s+/g, ' ').trim();
}

function jsonObject(value: unknown): JsonObject {
  return objectRecord(value) as JsonObject;
}

/**
 * Compiles the current visual/legacy autopilot shape into the universal
 * package format. This is deliberately a data compiler: niche-specific
 * branches stay in the generated package, never in the execution core.
 */
export function compileAutopilotConfigToDomainPack(
  input: AutopilotConfigDomainPackSource,
): AgentDomainPackDefinition {
  const documents = Array.isArray(input.knowledgeBaseDocuments) ? input.knowledgeBaseDocuments : [];
  const knowledgeSourceIds = documents.flatMap((document) => {
    if (typeof document === 'string') return document.trim() ? [document.trim()] : [];
    const id = compactText(objectRecord(document).id);
    return id ? [id] : [];
  });
  const goals = Array.isArray(input.goals) ? input.goals : [];
  const procedures = Array.isArray(input.procedures) ? input.procedures : [];
  const rules = Array.isArray(input.rules) ? input.rules : [];
  const normalizedGoals = goals.flatMap((goal, index) => {
    const record = objectRecord(goal);
    const id = compactText(record.id, `goal_${index + 1}`);
    const label = compactText(record.label || record.name, id);
    return [{
      id,
      label,
      description: compactText(record.description),
      triggerExamples: Array.isArray(record.triggerExamples)
        ? record.triggerExamples.filter((item): item is string => typeof item === 'string').slice(0, 30)
        : [],
    }];
  });
  const normalizedProcedures = procedures.flatMap((procedure, index) => {
    const record = objectRecord(procedure);
    const id = compactText(record.id, `procedure_${index + 1}`);
    const name = compactText(record.name || record.label, id);
    return [{
      id,
      name,
      version: typeof record.version === 'number' ? record.version : 1,
      definition: jsonObject(record.definition || record),
    }];
  });
  if (normalizedProcedures.length === 0 && Object.keys(objectRecord(input.flowGraph)).length > 0) {
    normalizedProcedures.push({
      id: 'autopilot_flow',
      name: 'Autopilot flow',
      version: 1,
      definition: jsonObject(input.flowGraph),
    });
  }
  const normalizedPolicies = rules.flatMap((rule, index) => {
    const record = objectRecord(rule);
    const id = compactText(record.id, `policy_${index + 1}`);
    const text = compactText(record.rule || record.description || record.text || JSON.stringify(record));
    if (!text) return [];
    const severity = record.severity === 'critical' || record.severity === 'warning'
      ? record.severity
      : 'info';
    return [{ id, rule: text, severity } as const];
  });

  return buildDomainPackDefinition({
    businessName: input.businessName || input.name,
    niche: input.niche,
    // The legacy knowledge base often mixes persona, documents and old niche
    // examples. Promoting it wholesale to identity was the main source of
    // domain leakage. Identity now comes only from an explicit description;
    // factual knowledge remains in the RAG layer where it can be scoped.
    description: input.description,
    toolNames: input.enabledToolNames || [],
    knowledgeSourceIds,
    goals: normalizedGoals,
    procedures: normalizedProcedures,
    policies: normalizedPolicies,
    responseStyle: objectRecord(input.responseStyle) as AgentDomainPackDefinition['responseStyle'],
    metadata: {
      compiler: 'autopilot_config_to_agent_domain_pack_v2',
      sourceConfigId: input.id || null,
      sourceConfigName: input.name || null,
      identitySource: input.description ? 'explicit_business_context' : 'neutral_default',
    },
  });
}
