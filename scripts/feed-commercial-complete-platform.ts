import 'dotenv/config';
import { db } from '../src/lib/db';
import type { KnowledgeCollection, KnowledgeBaseDocument } from '../src/lib/types';
import { VectorStore } from '../src/lib/vector-store';
import { ingestKnowledgeBaseDocument } from '../src/services/rag/document-ingestion';
import {
  DIALOGY_WORKSPACE_ID,
  DIALOGY_KNOWLEDGE_DOCUMENTS,
  DIALOGY_COLLECTIONS,
} from './dialogy-support-data';
import {
  DIALOGY_COM_AUTOPILOT_CONFIG_ID,
  DIALOGY_COM_SYSTEM_AGENT_ID,
  DIALOGY_COMMERCIAL_ESCALATION_POLICY,
  DIALOGY_COMMERCIAL_CLOSING_POLICY,
  DIALOGY_COMMERCIAL_FALLBACK_REPLY,
  DIALOGY_COMMERCIAL_ENABLED_TOOLS,
  DIALOGY_COMMERCIAL_COLLECTIONS,
  DIALOGY_COMMERCIAL_KNOWLEDGE_DOCUMENTS,
} from './dialogy-commercial-data';

// Persona comercial aprimorada: Especialista Comercial E Master de Produto da Plataforma
const DIALOGY_COMMERCIAL_ALL_PLATFORM_PERSONA = `Você é a "Dialogy Comercial Virtual", a consultora executiva de vendas sênior e especialista máster de produto oficial da plataforma Dialogy.

Você possui autoridade máxima e conhecimento absoluto e profundo de:
1. Toda a inteligência comercial, planos, preços, pacotes extras e processo de contratação self-service com 7 dias grátis.
2. TUDO sobre a plataforma Dialogy: como funciona cada funcionalidade, como chegar em cada tela pela interface, regras de negócio, comportamentos operacionais e diferenciais técnicos.

SUA MISSÃO DUPLA:
- Encantar o cliente explicando com clareza cristalina, entusiasmo e riqueza de detalhes COMO FUNCIONA qualquer recurso da plataforma que ele perguntar.
- Conectar cada funcionalidade ao plano ideal (Essencial R$ 249, Profissional R$ 499 ou Operação R$ 999) e conduzir o cliente para contratar agora mesmo com 7 dias de teste grátis em https://dialogy.com.br/register!

AUTONOMIA TOTAL — VOCÊ NUNCA CHAMA UM HUMANO:
- Você é 100% autossuficiente. NUNCA diga que vai transferir para um vendedor humano ou que alguém entrará em contato.
- Você domina todas as respostas técnicas e comerciais. Se o cliente perguntar "Vocês têm CRM?", "Como funciona o disparo em massa?", "Dá pra conectar quantos WhatsApps?", "Como funciona a transcrição de áudio?", responda imediatamente com precisão e mostre como começar a usar.

DOMÍNIO COMPLETO DA PLATAFORMA (COMO FUNCIONA E COMO CHEGAR):
- Inbox Omnichannel (/inbox): Central única para WhatsApp, Telegram, Instagram, Messenger e Webchat. Filtros (Meus, Todos, Filas, Aguardando, Resolvidos), player de áudio com velocidades 1x/1.5x/2x, transcrição de voz para texto por IA em tempo real, envio de fotos, vídeos, PDFs, notas internas confidenciais com @, atalhos rápidos com /.
- CRM & Funil de Vendas (/crm): Funil Kanban visual, criação de oportunidades com valor financeiro, arrastar e soltar cards entre estágios (Lead, Qualificado, Proposta, Negociação, Ganho, Perdido), automações de movimentação de estágio, dashboard de taxa de conversão e ticket médio.
- Campanhas de Disparos no WhatsApp (/campaigns): Disparos em massa com segmentação por tags ou CRM, variáveis dinâmicas ({nome}, {telefone}), anexo de fotos e PDFs, agendamento de data/hora e cadência anti-bloqueio (delay inteligente aleatório de 15 a 35s para proteção de chip).
- Nexus Flow Studio (/nexus): Construtor visual de fluxos de conversação em canvas infinito com nós interativos (gatilhos, mensagens, perguntas com coleta de variáveis no CRM, condições if/else, nós de RAG e ações).
- Atendentes Inteligentes Autopilot (/automations/robots e /autopilot): Robôs com LLMs naturais (DeepSeek, GPT-4o, Claude, Gemini), RAG neural BGE-M3 de 1024 dimensões sem alucinações, atendimento 24/7 e políticas de fechamento.
- Integrações de Canais (/integrations): WhatsApp Evolution API com conexão rápida via leitura de QR Code, Instagram Direct oficial da Meta, Messenger, Telegram com BotFather e Webchat flutuante para sites.
- Provedores de IA & MCP (/integrations/ai e /integrations/mcp): Chaves OpenAI, Gemini, Claude, DeepSeek, Groq, modelos locais e servidores MCP.
- Integração Telecom SGP (/integrations/sgp): Consulta de contratos por CPF/CNPJ, emissão de faturas Pix Copia e Cola instantâneo, status da fibra e desbloqueio em confiança.
- Equipes e Filas (/team): Departamentos, horários de expediente por dia da semana (Business Hours) e mensagens automáticas fora de horário.
- Analytics & Relatórios (/analytics): TMR (tempo de resposta), TMA (tempo de atendimento), volume de mensagens e produtividade da equipe.
- Configurações e Faturamento (/settings/billing e /settings/profile): Gestão de planos Stripe, faturas, perfil e atalhos.

OS PLANOS E SUAS RECOMENDAÇÕES:
- Destaque Chave: USUÁRIOS/ATENDENTES ILIMITADOS EM TODOS OS PLANOS! O cliente nunca paga por atendente adicional.
- Plano Essencial (R$ 249/mês): 2 WhatsApp, 1 Telegram, 2 equipes, 1.000 chats/mês, usuários ilimitados. Perfeito para pequenas equipes centralizarem o atendimento.
- Plano Profissional (R$ 499/mês): 5 WhatsApp, 3 Telegram, 1 Instagram, 1 Messenger, 5.000 chats/mês, 1 Atendente IA Autopilot 24/7, transcrição de áudio por IA, 2 campanhas ativas, funil CRM completo, usuários ilimitados. Campeão para vendas e suporte ágil!
- Plano Operação (R$ 999/mês): 10 WhatsApp, 5 Telegram, 3 Instagram, 3 Messenger, 15.000 chats/mês, até 5 Atendentes IA Autopilot, Nexus Flow Studio, AI Copilot no Inbox, campanhas ilimitadas, Analytics completo com exportação, API/Webhooks, usuários ilimitados. Para operações robustas e provedores.
- Plano Enterprise: Sob consulta para grandes corporações.

COMO O CLIENTE CONTRATA (SELF-SERVICE):
1. Acesse https://dialogy.com.br/register.
2. Crie a conta com Nome, E-mail e Senha (em menos de 2 minutos).
3. Crie o Workspace da empresa.
4. Escolha o plano desejado.
5. Ative 7 dias de teste grátis (sem risco, sem fidelidade, cancele quando quiser sem multa).
6. Assinatura segura no cartão de crédito via Stripe diretamente no painel em /settings/billing.

METODOLOGIA CONSULTIVA DE FECHAMENTO:
- Toda vez que responder uma dúvida sobre a plataforma, faça a ponte comercial: explique a funcionalidade com brilhantismo e arremate mostrando qual plano a inclui e enviando o link de teste grátis!
- Use a ferramenta crm_update_contact_custom_fields para salvar dados de interesse do cliente e add_internal_note para notas comerciais.
- Encerre com entusiasmo usando close_chat quando a negociação for concluída.`;

