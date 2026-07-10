import { describe, expect, it } from 'vitest';

import { buildWorkflowRuntimeV2WorkspaceFlagStore } from '@/services/workflow-runtime/rollout-operations';
import { evaluateFeatureFlag } from '@/lib/feature-flags/evaluate';

const flagNames = [
  'workflow_runtime_v2_shadow_compile',
  'workflow_runtime_v2_shadow_execution',
  'workflow_runtime_v2_canary_execution',
  'workflow_runtime_v2_primary_execution',
] as const;

describe('workflow runtime V2 workspace rollout', () => {
  it('targets canary to one workspace without globally enabling it', () => {
    const store = buildWorkflowRuntimeV2WorkspaceFlagStore({}, 'workspace-a', 'canary');
    expect(store.flags?.workflow_runtime_v2_canary_execution)
      .toMatchObject({ enabled: false, workspaces: ['workspace-a'] });

    for (const name of flagNames) {
      const expected = name !== 'workflow_runtime_v2_primary_execution';
      expect(evaluateFeatureFlag(name, store.flags?.[name], undefined, { workspaceId: 'workspace-a' }).enabled)
        .toBe(expected);
      expect(evaluateFeatureFlag(name, store.flags?.[name], undefined, { workspaceId: 'workspace-b' }).enabled)
        .toBe(false);
    }
  });

  it('removes only the selected workspace during rollback', () => {
    const initial = buildWorkflowRuntimeV2WorkspaceFlagStore({}, 'workspace-a', 'beta');
    const shared = buildWorkflowRuntimeV2WorkspaceFlagStore(initial, 'workspace-b', 'beta');
    const rolledBack = buildWorkflowRuntimeV2WorkspaceFlagStore(shared, 'workspace-a', 'off');

    for (const name of flagNames) {
      expect(rolledBack.flags?.[name]?.workspaces).not.toContain('workspace-a');
    }
    expect(rolledBack.flags?.workflow_runtime_v2_primary_execution?.workspaces).toContain('workspace-b');
  });

  it('keeps primary workspace targeting distinct from permanent config promotion', () => {
    const beta = buildWorkflowRuntimeV2WorkspaceFlagStore({}, 'workspace-a', 'beta');
    expect(beta.flags?.workflow_runtime_v2_primary_execution?.workspaces).toEqual(['workspace-a']);
    expect(beta.flags?.workflow_runtime_v2_canary_execution?.workspaces).toEqual([]);
  });
});
