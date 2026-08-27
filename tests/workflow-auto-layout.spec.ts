import { describe, expect, it } from 'vitest';

import { createNativeWorkflowLayout } from '@/components/workflow/native-workflow-layout';
import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import { workflowFunctionalSignature, workflowLayoutSignature } from '@/services/workflow-runtime/signature';
import type { WorkflowConnection, WorkflowNode } from '@/services/workflow-runtime/types';

function connect(source: WorkflowNode, target: WorkflowNode, id: string): WorkflowConnection {
  const output = source.outputPorts.find((port) => port.connectionType === 'main')!;
  const input = target.inputPorts.find((port) => port.connectionType === 'main')!;
  return {
    id,
    sourceNodeId: source.id,
    sourcePortId: output.id,
    targetNodeId: target.id,
    targetPortId: input.id,
    connectionType: 'main',
  };
}

describe('native workflow automatic layout', () => {
  it('lays execution routes from left to right and separates branches', () => {
    const trigger = createWorkflowNode('trigger.received_message', { id: 'trigger', position: { x: 900, y: 900 } });
    const router = createWorkflowNode('logic.switch', { id: 'router', position: { x: 100, y: 100 } });
    const first = createWorkflowNode('output.respond', { id: 'first', position: { x: 0, y: 0 } });
    const second = createWorkflowNode('output.respond', { id: 'second', position: { x: 0, y: 0 } });
    const connections = [
      connect(trigger, router, 'a'),
      connect(router, first, 'b'),
      connect(router, second, 'c'),
    ];

    const positions = createNativeWorkflowLayout([trigger, router, first, second], connections);

    expect(positions.get(trigger.id)!.x).toBeLessThan(positions.get(router.id)!.x);
    expect(positions.get(router.id)!.x).toBeLessThan(positions.get(first.id)!.x);
    expect(positions.get(first.id)!.x).toBe(positions.get(second.id)!.x);
    expect(positions.get(first.id)!.y).not.toBe(positions.get(second.id)!.y);
  });

  it('keeps loops finite and places attached resources beside their agent', () => {
    const trigger = createWorkflowNode('trigger.received_message', { id: 'trigger', position: { x: 0, y: 0 } });
    const agent = createWorkflowNode('ai.agent', { id: 'agent', position: { x: 0, y: 0 } });
    const response = createWorkflowNode('output.respond', { id: 'response', position: { x: 0, y: 0 } });
    const memory = createWorkflowNode('memory.session', { id: 'memory', position: { x: 0, y: 0 } });
    const memoryOutput = memory.outputPorts.find((port) => port.connectionType === 'memory')!;
    const memoryInput = agent.inputPorts.find((port) => port.connectionType === 'memory')!;
    const connections: WorkflowConnection[] = [
      connect(trigger, agent, 'a'),
      connect(agent, response, 'b'),
      connect(response, agent, 'loop'),
      {
        id: 'memory-edge',
        sourceNodeId: memory.id,
        sourcePortId: memoryOutput.id,
        targetNodeId: agent.id,
        targetPortId: memoryInput.id,
        connectionType: 'memory',
      },
    ];

    const positions = createNativeWorkflowLayout([trigger, agent, response, memory], connections);

    expect([...positions.values()].every((position) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
    expect(positions.get(memory.id)!.x).toBeLessThan(positions.get(agent.id)!.x);
  });

  it('aligns linear step continuations on the exact same horizontal line', () => {
    const trigger = createWorkflowNode('trigger.received_message', { id: 't', position: { x: 0, y: 0 } });
    const ask = createWorkflowNode('interaction.input', { id: 'ask', position: { x: 0, y: 0 } });
    const save = createWorkflowNode('data.set', { id: 'save', position: { x: 0, y: 0 } });
    const respond = createWorkflowNode('output.respond', { id: 'resp', position: { x: 0, y: 0 } });
    const end = createWorkflowNode('output.end', { id: 'end', position: { x: 0, y: 0 } });

    const connections = [
      connect(trigger, ask, '1'),
      connect(ask, save, '2'),
      connect(save, respond, '3'),
      connect(respond, end, '4'),
    ];

    const positions = createNativeWorkflowLayout([trigger, ask, save, respond, end], connections);

    // Left-to-right progression
    expect(positions.get('t')!.x).toBeLessThan(positions.get('ask')!.x);
    expect(positions.get('ask')!.x).toBeLessThan(positions.get('save')!.x);
    expect(positions.get('save')!.x).toBeLessThan(positions.get('resp')!.x);
    expect(positions.get('resp')!.x).toBeLessThan(positions.get('end')!.x);

    // Perfect horizontal collinearity for linear sequences
    const y0 = positions.get('t')!.y;
    expect(positions.get('ask')!.y).toBe(y0);
    expect(positions.get('save')!.y).toBe(y0);
    expect(positions.get('resp')!.y).toBe(y0);
    expect(positions.get('end')!.y).toBe(y0);
  });

  it('maintains branch sub-path continuity and separates parallel branches cleanly', () => {
    const ifNode = createWorkflowNode('logic.if', { id: 'if', position: { x: 0, y: 0 } });
    const trueStep1 = createWorkflowNode('output.respond', { id: 't1', position: { x: 0, y: 0 } });
    const trueStep2 = createWorkflowNode('output.end', { id: 't2', position: { x: 0, y: 0 } });
    const falseStep1 = createWorkflowNode('output.respond', { id: 'f1', position: { x: 0, y: 0 } });
    const falseStep2 = createWorkflowNode('output.end', { id: 'f2', position: { x: 0, y: 0 } });

    const connections = [
      connect(ifNode, trueStep1, 'c-true'),
      connect(trueStep1, trueStep2, 'c-t1-t2'),
      connect(ifNode, falseStep1, 'c-false'),
      connect(falseStep1, falseStep2, 'c-f1-f2'),
    ];

    const positions = createNativeWorkflowLayout([ifNode, trueStep1, trueStep2, falseStep1, falseStep2], connections);

    // Both branches at same rank
    expect(positions.get('t1')!.x).toBe(positions.get('f1')!.x);
    expect(positions.get('t2')!.x).toBe(positions.get('f2')!.x);

    // Branches do not overlap vertically
    expect(positions.get('t1')!.y).not.toBe(positions.get('f1')!.y);

    // Branch 1 stays on its own horizontal line
    expect(positions.get('t1')!.y).toBe(positions.get('t2')!.y);

    // Branch 2 stays on its own horizontal line
    expect(positions.get('f1')!.y).toBe(positions.get('f2')!.y);
  });

  it('separates multiple disconnected root workflows vertically without collision', () => {
    const root1 = createWorkflowNode('trigger.received_message', { id: 'r1', position: { x: 0, y: 0 } });
    const step1 = createWorkflowNode('output.respond', { id: 's1', position: { x: 0, y: 0 } });
    const root2 = createWorkflowNode('trigger.manual', { id: 'r2', position: { x: 0, y: 0 } });
    const step2 = createWorkflowNode('output.respond', { id: 's2', position: { x: 0, y: 0 } });

    const connections = [
      connect(root1, step1, 'c1'),
      connect(root2, step2, 'c2'),
    ];

    const positions = createNativeWorkflowLayout([root1, step1, root2, step2], connections);

    // Tree 1 and Tree 2 do not overlap vertically
    const maxTree1Y = Math.max(positions.get('r1')!.y, positions.get('s1')!.y);
    const minTree2Y = Math.min(positions.get('r2')!.y, positions.get('s2')!.y);

    expect(minTree2Y).toBeGreaterThan(maxTree1Y);
  });

  it('orders branches of a multi-option menu in visual port order with non-overlapping subtrees', () => {
    const trigger = createWorkflowNode('trigger.received_message', { id: 'trigger', position: { x: 0, y: 0 } });
    const menu = createWorkflowNode('interaction.options', {
      id: 'menu',
      position: { x: 0, y: 0 },
      config: {
        options: [
          { id: 'opt_sales', label: 'Comercial' },
          { id: 'opt_support', label: 'Suporte' },
          { id: 'opt_billing', label: 'Financeiro' },
        ],
      },
    });

    // Sales branch (3 steps)
    const sales1 = createWorkflowNode('data.set', { id: 's1', position: { x: 0, y: 0 } });
    const sales2 = createWorkflowNode('output.respond', { id: 's2', position: { x: 0, y: 0 } });
    const sales3 = createWorkflowNode('output.handoff', { id: 's3', position: { x: 0, y: 0 } });

    // Support branch (2 steps)
    const supp1 = createWorkflowNode('data.set', { id: 'sup1', position: { x: 0, y: 0 } });
    const supp2 = createWorkflowNode('output.handoff', { id: 'sup2', position: { x: 0, y: 0 } });

    // Billing branch (2 steps)
    const bill1 = createWorkflowNode('output.respond', { id: 'b1', position: { x: 0, y: 0 } });
    const bill2 = createWorkflowNode('output.end', { id: 'b2', position: { x: 0, y: 0 } });

    const connections: WorkflowConnection[] = [
      connect(trigger, menu, 'c0'),
      // Menu -> Branch 1 (Sales)
      { id: 'c-opt1', sourceNodeId: 'menu', sourcePortId: 'opt_sales', targetNodeId: 's1', targetPortId: 'input', connectionType: 'main' },
      connect(sales1, sales2, 'c-s1-s2'),
      connect(sales2, sales3, 'c-s2-s3'),
      // Menu -> Branch 2 (Support)
      { id: 'c-opt2', sourceNodeId: 'menu', sourcePortId: 'opt_support', targetNodeId: 'sup1', targetPortId: 'input', connectionType: 'main' },
      connect(supp1, supp2, 'c-sup1-sup2'),
      // Menu -> Branch 3 (Billing)
      { id: 'c-opt3', sourceNodeId: 'menu', sourcePortId: 'opt_billing', targetNodeId: 'b1', targetPortId: 'input', connectionType: 'main' },
      connect(bill1, bill2, 'c-b1-b2'),
    ];

    const allNodes = [trigger, menu, sales1, sales2, sales3, supp1, supp2, bill1, bill2];
    const positions = createNativeWorkflowLayout(allNodes, connections);

    // 1. Column progression with dynamic width:
    // Menu is 440px wide, so Column 2 (s1, sup1, b1) starts with generous clearance (X >= 440 + 120 = 560px from menu)
    expect(positions.get('menu')!.x).toBeGreaterThan(positions.get('trigger')!.x);
    expect(positions.get('s1')!.x - positions.get('menu')!.x).toBeGreaterThanOrEqual(500);

    // 2. Strict top-to-bottom visual port order:
    // Option 1 (Sales) < Option 2 (Support) < Option 3 (Billing)
    const salesY = positions.get('s1')!.y;
    const supportY = positions.get('sup1')!.y;
    const billingY = positions.get('b1')!.y;

    expect(salesY).toBeLessThan(supportY);
    expect(supportY).toBeLessThan(billingY);

    // 3. Each branch remains collinear horizontally
    expect(positions.get('s1')!.y).toBe(positions.get('s2')!.y);
    expect(positions.get('s2')!.y).toBe(positions.get('s3')!.y);

    expect(positions.get('sup1')!.y).toBe(positions.get('sup2')!.y);
    expect(positions.get('b1')!.y).toBe(positions.get('b2')!.y);
  });

  it('keeps complex enterprise workflows (e.g. Velpro Final) compact without 20000px voids', () => {
    const nodes: WorkflowNode[] = [
      createWorkflowNode('trigger.received_message', { id: 'velpro_trigger', position: { x: 0, y: 0 } }),
      createWorkflowNode('data.set', { id: 'velpro_context', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.respond', { id: 'velpro_welcome', position: { x: 0, y: 0 } }),
      createWorkflowNode('interaction.options', {
        id: 'velpro_main_menu',
        position: { x: 0, y: 0 },
        config: {
          options: [
            { id: 'subscribe', label: 'Assinar' },
            { id: 'address_transfer', label: 'Transferência' },
            { id: 'support', label: 'Suporte' },
            { id: 'finance', label: 'Financeiro' },
            { id: 'close', label: 'Encerrar' },
          ],
        },
      }),
      createWorkflowNode('output.respond', { id: 'velpro_session_expired', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.end', { id: 'velpro_session_expired_end', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.respond', { id: 'velpro_retry_exhausted', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.end', { id: 'velpro_retry_end', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.respond', { id: 'velpro_close_notice', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.close_conversation', { id: 'velpro_close_chat', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.end', { id: 'velpro_close_end', position: { x: 0, y: 0 } }),
      createWorkflowNode('interaction.options', {
        id: 'velpro_referral_menu',
        position: { x: 0, y: 0 },
        config: {
          options: [
            { id: 'referral_1', label: 'Google' },
            { id: 'referral_2', label: 'Instagram' },
          ],
        },
      }),
      createWorkflowNode('dialogy.team_availability', { id: 'velpro_commercial_availability', position: { x: 0, y: 0 } }),
      createWorkflowNode('dialogy.chat_tag', { id: 'velpro_commercial_open_tag', position: { x: 0, y: 0 } }),
      createWorkflowNode('dialogy.chat_tag', { id: 'velpro_commercial_closed_tag', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.respond', { id: 'velpro_commercial_message', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.handoff', { id: 'velpro_commercial_handoff', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.end', { id: 'velpro_commercial_end', position: { x: 0, y: 0 } }),
      createWorkflowNode('ai.model', { id: 'velpro_raquel_model', position: { x: 0, y: 0 } }),
      createWorkflowNode('ai.agent', { id: 'velpro_raquel_agent', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.respond', { id: 'velpro_raquel_response', position: { x: 0, y: 0 } }),
      createWorkflowNode('output.end', { id: 'velpro_raquel_end', position: { x: 0, y: 0 } }),
    ];

    const connections: WorkflowConnection[] = [
      { id: 'e1', sourceNodeId: 'velpro_trigger', sourcePortId: 'message', targetNodeId: 'velpro_context', targetPortId: 'main', connectionType: 'main' },
      { id: 'e2', sourceNodeId: 'velpro_context', sourcePortId: 'success', targetNodeId: 'velpro_welcome', targetPortId: 'main', connectionType: 'main' },
      { id: 'e3', sourceNodeId: 'velpro_welcome', sourcePortId: 'success', targetNodeId: 'velpro_main_menu', targetPortId: 'main', connectionType: 'main' },
      { id: 'e4', sourceNodeId: 'velpro_main_menu', sourcePortId: 'subscribe', targetNodeId: 'velpro_referral_menu', targetPortId: 'main', connectionType: 'main' },
      { id: 'e5', sourceNodeId: 'velpro_referral_menu', sourcePortId: 'referral_1', targetNodeId: 'velpro_commercial_availability', targetPortId: 'main', connectionType: 'main' },
      { id: 'e6', sourceNodeId: 'velpro_commercial_availability', sourcePortId: 'open', targetNodeId: 'velpro_commercial_open_tag', targetPortId: 'main', connectionType: 'main' },
      { id: 'e7', sourceNodeId: 'velpro_commercial_open_tag', sourcePortId: 'success', targetNodeId: 'velpro_commercial_message', targetPortId: 'main', connectionType: 'main' },
      { id: 'e8', sourceNodeId: 'velpro_commercial_message', sourcePortId: 'success', targetNodeId: 'velpro_commercial_handoff', targetPortId: 'main', connectionType: 'main' },
      { id: 'e9', sourceNodeId: 'velpro_commercial_handoff', sourcePortId: 'completed', targetNodeId: 'velpro_commercial_end', targetPortId: 'main', connectionType: 'main' },
      { id: 'e10', sourceNodeId: 'velpro_commercial_availability', sourcePortId: 'closed', targetNodeId: 'velpro_commercial_closed_tag', targetPortId: 'main', connectionType: 'main' },
      { id: 'e11', sourceNodeId: 'velpro_commercial_closed_tag', sourcePortId: 'success', targetNodeId: 'velpro_raquel_agent', targetPortId: 'main', connectionType: 'main' },
      { id: 'e12', sourceNodeId: 'velpro_raquel_agent', sourcePortId: 'completed', targetNodeId: 'velpro_raquel_response', targetPortId: 'main', connectionType: 'main' },
      { id: 'e13', sourceNodeId: 'velpro_raquel_response', sourcePortId: 'success', targetNodeId: 'velpro_raquel_end', targetPortId: 'main', connectionType: 'main' },
      { id: 'e14', sourceNodeId: 'velpro_raquel_model', sourcePortId: 'model', targetNodeId: 'velpro_raquel_agent', targetPortId: 'model', connectionType: 'model' },
      { id: 'e15', sourceNodeId: 'velpro_main_menu', sourcePortId: 'close', targetNodeId: 'velpro_close_notice', targetPortId: 'main', connectionType: 'main' },
      { id: 'e16', sourceNodeId: 'velpro_close_notice', sourcePortId: 'success', targetNodeId: 'velpro_close_chat', targetPortId: 'main', connectionType: 'main' },
      { id: 'e17', sourceNodeId: 'velpro_close_chat', sourcePortId: 'completed', targetNodeId: 'velpro_close_end', targetPortId: 'main', connectionType: 'main' },
    ];

    const positions = createNativeWorkflowLayout(nodes, connections);

    const allY = [...positions.values()].map((p) => p.y);
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);

    // Entire workflow fits within ~1250px height, instead of 22,000px!
    expect(maxY - minY).toBeLessThanOrEqual(1400);
    expect(minY).toBeGreaterThanOrEqual(80);
  });

  it('differentiates visual layout changes from functional logic changes', () => {
    const trigger = createWorkflowNode('trigger.received_message', { id: 'trigger', position: { x: 100, y: 100 } });
    const response = createWorkflowNode('output.respond', { id: 'response', position: { x: 400, y: 100 } });
    const workflowA = {
      id: 'flow-1',
      name: 'Flow Test',
      version: 'v1',
      status: 'published' as const,
      nodes: [trigger, response],
      connections: [connect(trigger, response, 'conn-1')],
      settings: {
        executionTimeoutMs: 120_000,
        maxSteps: 100,
        maxModelCalls: 15,
        maxToolCalls: 20,
        maxAgentTurnsPerNode: 8,
        maxRepeatedDecisionSignatures: 2,
        maxTotalInputTokens: 100_000,
        maxTotalOutputTokens: 20_000,
        concurrencyLimit: 1,
      },
      createdAt: '2026-08-27T00:00:00Z',
      updatedAt: '2026-08-27T00:00:00Z',
    };

    // User only moves a block on the canvas (visual move)
    const movedResponse = { ...response, position: { x: 450, y: 220 } };
    const workflowWithVisualMove = {
      ...workflowA,
      nodes: [trigger, movedResponse],
    };

    // Layout signature changes (enabling "Salvar")
    expect(workflowLayoutSignature(workflowA)).not.toBe(workflowLayoutSignature(workflowWithVisualMove));

    // Functional signature is 100% IDENTICAL (keeping "Publicar" disabled)
    expect(workflowFunctionalSignature(workflowA)).toBe(workflowFunctionalSignature(workflowWithVisualMove));

    // When a block is actually changed (e.g. renamed or config changed)
    const modifiedResponse = { ...response, name: 'Nova Resposta' };
    const workflowWithFunctionalChange = {
      ...workflowA,
      nodes: [trigger, modifiedResponse],
    };

    // Functional signature changes (enabling "Publicar")
    expect(workflowFunctionalSignature(workflowA)).not.toBe(workflowFunctionalSignature(workflowWithFunctionalChange));
  });
});

