import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';

import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import { db } from '@/lib/db';
import {
  loadNexusCredentialPayload,
  validateNexusWorkflowCredentialBindings,
  type NexusCredentialType,
} from '@/modules/nexus/services/credentials';
import { validateNexusWorkflowDialogyBindings } from '@/modules/nexus/services/dialogy-resources';
import {
  buildVelproFinalWorkflow,
  VELPRO_FINAL_PROFILE,
  type VelproFinalBindings,
} from '@/modules/nexus/services/velpro-final';
import { listWorkspaceConfiguredAiModels } from '@/services/ai/workspace-ai-credentials';
import { WorkflowDefinitionSchema, stableStringify, type ModelConfiguration } from '@/services/workflow-runtime';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';

const WORKSPACE = {
  id: 'e3b476a1-5de8-4744-80b5-a5d23fe15fab',
  name: 'Velpro Telecom',
  ownerId: '8fe1f4da-9305-475c-95d1-83bda9f29b22',
  timezone: 'America/Sao_Paulo',
} as const;

const RAQUEL_CONFIG_ID = '0a952e14-2fdc-47eb-99d6-733a2d4868a5';
const VELPRO_SENDER_SYSTEM_AGENT = {
  id: '5ad2ea69-47e4-4ee9-bb33-584eef145480',
  name: 'Velpro',
} as const;
const PREFERRED_MODEL = 'googleai/gemini-3.1-flash-lite';
const DEFAULT_SOURCE = resolve(process.cwd(), '..', 'nexusflow', 'flow-fluxo_velpro_final-2026-02-10.json');
const DEFAULT_DISCORD_CREDENTIAL_NAME = 'Discord Velpro Comercial';

const TEAM_BINDINGS = {
  commercial: { id: 'b3b71514-098f-49fa-b922-f38a40065ef6', name: 'Comercial' },
  finance: { id: 'e4991d0b-917c-42e7-8cde-014b0bdf5bb8', name: 'Financeiro' },
  support: { id: 'b9a74d62-7f65-46c1-a5ae-4887fde9926e', name: 'Suporte' },
} as const;

const TAG_BINDINGS = {
  commercial: { id: '8fa25b50-165f-4e88-ab96-82f1c8d7debd', label: 'Comercial' },
  finance: { id: '58ef50bc-f95e-4fa2-b060-1571cb173e48', label: 'Financeiro' },
  support: { id: 'f1edc42b-5d86-4b43-b70b-358a78b83aab', label: 'Suporte' },
  secondCopy: { id: '4645b98b-014e-4ee8-8380-750ebb91089a', label: 'Segunda via boleto' },
  closeReason: { id: '5a064503-1cca-4c42-983b-1556255061b1', label: 'Sistema' },
} as const;

const KNOWLEDGE_DOCUMENT_IDS = [
  '59988957-818e-4d93-98ff-06a7e3c81dde',
  'e1b1afc1-21fa-4ad6-8925-bb28bb1d3402',
  '73128d10-8acb-4e38-8f33-60a269dc3431',
  '28867a06-9d88-458b-8960-405c0c042785',
] as const;

const APPLY = process.argv.includes('--apply');
const PUBLISH = process.argv.includes('--publish');

function argument(name: string, fallback: string) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length).trim();
  return value || fallback;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function parseDocumentArray(value: unknown): Array<Record<string, unknown>> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
}

