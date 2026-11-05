import { db } from '@/lib/db';
import { createHash } from 'node:crypto';
import { decryptWithKey, encryptWithKey } from '@/lib/security/secret-box';
import type { WorkflowDefinition } from '@/services/workflow-runtime';

export type NexusCredentialType = 'bearer' | 'api_key' | 'basic' | 'smtp' | 'google_oauth' | 'database' | 'oauth2';

export type NexusCredentialSummary = {
  id: string;
  workspaceId: string;
  name: string;
  type: NexusCredentialType;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type Queryable = Pick<typeof db, 'query'>;

export type NexusCredentialBindingValidation = {
  valid: boolean;
  missingRequiredNodeIds: string[];
  unknownCredentialIds: string[];
};

function encryptionKey() {
  const dedicated = process.env.WORKSPACE_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (dedicated) return { secret: dedicated, envName: 'WORKSPACE_CREDENTIALS_ENCRYPTION_KEY' };
  return { secret: process.env.META_PAYLOAD_ENCRYPTION_KEY, envName: 'META_PAYLOAD_ENCRYPTION_KEY' };
}

export function encryptPayload(payload: Record<string, unknown>) {
  const key = encryptionKey();
  return encryptWithKey(JSON.stringify(payload), key.secret, key.envName);
}

export function decryptPayload(value: string): Record<string, unknown> {
  const key = encryptionKey();
  const parsed = JSON.parse(decryptWithKey(value, key.secret, key.envName));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Credencial armazenada em formato inválido.');
  return parsed as Record<string, unknown>;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return parseMetadata(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function summary(row: Record<string, unknown>): NexusCredentialSummary {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    type: row.credential_type as NexusCredentialType,
    metadata: parseMetadata(row.metadata),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function listNexusCredentialSummaries(workspaceId: string): Promise<NexusCredentialSummary[]> {
  const result = await db.query(
    `SELECT id, workspace_id, name, credential_type, metadata, created_at, updated_at
     FROM public.nexus_credentials WHERE workspace_id = $1 ORDER BY name`,
    [workspaceId],
  );
  return result.rows.map(summary);
}

export async function saveNexusCredential(input: {
  id?: string;
  workspaceId: string;
  userId: string;
  name: string;
  type: NexusCredentialType;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<NexusCredentialSummary> {
  const encrypted = encryptPayload(input.payload);
  const result = input.id
    ? await db.query(
      `UPDATE public.nexus_credentials
       SET name = $3, credential_type = $4, encrypted_payload = $5, metadata = $6::jsonb, updated_at = timezone('utc', now())
       WHERE id = $1 AND workspace_id = $2
       RETURNING id, workspace_id, name, credential_type, metadata, created_at, updated_at`,
      [input.id, input.workspaceId, input.name.trim(), input.type, encrypted, JSON.stringify(input.metadata || {})],
    )
    : await db.query(
      `INSERT INTO public.nexus_credentials (workspace_id, created_by, name, credential_type, encrypted_payload, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, workspace_id, name, credential_type, metadata, created_at, updated_at`,
      [input.workspaceId, input.userId, input.name.trim(), input.type, encrypted, JSON.stringify(input.metadata || {})],
    );
  if (!result.rows[0]) throw new Error('Credencial não encontrada.');
  return summary(result.rows[0]);
}

export async function loadNexusCredentialPayload(input: {
  workspaceId: string;
  credentialId: string;
  allowedTypes?: NexusCredentialType[];
  expectedFingerprint?: string;
}) {
  const result = await db.query(
    `SELECT credential_type, encrypted_payload, metadata FROM public.nexus_credentials
     WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
    [input.workspaceId, input.credentialId],
  );
  if (!result.rows[0]) throw new Error('Credencial não encontrada neste workspace.');
  const type = result.rows[0].credential_type as NexusCredentialType;
  if (input.allowedTypes && !input.allowedTypes.includes(type)) throw new Error(`Credencial incompatível com esta ação: ${type}.`);
  if (input.expectedFingerprint && credentialFingerprint(type, String(result.rows[0].encrypted_payload)) !== input.expectedFingerprint) throw new Error('A credencial mudou após a aprovação. Solicite uma nova autorização.');
  return { type, payload: decryptPayload(String(result.rows[0].encrypted_payload)), metadata: parseMetadata(result.rows[0].metadata) };
}

function credentialFingerprint(type: string, encryptedPayload: string) {
  return createHash('sha256').update(JSON.stringify([type, encryptedPayload])).digest('hex');
}

/** Bind approvals to the exact encrypted workspace credential without exposing its contents. */
export async function nexusCredentialFingerprint(input: { workspaceId: string; credentialId: string; type: NexusCredentialType }) {
  const { rows } = await db.query(`SELECT credential_type, encrypted_payload FROM public.nexus_credentials WHERE workspace_id = $1 AND id = $2 LIMIT 1`, [input.workspaceId, input.credentialId]);
  if (!rows[0] || rows[0].credential_type !== input.type || typeof rows[0].encrypted_payload !== 'string') throw new Error('Credencial não encontrada neste workspace.');
  return credentialFingerprint(input.type, rows[0].encrypted_payload);
}

export async function validateNexusWorkflowCredentialBindings(input: {
  workspaceId: string;
  definition: WorkflowDefinition;
  database?: Queryable;
}): Promise<NexusCredentialBindingValidation> {
  const references = input.definition.nodes
    .map((node) => ({
      nodeId: node.id,
      credentialId: String(node.config.credentialId || '').trim(),
      required: node.config.credentialRequired === true,
    }))
    .filter((reference) => reference.required || reference.credentialId);
  const missingRequiredNodeIds = references
    .filter((reference) => reference.required && !reference.credentialId)
    .map((reference) => reference.nodeId);
  const credentialIds = [...new Set(references.map((reference) => reference.credentialId).filter(Boolean))];
  const database = input.database || db;
  const found = credentialIds.length === 0
    ? new Set<string>()
    : new Set((await database.query(
      `SELECT id::text AS id
       FROM public.nexus_credentials
       WHERE workspace_id = $1
         AND id::text = ANY($2::text[])`,
      [input.workspaceId, credentialIds],
    )).rows.map((row: Record<string, unknown>) => String(row.id)));
  const unknownCredentialIds = credentialIds.filter((credentialId) => !found.has(credentialId));
  return {
    valid: missingRequiredNodeIds.length === 0 && unknownCredentialIds.length === 0,
    missingRequiredNodeIds,
    unknownCredentialIds,
  };
}

export async function deleteNexusCredential(workspaceId: string, credentialId: string) {
  await db.query('DELETE FROM public.nexus_credentials WHERE workspace_id = $1 AND id = $2', [workspaceId, credentialId]);
}
