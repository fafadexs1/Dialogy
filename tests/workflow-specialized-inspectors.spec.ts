import { describe, expect, it } from 'vitest';

import {
  guidedDurationToMs,
  guidedFieldsToSchema,
  guidedRecordEntriesToRecord,
  hasSpecializedWorkflowInspector,
  NativeSpecializedNodeInspector,
  schemaToGuidedFields,
  SPECIALIZED_WORKFLOW_INSPECTOR_TYPES,
  splitRecordForGuidedEditing,
  timeoutMsToGuidedDuration,
} from '@/components/workflow/native-specialized-inspectors';
import {
  createWorkflowNode,
  listStableWorkflowNodeManifests,
} from '@/services/workflow-runtime/catalog';

describe('native specialized inspectors', () => {
  it('covers every stable node that does not use the dedicated AI agent editor', () => {
    const expected = listStableWorkflowNodeManifests()
      .map((manifest) => manifest.type)
      .filter((type) => type !== 'ai.agent')
      .sort();

    expect([...SPECIALIZED_WORKFLOW_INSPECTOR_TYPES].sort()).toEqual(expected);
  });

  it('only advertises stable workflow node types', () => {
    const stable = new Set(listStableWorkflowNodeManifests().map((manifest) => manifest.type));
    for (const type of SPECIALIZED_WORKFLOW_INSPECTOR_TYPES) {
      expect(stable.has(type), type).toBe(true);
      expect(hasSpecializedWorkflowInspector(type)).toBe(true);
    }
    expect(hasSpecializedWorkflowInspector('ai.supervisor')).toBe(false);
  });

  it('routes every advertised type to a concrete guided inspector', () => {
    for (const type of SPECIALIZED_WORKFLOW_INSPECTOR_TYPES) {
      const node = createWorkflowNode(type, {
        id: `node-${type}`,
        position: { x: 0, y: 0 },
      });
      const inspector = NativeSpecializedNodeInspector({
        node,
        onUpdate: () => undefined,
      });
      expect(inspector, type).not.toBeNull();
    }

    const hiddenNode = createWorkflowNode('ai.supervisor', {
      id: 'hidden-supervisor',
      position: { x: 0, y: 0 },
    });
    expect(NativeSpecializedNodeInspector({ node: hiddenNode, onUpdate: () => undefined })).toBeNull();
  });

  it('round-trips primitive records while preserving advanced values', () => {
    const source = {
      customer_name: '{{current.name}}',
      attempts: 2,
      active: true,
      advanced: { keep: 'unchanged' },
    };
    const split = splitRecordForGuidedEditing(source);

    expect(split.entries).toEqual([
      { key: 'customer_name', value: '{{current.name}}', kind: 'text' },
      { key: 'attempts', value: '2', kind: 'number' },
      { key: 'active', value: 'true', kind: 'boolean' },
    ]);
    expect(guidedRecordEntriesToRecord(split.entries, split.preserved)).toEqual(source);
  });

  it('edits schemas through fields without discarding advanced constraints', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        email: { type: 'string', description: 'E-mail do cliente', format: 'email' },
      },
      required: ['email'],
    };
    const fields = schemaToGuidedFields(schema);
    expect(fields).toEqual([{ name: 'email', type: 'string', description: 'E-mail do cliente', required: true }]);

    const updated = guidedFieldsToSchema([
      ...fields,
      { name: 'score', type: 'number', description: 'Confiança', required: false },
    ], schema);
    expect(updated).toMatchObject({
      additionalProperties: false,
      required: ['email'],
      properties: {
        email: { type: 'string', description: 'E-mail do cliente', format: 'email' },
        score: { type: 'number', description: 'Confiança' },
      },
    });
  });

  it('converts wait durations using friendly units', () => {
    expect(timeoutMsToGuidedDuration(7_200_000)).toEqual({ value: 2, unit: 'hours' });
    expect(guidedDurationToMs(3, 'days')).toBe(259_200_000);
  });
});
