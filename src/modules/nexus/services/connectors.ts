import 'server-only';
import { randomUUID } from 'node:crypto';
import { validateSchema } from 'genkit/schema';
import { db } from '@/lib/db';
import { ConnectorDefinitionSchema, type ConnectorDefinition } from '@/services/workflow-runtime/connector-contract';
import { isRecord, materializeValue, statePatchAtPath } from '@/services/workflow-runtime/utils';
import type { NodeExecutionResult, NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { encryptPayload, decryptPayload } from './credentials';
import { requestAutomationApproval } from './automation-approvals';
import { executeDurableEffect, nodeInvocationKey } from './durable-effects';
import { buildGmailReply } from './gmail-reply';
import { executeNexusHttpOperation } from './http-executor';
import { toolboxSource } from './runtime-source';
import { assertAutomationToolboxEnabled } from './toolbox-policy';
import { extractGmailText } from './gmail-message';
import { WorkflowFileReferenceSchema } from '@/services/workflow-runtime/file-reference';
import { loadWorkflowFile } from './workflow-files';

export async function loadConnector(workspaceId: string, id: string, version: number): Promise<ConnectorDefinition> {
  assertAutomationToolboxEnabled(workspaceId);
  const { rows } = await db.query(`SELECT encrypted_definition FROM nexus_connectors WHERE workspace_id=$1 AND id=$2 AND version=$3 AND status='published'`, [workspaceId, id, version]);
  if (!rows[0]) throw new Error('A versão do conector não está publicada ou foi revogada.');
  return ConnectorDefinitionSchema.parse(decryptPayload(String(rows[0].encrypted_definition)));
}
export async function saveConnectorDraft(workspaceId: string, userId: string, value: unknown, connectorId?: string) {
  const definition = ConnectorDefinitionSchema.parse(value);
  const id = connectorId || randomUUID();
  const result = await db.query(`INSERT INTO nexus_connectors(id,version,workspace_id,name,encrypted_definition,created_by)
    SELECT $1,COALESCE(max(version),0)+1,$2,$3,$4,$5 FROM nexus_connectors WHERE workspace_id=$2 AND id=$1 RETURNING id,version`, [id, workspaceId, definition.name, encryptPayload(definition), userId]);
  return { id: String(result.rows[0].id), version: Number(result.rows[0].version) };
}
export async function publishConnector(workspaceId: string, id: string, version: number) {
  const row = (await db.query(`SELECT encrypted_definition FROM nexus_connectors WHERE workspace_id=$1 AND id=$2 AND version=$3 AND status='draft'`, [workspaceId, id, version])).rows[0];
  if (!row) throw new Error('Rascunho indisponível.');
  const definition = ConnectorDefinitionSchema.parse(decryptPayload(String(row.encrypted_definition)));
  const hostname = new URL(definition.http.url).hostname;
  if (hostname === 'your-domain.atlassian.net') throw new Error('Substitua your-domain pelo endereço do seu site Jira antes de publicar.');
  if (hostname.endsWith('.invalid') || ['your-store.myshopify.com', 'your-domain.my.salesforce.com'].includes(hostname)) throw new Error('Substitua o domínio de exemplo pelo endereço real do serviço antes de publicar.');
  if (Object.entries(definition.http.headers).some(([name,value]) => name.toLowerCase() === 'user-agent' && String(value).includes('example.invalid'))) throw new Error('Configure o contato real do aplicativo no User-Agent antes de publicar.');
  if (['api.tiendanube.com','api.nuvemshop.com.br'].includes(hostname)) {
    const agent = String(Object.entries(definition.http.headers).find(([name]) => name.toLowerCase() === 'user-agent')?.[1] || '');
    if (!/(?:https?:\/\/\S+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.test(agent)) throw new Error('Informe o nome do aplicativo e um contato no User-Agent da Nuvemshop.');
  }
  if (definition.http.credentialRequired && !definition.http.credentialId) throw new Error('Vincule uma credencial antes de publicar.');
  if (definition.http.credentialId) {
    const credential = await (await import('./credentials')).loadNexusCredentialPayload({ workspaceId, credentialId: definition.http.credentialId, allowedTypes: ['api_key', 'bearer', 'basic', 'oauth2'] });
    const endpoint = new URL(definition.http.url);
    if (endpoint.hostname.endsWith('.myshopify.com') && (credential.type !== 'api_key' || String(credential.payload.name || '').toLowerCase() !== 'x-shopify-access-token' || credential.payload.placement === 'query')) throw new Error('Shopify exige token no cabeçalho X-Shopify-Access-Token.');
    if (endpoint.origin === 'https://api.hubapi.com' && !['bearer','oauth2'].includes(credential.type)) throw new Error('HubSpot exige uma credencial Bearer autorizada.');
    if (['api.tiendanube.com','api.nuvemshop.com.br'].includes(endpoint.hostname) && credential.type !== 'bearer') throw new Error('Nuvemshop exige o token Bearer da instalação da loja.');
    if (endpoint.origin === 'https://api.pipedrive.com' && !['bearer','oauth2'].includes(credential.type) && !(credential.type === 'api_key' && String(credential.payload.name || '').toLowerCase() === 'x-api-token' && credential.payload.placement !== 'query')) throw new Error('Pipedrive exige OAuth Bearer ou x-api-token no cabeçalho.');
    const allowedOrigin = credential.metadata?.allowedOrigin || (credential.type === 'oauth2' ? credential.payload.allowedOrigin : undefined);
    if (allowedOrigin && allowedOrigin !== endpoint.origin) throw new Error('A credencial não autoriza a origem deste conector.');
    if (endpoint.origin === 'https://graph.microsoft.com' && endpoint.pathname.startsWith('/v1.0/me/') && credential.type === 'oauth2' && credential.payload.grantType === 'client_credentials') throw new Error('Operações Microsoft /me exigem credencial delegada de um usuário.');
    const provider = String(credential.metadata?.provider || '');
    const readPost = definition.http.method === 'POST' && ((provider === 'notion' && endpoint.origin === 'https://api.notion.com' && endpoint.pathname === '/v1/search') || (provider === 'google_workspace' && credential.metadata?.app === 'calendar' && endpoint.origin === 'https://www.googleapis.com' && endpoint.pathname === '/calendar/v3/freeBusy'));
    if (['google_workspace','notion','github'].includes(provider) && credential.metadata?.access === 'read' && !['GET','HEAD'].includes(definition.http.method) && !readPost) throw new Error('A credencial selecionada permite apenas leitura.');
  }
  await db.query(`UPDATE nexus_connectors SET status='published' WHERE workspace_id=$1 AND id=$2 AND version=$3 AND status='draft'`, [workspaceId, id, version]);
}

export async function executeConnectorStep(input: NodeRuntimeInput, fixedInvocationId?: string, resolvedArguments?: Record<string, unknown>): Promise<NodeExecutionResult> {
  const workspaceId = input.workflow.workspaceId!;
  const definition = await loadConnector(workspaceId, String(input.node.config.connectorId || ''), Number(input.node.config.version));
  const args = resolvedArguments || materializeValue(input.node.config.arguments || {}, toolboxSource(input));
  if (!isRecord(args)) throw new Error('Os argumentos do conector precisam ser um objeto.');
  try { if (!validateSchema(args, { jsonSchema: definition.inputSchema }).valid) throw new Error('invalid'); } catch { throw new Error('Os argumentos não atendem ao contrato publicado do conector.'); }
  if (definition.http.bodyType === 'binary') {
    const supplied = WorkflowFileReferenceSchema.parse(materializeValue(definition.http.body, { arguments: args, current: args }));
    const actual = (await loadWorkflowFile(workspaceId, supplied)).file;
    if (actual.id !== supplied.id || actual.name !== supplied.name || actual.mimeType !== supplied.mimeType || actual.size !== supplied.size) throw new Error('Os dados do arquivo informado não correspondem ao arquivo privado.');
  }
  if (definition.approval === 'required' || input.node.config.requiresConfirmation === true) {
    const approval = await requestAutomationApproval(input, { connectorId: input.node.config.connectorId, version: input.node.config.version, arguments: args, operation: definition.http.method, url: definition.http.url }, definition.name, fixedInvocationId);
    if (approval) return approval.status === 'route' ? { status: 'error', error: { code: 'CONNECTOR_APPROVAL_DENIED', message: 'A operação foi recusada ou sua aprovação expirou.', retryable: false }, output: approval.output } : approval;
  }
  const response = await executeDurableEffect(workspaceId, fixedInvocationId || nodeInvocationKey(input), { definition, args }, async () => {
    const config = definition.http.bodyTransform === 'gmail_reply' ? { ...definition.http, bodyType: 'json', body: buildGmailReply(args) } : definition.http;
    const result = await executeNexusHttpOperation({ workspaceId, config, runtimeSource: { arguments: args, current: args }, signal: input.signal });
    if (definition.http.method === 'GET' && definition.http.url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages/') && isRecord(result.selected)) {
      const text = extractGmailText(result.selected);
      if (text) result.selected = { ...result.selected, decodedText: text };
    }
    try { if (!validateSchema(result, { jsonSchema: definition.outputSchema }).valid) throw new Error('invalid'); } catch { throw new Error('A resposta não atende ao contrato publicado. Confira o resultado externo antes de repetir.'); }
    return result;
  });
  return { status: 'success', selectedOutput: 'success', output: response, statePatch: statePatchAtPath(String(input.node.config.outputKey || 'connector'), response.selected), metrics: { durationMs: 0, toolCalls: 1 } };
}
