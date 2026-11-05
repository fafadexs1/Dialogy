import { getSgpIdentificationMessage } from '@/modules/nexus/services/sgp-identification-messages';
import type { WorkflowNode } from '@/services/workflow-runtime/types';

export const WORKFLOW_CARD_HEADER = 88;
export const WORKFLOW_CARD_PREVIEW = 72;
export const WORKFLOW_PORT_ROW = 28;
export const WORKFLOW_CARD_FOOTER = 32;

export function workflowPreviewText(node: WorkflowNode): string | undefined {
  if (node.type === 'whatsapp.send_catalog') return String(node.config.body || '').trim() || undefined;
  if (node.type === 'dialogy.sgp_identify_customer') return getSgpIdentificationMessage(node.config, 'missingDocument');
  for (const key of ['message', 'prompt', 'caption', 'publicMessage', 'template', 'reason']) {
    const value = node.config[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
}

export function workflowVisibleOutputs(node: WorkflowNode) {
  return node.outputPorts.filter((port) => port.connectionType !== 'error' || node.config.customErrorRoute === true);
}

export function workflowNodeGeometry(node: WorkflowNode) {
  const outputs = workflowVisibleOutputs(node);
  const previewHeight = workflowPreviewText(node) ? WORKFLOW_CARD_PREVIEW : 0;
  const rows = Math.max(node.inputPorts.length, outputs.length, 1);
  return {
    width: outputs.length > 1 || node.type === 'interaction.options' ? 336 : 288,
    height: WORKFLOW_CARD_HEADER + previewHeight + rows * WORKFLOW_PORT_ROW + WORKFLOW_CARD_FOOTER,
    portY: (index: number) => WORKFLOW_CARD_HEADER + previewHeight + index * WORKFLOW_PORT_ROW + WORKFLOW_PORT_ROW / 2,
    rows,
  };
}