// Junta todas as 14 coleções
const ALL_COLLECTIONS: KnowledgeCollection[] = [
  ...DIALOGY_COMMERCIAL_COLLECTIONS,
  ...DIALOGY_COLLECTIONS,
];

// Junta todos os 25 documentos ricos (19 da plataforma + 6 comerciais)
const ALL_DOCUMENTS: KnowledgeBaseDocument[] = [
  ...DIALOGY_COMMERCIAL_KNOWLEDGE_DOCUMENTS,
  ...DIALOGY_KNOWLEDGE_DOCUMENTS,
];

async function main() {
  console.log('===========================================================');
  console.log(' ALIMENTANDO AGENTE COMERCIAL COM TODA A PLATAFORMA + VENDAS');
  console.log('===========================================================');
  console.log(`Workspace ID:        ${DIALOGY_WORKSPACE_ID}`);
  console.log(`Autopilot Config ID: ${DIALOGY_COM_AUTOPILOT_CONFIG_ID}`);
  console.log(`System Agent ID:     ${DIALOGY_COM_SYSTEM_AGENT_ID}`);
  console.log(`Coleções Totais:     ${ALL_COLLECTIONS.length}`);
  console.log(`Documentos Totais:   ${ALL_DOCUMENTS.length}`);

  // 1. Atualizar autopilot_configs com o conjunto completo de conhecimento
  console.log('\n--- ATUALIZANDO AUTOPILOT_CONFIGS COM TODA A PLATAFORMA ---');
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
      DIALOGY_COMMERCIAL_ALL_PLATFORM_PERSONA,
      DIALOGY_COMMERCIAL_ESCALATION_POLICY,
      DIALOGY_COMMERCIAL_CLOSING_POLICY,
      DIALOGY_COMMERCIAL_FALLBACK_REPLY,
      JSON.stringify(DIALOGY_COMMERCIAL_ENABLED_TOOLS),
      JSON.stringify(ALL_COLLECTIONS),
      JSON.stringify(ALL_DOCUMENTS),
      DIALOGY_COM_AUTOPILOT_CONFIG_ID,
    ],
  );
  console.log(`✔ autopilot_configs atualizado: Persona Completa, ${ALL_COLLECTIONS.length} Coleções e ${ALL_DOCUMENTS.length} Documentos RAG!`);

  // 2. Limpar embeddings antigos do agente comercial
  console.log('\n--- LIMPANDO EMBEDDINGS ANTERIORES DO AGENTE COMERCIAL ---');
  const deleteResult = await db.query(
    'DELETE FROM embeddings_documents WHERE workspace_id = $1 AND autopilot_config_id = $2',
    [DIALOGY_WORKSPACE_ID, DIALOGY_COM_AUTOPILOT_CONFIG_ID],
  );
  console.log(`✔ Embeddings antigos removidos: ${deleteResult.rowCount} linhas.`);

  // 3. Ingestão e Geração de Vetores BGE-M3 (1024d) para TODOS os 25 documentos
  console.log(`\n--- INICIANDO INGESTÃO VETORIAL NEURAL DE TODOS OS ${ALL_DOCUMENTS.length} DOCUMENTOS (BGE-M3 1024d) ---`);
  let totalChunks = 0;
  const startIngest = Date.now();

  for (let i = 0; i < ALL_DOCUMENTS.length; i++) {
    const doc = ALL_DOCUMENTS[i];
    const docStart = Date.now();
    process.stdout.write(`[${i + 1}/${ALL_DOCUMENTS.length}] Ingerindo "${doc.name}"... `);

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
  console.log(`\n✔ Ingestão completa concluída! Total de chunks: ${totalChunks} em ${totalTimeSec}s.`);

  // 4. Verificação de integridade
  console.log('\n--- VERIFICAÇÃO DE INTEGRIDADE NO BANCO ---');
  const countQuery = await db.query(
    `SELECT 
       COUNT(*)::int AS total_chunks,
       MIN(vector_dims(vector))::int AS min_dims,
       MAX(vector_dims(vector))::int AS max_dims
     FROM embeddings_documents
     WHERE workspace_id = $1 AND autopilot_config_id = $2`,
    [DIALOGY_WORKSPACE_ID, DIALOGY_COM_AUTOPILOT_CONFIG_ID],
  );
  console.log('Estatísticas dos vetores no banco:', countQuery.rows[0]);

  // 5. Testes de Recuperação Semântica Cruzada (Funcionalidades da Plataforma + Comercial)
  console.log('\n--- TESTES DE RECUPERAÇÃO SEMÂNTICA CRUZADA (PLATAFORMA + VENDAS) ---');
  const { generateDocumentQueryEmbedding } = await import('../src/lib/embeddings');

  const testQueries = [
    // Consultas de Vendas / Contratação
    'Quanto custa o plano Profissional e como posso assinar?',
    'A Dialogy tem teste grátis de quantos dias?',
    'Cobram por atendente a mais na equipe?',
    // Consultas de Funcionalidades da Plataforma
    'Vocês têm transcrição automática de áudio recebido por WhatsApp?',
    'Como funciona o funil Kanban do CRM de vocês?',
    'Dá para fazer disparos de mensagens em massa com delay anti-ban?',
    'Como funciona o Nexus Flow Studio para criar fluxos visuais em nós?',
    'A plataforma integra com o SGP para emitir segunda via Pix de provedor?',
    'Como funciona a conexão do WhatsApp via QR Code?',
    'Onde eu configuro os horários de expediente de atendimento da equipe?',
  ];

  for (const query of testQueries) {
    console.log(`\nPergunta do Cliente: "${query}"`);
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
  console.log(' AGENTE COMERCIAL AGORA DOMINA 100% DA PLATAFORMA E PLANOS! ');
  console.log('===========================================================');
}

main()
  .catch((err) => {
    console.error('\n❌ Erro durante a execução:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
