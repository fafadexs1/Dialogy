import 'dotenv/config';
import { db } from '../src/lib/db';

const WORKSPACE_ID = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
const AGENT_ID = '7d7259ab-a6c3-4057-a9ca-28ddbb15db95';
const USER_ID = '8fe1f4da-9305-475c-95d1-83bda9f29b22';

async function main() {
  const isApply = process.argv.includes('--apply');
  console.log(`=== RESTAURAÇÃO DO LUCAS PARA O MODO GUIADO (V60) [${isApply ? 'APPLY' : 'DRY-RUN'}] ===\n`);

  const client = await db.connect();
  try {
    // 1. Carregar V60
    const v60Res = await client.query(
      `SELECT * FROM autopilot_config_versions WHERE config_id = $1 AND version_number = 60`,
      [AGENT_ID]
    );
    if (!v60Res.rows[0]) {
      throw new Error('Versão 60 não encontrada no banco de dados!');
    }
    const v60 = v60Res.rows[0];
    const v60Snapshot = v60.snapshot;
    console.log(`✓ V60 carregada com sucesso. Label: "${v60.label}"`);
    console.log(`  - flow_graph nós: ${v60Snapshot.flow_graph?.nodes?.length}`);
    console.log(`  - workflow_runtime_v2_mode: ${v60Snapshot.workflow_runtime_v2_mode}`);
    console.log(`  - active_workflow_version: ${v60Snapshot.active_workflow_version}`);
    console.log(`  - enabled_tool_names: ${v60Snapshot.enabled_tool_names?.length} ferramentas`);

    // 2. Determinar próxima versão
    const nextVerRes = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM autopilot_config_versions WHERE config_id = $1`,
      [AGENT_ID]
    );
    const nextVersion = Number(nextVerRes.rows[0].next_version);
    console.log(`✓ Próxima versão a ser registrada: v${nextVersion}`);

    // 3. Carregar versão atual (v68) para auditoria
    const currentRes = await client.query(
      `SELECT version_number, snapshot FROM autopilot_config_versions WHERE config_id = $1 ORDER BY version_number DESC LIMIT 1`,
      [AGENT_ID]
    );
    const current = currentRes.rows[0];
    const currentManifest = current?.snapshot?.agent_release_manifest;
    console.log(`✓ Versão atual ativa antes da restauração: v${current.version_number}`);

    // 4. Montar snapshot v69 de restauração
    const restoredSnapshot = {
      ...v60Snapshot,
      agent_studio_rollback: {
        fromVersion: current.version_number,
        fromReleaseId: currentManifest?.releaseId || null,
        rolledBackAt: new Date().toISOString(),
        rolledBackByUserId: USER_ID,
        reason: 'Restauração do modo guiado (V60) solicitada pelo usuário',
      },
    };
    // Garantir que NÃO há agent_release_manifest para que o runtime execute o modo guiado
    delete (restoredSnapshot as any).agent_release_manifest;

    // 5. Preservar rascunho com modo guiado
    const currentDraftRes = await client.query(
      `SELECT snapshot FROM autopilot_config_drafts WHERE config_id = $1 AND workspace_id = $2`,
      [AGENT_ID, WORKSPACE_ID]
    );
    let updatedDraft = currentDraftRes.rows[0]?.snapshot || current?.snapshot;
    if (updatedDraft && updatedDraft.agent_studio_document) {
      updatedDraft = {
        ...updatedDraft,
        agent_studio_document: {
          ...updatedDraft.agent_studio_document,
          status: 'draft',
          resolveStage: {
            ...updatedDraft.agent_studio_document.resolveStage,
            conversationMode: 'guided',
            reasoning: {
              ...(updatedDraft.agent_studio_document.resolveStage?.reasoning || {}),
              enabled: false,
            },
          },
          updatedAt: new Date().toISOString(),
        },
      };
      delete updatedDraft.agent_release_manifest;
    }

    if (!isApply) {
      console.log('\n[DRY-RUN] Nenhuma alteração persistida no banco. Para aplicar, execute com --apply.');
      process.exit(0);
    }

    // 6. Aplicar em transação
    console.log('\nIniciando transação PostgreSQL...');
    await client.query('BEGIN');

    // 6.1 Atualizar autopilot_configs com os campos da V60
    await client.query(
      `UPDATE autopilot_configs SET
          name = $3,
          ai_model = $4,
          transcription_model = $5,
          knowledge_base = $6,
          knowledge_base_documents = $7::jsonb,
          knowledge_collections = $8::jsonb,
          enabled_tool_names = $9::jsonb,
          flow_graph = $10::jsonb,
          workflow_builder_mode = $11,
          workflow_runtime_v2_mode = $12,
          active_workflow_id = $13,
          active_workflow_version = $14,
          agent_domain_pack_id = $15,
          default_fallback_reply = $16,
          escalation_policy = $17,
          closing_policy = $18,
          inactivity_timeout_seconds = $19,
          is_active = $20,
          is_private = $21,
          updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2`,
      [
        WORKSPACE_ID,
        AGENT_ID,
        v60Snapshot.name,
        v60Snapshot.ai_model,
        v60Snapshot.transcription_model,
        v60Snapshot.knowledge_base,
        JSON.stringify(v60Snapshot.knowledge_base_documents || []),
        JSON.stringify(v60Snapshot.knowledge_collections || []),
        JSON.stringify(v60Snapshot.enabled_tool_names || []),
        v60Snapshot.flow_graph ? JSON.stringify(v60Snapshot.flow_graph) : null,
        v60Snapshot.workflow_builder_mode || 'native_v2',
        v60Snapshot.workflow_runtime_v2_mode || 'primary',
        v60Snapshot.active_workflow_id,
        v60Snapshot.active_workflow_version || 'v60',
        v60Snapshot.agent_domain_pack_id || null,
        v60Snapshot.default_fallback_reply,
        v60Snapshot.escalation_policy,
        v60Snapshot.closing_policy,
        v60Snapshot.inactivity_timeout_seconds,
        true,
        false,
      ]
    );
    console.log('✔ autopilot_configs atualizado com o runtime guiado da V60.');

    // 6.2 Inserir nova versão v69
    await client.query(
      `INSERT INTO autopilot_config_versions
         (config_id, workspace_id, user_id, version_number, label, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        AGENT_ID,
        WORKSPACE_ID,
        USER_ID,
        nextVersion,
        `Retorno ao modo guiado v${nextVersion} (Restauração da V60 anterior ao modo adaptativo)`,
        JSON.stringify(restoredSnapshot),
      ]
    );
    console.log(`✔ autopilot_config_versions v${nextVersion} registrado com sucesso.`);

    // 6.3 Atualizar rascunho
    if (updatedDraft) {
      await client.query(
        `INSERT INTO autopilot_config_drafts (config_id, workspace_id, user_id, snapshot, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW())
         ON CONFLICT (config_id) DO UPDATE SET
           workspace_id = EXCLUDED.workspace_id,
           user_id = EXCLUDED.user_id,
           snapshot = EXCLUDED.snapshot,
           updated_at = EXCLUDED.updated_at`,
        [AGENT_ID, WORKSPACE_ID, USER_ID, JSON.stringify(updatedDraft)]
      );
      console.log('✔ autopilot_config_drafts preservado com modo guiado.');
    }

    await client.query('COMMIT');
    console.log('✔ Transação confirmada com SUCESSO!');
    console.log(`\n========================================================================`);
    console.log(`=== LUCAS RESTAURADO AO MODO GUIADO (V60 ATIVADA COMO V${nextVersion}) ===`);
    console.log(`========================================================================`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erro na operação, rollback executado:', error);
    throw error;
  } finally {
    client.release();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
