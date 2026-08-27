import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import type { WorkflowDefinition } from '@/services/workflow-runtime/types';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';

import { bindStandaloneNexusWorkflow } from './standalone-workflows';

export const NEXUS_PORTABLE_FLOW_FORMAT = 'dialogy.nexus.workflow';
export const NEXUS_PORTABLE_FLOW_VERSION = 1;

export type NexusPortableFlow = {
  format: typeof NEXUS_PORTABLE_FLOW_FORMAT;
  formatVersion: typeof NEXUS_PORTABLE_FLOW_VERSION;
  exportedAt: string;
  definition: WorkflowDefinition;
};

export function createNexusPortableFlow(definition: WorkflowDefinition, now = new Date().toISOString()): NexusPortableFlow {
  return {
    format: NEXUS_PORTABLE_FLOW_FORMAT,
    formatVersion: NEXUS_PORTABLE_FLOW_VERSION,
    exportedAt: now,
    definition: WorkflowDefinitionSchema.parse(definition),
  };
}

export function serializeNexusPortableFlow(definition: WorkflowDefinition, now?: string) {
  return JSON.stringify(createNexusPortableFlow(definition, now), null, 2);
}

export function parseNexusPortableFlow(raw: unknown): WorkflowDefinition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.format === NEXUS_PORTABLE_FLOW_FORMAT) {
    if (record.formatVersion !== NEXUS_PORTABLE_FLOW_VERSION) {
      throw new Error(`Esta exportação usa a versão ${String(record.formatVersion)}; a Dialogy aceita a versão ${NEXUS_PORTABLE_FLOW_VERSION}.`);
    }
    return WorkflowDefinitionSchema.parse(record.definition);
  }
  const direct = WorkflowDefinitionSchema.safeParse(raw);
  return direct.success ? direct.data : null;
}

export function importNexusPortableFlow(input: {
  raw: unknown;
  workflowId: string;
  workspaceId: string;
  name?: string;
  now?: string;
}) {
  const source = parseNexusPortableFlow(input.raw);
  if (!source) return null;
  const workflow = bindStandaloneNexusWorkflow({
    definition: source,
    id: input.workflowId,
    workspaceId: input.workspaceId,
    name: input.name || source.name,
    now: input.now,
  });
  return {
    workflow,
    validation: validateWorkflowDefinition(workflow),
  };
}

export function nexusPortableFilename(name: string) {
  const safeName = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'fluxo';
  return `${safeName}.dialogy-nexus.json`;
}
