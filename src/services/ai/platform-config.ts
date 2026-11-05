import 'server-only';
import { db } from '@/lib/db';
import { PlatformAiConfigSchema, type PlatformAiConfig } from '@/lib/platform-ai';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import type { PoolClient } from 'pg';

export async function readPlatformAiConfig(connection: Pick<PoolClient, 'query'> = db): Promise<PlatformAiConfig | null> {
  const result = await connection.query("SELECT config FROM ai_platform_settings WHERE id='global'");
  if (!result.rows[0]) return null;
  return PlatformAiConfigSchema.parse(result.rows[0].config);
}

export async function withPlatformAiSettingsTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    // Model availability and role assignments must change under the same lock.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('platform-ai-settings'))");
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function requirePlatformAiConfig() {
  const config = await readPlatformAiConfig();
  if (!config) throw new Error('A IA da plataforma ainda nao foi configurada pelo administrador.');
  return config;
}

export async function platformModel() {
  const config = await requirePlatformAiConfig();
  return config.models.find(m => m.id === config.defaultModel && m.enabled)!;
}

export async function platformApiKey(model: string) {
  const provider = getAiModelRuntimeProvider(model);
  if (provider === 'lmstudio') {
    const { getGlobalLmStudioConfig } = await import('./lm-studio');
    return (await getGlobalLmStudioConfig()).apiToken || 'lm-studio';
  }
  const result = await db.query('SELECT api_key FROM ai_provider_credentials WHERE provider=$1', [provider]);
  const fallback = provider === 'googleai' ? process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY
    : provider === 'openai' ? process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY
      : provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : undefined;
  const key = result.rows[0]?.api_key || fallback;
  if (!key) throw new Error('Credencial da IA nao configurada no superadmin.');
  return String(key);
}
