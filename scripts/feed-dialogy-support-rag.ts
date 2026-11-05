import 'dotenv/config';
import { db } from '../src/lib/db';
import { VectorStore } from '../src/lib/vector-store';
import { ingestKnowledgeBaseDocument } from '../src/services/rag/document-ingestion';
import {
  DIALOGY_WORKSPACE_ID,
  DIALOGY_AUTOPILOT_CONFIG_ID,
  DIALOGY_SYSTEM_AGENT_ID,
  DIALOGY_SUPPORT_SYSTEM_PROMPT,
  DIALOGY_COLLECTIONS,
  DIALOGY_KNOWLEDGE_DOCUMENTS,
} from './dialogy-support-data';

async function main() {
  console.log('=====================================================');
  console.log(' ALIMENTAÇÃO DA BASE RAG — DIALOGY SUPORTE VIRTUAL');
  console.log('=====================================================');
  console.log(`Workspace ID:        ${DIALOGY_WORKSPACE_ID}`);
  console.log(`Autopilot Config ID: ${DIALOGY_AUTOPILOT_CONFIG_ID}`);
  console.log(`System Agent ID:     ${DIALOGY_SYSTEM_AGENT_ID}`);
  console.log(`Coleções:            ${DIALOGY_COLLECTIONS.length}`);
  console.log(`Documentos RAG:      ${DIALOGY_KNOWLEDGE_DOCUMENTS.length}`);

  // 1. Validar integridade do Workspace e Agente
  const wsCheck = await db.query('SELECT id, name FROM workspaces WHERE id = $1', [DIALOGY_WORKSPACE_ID]);
  if (wsCheck.rowCount === 0) {
    throw new Error(`Workspace ${DIALOGY_WORKSPACE_ID} não encontrado.`);
  }
  console.log(`\n✔ Workspace validado: "${wsCheck.rows[0].name}"`);

  const apCheck = await db.query('SELECT id, name, is_active FROM autopilot_configs WHERE id = $1', [DIALOGY_AUTOPILOT_CONFIG_ID]);
  if (apCheck.rowCount === 0) {
    throw new Error(`Autopilot Config ${DIALOGY_AUTOPILOT_CONFIG_ID} não encontrado.`);
  }
  console.log(`✔ Autopilot Config validado: "${apCheck.rows[0].name}" (Ativo: ${apCheck.rows[0].is_active})`);

  // 2. Atualizar autopilot_configs no banco
  console.log('\n--- ATUALIZANDO AUTOPILOT_CONFIGS NO BANCO ---');
  await db.query(
    `UPDATE autopilot_configs
     SET
       knowledge_base = $1,
       knowledge_collections = $2::jsonb,
       knowledge_base_documents = $3::jsonb,
       updated_at = NOW()
     WHERE id = $4`,
    [
      DIALOGY_SUPPORT_SYSTEM_PROMPT,
      JSON.stringify(DIALOGY_COLLECTIONS),
      JSON.stringify(DIALOGY_KNOWLEDGE_DOCUMENTS),
      DIALOGY_AUTOPILOT_CONFIG_ID,
    ],
  );
  console.log('✔ Tabela autopilot_configs atualizada com sucesso (Persona, 9 Coleções, 19 Documentos).');

  // 3. Limpar embeddings anteriores deste agente para garantir consistência
  console.log('\n--- LIMPANDO EMBEDDINGS ANTERIORES DO AGENTE ---');
  const deleteResult = await db.query(
    'DELETE FROM embeddings_documents WHERE workspace_id = $1 AND autopilot_config_id = $2',
    [DIALOGY_WORKSPACE_ID, DIALOGY_AUTOPILOT_CONFIG_ID],
  );
  console.log(`✔ Embeddings antigos removidos: ${deleteResult.rowCount} linhas.`);

  // 4. Ingestão e Geração de Vetores BGE-M3 (1024d) para cada documento
  console.log('\n--- INICIANDO INGESTÃO VETORIAL NEURAL (BGE-M3 1024d) ---');
  let totalChunks = 0;
  const startIngest = Date.now();

  for (let i = 0; i < DIALOGY_KNOWLEDGE_DOCUMENTS.length; i++) {
    const doc = DIALOGY_KNOWLEDGE_DOCUMENTS[i];
    const docStart = Date.now();
    process.stdout.write(`[${i + 1}/${DIALOGY_KNOWLEDGE_DOCUMENTS.length}] Ingerindo "${doc.name}"... `);

    const result = await ingestKnowledgeBaseDocument({
      workspaceId: DIALOGY_WORKSPACE_ID,
      autopilotConfigId: DIALOGY_AUTOPILOT_CONFIG_ID,
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
  console.log(`\n✔ Ingestão concluída com sucesso! Total de chunks indexados: ${totalChunks} em ${totalTimeSec}s.`);

  // 5. Verificação das estatísticas no banco
  console.log('\n--- VERIFICAÇÃO DE INTEGRIDADE NO BANCO DE DADOS ---');
  const stats = await VectorStore.getDocumentEmbeddingStats({
    workspaceId: DIALOGY_WORKSPACE_ID,
    autopilotConfigId: DIALOGY_AUTOPILOT_CONFIG_ID,
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
    [DIALOGY_WORKSPACE_ID, DIALOGY_AUTOPILOT_CONFIG_ID],
  );
  console.log('Estatísticas dos vetores:', countQuery.rows[0]);

  // 6. Testes de Recuperação Semântica (Semantic Search QA)
  console.log('\n--- TESTE DE RECUPERAÇÃO SEMÂNTICA (RAG RETRIEVAL) ---');
  const { generateDocumentQueryEmbedding } = await import('../src/lib/embeddings');

  const testQueries = [
    'Como faço para criar uma campanha de disparo no WhatsApp com delay anti-ban?',
    'Como funciona o envio de áudio e a transcrição no Inbox?',
    'Onde vejo o funil de vendas do CRM e como crio uma nova oportunidade?',
    'Como conectar o WhatsApp via leitura de QR Code na Evolution API?',
    'O que é o Nexus Flow Studio e como funciona o canvas visual?',
    'Onde configuro as equipes e os horários de expediente de atendimento?',
    'Como emitir segunda via de fatura Pix no SGP para clientes?',
    'Onde altero o tema claro/escuro e o idioma da plataforma?',
  ];

  for (const query of testQueries) {
    console.log(`\nConsulta: "${query}"`);
    const qVector = await generateDocumentQueryEmbedding(query);
    const matches = await VectorStore.searchSimilarDocuments({
      vector: qVector,
      workspaceId: DIALOGY_WORKSPACE_ID,
      autopilotConfigId: DIALOGY_AUTOPILOT_CONFIG_ID,
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

  console.log('\n=====================================================');
  console.log(' ALIMENTAÇÃO E VERIFICAÇÃO CONCLUÍDAS COM SUCESSO! ');
  console.log('=====================================================');
}

main()
  .catch((err) => {
    console.error('\n❌ Erro durante a execução do script:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
