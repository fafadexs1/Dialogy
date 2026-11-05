require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const value = (flag) => process.argv[process.argv.indexOf(flag) + 1];
async function main() {
  if (process.argv.includes('--list')) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, max: 1 });
    try {
      const rows = await pool.query(`SELECT a.id,a.workspace_id,a.name,v.version_number,
        v.snapshot->'agent_release_manifest'->'runtimeConfig'->>'aiModel' AS published_model
        FROM autopilot_configs a JOIN LATERAL (SELECT snapshot,version_number FROM autopilot_config_versions
          WHERE config_id=a.id AND workspace_id=a.workspace_id ORDER BY version_number DESC LIMIT 1) v ON true
        WHERE a.is_active=true AND v.snapshot ? 'agent_release_manifest' ORDER BY a.name LIMIT 30`);
      console.log(JSON.stringify(rows.rows, null, 2));
    } finally { await pool.end(); }
    return;
  }
  if (!process.argv.includes('--agent') || !process.argv.includes('--workspace')) throw new Error('Use --list or --agent UUID --workspace UUID. Only synthetic conversations and real model calls; no customer messages or business writes.');
  const agent = value('--agent'), workspace = value('--workspace');
  if (![agent, workspace].every((id) => /^[0-9a-f-]{36}$/i.test(id || ''))) throw new Error('Valid agent and workspace UUIDs are required.');
  const result = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/agent-studio-model-live.spec.ts', '--reporter=verbose'], {
    stdio: 'inherit', env: { ...process.env, DIALOGY_STUDIO_LIVE_AGENT: agent, DIALOGY_STUDIO_LIVE_WORKSPACE: workspace },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
main().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; });
