import { describe, expect, it } from 'vitest';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, HttpRequestStepConfigSchema } from '@/services/agent-studio/types';
import type { StudioSession } from '@/services/agent-studio/engine';
import { invalidateInactiveStudioIntegrationData } from '@/services/agent-studio/reasoning-integration-invalidation';

function fixture() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'p', name: 'API', updatedAt: '2026-11-01', steps: [{
    id: 's', order: 1, type: 'http_request', title: 'Consulta', adaptiveAccess: { enabled: true, requiresSteps: [] },
    httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Consultar', method: 'GET', url: '/status', connectionId: 'c', outputMappings: [{ chipKey: 'status', chipLabel: 'Status', jsonPath: 'status' }] }),
  }] })];
  const operation = { id: 'op', requestId: 'req', capabilityId: 'p:s', integrationIdentity: 'old', status: 'succeeded', values: { status: 'private' }, at: '2026-11-04T10:00:00.000Z' };
  const uncertain = { ...operation, id: 'uncertain', status: 'unknown', values: {} };
  const state = { reasoning: { requests: [{ id: 'req', procedureId: 'p', integrationValues: { status: 'private', independent: 'keep' } }], operations: [operation, uncertain] } } as unknown as StudioSession;
  return { document, state, operation, uncertain };
}

describe('active integration result invalidation', () => {
  it.each([{ name: 'revocation', active: new Map<string, string>(), clear: null }, { name: 'credential replacement', active: new Map([['p:s', 'new']]), clear: null }, { name: 'explicit clearing', active: new Map([['p:s', 'old']]), clear: '2026-11-04T10:01:00.000Z' }])('removes stale values after $name but preserves operation identity and uncertain effect', ({ active, clear }) => {
    const { document, state, operation, uncertain } = fixture();
    expect(invalidateInactiveStudioIntegrationData(document, state, active, clear)).toBe(true);
    expect(state.reasoning!.requests[0].integrationValues).toEqual({ independent: 'keep' });
    expect(operation.values).toEqual({});
    expect(uncertain).toMatchObject({ id: 'uncertain', status: 'unknown', values: {} });
  });
  it('keeps a successful result only when its last matching operation and connection are current', () => {
    const { document, state, operation } = fixture();
    state.reasoning!.operations.pop();
    expect(invalidateInactiveStudioIntegrationData(document, state, new Map([['p:s', 'old']]), null)).toBe(false);
    expect(operation.values).toEqual({ status: 'private' });
    expect(state.reasoning!.requests[0].integrationValues.status).toBe('private');
  });
  it('treats older results without connection identity as stale', () => {
    const { document, state, operation } = fixture();
    state.reasoning!.operations.pop();
    delete (operation as { integrationIdentity?: string }).integrationIdentity;
    expect(invalidateInactiveStudioIntegrationData(document, state, new Map([['p:s', 'old']]), null)).toBe(true);
    expect(operation.values).toEqual({});
  });
});
