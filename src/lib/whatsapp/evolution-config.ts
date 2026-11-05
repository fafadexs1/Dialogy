import { db } from '@/lib/db';
import type { EvolutionApiConfig } from '@/lib/types';

export class AmbiguousEvolutionInstanceError extends Error {
  readonly identifier: string;
  readonly matches: Array<{
    id: string;
    workspace_id: string;
    instance_name: string;
    webhook_key: string | null;
  }>;

  constructor(
    identifier: string,
    matches: Array<{
      id: string;
      workspace_id: string;
      instance_name: string;
      webhook_key: string | null;
    }>
  ) {
    super(`Multiple Evolution instances matched identifier '${identifier}'.`);
    this.name = 'AmbiguousEvolutionInstanceError';
    this.identifier = identifier;
    this.matches = matches;
  }
}

export type ResolvedEvolutionInstance = {
  id: string;
  workspace_id: string;
  cluster_id: string | null;
  instance_name: string;
  webhook_key: string | null;
  webhook_url: string | null;
  api_url: string | null;
  api_key: string | null;
};

type ResolveEvolutionInstanceOptions = {
  workspaceId?: string | null;
  allowLegacyInstanceName?: boolean;
};

export function buildEvolutionWebhookUrl(identifier: string): string {
  const baseUrl = process.env.EVOLUTION_WEBHOOK_BASE_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  if (!baseUrl) {
    throw new Error('Defina EVOLUTION_WEBHOOK_BASE_URL ou NEXTAUTH_URL com o endereco publico da Dialogy.');
  }

  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('A base do webhook deve ser uma URL HTTP(S) publica, sem credenciais, query ou fragmento.');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
      || url.hostname === '[::1]' || url.hostname === '0.0.0.0' || url.hostname.startsWith('127.')) {
    throw new Error('A Evolution API precisa de uma URL publica. Configure EVOLUTION_WEBHOOK_BASE_URL; localhost aponta para o proprio servidor da Evolution.');
  }
  if (!identifier.trim()) throw new Error('Identificador do webhook nao informado.');

  return `${url.toString().replace(/\/+$/, '')}/api/webhooks/evolution/${encodeURIComponent(identifier.trim())}`;
}

export async function resolveEvolutionInstance(
  identifier: string,
  options: ResolveEvolutionInstanceOptions = {}
): Promise<ResolvedEvolutionInstance | null> {
  const normalizedIdentifier = identifier?.trim();
  if (!normalizedIdentifier) return null;

  const params: Array<string> = [normalizedIdentifier];
  const whereClauses = [`to_jsonb(i)->>'webhook_key' = $1`];

  if (options.workspaceId) {
    params.push(options.workspaceId);
    whereClauses.push(`(i.instance_name = $1 AND i.workspace_id = $${params.length})`);
  } else if (options.allowLegacyInstanceName !== false) {
    whereClauses.push('i.instance_name = $1');
  }

  const res = await db.query(
    `SELECT
        i.id,
        i.workspace_id,
        i.cluster_id,
        i.instance_name,
        to_jsonb(i)->>'webhook_key' AS webhook_key,
        i.webhook_url,
        c.api_url,
        c.api_key
     FROM evolution_api_instances i
     LEFT JOIN whatsapp_clusters c ON c.id = i.cluster_id
     WHERE ${whereClauses.join(' OR ')}
     ORDER BY
        CASE WHEN to_jsonb(i)->>'webhook_key' = $1 THEN 0 ELSE 1 END,
        i.created_at DESC`,
    params
  );

  if ((res.rowCount ?? 0) === 0) {
    return null;
  }

  const webhookMatches = res.rows.filter((row) => row.webhook_key === normalizedIdentifier);
  if (webhookMatches.length > 1) {
    throw new AmbiguousEvolutionInstanceError(
      normalizedIdentifier,
      webhookMatches.map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        instance_name: row.instance_name,
        webhook_key: row.webhook_key,
      }))
    );
  }
  if (webhookMatches.length === 1) {
    return webhookMatches[0];
  }

  const legacyMatches = res.rows.filter((row) => row.instance_name === normalizedIdentifier);
  if (legacyMatches.length > 1) {
    throw new AmbiguousEvolutionInstanceError(
      normalizedIdentifier,
      legacyMatches.map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        instance_name: row.instance_name,
        webhook_key: row.webhook_key,
      }))
    );
  }

  return legacyMatches[0] ?? res.rows[0];
}

export async function getEvolutionApiConfig(
  instanceIdentifier: string,
  options: ResolveEvolutionInstanceOptions = {}
): Promise<Omit<EvolutionApiConfig, 'id' | 'workspace_id'> | null> {
  const resolved = await resolveEvolutionInstance(instanceIdentifier, options);
  if (!resolved) {
    return null;
  }

  if (!resolved.api_url || !resolved.api_key) {
    return null;
  }

  return {
    api_url: resolved.api_url,
    api_key: resolved.api_key,
  };
}
