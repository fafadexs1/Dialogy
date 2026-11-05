import { describe, expect, it, vi } from 'vitest';
import { advanceStudioSession, createStudioSession, StudioSessionSchema, type StudioEngineDependencies } from '@/services/agent-studio/engine';
import { interpretStudioTurn } from '@/services/agent-studio/turn-interpreter';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, CollectedFieldDefinitionSchema } from '@/services/agent-studio/types';

function fixture() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.resolveStage.conversationMode = 'adaptive';
  document.concludeStage.confirmResolutionQuestion = 'Consegui te ajudar com todas as dúvidas? Se quiser contratar ou consultar seu endereço, é só me falar!';
  document.concludeStage.successClosingMessage = 'Excelente! Foi um prazer te atender. Conte sempre com a Velpro 😊 Tenha um ótimo dia!';
  document.concludeStage.handoffTeam = 'Support';
  document.resolveStage.procedures = [
    ProcedureDocumentSchema.parse({
      id: 'contract',
      name: 'Iniciar contratação',
      updatedAt: '2026-09-06',
      steps: [
        {
          id: 'name',
          order: 1,
          type: 'collect_data',
          title: 'Nome',
          collectField: CollectedFieldDefinitionSchema.parse({
            id: 'name',
            name: 'Nome',
            type: 'text',
            variableKey: 'name',
            promptMessage: 'Qual o seu nome completo?',
          }),
        },
      ],
    }),
  ];

  let state = createStudioSession('agent', 'release', 'session');
  let seq = 0;
  const deps: StudioEngineDependencies = {
    interpretTurn: vi.fn().mockResolvedValue({ kind: 'answer' }),
    chooseProcedure: vi.fn().mockResolvedValue(null),
    knowledge: vi.fn().mockResolvedValue('Informação verificada.'),
    planAction: vi.fn().mockImplementation(async ({ question }) => (question ? 'answer' : 'continue')),
    execute: vi.fn(),
    handoff: vi.fn().mockResolvedValue(undefined),
    checkpoint: vi.fn(),
  };

  return {
    document,
    deps,
    get state() {
      return state;
    },
    async send(message: string, id = String(++seq)) {
      const r = await advanceStudioSession({
        document,
        state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(state))),
        message,
        messageId: id,
        dependencies: deps,
      });
      state = r.state;
      return r;
    },
  };
}

describe('AI-driven conversation conclusion', () => {
  it('concludes gracefully without handoff when customer answers polite negative to confirm resolution', async () => {
    const f = fixture();
    Object.assign(f.state, { phase: 'conclude', procedureId: null, stepIndex: 0 });
    // AI naturally interprets "Não, era só isso mesmo, obrigado" as conclude
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'conclude' });

    const result = await f.send('Não, era só isso mesmo, muito obrigado!');

    expect(result.state.phase).toBe('done');
    expect(result.state.status).toBe('resolved');
    expect(result.response).toContain('Excelente! Foi um prazer te atender');
    expect(f.deps.handoff).not.toHaveBeenCalled();
  });

  it('concludes gracefully when customer expresses gratitude in conclude phase', async () => {
    const f = fixture();
    Object.assign(f.state, { phase: 'conclude', procedureId: null, stepIndex: 0 });
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'conclude' });

    const result = await f.send('Muito obrigado pela atenção Raquel, tenha um bom dia!');

    expect(result.state.phase).toBe('done');
    expect(result.state.status).toBe('resolved');
    expect(result.response).toContain('Excelente! Foi um prazer te atender');
    expect(f.deps.handoff).not.toHaveBeenCalled();
  });

  it('triggers handoff when customer explicitly states the issue was not resolved (reject)', async () => {
    const f = fixture();
    Object.assign(f.state, { phase: 'conclude', procedureId: null, stepIndex: 0 });
    // AI naturally interprets that the customer issue is NOT solved
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'reject' });

    await f.send('Não resolveu nada, continuo sem internet');

    expect(f.deps.handoff).toHaveBeenCalledWith(
      'Support',
      expect.stringContaining('não foi resolvida'),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ reasonCode: 'reclamacao_grave', briefing: expect.stringContaining('Resumo da IA') })
    );
  });

  it('triggers handoff when customer asks for a person in conclude phase', async () => {
    const f = fixture();
    Object.assign(f.state, { phase: 'conclude', procedureId: null, stepIndex: 0 });
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'handoff' });

    await f.send('Quero falar com um atendente humano por favor');

    expect(f.deps.handoff).toHaveBeenCalledWith(
      'Support',
      expect.stringContaining('atendimento humano'),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ reasonCode: 'cliente_pediu' })
    );
  });

  it('concludes immediately when customer spontaneously says goodbye outside conclude phase', async () => {
    const f = fixture();
    Object.assign(f.state, { phase: 'resolve', procedureId: null });
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'conclude' });

    const result = await f.send('Valeu, era só isso, pode encerrar.');

    expect(result.state.phase).toBe('done');
    expect(result.state.status).toBe('resolved');
    expect(result.response).toContain('Excelente! Foi um prazer te atender');
    expect(f.deps.handoff).not.toHaveBeenCalled();
  });

  it('clears active procedure and concludes when customer requests to end during a procedure', async () => {
    const f = fixture();
    Object.assign(f.state, { phase: 'resolve', procedureId: 'contract', pendingField: 'name', stepIndex: 0 });
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'conclude' });

    const result = await f.send('Obrigado, não vou mais precisar contratar por hoje, valeu!');

    expect(result.state.phase).toBe('done');
    expect(result.state.status).toBe('resolved');
    expect(result.state.procedureId).toBeNull();
    expect(result.response).toContain('Excelente! Foi um prazer te atender');
    expect(f.deps.handoff).not.toHaveBeenCalled();
  });

  it('interpretStudioTurn includes conclude in allowed decisions', async () => {
    const document = createDefaultAgentStudioDocument('agent', 'workspace');
    const state = createStudioSession('agent', 'release', 'session');
    state.phase = 'conclude';

    let capturedChoices: { id: string; label: string }[] = [];
    const decide = vi.fn().mockImplementation(async (_prompt: string, choices: { id: string; label: string }[]) => {
      capturedChoices = choices;
      return 'turn_conclude';
    });

    const decision = await interpretStudioTurn(
      {
        document,
        state,
        message: 'Não, era só isso mesmo, obrigado!',
        context: { contact: {}, values: {} },
      },
      decide
    );

    expect(capturedChoices.some((c) => c.label.includes('conclude'))).toBe(true);
    expect(decision).toEqual({ kind: 'conclude' });
  });
});
