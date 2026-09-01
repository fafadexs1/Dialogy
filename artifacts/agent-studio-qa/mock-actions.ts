import type { AgentStudioDocument } from '../../src/services/agent-studio/types';
import { McpToolStepConfigSchema } from '../../src/services/agent-studio/types';
import { buildStudioMcpArguments, mapStudioOutputs } from '../../src/services/agent-studio/data-mapping';
import { validateSchema } from 'genkit/schema';
let saved: AgentStudioDocument | null = null;
let published: AgentStudioDocument | null = null;
export async function saveAgentStudioDraftAction(_id: string, document: AgentStudioDocument) { saved = { ...document, draftRevision: (document.draftRevision || 0) + 1 }; return { success: true, document: saved }; }
export async function publishAgentStudioAction(id: string, document: AgentStudioDocument) { const result = await saveAgentStudioDraftAction(id, document); published = { ...result.document, publishedVersion: 1, status: 'published' }; return { success: true, document: published, publishedVersion: 1 }; }
export async function listStudioResourcesAction() { return { success: true, teams: [{ id: 'support', name: 'Suporte' }], tags: [{ id: 'customer', name: 'Cliente' }], fields: [{ id: 'email', name: 'E-mail', type: 'text' }] }; }
export async function listAgentApiConnectionsAction() { return { success: true, connections: [] }; }
export async function listAgentMcpServersAction() { return { success: true, servers: [{ id: 'qa', name: 'ERP fictício', isActive: true, tools: [{ name: 'get_invoice', title: 'Consultar fatura', qualifiedName: 'mcp:qa:get_invoice', serverId: 'qa', serverName: 'ERP fictício', inputSchema: { type: 'object', required: ['cpf'], properties: { cpf: { type: 'string', title: 'CPF do cliente' } } }, annotations: { readOnlyHint: true } }] }] }; }
export async function getStudioResultsAction(_id?: string, periodDays = 30) { return { success: true, periodDays, sessions: [], averageResolutionSeconds: null, procedures: [], recent: [], releases: published ? [{ id: '00000000-0000-4000-8000-000000000003', version: 1, createdAt: new Date().toISOString() }] : [] }; }
export async function getStudioVersionForDraftAction() { return { success: true, document: published }; }
export async function importStudioKnowledgeFileAction() { return { success: false as const, error: 'Upload de arquivo bloqueado no teste isolado.' }; }
export async function rollbackAgentStudioToLegacyAction() { return { success: false as const, error: 'Rollback bloqueado no teste isolado.' }; }
export async function revokeAgentStudioReleaseAction() { return { success: false as const, error: 'Revogação bloqueada no teste isolado.' }; }
export async function reviewStudioOutcomeAction() { return { success: false as const, error: 'Revisão bloqueada no teste isolado.' }; }
export async function testHttpRequestAction() { return { success: false, error: 'Ações de rede bloqueadas no teste isolado.' }; }
export const testMcpToolAction = testHttpRequestAction;
export async function validateStudioMcpSimulationAction(_agentId: string, stepInput: unknown, context: any, sample: unknown) {
  try {
    const step = McpToolStepConfigSchema.parse(stepInput);
    const inputSchema = { type: 'object', required: ['cpf'], properties: { cpf: { type: 'string' } } };
    const outputSchema = { type: 'object', required: ['invoice_url'], properties: { invoice_url: { type: 'string' } } };
    const args = buildStudioMcpArguments(step, { values: context?.values || {}, contact: context?.contact || {}, input: context?.input || {} });
    if (!validateSchema(args, { jsonSchema: inputSchema }).valid) throw new Error('Os dados de entrada simulados não correspondem ao contrato MCP.');
    if (!validateSchema(sample, { jsonSchema: outputSchema }).valid) throw new Error('A resposta fictícia não corresponde ao contrato de saída MCP.');
    return { success: true as const, values: mapStudioOutputs(sample, step.outputMappings) };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'A simulação não pôde ser validada.' }; }
}
export const saveAgentApiConnectionAction = testHttpRequestAction;
export const upsertMcpServerAction = testHttpRequestAction;
export const syncMcpServerToolsAction = testHttpRequestAction;
export const testMcpServerConnectionAction = testHttpRequestAction;
