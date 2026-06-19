import 'dotenv/config';
import { db } from '../src/lib/db';

const workspaceId = '5c3a91e9-b243-4436-80ba-42434bc5ca97';
const configId = '475cc308-03a6-483f-8fdd-10084f0c73b8';
const userId = '8fe1f4da-9305-475c-95d1-83bda9f29b22';

async function main() {
  console.log('[STAGE] Fetching config row...');
  const configRes = await db.query(
    'SELECT * FROM autopilot_configs WHERE id = $1 LIMIT 1',
    [configId]
  );
  if (configRes.rowCount === 0) {
    throw new Error('Config row not found.');
  }
  const configRow = configRes.rows[0];

  console.log('[STAGE] Preparing active snapshot...');
  const snapshot = {
    name: configRow.name || 'Fabricio Soares',
    gemini_api_key: configRow.gemini_api_key,
    ai_model: 'lmstudio/google/gemma-4-12b-qat',
    transcription_model: configRow.transcription_model,
    knowledge_base: configRow.knowledge_base,
    knowledge_base_documents: configRow.knowledge_base_documents || [],
    knowledge_collections: configRow.knowledge_collections || [],
    is_active: true, // Activate!
    is_private: configRow.is_private,
    default_fallback_reply: configRow.default_fallback_reply,
    escalation_policy: configRow.escalation_policy,
    closing_policy: configRow.closing_policy,
    enabled_tool_names: configRow.enabled_tool_names || [],
    flow_graph: configRow.flow_graph,
  };

  console.log('[STAGE] Publishing draft & updating db inside transaction...');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    
    // 1. Get next version number
    const nextVersionRes = await client.query(
      'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM autopilot_config_versions WHERE config_id = $1',
      [configId]
    );
    const versionNumber = Number(nextVersionRes.rows[0]?.next_version || 1);
    
    // 2. Update config row (setting is_active to true)
    await client.query(
      `UPDATE autopilot_configs
       SET
          name = $3,
          is_active = true,
          ai_model = $4,
          updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2`,
      [
        workspaceId,
        configId,
        snapshot.name,
        snapshot.ai_model,
      ]
    );

    // 3. Insert into versions
    await client.query(
      `INSERT INTO autopilot_config_versions
          (config_id, workspace_id, user_id, version_number, label, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        configId,
        workspaceId,
        userId,
        versionNumber,
        `Publicacao v${versionNumber} (Ativação e Modelo 12b via Script)`,
        JSON.stringify(snapshot),
      ]
    );

    // 4. Delete draft if exists
    await client.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1', [configId]);

    await client.query('COMMIT');
    console.log('[STAGE] Flow committed, activated, and published successfully as version', versionNumber);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[ERROR] Failed:', err);
  process.exit(1);
});
