import { describe, expect, it } from 'vitest';

import {
  hasSpecializedWorkflowInspector,
  SPECIALIZED_WORKFLOW_INSPECTOR_TYPES,
} from '@/components/workflow/native-specialized-inspectors';
import { listStableWorkflowNodeManifests } from '@/services/workflow-runtime/catalog';

describe('native specialized inspectors', () => {
  it('covers every specialized node promised by the native editor plan', () => {
    expect([...SPECIALIZED_WORKFLOW_INSPECTOR_TYPES].sort()).toEqual([
      'ai.model',
      'guardrail.policy',
      'knowledge.rag_retriever',
      'logic.ai_router',
      'tool.internal',
      'tool.mcp',
    ]);
  });

  it('only advertises stable workflow node types', () => {
    const stable = new Set(listStableWorkflowNodeManifests().map((manifest) => manifest.type));
    for (const type of SPECIALIZED_WORKFLOW_INSPECTOR_TYPES) {
      expect(stable.has(type), type).toBe(true);
      expect(hasSpecializedWorkflowInspector(type)).toBe(true);
    }
    expect(hasSpecializedWorkflowInspector('ai.supervisor')).toBe(false);
  });
});