function deterministicUuid(seed: string) {
  const bytes = Buffer.from(createHash('sha256').update(seed).digest('hex').slice(0, 32), 'hex');
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function assertNexusSchema(client: PoolClient) {
  const result = await client.query(`
    SELECT
      to_regclass('public.nexus_workflows') IS NOT NULL AS workflows,
      to_regclass('public.nexus_credentials') IS NOT NULL AS credentials,
      to_regclass('public.nexus_schedule_runs') IS NOT NULL AS schedules,
      to_regclass('public.nexus_workflow_versions') IS NOT NULL AS versions,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'nexus_workflows'
          AND column_name = 'webhook_token_hash'
      ) AS webhook_token
  `);
  const row = result.rows[0] as Record<string, unknown>;
  if (![row.workflows, row.credentials, row.schedules, row.versions, row.webhook_token].every((value) => value === true)) {
    throw new Error('O schema Nexus não está completo. Execute npm run db:nexus:migrations:apply.');
  }
}

async function resolveCredential(client: PoolClient, name: string) {
  const result = await client.query(
    `SELECT id, credential_type
     FROM public.nexus_credentials
     WHERE workspace_id = $1
       AND lower(name) = lower($2)
     LIMIT 2`,
    [WORKSPACE.id, name],
  );
  if (result.rows.length > 1) throw new Error(`Existe mais de uma credencial com o nome "${name}".`);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const type = String(row.credential_type) as NexusCredentialType;
  if (type !== 'api_key') {
    throw new Error(`A credencial "${name}" precisa ser do tipo api_key para enviar Authorization: Bot ao Discord.`);
  }
  const id = String(row.id);
  const credential = await loadNexusCredentialPayload({
    workspaceId: WORKSPACE.id,
    credentialId: id,
    allowedTypes: ['api_key'],
  });
  const headerName = String(credential.payload.name || '').trim().toLowerCase();
  const placement = String(credential.payload.placement || 'header').trim().toLowerCase();
  const value = String(credential.payload.value || '');
  if (headerName !== 'authorization' || placement !== 'header' || !/^Bot\s+\S+/i.test(value)) {
    throw new Error(`A credencial "${name}" deve usar o header Authorization, placement header e valor no formato Bot <token>.`);
  }
  return id;
}

async function resolveWorkflowId(client: PoolClient) {
  const existing = await client.query(
    `SELECT id, workspace_id
     FROM public.nexus_workflows
     WHERE workspace_id = $1
       AND draft_definition #>> '{metadata,profile}' = $2
     ORDER BY updated_at DESC`,
    [WORKSPACE.id, VELPRO_FINAL_PROFILE],
  );
  if (existing.rows.length > 1) throw new Error('Há mais de um rascunho com o perfil Velpro Final; recusei escolher de forma ambígua.');
  if (existing.rows[0]) return String(existing.rows[0].id);
  return deterministicUuid(`${WORKSPACE.id}:${VELPRO_FINAL_PROFILE}`);
}

function modelConfiguration(model: string): ModelConfiguration {
  return {
    provider: getAiModelRuntimeProvider(model),
    model,
    temperature: 0.21,
    maxOutputTokens: 4_096,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    timeoutMs: 60_000,
    maxRetries: 2,
  };
}

async function resolveBindings(client: PoolClient, discordCredentialName: string): Promise<{
  workflowId: string;
  bindings: VelproFinalBindings;
  discordCredentialReady: boolean;
}> {
  const workspace = await client.query(
    `SELECT id, name, owner_id, timezone FROM public.workspaces WHERE id = $1 LIMIT 1`,
    [WORKSPACE.id],
  );
  const row = workspace.rows[0] as Record<string, unknown> | undefined;
  if (
    !row
    || String(row.name) !== WORKSPACE.name
    || String(row.owner_id) !== WORKSPACE.ownerId
    || String(row.timezone) !== WORKSPACE.timezone
  ) {
    throw new Error('A workspace operacional da Velpro não corresponde ao vínculo aprovado.');
  }

  const teamRows = await client.query(
    `SELECT id, name FROM public.teams WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [WORKSPACE.id, Object.values(TEAM_BINDINGS).map((team) => team.id)],
  );
  const teams = new Map(teamRows.rows.map((team: Record<string, unknown>) => [String(team.id), String(team.name)]));
  for (const team of Object.values(TEAM_BINDINGS)) {
    if (teams.get(team.id) !== team.name) throw new Error(`A equipe Velpro esperada "${team.name}" não foi encontrada.`);
  }

  const tagRows = await client.query(
    `SELECT id, label FROM public.tags WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [WORKSPACE.id, Object.values(TAG_BINDINGS).map((tag) => tag.id)],
  );
  const tags = new Map(tagRows.rows.map((tag: Record<string, unknown>) => [String(tag.id), String(tag.label)]));
  for (const tag of Object.values(TAG_BINDINGS)) {
    if (tags.get(tag.id) !== tag.label) throw new Error(`A etiqueta Velpro esperada "${tag.label}" não foi encontrada.`);
  }

  const raquel = await client.query(
    `SELECT id, name, is_active, knowledge_base_documents
     FROM public.autopilot_configs
     WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
    [WORKSPACE.id, RAQUEL_CONFIG_ID],
  );
  const raquelRow = raquel.rows[0] as Record<string, unknown> | undefined;
  if (!raquelRow || String(raquelRow.name) !== 'Raquel' || raquelRow.is_active !== true) {
    throw new Error('A configuração ativa da Raquel não foi encontrada na workspace Velpro.');
  }
  const documents = new Map(parseDocumentArray(raquelRow.knowledge_base_documents).map((document) => [String(document.id), document]));
  for (const documentId of KNOWLEDGE_DOCUMENT_IDS) {
    const document = documents.get(documentId);
    if (!document || ['archived', 'expired'].includes(String(document.status || ''))) {
      throw new Error(`O documento comercial ${documentId} não está disponível para a Raquel.`);
    }
  }

  const sender = await client.query(
    `SELECT id, name, is_active
     FROM public.system_agents
     WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
    [WORKSPACE.id, VELPRO_SENDER_SYSTEM_AGENT.id],
  );
  const senderRow = sender.rows[0] as Record<string, unknown> | undefined;
  if (!senderRow || String(senderRow.name) !== VELPRO_SENDER_SYSTEM_AGENT.name || senderRow.is_active !== true) {
    throw new Error('O agente remetente ativo Velpro não foi encontrado na workspace Velpro.');
  }

  const instance = await client.query(
    `SELECT instance_name FROM public.evolution_api_instances
     WHERE workspace_id = $1 AND instance_name = 'zap1' LIMIT 1`,
    [WORKSPACE.id],
  );
  if (!instance.rows[0]) throw new Error('A instância WhatsApp operacional zap1 não foi encontrada.');

  const configuredModels = await listWorkspaceConfiguredAiModels(WORKSPACE.id);
  if (!configuredModels.some((model) => model.id === PREFERRED_MODEL)) {
    throw new Error(`O modelo ${PREFERRED_MODEL} não está configurado na workspace Velpro.`);
  }
  const discordCredentialId = await resolveCredential(client, discordCredentialName);
  const workflowId = await resolveWorkflowId(client);
  return {
    workflowId,
    discordCredentialReady: Boolean(discordCredentialId),
    bindings: {
      workspaceId: WORKSPACE.id,
      workflowId,
      raquelConfigId: RAQUEL_CONFIG_ID,
      senderSystemAgentId: VELPRO_SENDER_SYSTEM_AGENT.id,
      model: modelConfiguration(PREFERRED_MODEL),
      instanceNames: ['zap1'],
      teamIds: {
        commercial: TEAM_BINDINGS.commercial.id,
        finance: TEAM_BINDINGS.finance.id,
        support: TEAM_BINDINGS.support.id,
      },
      tagIds: {
        commercial: TAG_BINDINGS.commercial.id,
        finance: TAG_BINDINGS.finance.id,
        support: TAG_BINDINGS.support.id,
        secondCopy: TAG_BINDINGS.secondCopy.id,
        closeReason: TAG_BINDINGS.closeReason.id,
      },
      knowledgeDocumentIds: [...KNOWLEDGE_DOCUMENT_IDS],
      discordCredentialId: discordCredentialId || undefined,
    },
  };
}

function workflowContentSignature(definition: ReturnType<typeof WorkflowDefinitionSchema.parse>) {
  return stableStringify({ ...definition, createdAt: undefined, updatedAt: undefined });
}

async function recordVersion(input: {
  client: PoolClient;
  workflowId: string;
  definition: ReturnType<typeof WorkflowDefinitionSchema.parse>;
  source: 'import' | 'publish';
  description: string;
  publishedRevision?: number;
}) {
  await input.client.query(
    `INSERT INTO public.nexus_workflow_versions (
       nexus_workflow_id, workspace_id, revision, published_revision,
       definition, description, source, created_by
     )
     SELECT $1, $2, COALESCE(MAX(revision), 0) + 1, $3, $4::jsonb, $5, $6, $7
     FROM public.nexus_workflow_versions
     WHERE nexus_workflow_id = $1`,
    [
      input.workflowId,
      WORKSPACE.id,
      input.publishedRevision || null,
      JSON.stringify(input.definition),
      input.description,
      input.source,
      WORKSPACE.ownerId,
    ],
  );
}

async function upsertDraft(client: PoolClient, workflowId: string, definition: ReturnType<typeof WorkflowDefinitionSchema.parse>) {
  const conflict = await client.query(
    `SELECT workspace_id, status, draft_definition, draft_definition #>> '{metadata,profile}' AS profile
     FROM public.nexus_workflows WHERE id = $1 FOR UPDATE`,
    [workflowId],
  );
  if (conflict.rows[0] && (
    String(conflict.rows[0].workspace_id) !== WORKSPACE.id
    || String(conflict.rows[0].profile) !== VELPRO_FINAL_PROFILE
  )) {
    throw new Error('O ID determinístico do fluxo já pertence a outro registro; nenhuma alteração foi feita.');
  }
  const currentDefinition = conflict.rows[0]
    ? WorkflowDefinitionSchema.parse(parseJson(conflict.rows[0].draft_definition))
    : null;
  const changed = !currentDefinition
    || workflowContentSignature(currentDefinition) !== workflowContentSignature(definition);
  const storedDefinition = currentDefinition
    ? WorkflowDefinitionSchema.parse({
        ...definition,
        createdAt: currentDefinition.createdAt,
        updatedAt: changed ? definition.updatedAt : currentDefinition.updatedAt,
      })
    : definition;
  if (!changed && conflict.rows[0]) {
    if (String(conflict.rows[0].status) === 'archived') {
      await client.query(
        `UPDATE public.nexus_workflows
         SET status = 'draft', updated_at = timezone('utc', now())
         WHERE id = $1 AND workspace_id = $2`,
        [workflowId, WORKSPACE.id],
      );
    }
    return { changed: false, definition: storedDefinition };
  }
  await client.query(
    `INSERT INTO public.nexus_workflows
       (id, workspace_id, created_by, name, description, status, draft_definition)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       draft_definition = EXCLUDED.draft_definition,
       status = CASE WHEN nexus_workflows.status = 'archived' THEN 'draft' ELSE nexus_workflows.status END,
       updated_at = timezone('utc', now())`,
    [
      workflowId,
      WORKSPACE.id,
      WORKSPACE.ownerId,
      definition.name,
      'Migração nativa e sanitizada do Fluxo Velpro Final, sem histórico de conversas nem segredos legados.',
      JSON.stringify(storedDefinition),
    ],
  );
  if (changed) {
    await recordVersion({
      client,
      workflowId,
      definition: storedDefinition,
      source: 'import',
      description: 'Fluxo Velpro Final importado e vinculado aos recursos nativos da Dialogy.',
    });
  }
  return { changed, definition: storedDefinition };
}

async function publish(client: PoolClient, workflowId: string, draft: ReturnType<typeof WorkflowDefinitionSchema.parse>) {
  const [credentialBindings, dialogyBindings] = await Promise.all([
    validateNexusWorkflowCredentialBindings({
      workspaceId: WORKSPACE.id,
      definition: draft,
      database: client,
    }),
    validateNexusWorkflowDialogyBindings({
      workspaceId: WORKSPACE.id,
      definition: draft,
      database: client,
    }),
  ]);
  if (!credentialBindings.valid) {
    throw new Error('A publicação foi bloqueada porque a credencial segura do Discord ainda não está vinculada.');
  }
  if (!dialogyBindings.valid) {
    throw new Error(dialogyBindings.issues.map((issue) => issue.message).join(' '));
  }
  const row = await client.query(
    `SELECT published_revision FROM public.nexus_workflows
     WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [workflowId, WORKSPACE.id],
  );
  if (!row.rows[0]) throw new Error('O fluxo Velpro não foi encontrado para publicação.');
  const revision = Number(row.rows[0].published_revision || 0) + 1;
  const timestamp = new Date().toISOString();
  const published = WorkflowDefinitionSchema.parse({
    ...draft,
    version: `v${revision}`,
    status: 'published',
    updatedAt: timestamp,
  });
  await new PostgresWorkflowPersistence(client).saveWorkflowDefinition(published);
  await client.query(
    `UPDATE public.nexus_workflows
     SET status = 'published',
         published_workflow_id = $3,
         published_workflow_version = $4,
         published_revision = $5,
         published_at = $6,
         updated_at = timezone('utc', now())
     WHERE id = $1 AND workspace_id = $2`,
    [workflowId, WORKSPACE.id, published.id, published.version, revision, timestamp],
  );
  // A partir da publicacao, o proprio Dialogy executa o fluxo. Manter o
  // webhook legado no mesmo agente faria cada entrada passar pelos dois
  // motores e duplicaria as respostas.
  const detachedLegacyWebhook = await client.query(
    `UPDATE public.system_agents
     SET webhook_url = NULL
     WHERE id = $1
       AND workspace_id = $2
       AND name = $3
     RETURNING id`,
    [VELPRO_SENDER_SYSTEM_AGENT.id, WORKSPACE.id, VELPRO_SENDER_SYSTEM_AGENT.name],
  );
  if (detachedLegacyWebhook.rowCount !== 1) {
    throw new Error('Nao foi possivel desvincular o webhook legado do agente remetente Velpro.');
  }
  await recordVersion({
    client,
    workflowId,
    definition: published,
    source: 'publish',
    description: `Velpro Final publicada como revisão operacional ${revision}.`,
    publishedRevision: revision,
  });
  return revision;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente.');
  if (PUBLISH && !APPLY) throw new Error('--publish exige --apply.');
  const sourcePath = resolve(argument('source', DEFAULT_SOURCE));
  const discordCredentialName = argument('discord-credential-name', DEFAULT_DISCORD_CREDENTIAL_NAME);
  let sourceText = await readFile(sourcePath, 'utf8');
  if (sourceText.charCodeAt(0) === 0xfeff) sourceText = sourceText.slice(1);
  const rawLegacyFlow = parseJson(sourceText);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  try {
    await assertNexusSchema(client);
    const resolved = await resolveBindings(client, discordCredentialName);
    const built = buildVelproFinalWorkflow({ rawLegacyFlow, bindings: resolved.bindings });
    const dialogyBindings = await validateNexusWorkflowDialogyBindings({
      workspaceId: WORKSPACE.id,
      definition: built.workflow,
      database: client,
    });
    const history = await client.query(
      `SELECT COUNT(*)::integer AS total
       FROM public.nexus_workflow_versions
       WHERE nexus_workflow_id = $1 AND workspace_id = $2`,
      [resolved.workflowId, WORKSPACE.id],
    );
    console.log('VALIDAÇÃO:', JSON.stringify({
      workspaceId: WORKSPACE.id,
      workflowId: resolved.workflowId,
      profile: VELPRO_FINAL_PROFILE,
      nodes: built.workflow.nodes.length,
      connections: built.workflow.connections.length,
      valid: built.validation.valid,
      warnings: built.validation.warnings.length,
      sourceSha256: built.sourceHash,
      dialogyBindingsValid: dialogyBindings.valid,
      dialogyBindingIssues: dialogyBindings.issues.length,
      discordCredentialReady: resolved.discordCredentialReady,
      versionHistoryEntries: Number(history.rows[0]?.total || 0),
      publicationRequested: PUBLISH,
    }, null, 2));

    if (!dialogyBindings.valid) {
      throw new Error(dialogyBindings.issues.map((issue) => issue.message).join(' '));
    }

    if (!APPLY) {
      console.log('Modo verificação. Rode com --apply para gravar o rascunho idempotente.');
      return;
    }

    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('dialogy:velpro-final-nexus'))");
    const draft = await upsertDraft(client, resolved.workflowId, built.workflow);
    const revision = PUBLISH ? await publish(client, resolved.workflowId, draft.definition) : null;
    await client.query('COMMIT');
    console.log(JSON.stringify({
      success: true,
      workflowId: resolved.workflowId,
      workspaceId: WORKSPACE.id,
      status: revision ? 'published' : 'draft',
      revision,
      draftChanged: draft.changed,
      discordCredentialReady: resolved.discordCredentialReady,
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await Promise.all([pool.end(), db.end()]);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
