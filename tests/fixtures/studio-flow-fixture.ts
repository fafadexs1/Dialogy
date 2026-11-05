import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, type AgentReleaseManifest } from '@/services/agent-studio/types';
import { StudioFlowContractSchema } from '@/services/agent-studio/flow-contract';

export const STUDIO_FLOW_WORKSPACE = '10000000-0000-4000-8000-000000000001';
export const STUDIO_FLOW_AGENT = '10000000-0000-4000-8000-000000000002';
export const STUDIO_FLOW_RELEASE = '10000000-0000-4000-8000-000000000003';
export function studioFlowRelease(): AgentReleaseManifest {
  const document = createDefaultAgentStudioDocument(STUDIO_FLOW_AGENT, STUDIO_FLOW_WORKSPACE, 'Triagem de atendimento');
  document.objective = 'Classificar o pedido e devolver um resumo.';
  document.understandStage.askInitialData = false;
  document.understandStage.initialFields = [];
  document.rules.operatingHoursEnabled = false;
  const procedure = ProcedureDocumentSchema.parse({ id: 'consulta', name: 'Consultar cadastro', status: 'published', updatedAt: '2026-10-23T12:00:00Z', steps: [{ id: 'api', order: 1, type: 'http_request', title: 'Consultar API', httpRequest: { name: 'Cadastro', method: 'GET', url: 'https://example.com/customer', authType: 'none', sentDataMappings: [], outputMappings: [{ jsonPath: 'answer', chipKey: 'answer', chipLabel: 'Resposta' }] } }] });
  document.resolveStage.procedures = [procedure];
  const contract = StudioFlowContractSchema.parse({ enabled: true, modes: ['conversation', 'task'], inputs: [{ key: 'request', label: 'Solicitação', type: 'text' }], outputs: [{ key: 'answer', label: 'Resultado', type: 'text', required: true }], exposedProcedureIds: ['consulta'], extensions: ['model', 'tools', 'knowledge', 'memory'], completionCriteria: 'Devolver o resultado em answer.' });
  document.flowBuilder = contract;
  return { agentId: document.id, workspaceId: document.workspaceId, releaseId: STUDIO_FLOW_RELEASE, version: 1, agentSnapshot: document, publishedProcedures: [procedure], flowContract: contract, runtimeVersion: 'studio-v1', runtimeConfig: { aiModel: 'fixture-model' }, referencedConnectionIds: [], mcpServerToolFingerprints: {}, createdAt: '2026-10-23T12:00:00Z' };
}
