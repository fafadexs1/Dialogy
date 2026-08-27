import { describe, expect, it, vi } from 'vitest';

import {
  loadNexusDialogyResources,
  validateNexusWorkflowDialogyBindingsAgainstResources,
  type NexusDialogyResources,
} from '@/modules/nexus/services/dialogy-resources';
import { createWorkflowNode } from '@/services/workflow-runtime';
import { linearWorkflow } from './workflow-runtime-fixtures';

const resources: NexusDialogyResources = {
  teams: [{ id: 'team-1', label: 'Comercial' }],
  tags: [
    { id: 'tag-1', label: 'Comercial', isCloseReason: false },
    { id: 'close-1', label: 'Sistema', isCloseReason: true },
  ],
  members: [{ id: 'member-1', label: 'Ana' }],
  systemAgents: [{ id: 'sender-1', label: 'Velpro' }],
  intelligentAgents: [{ id: 'ai-1', label: 'Raquel' }],
  instances: [{ id: 'zap1', label: 'zap1' }],
  workflows: [{ id: 'subflow-1', label: 'Consultar cadastro' }],
};

function workflowWithDialogyBindings() {
  const workflow = linearWorkflow();
  workflow.metadata = { senderSystemAgentId: 'sender-1' };
  workflow.nodes.push(
    createWorkflowNode('trigger.received_message', {
      id: 'message-trigger',
      position: { x: 0, y: 0 },
      config: { instanceNames: ['zap1'] },
    }),
    createWorkflowNode('dialogy.team_availability', {
      id: 'availability',
      position: { x: 0, y: 0 },
      config: { teamId: 'team-1' },
    }),
    createWorkflowNode('dialogy.chat_tag', {
      id: 'tag',
      position: { x: 0, y: 0 },
      config: { tagId: 'tag-1' },
    }),
    createWorkflowNode('output.handoff', {
      id: 'human-handoff',
      position: { x: 0, y: 0 },
      config: { destinationType: 'human', teamId: 'team-1', agentId: '' },
    }),
    createWorkflowNode('output.handoff', {
      id: 'member-handoff',
      position: { x: 0, y: 0 },
      config: { destinationType: 'human', teamId: '', agentId: 'member-1' },
    }),
    createWorkflowNode('output.handoff', {
      id: 'ai-handoff',
      position: { x: 0, y: 0 },
      config: { destinationType: 'intelligent_agent', systemAgentId: 'ai-1' },
    }),
    createWorkflowNode('output.close_conversation', {
      id: 'close',
      position: { x: 0, y: 0 },
      config: { reasonTagId: 'close-1' },
    }),
    createWorkflowNode('whatsapp.group_create', {
      id: 'group',
      position: { x: 0, y: 0 },
      config: { instanceName: 'zap1' },
    }),
    createWorkflowNode('whatsapp.send_text', {
      id: 'whatsapp-text',
      position: { x: 0, y: 0 },
      config: { instanceName: 'zap1', phoneNumber: '5511999999999', message: 'Olá' },
    }),
    createWorkflowNode('whatsapp.send_media', {
      id: 'whatsapp-media',
      position: { x: 0, y: 0 },
      config: { instanceName: 'zap1', phoneNumber: '5511999999999', url: 'https://cdn.example.com/fatura.pdf' },
    }),
    createWorkflowNode('dialogy.sgp_second_copy', {
      id: 'second-copy',
      position: { x: 0, y: 0 },
      config: {
        deliveryMode: 'cloud-template',
        pixTemplateInstance: 'zap1',
        boletoTemplateInstance: 'zap1',
      },
    }),
    createWorkflowNode('logic.subflow', {
      id: 'subflow',
      position: { x: 0, y: 0 },
      config: { workflowId: 'subflow-1', inputMapping: {}, inputSchema: {}, outputSchema: {} },
    }),
  );
  return workflow;
}

