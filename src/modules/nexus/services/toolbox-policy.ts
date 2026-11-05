import type { WorkflowDefinition } from '@/services/workflow-runtime/types';
import { toolboxManifests } from '@/services/workflow-runtime/toolbox-catalog';
const toolboxTypes = new Set(toolboxManifests().map(manifest => manifest.type));
export function usesAutomationToolbox(workflow: WorkflowDefinition) {
  return workflow.nodes.some(node => toolboxTypes.has(node.type)
    || (node.type === 'logic.wait' && (node.config.pauseTimeoutWhileWaiting === true || node.config.expireEvents === true || node.config.mode === 'message'))
    || (['integration.http_request', 'tool.http'].includes(node.type) && ((node.config.responseFormat !== undefined && node.config.responseFormat !== 'legacy') || node.config.approvalPolicy === 'required')));
}
export function isAutomationToolboxEnabled(workspaceId: string): boolean {
  const configured = (process.env.NEXUS_AUTOMATION_WORKSPACES || '').split(',').map(value => value.trim()).filter(Boolean);
  return configured.includes('all') || configured.includes(workspaceId) || (process.env.NODE_ENV !== 'production' && configured.length === 0);
}
export function assertAutomationToolboxEnabled(workspaceId: string) {
  if (!isAutomationToolboxEnabled(workspaceId)) throw new Error('As ferramentas avançadas ainda não foram habilitadas neste workspace.');
}
