import { describe, expect, it } from 'vitest';
import { availableStudioData, studioStepConsumers } from '@/services/agent-studio/data-availability';
import { checkStudioDependencies } from '@/services/agent-studio/publication-checks';
import { isSafeStudioPattern, extractStudioFieldCandidate } from '@/services/agent-studio/collection';
import { CollectedFieldDefinitionSchema, createDefaultAgentStudioDocument, HttpRequestStepConfigSchema, ProcedureDocumentSchema } from '@/services/agent-studio/types';

function fixture() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.concludeStage.handoffTeam = 'Equipe';
  const procedure = ProcedureDocumentSchema.parse({ id: 'proc', name: 'Consulta', updatedAt: '2026-08-27', steps: [
    { id: 'api', order: 1, type: 'http_request', title: 'Consultar', httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Consulta', url: 'https://example.com', outputMappings: [{ chipKey: 'invoice', chipLabel: 'Fatura', jsonPath: 'invoice', required: false }] }) },
    { id: 'condition', order: 2, type: 'decision', title: 'Encontrou?', decisionBranches: [
      { id: 'found', conditionLabel: 'Encontrada', actionType: 'continue', nextStepId: 'reply', condition: { fieldKey: 'invoice', operator: 'exists' } },
      { id: 'empty', conditionLabel: 'Caso contrário', actionType: 'respond', actionValue: 'Não encontrada', isDefault: true },
    ] },
    { id: 'reply', order: 3, type: 'respond', title: 'Enviar fatura', messageDataKeys: ['invoice'] },
  ] });
  document.resolveStage.procedures = [procedure];
  return { document, procedure };
}

describe('Studio path-aware data contracts', () => {
  it('rejects collecting system-prohibited secrets and business-prohibited data', () => {
    const { document } = fixture(); document.understandStage.askInitialData = true;
    document.understandStage.initialFields = [CollectedFieldDefinitionSchema.parse({ id: 'secret', name: 'Senha', variableKey: 'secret', promptMessage: 'Qual senha?' })];
    expect(checkStudioDependencies(document).some((issue) => issue.code === 'PROHIBITED_COLLECTION')).toBe(true);
    document.understandStage.initialFields[0].name = 'Renda mensal'; document.rules.prohibitedDataLabels = ['renda'];
    expect(checkStudioDependencies(document).some((issue) => issue.code === 'PROHIBITED_COLLECTION')).toBe(true);
  });
  it('refines optional results only after an existence guard', () => {
    const { document, procedure } = fixture();
    expect(availableStudioData(document, procedure, 1).find((item) => item.key === 'invoice')?.guaranteed).toBe(false);
    expect(availableStudioData(document, procedure, 2).find((item) => item.key === 'invoice')?.guaranteed).toBe(true);
    expect(checkStudioDependencies(document)).toEqual([]);
  });
  it('does not offer a value as guaranteed when the empty branch also reaches its consumer', () => {
    const { document, procedure } = fixture();
    procedure.steps[1].decisionBranches![1] = { id: 'empty', conditionLabel: 'Caso contrário', actionType: 'continue', nextStepId: 'reply', isDefault: true };
    expect(availableStudioData(document, procedure, 2).find((item) => item.key === 'invoice')?.guaranteed).toBe(false);
    expect(checkStudioDependencies(document).some((issue) => issue.code === 'DATA_NOT_AVAILABLE')).toBe(true);
  });
  it('detects data consumers and branch targets before removal', () => {
    const { procedure } = fixture();
    expect(studioStepConsumers(procedure, procedure.steps[0]).map((step) => step.id)).toEqual(['condition', 'reply']);
    expect(studioStepConsumers(procedure, procedure.steps[2]).map((step) => step.id)).toEqual(['condition']);
  });
  it('marks skipped steps unreachable and never treats their outputs as guaranteed', () => {
    const { document, procedure } = fixture();
    procedure.steps.unshift({ id: 'finish', order: 0, type: 'finish', title: 'Concluir' });
    expect(availableStudioData(document, procedure, 3).find((item) => item.key === 'invoice')?.guaranteed).toBe(false);
    expect(checkStudioDependencies(document).some((issue) => issue.code === 'UNREACHABLE_STEP')).toBe(true);
  });
  it('rejects optional repetition, even without groups, before evaluating a validation pattern', () => {
    for (const pattern of ['a?a?a?a?a?a?a?a?a?a?a?a?aaaaaaaaaaaa', 'a{0,100}a{0,100}b', '[a-z]{999999999}', '(a+)+']) expect(isSafeStudioPattern(pattern)).toBe(false);
    expect(isSafeStudioPattern('^[A-Z]{3}[0-9]{4}$')).toBe(true);
  });
  it('does not silently choose the first of two customer identifiers', () => {
    const field = CollectedFieldDefinitionSchema.parse({ id: 'cpf', name: 'CPF', variableKey: 'cpf', type: 'cpf', promptMessage: 'Qual CPF?' });
    expect(extractStudioFieldCandidate(field, '529.982.247-25 ou 111.444.777-35', false)).toBeUndefined();
    expect(extractStudioFieldCandidate(field, 'CPF: 529.982.247-25; E-mail: teste@example.com', false)).toBe('529.982.247-25');
  });
  it('recognizes a unique descriptive part of an option without guessing an ambiguous one', () => {
    const plans = CollectedFieldDefinitionSchema.parse({
      id: 'plan', name: 'Plano', variableKey: 'plan', type: 'single_select', promptMessage: 'Qual plano?',
      options: ['500 MEGA + Wi-Fi 5 — R$ 79,90', '1000 MEGA + Wi-Fi 6 — R$ 109,90'],
    });
    expect(extractStudioFieldCandidate(plans, 'Cara, esse de 1000 MEGA, eu quero esse.', false)).toBe('1000 MEGA + Wi-Fi 6 — R$ 109,90');
    const ambiguous = CollectedFieldDefinitionSchema.parse({
      id: 'support', name: 'Suporte', variableKey: 'support', type: 'single_select', promptMessage: 'Qual suporte?',
      options: ['Suporte + Comercial', 'Suporte + Financeiro'],
    });
    expect(extractStudioFieldCandidate(ambiguous, 'Quero suporte', false)).toBeUndefined();
  });
});
