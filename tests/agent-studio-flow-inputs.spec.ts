import { describe, expect, it } from 'vitest';
import { createDefaultAgentStudioDocument, CollectedFieldDefinitionSchema, ProcedureDocumentSchema } from '@/services/agent-studio/types';
import { mapStudioFlowInputs, studioFlowInputs, validateStudioFlowBindings } from '@/services/agent-studio/flow-inputs';

const document = createDefaultAgentStudioDocument('agent', 'workspace');
document.understandStage.askInitialData = true;
document.understandStage.initialFields = [CollectedFieldDefinitionSchema.parse({ id: 'email', name: 'E-mail', variableKey: 'email', promptMessage: 'Qual e-mail?', reuseFrom: { sourceType: 'flow_input', sourceValue: 'customer.email' } })];
const source = { variables: { email: 'test@example.com', secret: 'not-authorized' }, current: {}, input: {} };
describe('explicit flow-to-agent input contract', () => {
  it('exposes only declared inputs and sends only explicitly mapped data', () => {
    expect(studioFlowInputs(document)).toEqual([{ key: 'customer.email', label: 'E-mail', required: false }]);
    expect(mapStudioFlowInputs(document, [], source)).toEqual({});
    expect(mapStudioFlowInputs(document, [{ inputKey: 'customer.email', sourceType: 'variable', sourcePath: 'email' }], source)).toEqual({ customer: { email: 'test@example.com' } });
  });
  it('rejects unknown destinations, duplicate mappings and unsafe paths', () => {
    expect(() => mapStudioFlowInputs(document, [{ inputKey: 'secret', sourceType: 'variable', sourcePath: 'secret' }], source)).toThrow('autorizado');
    const mapping = { inputKey: 'customer.email', sourceType: 'variable', sourcePath: 'email' };
    expect(() => mapStudioFlowInputs(document, [mapping, mapping], source)).toThrow('mais de uma vez');
    expect(() => mapStudioFlowInputs(document, [{ ...mapping, sourcePath: '__proto__' }], source)).toThrow('caminho');
  });
  it('preserves structured and false values without reinterpreting templates', () => {
    expect(mapStudioFlowInputs(document, [{ inputKey: 'customer.email', sourceType: 'static', sourcePath: 'false', valueType: 'boolean' }], source)).toEqual({ customer: { email: false } });
    expect(mapStudioFlowInputs(document, [{ inputKey: 'customer.email', sourceType: 'static', sourcePath: '{{secret}}' }], source)).toEqual({ customer: { email: '{{secret}}' } });
  });
  it('validates empty and duplicate mappings even when runtime values are not available', () => {
    const mapping = { inputKey: 'customer.email', sourceType: 'variable', sourcePath: 'missing' };
    expect(() => validateStudioFlowBindings(document, [mapping, mapping])).toThrow('mais de uma vez');
    expect(() => validateStudioFlowBindings(document, [{ ...mapping, sourcePath: '' }])).toThrow('caminho');
    expect(() => validateStudioFlowBindings(document, [{ ...mapping, sourceType: 'static', sourcePath: 'oops', valueType: 'number' }])).toThrow('número');
  });
  it('requires direct action inputs but allows optional reuse to ask the customer', () => {
    const withAction = structuredClone(document);
    withAction.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'api', name: 'Consulta', updatedAt: '2026-08-27', steps: [
      { id: 'lookup', order: 1, title: 'Consulta', type: 'http_request', httpRequest: { name: 'Consulta', url: 'https://example.com', sentDataMappings: [{ apiField: 'email', sourceType: 'flow_input', sourceValue: 'customer.email' }] } },
    ] })];
    expect(() => validateStudioFlowBindings(document, [])).not.toThrow();
    expect(() => validateStudioFlowBindings(withAction, [])).toThrow('obrigatório');
    expect(() => validateStudioFlowBindings(withAction, [{ inputKey: 'customer.email', sourceType: 'variable', sourcePath: 'email' }])).not.toThrow();
  });
  it('does not allow output keys outside the fixed release contract', () => {
    expect(() => validateStudioFlowBindings(document, [], ['email'])).not.toThrow();
    expect(() => validateStudioFlowBindings(document, [], ['secret'])).toThrow('saída');
    expect(() => validateStudioFlowBindings(document, [], ['email', 'email'])).toThrow('duplicado');
  });
});
