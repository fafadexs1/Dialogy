import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '@/services/workflow-runtime/catalog';
import { workflowDefinition } from './workflow-runtime-fixtures';
import { studioFlowRelease } from './fixtures/studio-flow-fixture';
import { mapStudioCompositionInputs, projectStudioFlowData, publishedStudioFlowContract, StudioFlowContractSchema, studioFlowJsonSchema, validateStudioFlowPublication } from '@/services/agent-studio/flow-contract';
import { validateStudioCompositionBinding, assertStudioDelegationAcyclic } from '@/services/agent-studio/flow-bindings';
import { normalizeStandaloneStudioAgents } from '@/modules/nexus/services/standalone-workflows';
import { studioFlowKnowledgeContext } from '@/services/agent-studio/flow-knowledge';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';

describe('Studio composition contracts', () => {
  it('requires an explicitly published composition contract; legacy versions stay terminal', () => {
    const release = studioFlowRelease(); delete release.flowContract;
    expect(() => publishedStudioFlowContract(release)).toThrow('não permite composição');
    const old = createWorkflowNode('ai.published_agent', { id: 'old', position: { x: 0, y: 0 } });
    const composed = createWorkflowNode('ai.studio_agent', { id: 'composed', position: { x: 400, y: 0 } });
    const original = workflowDefinition([old, composed], []);
    expect(normalizeStandaloneStudioAgents(original).nodes[0].outputPorts).toEqual([]);
    expect(normalizeStandaloneStudioAgents(original).nodes[1].outputPorts).toEqual(composed.outputPorts);
  });
  it('rejects duplicate, overlapping and unsafe public fields', () => {
    for (const keys of [['name', 'name'], ['client', 'client.name'], ['__proto__.polluted'], ['constructor.value']]) {
      expect(StudioFlowContractSchema.safeParse({ inputs: keys.map((key) => ({ key, label: key })) }).success).toBe(false);
    }
    expect(StudioFlowContractSchema.safeParse({ enabled: true, modes: [] }).success).toBe(false);
  });
  it('maps typed public data without exposing undeclared values or coercing source values', () => {
    const contract = StudioFlowContractSchema.parse({ inputs: [{ key: 'count', label: 'Quantidade', type: 'number' }] });
    expect(mapStudioCompositionInputs(contract, [{ inputKey: 'count', sourceType: 'static', sourcePath: '3', valueType: 'number' }], { input: {}, variables: {}, current: {} })).toEqual({ count: 3 });
    expect(() => mapStudioCompositionInputs(contract, [{ inputKey: 'count', sourceType: 'input', sourcePath: 'count' }], { input: { count: '3' }, variables: {}, current: {} })).toThrow('Tipo inválido');
    expect(() => mapStudioCompositionInputs(contract, [{ inputKey: 'secret', sourceType: 'input', sourcePath: 'token' }], { input: {}, variables: {}, current: {} })).toThrow('não autorizada');
  });
  it('projects only declared output fields and masks explicitly sensitive ones', () => {
    const fields = StudioFlowContractSchema.parse({ outputs: [{ key: 'client.code', label: 'Código', sensitive: true, required: true }] }).outputs;
    expect(projectStudioFlowData(fields, { client: { code: '123', private: 'hidden' }, token: 'hidden' }, false)).toEqual({ client: { code: '[protegido]' } });
    expect(() => projectStudioFlowData(fields, {})).toThrow('contrato');
    expect(studioFlowJsonSchema(fields)).toMatchObject({ required: ['client'], properties: { client: { required: ['code'], properties: { code: { type: 'string' } } } } });
  });
  it('only exports active published procedures', () => {
    const contract = studioFlowRelease().flowContract!;
    expect(() => validateStudioFlowPublication(contract, [])).toThrow('habilidade exportada');
    expect(() => validateStudioFlowPublication(contract, ['consulta'])).not.toThrow();
  });
  it('validates scoped modes, required inputs and permitted extensions at publication', () => {
    const release = studioFlowRelease();
    const node = createWorkflowNode('ai.studio_agent', { id: 'agent', position: { x: 0, y: 0 }, config: { agentId: release.agentId, releaseId: release.releaseId, mode: 'task' } });
    const definition = workflowDefinition([node], [], { workspaceId: release.workspaceId });
    expect(() => validateStudioCompositionBinding(definition, node, release)).not.toThrow();
    expect(() => validateStudioCompositionBinding({ ...definition, workspaceId: 'other' }, node, release)).toThrow('escopo');
    release.flowContract!.inputs[0].required = true;
    expect(() => validateStudioCompositionBinding(definition, node, release)).toThrow('entradas obrigatórias');
    release.flowContract!.inputs[0].required = false; release.flowContract!.extensions = [];
    definition.connections.push({ id: 'model-edge', sourceNodeId: 'model', sourcePortId: 'model', targetNodeId: 'agent', targetPortId: 'model', connectionType: 'model' });
    expect(() => validateStudioCompositionBinding(definition, node, release)).toThrow('não autoriza');
  });
  it('rejects self-delegation before publishing', () => {
    const release = studioFlowRelease();
    const agent = createWorkflowNode('ai.studio_agent', { id: 'agent', position: { x: 0, y: 0 }, config: { releaseId: release.releaseId } });
    const tool = createWorkflowNode('tool.studio_agent', { id: 'tool', position: { x: 0, y: 200 }, config: { releaseId: release.releaseId } });
    expect(() => assertStudioDelegationAcyclic(workflowDefinition([agent, tool], [{ id: 'edge', sourceNodeId: 'tool', sourcePortId: 'tool', targetNodeId: 'agent', targetPortId: 'tools', connectionType: 'tool' }]))).toThrow('própria versão');
  });
  it('derives specialist schemas from Studio without requiring manually duplicated schemas', () => {
    const release = studioFlowRelease();
    const tool = createWorkflowNode('tool.studio_agent', { id: 'specialist', position: { x: 0, y: 0 }, config: { agentId: release.agentId, releaseId: release.releaseId, name: 'specialist', description: 'Consultar o especialista' } });
    const definition = workflowDefinition([tool], [], { workspaceId: release.workspaceId });
    expect(validateWorkflowDefinition(definition).errors.some((error) => error.code === 'tool_missing_schema')).toBe(false);
    release.flowContract!.maxModelCalls = 4; release.flowContract!.maxToolCalls = 2;
    expect(() => validateStudioCompositionBinding(definition, tool, release)).not.toThrow();
  });
  it('selects relevant immutable excerpts within a bounded context without altering the sources', () => {
    const release = studioFlowRelease();
    release.knowledgeSnapshot = [{ id: 'fonte', name: 'Manual', content: `${'texto genérico '.repeat(3000)}\nCancelamento exige protocolo ABC123.` }];
    const before = structuredClone(release);
    const context = studioFlowKnowledgeContext(release, 'cancelamento protocolo', 4000);
    expect(context.excerpts.map((excerpt) => excerpt.content).join('')).toContain('Cancelamento exige protocolo ABC123');
    expect(context.excerpts.reduce((total, excerpt) => total + excerpt.content.length, 0)).toBeLessThanOrEqual(4000);
    expect(context.omitted).toBe(true); expect(release).toEqual(before);
  });
});
