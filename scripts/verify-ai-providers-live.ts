import 'dotenv/config';

import { db } from '../src/lib/db';
import { DEFAULT_AUTOPILOT_MODEL } from '../src/lib/ai-models';
import {
  getDefaultDeepSeekEnvKey,
  getDefaultGeminiEnvKey,
  getDefaultOpenAiEnvKey,
} from '../src/services/ai/provider-keys';
import {
  testAiProviderConnection,
  type AiProviderConnectionProvider,
} from '../src/services/ai/provider-health';

type Target = {
  provider: AiProviderConnectionProvider;
  model: string;
  apiKey: string;
  keySource: string;
};

const REQUIRED_PROVIDERS: AiProviderConnectionProvider[] = ['gemini', 'openai', 'deepseek'];

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function defaultModel(provider: AiProviderConnectionProvider): string {
  if (provider === 'gemini') return DEFAULT_AUTOPILOT_MODEL;
  if (provider === 'deepseek') return 'deepseek/deepseek-v4-flash';
  return 'openai/gpt-5.4-mini';
}

function envKey(provider: AiProviderConnectionProvider): string {
  if (provider === 'gemini') return getDefaultGeminiEnvKey();
  if (provider === 'deepseek') return getDefaultDeepSeekEnvKey();
  return getDefaultOpenAiEnvKey();
}

async function loadWorkspaceTargets(workspaceId?: string | null): Promise<Map<AiProviderConnectionProvider, Target>> {
  const targets = new Map<AiProviderConnectionProvider, Target>();
  try {
    const whereWorkspace = workspaceId ? 'AND workspace_id = $2' : '';
    const params = workspaceId
      ? [REQUIRED_PROVIDERS, workspaceId]
      : [REQUIRED_PROVIDERS];
    const result = await db.query(
      `
        SELECT DISTINCT ON (provider)
          provider,
          config->>'apiKey' AS api_key,
          config->>'aiModel' AS ai_model
        FROM workspace_integrations
        WHERE provider = ANY($1::text[])
          ${whereWorkspace}
          AND is_active = true
          AND COALESCE(config->>'apiKey', '') <> ''
        ORDER BY provider, updated_at DESC
      `,
      params,
    );

    for (const row of result.rows) {
      const provider = row.provider as AiProviderConnectionProvider;
      targets.set(provider, {
        provider,
        model: clean(row.ai_model) || defaultModel(provider),
        apiKey: clean(row.api_key),
        keySource: workspaceId ? `workspace:${workspaceId}` : 'workspace:latest-active',
      });
    }
  } catch (error) {
    console.warn(`[warn] Could not load workspace AI provider keys: ${error instanceof Error ? error.message : String(error)}`);
  }
  return targets;
}

async function main() {
  const workspaceId = getArg('--workspace');
  const workspaceTargets = await loadWorkspaceTargets(workspaceId);
  const targets = REQUIRED_PROVIDERS.map((provider): Target => {
    const workspaceTarget = workspaceTargets.get(provider);
    if (workspaceTarget) return workspaceTarget;
    return {
      provider,
      model: defaultModel(provider),
      apiKey: envKey(provider),
      keySource: envKey(provider) ? 'environment' : 'missing',
    };
  });

  let passed = 0;
  for (const target of targets) {
    const result = await testAiProviderConnection({
      provider: target.provider,
      model: target.model,
      apiKey: target.apiKey,
      timeoutMs: 12000,
    });
    const prefix = result.ok ? '[ok]' : '[fail]';
    console.log(`${prefix} ${target.provider} ${result.model || target.model} ${result.durationMs}ms key=${target.keySource} ${result.message}`);
    if (result.ok) passed += 1;
  }

  await db.end();
  if (passed !== REQUIRED_PROVIDERS.length) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => undefined);
  process.exitCode = 1;
});
