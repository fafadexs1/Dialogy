import module from 'node:module';
import 'dotenv/config';

// Read-only local benchmark: never contact a model, execute a business tool,
// print customer text, or write a database row.
const originalRequire = module.prototype.require;
module.prototype.require = function patchedRequire(id) {
  if (id === 'server-only') return {};
  return originalRequire.call(this, id);
};

async function main() {
const [{ db }, { loadStudioRelease }, { readArchivedStudioSession }, { advanceStudioReasoningSession }]
  = await Promise.all([
    import('@/lib/db'), import('@/services/agent-studio/repository'), import('@/services/agent-studio/session-store'),
    import('@/services/agent-studio/reasoning-engine'),
  ]);

const decision = (kind: 'knowledge' | 'respond') => ({ requests: [], choices: [], action: {
  kind, requestId: null, capabilityId: null, query: kind === 'knowledge' ? 'consulta de referência controlada' : null,
  response: kind === 'respond' ? 'Verificação controlada concluída.' : null,
  consent: 'none', consentQuote: null, reason: '',
} });

const masked = (content: string) => 'mensagem '.repeat(Math.ceil(Math.min(content.length, 2500) / 9)).slice(0, Math.min(content.length, 2500));
const summary = { cases: 0, legacyPayloadChars: 0, compactPayloadChars: 0, skipped: 0,
  legacySections: {} as Record<string, number>, compactSections: {} as Record<string, number>,
  skippedReasons: {} as Record<string, number> };
const skip = (reason: string) => { summary.skipped++; summary.skippedReasons[reason] = (summary.skippedReasons[reason] || 0) + 1; };
try {
  const rows = await db.query(`SELECT id::text, workspace_id::text, agent_id::text, chat_id::text, release_id::text
    FROM agent_studio_sessions WHERE summary ? $1 ORDER BY started_at DESC LIMIT 30`, ['recoveryCheckpoint']);
  for (const row of rows.rows) {
    const scope = { workspaceId: row.workspace_id as string, agentId: row.agent_id as string, chatId: row.chat_id as string };
    try {
      const release = await loadStudioRelease(scope.workspaceId, scope.agentId, row.release_id as string);
      if (!release || release.releaseId !== row.release_id || !release.agentSnapshot.resolveStage.reasoning?.enabled) { skip('release_unavailable_or_not_reasoning'); continue; }
      const state = await readArchivedStudioSession(scope, String(row.id));
      if (!state?.reasoning || ['transferred', 'cancelled'].includes(state.status)) { skip('state_not_replayable'); continue; }
      const sources = (state.conversationMemory || []).slice(-30).flatMap((turn) => [
        { messageId: turn.messageId, content: masked(turn.customer), fromMe: false },
        { messageId: `${turn.messageId}:assistant`, content: masked(turn.assistant), fromMe: true },
      ]);
      const replay = async (compactContext: boolean) => {
        const contexts: Record<string, unknown>[] = [];
        const output = await advanceStudioReasoningSession({ document: release.agentSnapshot, state, message: 'Pode continuar o atendimento.',
          messageId: `lia1-benchmark-${row.id}`, context: { contact: { id: 'benchmark-contact' } }, sources,
          memory: { records: [], nextCursor: null }, maxDecisions: 3, compactContext,
          dependencies: { decide: async (context) => { contexts.push(structuredClone(context)); return decision(contexts.length === 1 ? 'knowledge' : 'respond'); },
            knowledge: async () => 'Resultado controlado.', execute: async () => { throw new Error('Business execution forbidden in benchmark.'); },
            handoff: async () => { throw new Error('Handoff forbidden in benchmark.'); },
            recall: async () => ({ records: [], nextCursor: null }), checkpoint: async () => {}, assertActive: () => {},
          },
        });
        return { contexts, response: output.response, status: output.state.status };
      };
      const legacy = await replay(false), compact = await replay(true);
      if (legacy.contexts.length !== 2 || compact.contexts.length !== 2
        || legacy.response !== compact.response || legacy.status !== compact.status) throw new Error('Paired replay diverged.');
      // Compare source contexts only. Provider transcript, schema, reasoning and
      // the adaptive delta/snapshot choice are measured separately in a canary.
      summary.legacyPayloadChars += legacy.contexts.reduce((size, context) => size + JSON.stringify(context).length, 0);
      summary.compactPayloadChars += compact.contexts.reduce((size, context) => size + JSON.stringify(context).length, 0);
      for (const [contexts, sizes] of [[legacy.contexts, summary.legacySections], [compact.contexts, summary.compactSections]] as const)
        for (const context of contexts) for (const [key, value] of Object.entries(context))
          sizes[key] = (sizes[key] || 0) + (JSON.stringify(value)?.length || 0);
      summary.cases++;
    } catch {
      skip('replay_error');
    }
  }
  const reductionPercent = summary.legacyPayloadChars
    ? Math.round((1 - summary.compactPayloadChars / summary.legacyPayloadChars) * 10_000) / 100 : null;
  process.stdout.write(`${JSON.stringify({ ...summary, reductionPercent,
    measure: 'full context snapshot characters on paired local historical states; not provider tokens or production resolution',
    customerContentExported: false })}\n`);
} finally {
  await db.end();
}
}

void main().catch((error) => {
  process.stderr.write(`LIA-1 context benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
