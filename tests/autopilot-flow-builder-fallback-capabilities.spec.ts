import { describe, expect, it } from 'vitest';

import { buildDeterministicFallbackProposal } from '@/ai/flows/autopilot-flow-builder';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { auditAutopilotFlowGraph } from '@/services/autopilot/flow-audit';

type CapabilityFixture = {
  title: string;
  request: string;
  toolName: string;
  description: string;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
  unrelatedToolName: string;
  unrelatedDescription: string;
};

function actionTool(
  name: string,
  description: string,
  required: string[],
  properties: Record<string, Record<string, unknown>>,
): AgentToolCatalogItem {
  return {
    name: name as AgentToolCatalogItem['name'],
    version: 'mcp',
    description,
    class: 'write_non_idempotent',
    riskLevel: 'high',
    sideEffect: 'high',
    idempotent: false,
    timeoutMs: 12000,
    maxAttempts: 1,
    requiresHumanApproval: true,
    customerVisible: true,
    allowedIntents: ['change_request', 'scheduling_request', 'cancellation_request'],
    requiredSlots: [],
    fallbackAction: 'handoff',
    source: 'mcp',
    enabledByDefault: false,
    serverId: name.split(':')[1],
    serverName: `${name.split(':')[1]} MCP`,
    inputSchema: {
      type: 'object',
      required,
      properties,
    },
  };
}

const fixtures: CapabilityFixture[] = [
  {
    title: 'Seguro',
    request: 'Crie um fluxo para aprovar um sinistro de seguro com numero e motivo da aprovacao.',
    toolName: 'mcp:insurance:approve_claim',
    description: 'Aprova um sinistro de seguro usando claim_id e approval_reason.',
    required: ['claim_id', 'approval_reason'],
    properties: {
      claim_id: { type: 'string', title: 'Numero do sinistro' },
      approval_reason: { type: 'string', title: 'Motivo da aprovacao' },
    },
    unrelatedToolName: 'mcp:commerce:cancel_order',
    unrelatedDescription: 'Cancela um pedido de comercio pelo order_id.',
  },
  {
    title: 'Hotelaria',
    request: 'Crie um fluxo para reservar uma mesa no restaurante com data, horario e quantidade de pessoas.',
    toolName: 'mcp:hospitality:reserve_table',
    description: 'Reserva uma mesa do restaurante para data, horario e party_size.',
    required: ['date', 'time', 'party_size'],
    properties: {
      date: { type: 'string', format: 'date', title: 'Data da reserva' },
      time: { type: 'string', format: 'time', title: 'Horario da reserva' },
      party_size: { type: 'integer', title: 'Quantidade de pessoas' },
    },
    unrelatedToolName: 'mcp:clinic:book_appointment',
    unrelatedDescription: 'Agenda uma consulta medica para um paciente.',
  },
  {
    title: 'Educacao',
    request: 'Crie um fluxo para emitir o certificado do aluno pelo student_id e course_id.',
    toolName: 'mcp:education:issue_certificate',
    description: 'Emite certificado de conclusao do aluno usando student_id e course_id.',
    required: ['student_id', 'course_id'],
    properties: {
      student_id: { type: 'string', title: 'Matricula do aluno' },
      course_id: { type: 'string', title: 'Codigo do curso' },
    },
    unrelatedToolName: 'mcp:billing:issue_invoice',
    unrelatedDescription: 'Emite uma fatura financeira pelo invoice_id.',
  },
  {
    title: 'Assinaturas',
    request: 'Crie um fluxo para cancelar uma assinatura usando subscription_id e motivo.',
    toolName: 'mcp:subscriptions:cancel_subscription',
    description: 'Cancela uma assinatura pelo subscription_id e cancellation_reason.',
    required: ['subscription_id', 'cancellation_reason'],
    properties: {
      subscription_id: { type: 'string', title: 'Codigo da assinatura' },
      cancellation_reason: { type: 'string', title: 'Motivo do cancelamento' },
    },
    unrelatedToolName: 'mcp:commerce:cancel_order',
    unrelatedDescription: 'Cancela um pedido de compra pelo order_id.',
  },
];

describe('Flowbuilder deterministic fallback capabilities', () => {
  it.each(fixtures)('builds a complete schema-driven $title action branch', (fixture) => {
    const selectedTool = actionTool(
      fixture.toolName,
      fixture.description,
      fixture.required,
      fixture.properties,
    );
    const unrelatedTool = actionTool(
      fixture.unrelatedToolName,
      fixture.unrelatedDescription,
      ['unrelated_id'],
      { unrelated_id: { type: 'string' } },
    );
    const proposal = buildDeterministicFallbackProposal({
      conversation: [{ role: 'user', content: fixture.request }],
      currentSystemPrompt: null,
      tools: [selectedTool, unrelatedTool],
    }, new Error('architecture JSON invalid'));
    const selectedNode = proposal.flowGraph.nodes.find((node) => node.toolName === fixture.toolName);
    const unrelatedNode = proposal.flowGraph.nodes.find((node) => node.toolName === fixture.unrelatedToolName);
    const collect = proposal.flowGraph.nodes.find((node) => (
      node.kind === 'collect' &&
      String(node.subtitle || '').includes(fixture.toolName) &&
      node.config?.formFields?.some((field) => field.fieldKey === fixture.required[0])
    ));
    const confirmation = proposal.flowGraph.nodes.find((node) => (
      node.kind === 'message' &&
      String(node.subtitle || '').includes(fixture.toolName)
    ));
    const decision = proposal.flowGraph.nodes.find((node) => node.kind === 'decision');
    const route = decision?.config?.routes?.find((candidate) => candidate.targetNodeId === collect?.id);
    const agent = proposal.flowGraph.nodes.find((node) => node.kind === 'sub_agent');
    const audit = auditAutopilotFlowGraph(proposal.flowGraph);

    expect(selectedNode).toBeDefined();
    expect(unrelatedNode).toBeUndefined();
    expect(collect?.config?.formFields?.filter((field) => field.required).map((field) => field.fieldKey))
      .toEqual(expect.arrayContaining(fixture.required));
    expect(confirmation).toBeDefined();
    expect(route).toBeDefined();
    expect(proposal.flowGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: decision?.id, target: collect?.id, routeId: route?.id }),
      expect.objectContaining({ source: collect?.id, target: confirmation?.id }),
      expect.objectContaining({ source: confirmation?.id, target: selectedNode?.id }),
      expect.objectContaining({ source: selectedNode?.id, target: agent?.id }),
    ]));
    expect(proposal.enabledToolNames).toContain(fixture.toolName);
    expect(audit.status).toBe('passed');
    expect(audit.issues).toEqual([]);
  });
});
