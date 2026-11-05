import { describe, expect, it } from 'vitest';
import { checkStudioReasoningPublication } from '@/services/agent-studio/reasoning-publication';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema } from '@/services/agent-studio/types';

function fixture() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.aiModel = 'deepseek/deepseek-v4-flash';
  document.resolveStage.conversationMode = 'adaptive';
  document.resolveStage.reasoning = { enabled: true, effort: 'medium', supportModel: null, maxDecisions: 8, maxTurnMs: 90_000 };
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'support', name: 'Suporte', updatedAt: '2026-09-08', steps: [
    { id: 'lookup', order: 1, type: 'http_request', title: 'Consulta', adaptiveAccess: { enabled: true, requiresSteps: [] } },
    { id: 'change', order: 2, type: 'native_action', title: 'Alteração', adaptiveAccess: { enabled: true, requiresSteps: ['lookup'] } },
  ] })];
  return document;
}
describe('reasoning publication configuration', () => {
  it('accepts an explicit, acyclic capability contract', () => {
    expect(checkStudioReasoningPublication(fixture())).toEqual([]);
  });
  it('requires review of legacy operations before exposing the new engine', () => {
    const document = fixture(); delete document.resolveStage.procedures[0].steps[0].adaptiveAccess;
    const codes = checkStudioReasoningPublication(document).map((i) => i.code);
    expect(codes).toContain('REASONING_CAPABILITY_REVIEW'); expect(codes).toContain('REASONING_DEPENDENCY_INVALID');
  });
  it('rejects cycles and references to disabled actions', () => {
    const document = fixture(); document.resolveStage.procedures[0].steps[0].adaptiveAccess!.requiresSteps = ['change'];
    expect(checkStudioReasoningPublication(document).map((i) => i.code)).toContain('REASONING_DEPENDENCY_CYCLE');
    document.resolveStage.procedures[0].steps[0].adaptiveAccess!.enabled = false;
    expect(checkStudioReasoningPublication(document).map((i) => i.code)).toContain('REASONING_DEPENDENCY_INVALID');
  });
  it('does not silently drop authored business conditions', () => {
    const document = fixture(); document.resolveStage.procedures[0].steps.push({ id: 'condition', order: 3, type: 'decision', title: 'Cliente elegível' });
    expect(checkStudioReasoningPublication(document).map((i) => i.code)).toContain('REASONING_BRANCH_EMPTY');
  });
  it('allows authored branches with an available source and rejects a disabled source', () => {
    const document = fixture(); const procedure = document.resolveStage.procedures[0];
    procedure.steps[0].httpRequest = ProcedureDocumentSchema.parse({ id: 'source', name: 'Fonte', updatedAt: '2026-09-08', steps: [
      { id: 'query', order: 1, title: 'Consultar', type: 'http_request', httpRequest: { name: 'Consultar', method: 'GET', url: 'https://example.test', outputMappings: [{ chipKey: 'eligible', chipLabel: 'Elegível', jsonPath: 'eligible' }] } },
    ] }).steps[0].httpRequest;
    procedure.steps.push({ id: 'decision', order: 3, type: 'decision', title: 'Elegibilidade', decisionBranches: [
      { id: 'yes', conditionLabel: 'Elegível', condition: { fieldKey: 'eligible', operator: 'equals', value: 'true' }, actionType: 'respond', actionValue: 'Oferta disponível.' },
      { id: 'no', conditionLabel: 'Caso contrário', isDefault: true, actionType: 'handoff', actionValue: 'review-team' },
    ] });
    expect(checkStudioReasoningPublication(document)).toEqual([]);
    procedure.steps[0].adaptiveAccess!.enabled = false;
    expect(checkStudioReasoningPublication(document).map((issue) => issue.code)).toContain('REASONING_CONDITION_SOURCE_UNAVAILABLE');
  });
  it('does not change validation for legacy publications', () => {
    const document = fixture(); delete document.resolveStage.reasoning;
    delete document.resolveStage.procedures[0].steps[0].adaptiveAccess;
    expect(checkStudioReasoningPublication(document)).toEqual([]);
  });
});
