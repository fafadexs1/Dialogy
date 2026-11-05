import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { checkStudioAutomation, studioAutomation, studioAutomationKilled } from '@/services/agent-studio/automation';
import { checkStudioDependencies } from '@/services/agent-studio/publication-checks';
import { AgentStudioDocumentSchema, createDefaultAgentStudioDocument, StudioAutomationSchema, type AgentStudioDocument } from '@/services/agent-studio/types';
import { StudioAutomationSettings } from '@/components/autopilot/studio-automation-settings';

const doc = (automation?: unknown): AgentStudioDocument => {
  const base = createDefaultAgentStudioDocument('agent-1', 'ws');
  return { ...base, concludeStage: { ...base.concludeStage, automation: automation as never } };
};

describe('automation settings of an agent', () => {
  it('keep the previous behaviour by default, except that the promise guard observes', () => {
    expect(StudioAutomationSchema.parse({})).toMatchObject({
      closeOnCustomerConfirmation: false, transferWhenCustomerAsksForPerson: false, promiseGuard: 'observe',
      inactivity: { enabled: false, followupMinutes: 30, closeMinutes: 30, windowStartHour: 8, windowEndHour: 21 },
      queue: { enabled: false, alertAfterMinutes: 10, escalateAfterMinutes: 20, escalationTeamId: null, notifyCustomer: true, alertWebhookUrl: null },
    });
  });

  it('are filled in for a document saved before they existed', () => {
    const base = createDefaultAgentStudioDocument('agent-1', 'ws');
    const { automation: _removed, ...concludeWithout } = base.concludeStage;
    const old = JSON.parse(JSON.stringify({ ...base, concludeStage: concludeWithout }));
    const parsed = AgentStudioDocumentSchema.parse(old);
    expect(parsed.concludeStage.automation).toMatchObject({ closeOnCustomerConfirmation: false, promiseGuard: 'observe' });
    expect(studioAutomation({ concludeStage: concludeWithout as never }).inactivity.enabled).toBe(false);
  });

  it('are versioned with the document: a stored choice is returned exactly', () => {
    const chosen = StudioAutomationSchema.parse({ closeOnCustomerConfirmation: true, promiseGuard: 'enforce', inactivity: { enabled: true, followupMinutes: 60 } });
    expect(studioAutomation(doc(chosen))).toEqual(chosen);
  });

  it('refuse values that are unsafe at the schema level', () => {
    for (const bad of [{ inactivity: { followupMinutes: 9 } }, { inactivity: { closeMinutes: 5 } }, { queue: { alertAfterMinutes: 1 } }, { promiseGuard: 'banana' }, { inactivity: { windowEndHour: 25 } }]) {
      expect(StudioAutomationSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('fall back to the defaults when the stored value is corrupt, never to something more permissive', () => {
    expect(studioAutomation(doc({ inactivity: { enabled: true, followupMinutes: 1 } }))).toEqual(StudioAutomationSchema.parse({}));
  });

  it('are switched off for the whole platform by the operator kill switch', () => {
    const on = StudioAutomationSchema.parse({ closeOnCustomerConfirmation: true, transferWhenCustomerAsksForPerson: true, inactivity: { enabled: true }, queue: { enabled: true } });
    expect(studioAutomationKilled({ STUDIO_AUTOMATION_KILL_SWITCH: 'true' })).toBe(true);
    expect(studioAutomationKilled({})).toBe(false);
    expect(studioAutomation(doc(on), { STUDIO_AUTOMATION_KILL_SWITCH: 'true' })).toMatchObject({
      closeOnCustomerConfirmation: false, transferWhenCustomerAsksForPerson: false, promiseGuard: 'off', inactivity: { enabled: false }, queue: { enabled: false } });
    expect(studioAutomation(doc(on), {}).closeOnCustomerConfirmation).toBe(true);
  });
});

describe('publication checks for the automation settings', () => {
  const issues = (automation: unknown) => checkStudioAutomation(doc(automation)).map((issue) => issue.code);

  it('accept the defaults and a complete configuration', () => {
    expect(issues(undefined)).toEqual([]);
    expect(issues({ inactivity: { enabled: true, windowStartHour: 9, windowEndHour: 18 }, queue: { enabled: true, alertAfterMinutes: 5, escalateAfterMinutes: 15, alertWebhookUrl: 'https://hooks.example.com/a' } })).toEqual([]);
  });

  it('reject an inverted window, an escalation before the alert and a webhook that is not https', () => {
    expect(issues({ inactivity: { enabled: true, windowStartHour: 21, windowEndHour: 8 } })).toEqual(['AUTOMATION_WINDOW_INVALID']);
    expect(issues({ queue: { enabled: true, alertAfterMinutes: 30, escalateAfterMinutes: 20 } })).toEqual(['AUTOMATION_QUEUE_ORDER']);
    for (const url of ['http://hooks.example.com', 'https://user:pass@hooks.example.com', 'not a url']) {
      expect(issues({ queue: { alertWebhookUrl: url } })).toEqual(['AUTOMATION_WEBHOOK_INVALID']);
    }
  });

  it('do not complain about an inverted window while the feature is off', () => {
    expect(issues({ inactivity: { enabled: false, windowStartHour: 21, windowEndHour: 8 } })).toEqual([]);
  });

  it('block publication of the agent', () => {
    const found = checkStudioDependencies(doc({ inactivity: { enabled: true, windowStartHour: 21, windowEndHour: 8 } }));
    expect(found).toContainEqual(expect.objectContaining({ code: 'AUTOMATION_WINDOW_INVALID', severity: 'error' }));
  });
});

describe('the settings screen', () => {
  const render = (automation: unknown, teams = [{ id: 'team-1', name: 'Financeiro' }, { id: 'team-2', name: 'Gerência' }]) =>
    renderToStaticMarkup(<StudioAutomationSettings automation={automation as never} teams={teams} onChange={() => undefined} />);

  it('explains each choice in plain language and shows the safe defaults', () => {
    const html = render(undefined);
    expect(html).toContain('Autonomia do agente');
    expect(html).toContain('Transferir na hora quando o cliente pedir uma pessoa');
    expect(html).toContain('Encerrar o atendimento só quando o cliente confirmar que acabou');
    expect(html).toContain('Avisar e encerrar quando o cliente parar de responder');
    expect(html).toContain('Acompanhar a fila quando a equipe não tiver ninguém disponível');
    expect(html).toContain('Só registrar para eu acompanhar (recomendado para começar)');
    expect(html).not.toContain('checked=""');
  });

  it('hides the details of a feature until it is turned on', () => {
    expect(render(undefined)).not.toContain('Avisar depois de');
    expect(render(undefined)).not.toContain('Equipe que recebe a conversa');
    const on = render({ inactivity: { enabled: true }, queue: { enabled: true } });
    expect(on).toContain('Avisar depois de');
    expect(on).toContain('Encerrar depois de mais');
    expect(on).toContain('Equipe que recebe a conversa se ninguém atender');
    expect(on).toContain('minutos sem resposta');
  });

  it('lists the workspace teams for the escalation and preselects the stored one', () => {
    const html = render({ queue: { enabled: true, escalationTeamId: 'team-2' } });
    expect(html).toContain('>Financeiro</option>');
    expect(html).toMatch(/<option value="team-2" selected=""[^>]*>Gerência<\/option>/);
    expect(html).toContain('apenas marcar como “precisa de atenção”');
  });

  it('warns about invalid combinations before the user tries to publish', () => {
    expect(render({ inactivity: { enabled: true, windowStartHour: 21, windowEndHour: 8 } })).toContain('O horário inicial precisa ser antes do final.');
    expect(render({ queue: { enabled: true, alertAfterMinutes: 30, escalateAfterMinutes: 20 } })).toContain('O escalonamento precisa vir depois do alerta.');
    expect(render({ queue: { enabled: true, alertWebhookUrl: 'http://x.example.com' } })).toContain('Use um endereço https válido');
  });

  it('states that the minimum wait is 10 minutes and that nothing leaks customer text', () => {
    const html = render({ inactivity: { enabled: true }, queue: { enabled: true } });
    expect(html).toContain('O mínimo é de 10 minutos em cada espera');
    expect(html).toContain('nunca o texto da conversa');
  });
});
