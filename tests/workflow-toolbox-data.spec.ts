import { describe, expect, it } from 'vitest';
import { executeDataOperation as run, sampleDataFields } from '@/services/workflow-runtime/data-operations';
import { createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime/node-handlers';
import { WorkflowExecutor } from '@/services/workflow-runtime/executor';
import { InMemoryWorkflowPersistence } from '@/services/workflow-runtime/persistence';
import { workflowNode, workflowDefinition, connect } from './workflow-runtime-fixtures';

describe('guided workflow data operations', () => {
  it('selects array indices and represents a missing field as null', () => {
    expect(run({ operation: 'pick', field: 'items.0.name' }, { items: [{ name: 'Maria' }] })).toBe('Maria');
    expect(run({ operation: 'pick', field: 'items.3.name' }, { items: [] })).toBeNull();
  });
  it('splits text without losing empty fields', () => expect(run({ operation: 'split', delimiter: ';' }, 'Maria;;149')).toEqual(['Maria', '', '149']));
  it('rejects ambiguous conversions', () => {
    expect(run({ operation: 'convert', targetType: 'boolean' }, 'false')).toBe(false);
    expect(() => run({ operation: 'convert', targetType: 'boolean' }, 'não sei')).toThrow();
    expect(() => run({ operation: 'convert', targetType: 'number' }, null)).toThrow();
  });
  it('retains valid zero and false in required fields', () => expect(run({ operation: 'validate', requiredFields: ['age', 'enabled', 'missing'] }, { age: 0, enabled: false })).toMatchObject({ valid: false, missing: ['missing'] }));
  it('filters and sorts without mutating the source', () => {
    const list = [{ p: 2 }, { p: 1 }, { p: 3 }];
    expect(run({ operation: 'filter', field: 'p', operator: 'greater_than', value: 1 }, list)).toEqual([{ p: 2 }, { p: 3 }]);
    expect(run({ operation: 'sort', field: 'p' }, list)).toEqual([{ p: 1 }, { p: 2 }, { p: 3 }]);
    expect(list[0].p).toBe(2);
  });
  it('deduplicates structurally and groups hostile keys safely', () => {
    expect(run({ operation: 'unique', field: 'id' }, [{ id: 1 }, { id: 1 }, { id: 2 }])).toHaveLength(2);
    expect(run({ operation: 'group', field: 'id' }, [{ id: '__proto__' }])).toEqual([{ key: '__proto__', items: [{ id: '__proto__' }] }]);
  });
  it('does not match missing join keys and preserves all duplicate matches', () => expect(run({ operation: 'join', field: 'id', rightField: 'id', right: [{ id: 1 }, { id: 1 }, {}] }, [{ id: 1 }, {}])).toEqual([{ left: { id: 1 }, matches: [{ id: 1 }, { id: 1 }] }, { left: {}, matches: [] }]));
  it('defines empty aggregates explicitly', () => {
    expect(run({ operation: 'aggregate', aggregate: 'sum' }, [])).toBe(0);
    expect(run({ operation: 'aggregate', aggregate: 'average' }, [])).toBeNull();
    expect(run({ operation: 'aggregate', aggregate: 'average', field: 'price' }, [{ price: 10 }, { price: 20 }])).toBe(15);
  });
  it('bounds data and previews', () => {
    expect(() => run({ operation: 'sort' }, Array(1001).fill(1))).toThrow('1.000');
    expect(sampleDataFields({ list: [{ id: 'A' }] }, 'current')).toContainEqual({ path: 'current.list.0.id', type: 'string', preview: '"A"' });
    expect(sampleDataFields(Array(1000).fill({ x: 1 }), 'current', 5)).toHaveLength(5);
  });
  it('executes through the real workflow registry with a typed state patch', async () => {
    const start = workflowNode('trigger.manual', 'start');
    const operation = workflowNode('data.operation', 'data', { operation: 'filter', source: '{{input.items}}', field: 'active', value: true, outputKey: 'leads' });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition([start, operation, end], [connect(start, start.outputPorts[0].id, operation, 'main'), connect(operation, 'success', end, 'main')]);
    const executor = new WorkflowExecutor(new InMemoryWorkflowPersistence(), createDefaultNodeHandlerRegistry());
    const execution = await executor.start({ workflow, input: { items: [{ active: true }, { active: false }] } });
    expect(execution.status).toBe('completed');
    expect(execution.variables.leads).toEqual([{ active: true }]);
  });
});
