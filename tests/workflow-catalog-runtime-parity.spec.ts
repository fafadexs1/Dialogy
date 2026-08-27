import { describe, expect, it } from 'vitest';
import {
  createDefaultNodeHandlerRegistry,
  listStableWorkflowNodeManifests,
} from '@/services/workflow-runtime';

describe('workflow catalog/runtime parity', () => {
  it('exposes only nodes that are executable or resolved as attachments', () => {
    const handlers = createDefaultNodeHandlerRegistry().listTypes();
    const handlerTypes = new Set(handlers);
    const unsupported = listStableWorkflowNodeManifests()
      .filter((manifest) => !manifest.attachment && !handlerTypes.has(manifest.type))
      .map((manifest) => manifest.type);

    expect(unsupported).toEqual([]);
  });

  it('shows completed advanced nodes and keeps unfinished runtimes hidden', () => {
    const visible = new Set(listStableWorkflowNodeManifests().map((manifest) => manifest.type));
    expect(visible.has('data.code')).toBe(true);
    expect(visible.has('ai.supervisor')).toBe(false);
    expect(visible.has('ai.planner')).toBe(false);
    expect(visible.has('tool.http')).toBe(true);
  });
});
