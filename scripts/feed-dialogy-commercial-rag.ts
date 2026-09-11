import 'dotenv/config';
import { db } from '../src/lib/db';
import { VectorStore } from '../src/lib/vector-store';
import { ingestKnowledgeBaseDocument } from '../src/services/rag/document-ingestion';
import {
  DIALOGY_WORKSPACE_ID,
  DIALOGY_COM_AUTOPILOT_CONFIG_ID,
  DIALOGY_COM_SYSTEM_AGENT_ID,
  DIALOGY_COMMERCIAL_SYSTEM_PROMPT,
  DIALOGY_COMMERCIAL_ESCALATION_POLICY,
  DIALOGY_COMMERCIAL_CLOSING_POLICY,
  DIALOGY_COMMERCIAL_FALLBACK_REPLY,
  DIALOGY_COMMERCIAL_ENABLED_TOOLS,
  DIALOGY_COMMERCIAL_COLLECTIONS,
  DIALOGY_COMMERCIAL_KNOWLEDGE_DOCUMENTS,
} from './dialogy-commercial-data';

async function main() {
  console.log('===========================================================');
  console.log(' OTIMIZAÇÃO & RAG DO AGENTE DIALOGY COMERCIAL VIRTUAL');
  console.log('===========================================================');
  console.log(`Workspace ID:        ${DIALOGY_WORKSPACE_ID}`);
  console.log(`Autopilot Config ID: ${DIALOGY_COM_AUTOPILOT_CONFIG_ID}`);
  console.log(`System Agent ID:     ${DIALOGY_COM_SYSTEM_AGENT_ID}`);
  console.log(`Coleções:            ${DIALOGY_COMMERCIAL_COLLECTIONS.length}`);
  console.log(`Documentos RAG:      ${DIALOGY_COMMERCIAL_KNOWLEDGE_DOCUMENTS.length}`);

  // 1. Validar integridade do Workspace e Agente
  const wsCheck = await db.query('SELECT id, name FROM workspaces WHERE id = $1', [DIALOGY_WORKSPACE_ID]);
  if (wsCheck.rowCount === 0) {
    throw new Error(`Workspace ${DIALOGY_WORKSPACE_ID} não encontrado.`);
  }
  console.log(`\n✔ Workspace validado: "${wsCheck.rows[0].name}"`);

  const apCheck = await db.query('SELECT id, name FROM autopilot_configs WHERE id = $1', [DIALOGY_COM_AUTOPILOT_CONFIG_ID]);
  if (apCheck.rowCount === 0) {
    throw new Error(`Autopilot Config ${DIALOGY_COM_AUTOPILOT_CONFIG_ID} não encontrado.`);
  }
  console.log(`✔ Autopilot Config validado: "${apCheck.rows[0].name}"`);

  // 2. Atualizar autopilot_configs no banco com Persona, Políticas e RAG
  console.log('\n--- ATUALIZANDO AUTOPILOT_CONFIGS NO BANCO ---');
  await db.query(
    `UPDATE autopilot_configs
     SET
       knowledge_base = $1,
       escalation_policy = $2,
       closing_policy = $3,
       default_fallback_reply = $4,
       enabled_tool_names = $5::jsonb,
       tool_mode = 'on_demand',
       inactivity_timeout_seconds = 1200,
       is_active = true,
       knowledge_collections = $6::jsonb,
       knowledge_base_documents = $7::jsonb,
       updated_at = NOW()
     WHERE id = $8`,
    [
      DIALOGY_COMMERCIAL_SYSTEM_PROMPT,
      DIALOGY_COMMERCIAL_ESCALATION_POLICY,
      DIALOGY_COMMERCIAL_CLOSING_POLICY,
      DIALOGY_COMMERCIAL_FALLBACK_REPLY,
      JSON.stringify(DIALOGY_COMMERCIAL_ENABLED_TOOLS),
      JSON.stringify(DIALOGY_COMMERCIAL_COLLECTIONS),
      JSON.stringify(DIALOGY_COMMERCIAL_KNOWLEDGE_DOCUMENTS),
      DIALOGY_COM_AUTOPILOT_CONFIG_ID,
    ],
  );
  console.log('✔ Tabela autopilot_configs atualizada com sucesso (Persona, Políticas, 5 Coleções, 6 Documentos).');

  // 3. Atualizar system_agents
  console.log('\n--- ATUALIZANDO SYSTEM_AGENTS NO BANCO ---');
  await db.query(
    `UPDATE system_agents
     SET
       handoff_system_agent_id = NULL,
       is_active = true
     WHERE id = $1`,
    [DIALOGY_COM_SYSTEM_AGENT_ID],
  );
  console.log('✔ Tabela system_agents atualizada: agente ativo e sem handoff.');

  // 4. Limpar embeddings anteriores deste agente
  console.log('\n--- LIMPANDO EMBEDDINGS ANTERIORES DO AGENTE COMERCIAL ---');
  const deleteResult = await db.query(
    'DELETE FROM embeddings_documents WHERE workspace_id = $1 AND autopilot_config_id = $2',
    [DIALOGY_WORKSPACE_ID, DIALOGY_COM_AUTOPILOT_CONFIG_ID],
  );
  console.log(`✔ Embeddings antigos removidos: ${deleteResult.rowCount} linhas.`);

  // 5. Ingestão e Geração de Vetores BGE-M3 (1024d) para cada documento comercial
  console.log('\n--- INICIANDO INGESTÃO VETORIAL NEURAL (BGE-M3 1024d) ---');
  let totalChunks = 0;
  const startIngest = Date.now();

  for (let i = 0; i < DIALOGY_COMMERCIAL_KNOWLEDGE_DOCUMENTS.length; i++) {
    const doc = DIALOGY_COMMERCIAL_KNOWLEDGE_DOCUMENTS[i];
    const docStart = Date.now();
    process.stdout.write(`[${i + 1}/${DIALOGY_COMMERCIAL_KNOWLEDGE_DOCUMENTS.length}] Ingerindo "${doc.name}"... `);

    const result = await ingestKnowledgeBaseDocument({
      workspaceId: DIALOGY_WORKSPACE_ID,
      autopilotConfigId: DIALOGY_COM_AUTOPILOT_CONFIG_ID,
      documentId: doc.id,
      documentName: doc.name,
      content: doc.content,
      document: doc,
    });

    totalChunks += result.chunks;
    const elapsedMs = Date.now() - docStart;
    console.log(`OK (${result.chunks} chunks, status: ${result.status}, ${elapsedMs}ms)`);
  }

  const totalTimeSec = ((Date.now() - startIngest) / 1000).toFixed(1);
  console.log(`\n✔ Ingestão comercial concluída! Total de chunks: ${totalChunks} em ${totalTimeSec}s.`);

  // 6. Verificação no banco de dados
  console.log('\n--- VERIFICAÇÃO DE INTEGRIDADE NO BANCO ---');
  const stats = await VectorStore.getDocumentEmbeddingStats({
    workspaceId: DIALOGY_WORKSPACE_ID,
    autopilotConfigId: DIALOGY_COM_AUTOPILOT_CONFIG_ID,
  });

  console.log(`Documentos registrados com embeddings na tabela embeddings_documents: ${stats.length}`);
  let totalWrongDims = 0;
  for (const item of stats) {
    totalWrongDims += Number(item.wrong_dims || 0);
  }
  console.log(`Total de dimensões incorretas: ${totalWrongDims} (esperado: 0)`);

  const countQuery = await db.query(
    `SELECT 
       COUNT(*)::int AS total_chunks,
       MIN(vector_dims(vector))::int AS min_dims,
       MAX(vector_dims(vector))::int AS max_dims
     FROM embeddings_documents
     WHERE workspace_id = $1 AND autopilot_config_id = $2`,
    [DIALOGY_WORKSPACE_ID, DIALOGY_COM_AUTOPILOT_CONFIG_ID],
  );
  console.log('Estatísticas dos vetores comerciais:', countQuery.rows[0]);

  // 7. Testes de Recuperação Semântica (Semantic Search QA)
  console.log('\n--- TESTES DE RECUPERAÇÃO SEMÂNTICA COMERCIAL ---');
  const { generateDocumentQueryEmbedding } = await import('../src/lib/embeddings');

  const testQueries = [
    'Quanto custa o plano Essencial e quantas pessoas podem usar?',
    'Qual a diferença entre o plano Profissional de 499 e o Operação de 999?',
    'Como faço para contratar o plano e ativar os 7 dias de teste grátis?',
    'A Dialogy cobra por atendente ou usuário adicional?',
    'Qual o plano ideal para um provedor de internet que precisa de múltiplos robôs de IA?',
    'Posso cancelar a qualquer momento ou tem fidelidade de 12 meses?',
    'Vocês cobram taxa por mensagem enviada no WhatsApp?',
  ];

  for (const query of testQueries) {
    console.log(`\nPergunta do Lead: "${query}"`);
    const qVector = await generateDocumentQueryEmbedding(query);
    const matches = await VectorStore.searchSimilarDocuments({
      vector: qVector,
      workspaceId: DIALOGY_WORKSPACE_ID,
      autopilotConfigId: DIALOGY_COM_AUTOPILOT_CONFIG_ID,
      limit: 2,
      minSimilarity: 0.4,
    });

    if (matches.length === 0) {
      console.log('  ❌ Nenhum documento encontrado acima da similaridade mínima.');
    } else {
      matches.forEach((m, idx) => {
        console.log(`  [Top ${idx + 1}] (Similaridade: ${(m.similarity * 100).toFixed(1)}%) -> ${m.document_name}`);
      });
    }
  }

  console.log('\n===========================================================');
  console.log(' AGENTE DIALOGY COMERCIAL VIRTUAL OTIMIZADO COM SUCESSO! ');
  console.log('===========================================================');
}

main()
  .catch((err) => {
    console.error('\n❌ Erro durante a execução do script comercial:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
