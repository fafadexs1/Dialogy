import { describe, expect, it } from 'vitest';

import type { AutopilotConfig, KnowledgeBaseDocument } from '@/lib/types';
import { compileAutopilotTurnPolicy } from '@/services/autopilot/turn-policy';

const documents = [
  { id: 'doc-general', name: 'General', content: 'General', collectionIds: ['general'] },
] as KnowledgeBaseDocument[];

describe('autopilot turn policy', () => {
  it('defaults to deny when no flow is configured', () => {
    const policy = compileAutopilotTurnPolicy({
      config: { enabled_tool_names: ['transfer_chat'] } as AutopilotConfig,
      documents,
      intentScope: null,
    });

    expect(policy.allowedToolNames).toEqual([]);
    expect(policy.allowedKnowledgeDocumentIds).toBeUndefined();
    expect(policy.reason).toBe('flow_graph_missing');
  });

  it('allows only globally enabled tools connected to the active flow node', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        enabled_tool_names: ['transfer_chat', 'close_chat'],
        flow_graph: {
          version: 1,
          nodes: [
            { id: 'assistant', kind: 'assistant', title: 'Assistant' },
            {
              id: 'transfer',
              kind: 'tool',
              title: 'Transfer',
              toolName: 'transfer_chat',
              config: { instructions: 'Transfira somente para a equipe solicitada pelo cliente.' },
            },
            { id: 'close', kind: 'tool', title: 'Close', toolName: 'close_chat' },
          ],
          edges: [{ id: 'edge-transfer', source: 'assistant', target: 'transfer' }],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: null,
    });

    expect(policy.allowedToolNames).toEqual(['transfer_chat']);
    expect(policy.toolInstructionsByName).toEqual({
      transfer_chat: 'Transfira somente para a equipe solicitada pelo cliente.',
    });
  });

  it('lets sub-agents inherit globally enabled tools connected to the principal assistant', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        enabled_tool_names: ['transfer_chat', 'close_chat'],
        flow_graph: {
          version: 1,
          nodes: [
            { id: 'assistant', kind: 'assistant', title: 'Assistant' },
            {
              id: 'billing',
              kind: 'intent',
              title: 'Billing',
              config: { intent: 'billing_or_payment', instructions: 'Atenda financeiro.' },
            },
            {
              id: 'transfer',
              kind: 'tool',
              title: 'Transfer',
              toolName: 'transfer_chat',
              config: { instructions: 'Transfira somente quando solicitado.' },
            },
            { id: 'close', kind: 'tool', title: 'Close', toolName: 'close_chat' },
          ],
          edges: [
            { id: 'assistant-billing', source: 'assistant', target: 'billing' },
            { id: 'assistant-transfer', source: 'assistant', target: 'transfer' },
          ],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: {
        nodeId: 'billing',
        title: 'Billing',
        intent: 'billing_or_payment',
        systemPrompt: 'Atenda financeiro.',
      },
    });

    expect(policy.activeNodeId).toBe('billing');
    expect(policy.allowedToolNames).toEqual(['transfer_chat']);
    expect(policy.toolInstructionsByName).toEqual({
      transfer_chat: 'Transfira somente quando solicitado.',
    });
  });

  it('denies vector retrieval when a configured flow node has no attached knowledge', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        flow_graph: {
          version: 1,
          nodes: [{ id: 'assistant', kind: 'assistant', title: 'Assistant' }],
          edges: [],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: null,
    });

    expect(policy.allowedKnowledgeDocumentIds).toEqual([]);
  });

  it('lets sub-agents inherit knowledge connected to the principal assistant', () => {
    const policy = compileAutopilotTurnPolicy({
      config: {
        flow_graph: {
          version: 1,
          nodes: [
            { id: 'assistant', kind: 'assistant', title: 'Assistant' },
            {
              id: 'billing',
              kind: 'intent',
              title: 'Billing',
              config: { intent: 'billing_or_payment', instructions: 'Atenda financeiro.' },
            },
            { id: 'knowledge', kind: 'knowledge', title: 'Knowledge' },
          ],
          edges: [
            { id: 'assistant-billing', source: 'assistant', target: 'billing' },
            { id: 'knowledge-assistant', source: 'knowledge', target: 'assistant' },
          ],
        },
      } as unknown as AutopilotConfig,
      documents,
      intentScope: {
        nodeId: 'billing',
        title: 'Billing',
        intent: 'billing_or_payment',
        systemPrompt: 'Atenda financeiro.',
      },
    });

    expect(policy.allowedKnowledgeDocumentIds).toEqual(['doc-general']);
  });
});
