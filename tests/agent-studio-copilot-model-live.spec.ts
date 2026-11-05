import { afterAll, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import type { Contact } from '@/lib/types';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, type AgentReleaseManifest } from '@/services/agent-studio/types';

// Opt-in: real configured provider, synthetic conversation, no customer or publication writes.
describe.skipIf(process.env.DIALOGY_COPILOT_LIVE !== '1')('Studio copilot with the real platform model', () => {
  let pool: typeof import('@/lib/db').db | undefined;
  afterAll(async () => { await pool?.end(); });
  it('continues a prior choice and handles unavailable information without executing the procedure', async () => {
    pool = (await import('@/lib/db')).db;
    const config = await (await import('@/services/ai/platform-config')).requirePlatformAiConfig();
    if (config.billingEnabled) throw new Error('Use a dedicated funded test workspace before enabling this synthetic live test with billing.');
    const id = '00000000-0000-4000-8000-000000000000';
    const document = createDefaultAgentStudioDocument(id, id);
    document.name = 'Assistente de teste'; document.objective = 'Ajudar o atendente a preparar uma instalação, respeitando escolhas já feitas. Não contratar nem cobrar.';
    document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'install', name: 'Preparar instalação', whenToUse: 'Cliente quer instalar um plano', updatedAt: '2026-09-19', status: 'published', steps: [
      { id: 'address', order: 1, type: 'collect_data', title: 'Confirmar endereço', collectField: { id: 'address', variableKey: 'address', name: 'Endereço', type: 'text', promptMessage: 'Qual é o endereço da instalação?' } },
      { id: 'cep', order: 2, type: 'collect_data', title: 'CEP opcional', collectField: { id: 'cep', variableKey: 'cep', name: 'CEP', type: 'cep', required: false, promptMessage: 'Se souber, informe o CEP.' } },
      { id: 'coverage', order: 3, type: 'http_request', title: 'Consultar cobertura para o endereço' },
    ] })];
    const release: AgentReleaseManifest = { releaseId: id, agentId: id, workspaceId: id, version: 1, agentSnapshot: document,
      publishedProcedures: document.resolveStage.procedures, referencedConnectionIds: [], mcpServerToolFingerprints: {}, knowledgeSnapshot: [], createdAt: '2026-09-19' };
    const { runStudioCopilot } = await import('@/services/agent-studio/copilot');
    const started = Date.now();
    const result = await runStudioCopilot({ release, workspaceId: id, agentId: id, chatId: id,
      message: 'Não sei meu CEP. Dá para continuar?', contact: { name: 'Cliente de teste' } as Contact,
      history: [{ content: 'Quero 700 mega sem mesh.', fromMe: false }, { content: 'Qual o endereço da instalação?', fromMe: true },
        { content: 'Rua das Flores, 10, Centro, Cidade Ocidental.', fromMe: false }, { content: 'Se souber, informe o CEP.', fromMe: true }],
      assertCurrent: async () => {},
    });
    expect(result.response.trim().length).toBeGreaterThan(0);
    expect(result.insights.knowledgeSources).toEqual([]);
    expect(result.insights.toolsUsed).toBeUndefined();
    expect(result.insights.recommendedActions?.every((action) => action.label.startsWith('Preparar instalação:'))).toBe(true);
    await writeFile('docs/copilot-studio-model-smoke.json', JSON.stringify({ at: new Date().toISOString(), durationMs: Date.now() - started,
      scope: 'Real platform model; synthetic conversation and published procedure; no external integrations, customer messages or session persistence. Not a production end-to-end test.', result }, null, 2));
    // Compile and execute the actual read-only context SQL against the configured database.
    const { loadStudioCopilotContext } = await import('@/services/agent-studio/copilot-context');
    await expect(loadStudioCopilotContext({ workspaceId: id, chatId: id, agentId: id, messageId: id })).rejects.toMatchObject({ code: 'AUTOPILOT_SOURCE_SUPERSEDED' });
  }, 110_000);
});
