import { describe, expect, it } from 'vitest';
import { ProcedureDocumentSchema, createDefaultAgentStudioDocument } from '@/services/agent-studio/types';
import { studioReasoningPaths } from '@/services/agent-studio/reasoning-paths';
import { compileStudioReasoningCapabilities } from '@/services/agent-studio/reasoning-capabilities';

function fixture() {
  return ProcedureDocumentSchema.parse({ id: 'sales', name: 'Comercial', updatedAt: '2026-09-08', steps: [
    { id: 'query', order: 1, type: 'http_request', title: 'Consultar elegibilidade', adaptiveAccess: { enabled: true }, httpRequest: { name: 'Consulta', method: 'GET', url: 'https://example.test', outputMappings: [{ chipKey: 'eligible', chipLabel: 'Elegível', jsonPath: 'eligible' }] } },
    { id: 'eligibility', order: 2, type: 'decision', title: 'Elegibilidade', decisionBranches: [
      { id: 'yes', conditionLabel: 'Elegível', condition: { fieldKey: 'eligible', operator: 'equals', value: 'true' }, actionType: 'continue', nextStepId: 'activate' },
      { id: 'no', conditionLabel: 'Não elegível', isDefault: true, actionType: 'respond', actionValue: 'Esta oferta não está disponível para este contrato.' },
    ] },
    { id: 'activate', order: 3, type: 'native_action', title: 'Ativar', nativeActionType: 'update_crm_field', adaptiveAccess: { enabled: true } },
  ] });
}

describe('published business paths in adaptive reasoning', () => {
  it('exposes only the handoff reached by current evidence and removes it after the facts change', () => {
    const procedure = fixture();
    const denied = procedure.steps[1].decisionBranches![1];
    denied.actionType = 'handoff'; denied.actionValue = 'review-team';
    expect(studioReasoningPaths(procedure, { values: {} }, new Set()).handoffs).toEqual([]);
    expect(studioReasoningPaths(procedure, { values: { eligible: false } }, new Set(['query'])).handoffs).toEqual([
      { stepId: 'eligibility', team: 'review-team', reason: 'Não elegível' },
    ]);
    expect(studioReasoningPaths(procedure, { values: { eligible: true } }, new Set(['query'])).handoffs).toEqual([]);
  });
  it('never exposes an unselected descriptive transfer destination', () => {
    const procedure = fixture();
    procedure.steps[1].decisionBranches = [
      { id: 'review', conditionLabel: 'Revisão humana necessária', actionType: 'handoff', actionValue: 'review-team' },
      { id: 'continue', conditionLabel: 'Continuar atendimento', isDefault: true, actionType: 'continue', nextStepId: 'activate' },
    ];
    expect(studioReasoningPaths(procedure, { values: {} }, new Set()).handoffs).toEqual([]);
    expect(studioReasoningPaths(procedure, { values: {} }, new Set(), { eligibility: 'continue' }).handoffs).toEqual([]);
    expect(studioReasoningPaths(procedure, { values: {} }, new Set(), { eligibility: 'review' }).handoffs[0]?.team).toBe('review-team');
  });
  it('does not interpret an unqueried output as a negative/default answer', () => {
    const paths = studioReasoningPaths(fixture(), { values: {} }, new Set());
    expect(paths.reachable.has('query')).toBe(true);
    expect(paths.reachable.has('activate')).toBe(false);
    expect(paths.decisions[0].waitingFor).toEqual(['eligible']);
    expect(paths.responses).toEqual([]);
  });
  it('revalidates a commercial condition against refreshed facts before exposing an action', () => {
    const document = createDefaultAgentStudioDocument('agent','workspace'); document.resolveStage.procedures = [fixture()];
    const allowed = compileStudioReasoningCapabilities(document,'sales',{ values: { eligible: true } },new Set(['query']));
    expect(allowed.find((entry) => entry.stepId === 'activate')?.ready).toBe(true);
    const denied = compileStudioReasoningCapabilities(document,'sales',{ values: { eligible: false } },new Set(['query']));
    expect(denied.find((entry) => entry.stepId === 'activate')?.ready).toBe(false);
    expect(studioReasoningPaths(fixture(),{ values: { eligible: false } },new Set(['query'])).responses).toEqual(['Esta oferta não está disponível para este contrato.']);
  });
  it('lets the model select only descriptive branches and never override a data condition', () => {
    const procedure = fixture(); procedure.steps[1].decisionBranches!.splice(1,0,{ id: 'review', conditionLabel: 'Cliente quer uma revisão', actionType: 'respond', actionValue: 'Vamos revisar as alternativas.' });
    expect(studioReasoningPaths(procedure,{ values: { eligible: false } },new Set(['query'])).decisions[0].branches.map((branch) => branch.id)).toEqual(['review','no']);
    expect(studioReasoningPaths(procedure,{ values: { eligible: false } },new Set(['query']),{ eligibility: 'no' }).responses).toEqual(['Esta oferta não está disponível para este contrato.']);
    expect(studioReasoningPaths(procedure,{ values: { eligible: false } },new Set(['query']),{ eligibility: 'review' }).responses).toEqual(['Vamos revisar as alternativas.']);
    expect(studioReasoningPaths(procedure,{ values: { eligible: true } },new Set(['query']),{ eligibility: 'review' }).reachable.has('activate')).toBe(true);
  });
  it('respects an explicit terminal edge rather than exposing downstream actions', () => {
    const procedure = fixture(); procedure.steps[0].nextStepId = null;
    expect(studioReasoningPaths(procedure,{ values: { eligible: true } },new Set(['query'])).reachable.has('activate')).toBe(false);
  });
});
