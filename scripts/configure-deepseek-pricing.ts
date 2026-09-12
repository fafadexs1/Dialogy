import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { PlatformAiConfigSchema, type PlatformAiConfig } from '../src/lib/platform-ai';
import { parseAiModelCatalog, SYSTEM_AI_MODEL_CATALOG_KEY } from '../src/lib/ai-models';
import { assertDecisionModelsAvailable, parseAiDecisionModelConfig, SYSTEM_AI_DECISION_MODELS_KEY } from '../src/lib/ai-decision-models';

loadEnv({path:['.env.local','.env'],quiet:true});
const target = 'deepseek/deepseek-flash';
// Official pricing and PTAX checked on 2026-09-12. Fixed reference: peak, cache miss.
const reference = { inputUsd:0.30, outputUsd:1.20, usdToBrl:5.0918,
  providerSource:'https://api-docs.deepseek.com/quick_start/pricing/',
  fxDate:'2026-09-11', checkedAt:'2026-09-12', basis:'peak_cache_miss' };

async function main() {
  if (!process.argv.includes('--apply')) throw new Error('Pass --apply to save the reviewed 2026-09-12 prices.');
  const client = new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('platform-ai-settings'))");
    const current = await client.query("SELECT config FROM ai_platform_settings WHERE id='global' FOR UPDATE");
    const legacy = await client.query('SELECT value FROM system_settings WHERE key=$1',[SYSTEM_AI_MODEL_CATALOG_KEY]);
    const decisions = await client.query('SELECT value FROM system_settings WHERE key=$1',[SYSTEM_AI_DECISION_MODELS_KEY]);
    const before = await client.query('SELECT count(*)::int AS agents FROM autopilot_configs');
    const saved:PlatformAiConfig|null = current.rows[0] ? PlatformAiConfigSchema.parse(current.rows[0].config) : null;
    const models = saved?.models || (legacy.rows[0]?.value ? parseAiModelCatalog(legacy.rows[0].value).map(model=>({...model,inputCost:0,outputCost:0,inputMarkup:0,outputMarkup:0})) : []);
    if (!models.some(model=>model.id===target && model.enabled)) throw new Error('The registered active DeepSeek model was not found.');
    const config:PlatformAiConfig = saved || {defaultModel:target,models,creditValueBrl:.01,costCurrency:'USD',usdToBrl:reference.usdToBrl,billingEnabled:false};
    const conversion = config.costCurrency==='USD' ? 1 : reference.usdToBrl;
    config.models = models.map(model=>model.id===target ? {...model,inputCost:reference.inputUsd*conversion,outputCost:reference.outputUsd*conversion} : model);
    PlatformAiConfigSchema.parse(config);
    if (decisions.rows[0]?.value) assertDecisionModelsAvailable(parseAiDecisionModelConfig(decisions.rows[0].value),config.models);
    await client.query("INSERT INTO ai_platform_settings(id,config) VALUES('global',$1) ON CONFLICT(id) DO UPDATE SET config=excluded.config,updated_at=now()",[JSON.stringify(config)]);
    const verified=await client.query("SELECT config FROM ai_platform_settings WHERE id='global'");
    const persisted=PlatformAiConfigSchema.parse(verified.rows[0].config);
    const after=await client.query('SELECT count(*)::int AS agents FROM autopilot_configs');
    if(JSON.stringify(persisted)!==JSON.stringify(PlatformAiConfigSchema.parse(config)))throw new Error('Saved configuration differs from the requested configuration.');
    const credentials=await client.query("SELECT EXISTS(SELECT 1 FROM ai_provider_credentials WHERE provider='deepseek' AND length(api_key)>0) AS configured");
    await client.query('COMMIT');
    console.log(JSON.stringify({saved:true,model:persisted.models.find(model=>model.id===target),defaultModel:persisted.defaultModel,
      currency:persisted.costCurrency,usdToBrl:persisted.usdToBrl,creditValueBrl:persisted.creditValueBrl,billingEnabled:persisted.billingEnabled,
      modelsPreserved:persisted.models.length,agentsBefore:before.rows[0].agents,agentsAfter:after.rows[0].agents,
      credentialPresent:credentials.rows[0].configured,reference},null,2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {await client.end();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Configuration failed');process.exitCode=1;});
