import 'server-only';
import type { WorkflowDefinition } from '@/services/workflow-runtime/types';
import { isRecord } from '@/services/workflow-runtime/utils';
import { loadNexusCredentialPayload } from './credentials';
import { loadConnector } from './connectors';
import { loadPublishedNexusWorkflow } from './runtime';
import { usesAutomationToolbox, assertAutomationToolboxEnabled } from './toolbox-policy';

/** Resolve mutable bindings before publication; runtime also checks them on every invocation. */
export async function validateAutomationBindings(workspaceId: string, definition: WorkflowDefinition) {
  if (usesAutomationToolbox(definition)) assertAutomationToolboxEnabled(workspaceId);
  const cache = new Map<string, WorkflowDefinition>();
  const walk = async (workflow: WorkflowDefinition, stack: string[]) => {
    for (const node of workflow.nodes) {
      if (['integration.connector', 'tool.connector'].includes(node.type)) await loadConnector(workspaceId, String(node.config.connectorId || ''), Number(node.config.version));
      if (node.type === 'trigger.webhook' && node.config.signatureCredentialId) await loadNexusCredentialPayload({ workspaceId, credentialId: String(node.config.signatureCredentialId), allowedTypes: ['api_key'] });
      if (!['logic.map_subflow', 'logic.async_subflow', 'logic.fork_subflows'].includes(node.type)) continue;
      const ids = node.type === 'logic.fork_subflows' && Array.isArray(node.config.branches) ? node.config.branches.filter(isRecord).map(branch => String(branch.workflowId || '')) : [String(node.config.workflowId || '')];
      for (const rawId of ids) {
        const id = rawId.replace(/^nexus:/, '');
        if (stack.includes(id) || stack.length >= 4) throw new Error(`O bloco “${node.name}” cria uma chamada circular ou excede quatro níveis.`);
        if (!cache.has(id)) {
          if (cache.size >= 100) throw new Error('O conjunto de subfluxos excede o limite de validação.');
          const published = await loadPublishedNexusWorkflow({ workspaceId, nexusWorkflowId: id });
          if (!published || !published.workflow.nodes.some(candidate => candidate.type === 'trigger.manual')) throw new Error(`O subfluxo de “${node.name}” precisa estar publicado neste workspace e usar gatilho manual.`);
          cache.set(id, published.workflow);
        }
        await walk(cache.get(id)!, [...stack, id]);
      }
    }
  };
  await walk(definition, [definition.id.replace(/^nexus:/, '')]);
}