describe('Nexus Dialogy resource bindings', () => {
  it('loads only native resources from the selected workspace', async () => {
    const database = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'team-1', name: 'Comercial' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'close-1', label: 'Sistema', is_close_reason: true }] })
        .mockResolvedValueOnce({ rows: [{ id: 'member-1', full_name: 'Ana', email: 'ana@example.com' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'ai-1', name: 'Raquel', type: 'intelligent_attendant', autopilot_config_id: 'config-1', autopilot_is_active: true }] })
        .mockResolvedValueOnce({ rows: [{ instance_name: 'zap1', type: 'evolution' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'subflow-1', name: 'Consultar cadastro', published_revision: 2 }] }),
    };

    const result = await loadNexusDialogyResources('workspace-1', database as never);

    expect(database.query).toHaveBeenCalledTimes(6);
    for (const call of database.query.mock.calls) expect(call[1]).toEqual(['workspace-1']);
    expect(result).toEqual({
      teams: [{ id: 'team-1', label: 'Comercial' }],
      tags: [{ id: 'close-1', label: 'Sistema', isCloseReason: true }],
      members: [{ id: 'member-1', label: 'Ana', description: 'ana@example.com' }],
      systemAgents: [{ id: 'ai-1', label: 'Raquel', description: 'Atendente Inteligente · IA ativa', type: 'intelligent_attendant', hasLinkedAi: true, linkedAiActive: true }],
      intelligentAgents: [{ id: 'ai-1', label: 'Raquel', description: 'Atendente Inteligente · IA ativa', type: 'intelligent_attendant', hasLinkedAi: true, linkedAiActive: true }],
      instances: [{ id: 'zap1', label: 'zap1', description: 'evolution' }],
      workflows: [{ id: 'subflow-1', label: 'Consultar cadastro', description: 'Publicado · v2' }],
    });
    for (const call of database.query.mock.calls) expect(String(call[0])).toContain('workspace_id = $1');
  });

  it('accepts teams, tags, agents and instances that belong to the workspace', () => {
    expect(validateNexusWorkflowDialogyBindingsAgainstResources(
      workflowWithDialogyBindings(),
      resources,
    )).toEqual({ valid: true, issues: [] });
  });

  it('requires an active sender system agent for message flows', () => {
    const missing = workflowWithDialogyBindings();
    missing.metadata = {};
    const missingResult = validateNexusWorkflowDialogyBindingsAgainstResources(missing, resources);

    expect(missingResult.issues).toContainEqual(expect.objectContaining({
      nodeId: '__workflow__',
      field: 'metadata.senderSystemAgentId',
      resource: 'system_agent',
      value: '',
    }));

    const foreign = workflowWithDialogyBindings();
    foreign.metadata = { senderSystemAgentId: 'foreign-sender' };
    const foreignResult = validateNexusWorkflowDialogyBindingsAgainstResources(foreign, resources);

    expect(foreignResult.issues).toContainEqual(expect.objectContaining({
      nodeId: '__workflow__',
      resource: 'system_agent',
      value: 'foreign-sender',
    }));
  });

  it('does not require a sender for a flow with no message delivery', () => {
    expect(validateNexusWorkflowDialogyBindingsAgainstResources(
      linearWorkflow(),
      resources,
    )).toEqual({ valid: true, issues: [] });
  });

  it('blocks an AI block when the selected intelligent agent has no active linked AI', () => {
    const workflow = workflowWithDialogyBindings();
    workflow.metadata = { senderSystemAgentId: 'paused-ai' };
    workflow.nodes.push(createWorkflowNode('ai.agent', {
      id: 'agent-node',
      position: { x: 0, y: 0 },
    }));
    const pausedResources: NexusDialogyResources = {
      ...resources,
      systemAgents: [{
        id: 'paused-ai',
        label: 'Agente pausado',
        type: 'intelligent_attendant',
        hasLinkedAi: true,
        linkedAiActive: false,
      }],
    };

    const result = validateNexusWorkflowDialogyBindingsAgainstResources(workflow, pausedResources);

    expect(result.issues).toContainEqual(expect.objectContaining({
      nodeId: '__workflow__',
      resource: 'intelligent_agent',
      value: 'paused-ai',
    }));
  });

  it('blocks stale or foreign workspace bindings before publication', () => {
    const workflow = workflowWithDialogyBindings();
    workflow.nodes.find((node) => node.id === 'availability')!.config.teamId = 'foreign-team';
    workflow.nodes.find((node) => node.id === 'tag')!.config.tagId = 'foreign-tag';
    workflow.nodes.find((node) => node.id === 'ai-handoff')!.config.systemAgentId = 'foreign-ai';
    workflow.nodes.find((node) => node.id === 'group')!.config.instanceName = 'foreign-instance';
    workflow.nodes.find((node) => node.id === 'whatsapp-text')!.config.instanceName = 'foreign-text-instance';
    workflow.nodes.find((node) => node.id === 'whatsapp-media')!.config.instanceName = 'foreign-media-instance';
    workflow.nodes.find((node) => node.id === 'subflow')!.config.workflowId = 'foreign-flow';

    const result = validateNexusWorkflowDialogyBindingsAgainstResources(workflow, resources);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => [issue.nodeId, issue.resource])).toEqual([
      ['availability', 'team'],
      ['tag', 'tag'],
      ['ai-handoff', 'intelligent_agent'],
      ['group', 'instance'],
      ['whatsapp-text', 'instance'],
      ['whatsapp-media', 'instance'],
      ['subflow', 'workflow'],
    ]);
  });

  it('blocks a workflow from calling itself as a subflow', () => {
    const workflow = workflowWithDialogyBindings();
    workflow.id = 'nexus:subflow-1';

    const result = validateNexusWorkflowDialogyBindingsAgainstResources(workflow, resources);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ nodeId: 'subflow', resource: 'workflow', value: 'subflow-1' }),
    ]);
  });

  it('requires an actual close-reason tag while preserving dynamic runtime bindings', () => {
    const workflow = workflowWithDialogyBindings();
    workflow.nodes.find((node) => node.id === 'close')!.config.reasonTagId = 'tag-1';
    workflow.nodes.find((node) => node.id === 'availability')!.config.teamId = '{{variables.teamId}}';

    const result = validateNexusWorkflowDialogyBindingsAgainstResources(workflow, resources);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ nodeId: 'close', resource: 'close_reason', value: 'tag-1' });
  });
});
