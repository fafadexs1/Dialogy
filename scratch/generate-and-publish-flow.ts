import { createRequire } from 'module';
const require = createRequire(import.meta.url);
try {
  const path = require.resolve('server-only');
  require.cache[path] = {
    id: path,
    filename: path,
    loaded: true,
    exports: {},
    paths: [],
    children: []
  } as any;
} catch (e) {
  // ignore
}

import 'dotenv/config';
import { db } from '../src/lib/db';
import { generateAutopilotFlowProposal } from '../src/ai/flows/autopilot-flow-builder';
import { listAgentToolCatalogItems } from '../src/services/agent-tools/catalog';
import { listMcpToolsForWorkspace } from '../src/services/mcp/store';
import { auditAutopilotFlowGraph } from '../src/services/autopilot/flow-audit';

const workspaceId = '5c3a91e9-b243-4436-80ba-42434bc5ca97';
const configId = '475cc308-03a6-483f-8fdd-10084f0c73b8';
const userId = '8fe1f4da-9305-475c-95d1-83bda9f29b22';

const promptContent = `Crie um fluxo comercial de vendas estruturado de alta conversão para a Dialogy, utilizando a seguinte topologia e blocos funcionais:

1. Bloco de Entrada (Trigger):
- ID: "gatilho_entrada"
- Tipo: trigger
- Título: "Início do Atendimento"
- Subtítulo: "Cliente envia mensagem"
- Conecta diretamente no Switch de Triagem.

2. Bloco Switch de Decisão Inteligente (Switch):
- ID: "triagem_comercial"
- Tipo: switch
- Título: "Entender Intenção"
- Subtítulo: "Classificador de Rotas do Lead"
- Configurações: switchMode = "ai", confidenceThreshold = 0.75, fallbackRouteId = "tirar_duvidas"
- Rotas Configuradas:
  * Rota 1: ID = "ver_planos", Label = "Ver Planos", Description = "Lead quer conhecer planos, preços ou valores da plataforma", Examples = ["Quero ver os planos", "Quanto custa?", "Tabela de preços"], targetNodeId = "apresentar_planos"
  * Rota 2: ID = "tirar_duvidas", Label = "Tirar Dúvidas", Description = "Dúvidas gerais, WhatsApp QR Code vs API, Meta, fidelidade, etc", Examples = ["Como funciona a API?", "Vocês cobram por atendente?", "Tem fidelidade?"], targetNodeId = "assistente_vendas"
  * Rota 3: ID = "falar_humano", Label = "Falar com Humano", Description = "Cliente pede atendente humano ou setor comercial direto", Examples = ["Quero falar com um atendente", "Me passa para o comercial", "Humano"], targetNodeId = "transbordo_humano"

3. Bloco de Base de Conhecimento (Knowledge):
- ID: "base_comercial"
- Tipo: knowledge
- Título: "Base de Conhecimento Comercial"
- Subtítulo: "Dados de planos e FAQs"
- Conecta diretamente no assistente_vendas para alimentar as respostas com RAG.

4. Bloco Assistente Comercial Principal (Assistant):
- ID: "assistente_vendas"
- Tipo: assistant
- Título: "Raquel SDR"
- Subtítulo: "Assistente Comercial com IA"
- Instruções/Prompt: "Você é Raquel, SDR virtual da Dialogy. Use a base_comercial para tirar dúvidas sobre WhatsApp QR/API, fidelidade e planos. Destaque SEMPRE que temos usuários ilimitados nos planos e oferecemos 7 dias grátis sem cartão de crédito. Se o cliente aceitar o teste ou demonstrar intenção de contratar, direcione-o imediatamente para o formulário de pré-cadastro."
- Edges de saída: Conecta o fluxo da conversa no formulário "pre_cadastro" quando o cliente decide testar ou assinar.

5. Bloco de Sub-Agente Temático de Planos (Intent):
- ID: "apresentar_planos"
- Tipo: intent
- Título: "Apresentação de Planos"
- Subtítulo: "Falar sobre valores e limites"
- Intent: "pricing_request"
- Instruções: "Apresente as 3 opções de planos de forma resumida destacando a quantidade de chats inclusos (Essencial 1k chats por R$249, Profissional 5k chats por R$499 e Operação 15k chats por R$999). Destaque que todos têm atendentes ilimitados. Finalize perguntando qual faz mais sentido para o modelo dele começar a testar gratuitamente."
- Edges de saída: Se o cliente escolher um plano, avance para o formulário "pre_cadastro".

6. Bloco de Formulário (Form):
- ID: "pre_cadastro"
- Tipo: form
- Título: "Dados do Pré-Cadastro"
- Subtítulo: "Coleta de leads de 7 dias grátis"
- Configuração de campos (slots):
  * campo 1: nome_completo (Tipo texto, Label: "Nome Completo", Required = true)
  * campo 2: empresa_nome (Tipo texto, Label: "Nome da Empresa", Required = true)
  * campo 3: whatsapp_contato (Tipo texto, Label: "WhatsApp de Contato", Required = true)
  * campo 4: plano_escolhido (Tipo texto, Label: "Plano Escolhido", Required = true)
- Instruções de preenchimento: "Colete um dado de cada vez de forma simpática. Agradeça à medida que as informações são enviadas."
- Edges de saída: Uma vez concluído, conecta no transbordo_humano.

7. Bloco de Transbordo (Handoff):
- ID: "transbordo_humano"
- Tipo: handoff
- Título: "Fila Comercial Humana"
- Subtítulo: "Transferir atendimento comercial"
- Mensagem de saída: "Perfeito! Seus dados foram salvos. Nosso time comercial já está liberando o seu acesso gratuito de 7 dias e te chamará aqui em instantes. Obrigado! 🚀"

Conecte a topologia inteira na ordem operacional lógica: gatilho_entrada -> triagem_comercial; triagem_comercial (rota: ver_planos) -> apresentar_planos -> pre_cadastro; triagem_comercial (rota: tirar_duvidas) -> assistente_vendas -> pre_cadastro; triagem_comercial (rota: falar_humano) -> transbordo_humano; pre_cadastro -> transbordo_humano.`;

async function main() {
  console.log('[STAGE] Fetching tools...');
  const mcpTools = await listMcpToolsForWorkspace(workspaceId);
  const mcpCatalogItems = mcpTools.map((tool) => ({
    name: tool.qualifiedName as any,
    version: 'mcp',
    description: tool.description || tool.title || `Ferramenta MCP ${tool.name} em ${tool.serverName}.`,
    class: tool.annotations?.readOnlyHint ? 'read_only' as const : 'retrieval' as const,
    riskLevel: tool.annotations?.destructiveHint ? 'high' as const : 'medium' as const,
    sideEffect: tool.annotations?.destructiveHint ? 'high' as const : tool.annotations?.readOnlyHint ? 'none' as const : 'medium' as const,
    idempotent: Boolean(tool.annotations?.idempotentHint || tool.annotations?.readOnlyHint),
    timeoutMs: 8000,
    maxAttempts: 1,
    requiresHumanApproval: Boolean(tool.annotations?.destructiveHint),
    customerVisible: true,
    allowedIntents: [],
    requiredSlots: [],
    fallbackAction: 'handoff' as const,
    source: 'mcp' as const,
    enabledByDefault: false,
    serverId: tool.serverId,
    serverName: tool.serverName,
    inputSchema: tool.inputSchema || null,
    outputSchema: null,
  }));
  const tools = [...listAgentToolCatalogItems(), ...mcpCatalogItems];

  console.log('[STAGE] Fetching config row...');
  const configRes = await db.query(
    'SELECT * FROM autopilot_configs WHERE id = $1 LIMIT 1',
    [configId]
  );
  if (configRes.rowCount === 0) {
    throw new Error('Config row not found.');
  }
  const configRow = configRes.rows[0];

  console.log('[STAGE] Generating flow proposal via local LM Studio...');
  const proposal = await generateAutopilotFlowProposal({
    conversation: [{ role: 'user', content: promptContent }],
    currentGraph: configRow.flow_graph,
    currentSystemPrompt: configRow.knowledge_base,
    tools,
    model: configRow.ai_model,
  });

  console.log('[STAGE] Proposal generated successfully!');
  console.log('SUMMARY:', proposal.summary);
  console.log('SYSTEM PROMPT:', proposal.systemPrompt);
  console.log('NODES:', JSON.stringify(proposal.flowGraph.nodes, null, 2));
  console.log('EDGES:', JSON.stringify(proposal.flowGraph.edges, null, 2));

  console.log('[STAGE] Auditing generated graph...');
  const auditResult = auditAutopilotFlowGraph(proposal.flowGraph);
  console.log('AUDIT RESULT STATUS:', auditResult.status);
  if (auditResult.issues.length > 0) {
    console.log('AUDIT ISSUES:', auditResult.issues);
  }
  if (auditResult.status === 'failed') {
    throw new Error('Audit failed! Proposal contains critical issues.');
  }

  // Create Snapshot:
  const snapshot = {
    name: configRow.name || 'Agente de IA',
    gemini_api_key: configRow.gemini_api_key,
    ai_model: configRow.ai_model,
    transcription_model: configRow.transcription_model,
    knowledge_base: proposal.systemPrompt,
    knowledge_base_documents: configRow.knowledge_base_documents || [],
    knowledge_collections: configRow.knowledge_collections || [],
    is_active: configRow.is_active,
    is_private: configRow.is_private,
    default_fallback_reply: configRow.default_fallback_reply,
    escalation_policy: configRow.escalation_policy,
    closing_policy: configRow.closing_policy,
    enabled_tool_names: proposal.enabledToolNames || [],
    flow_graph: proposal.flowGraph,
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
    
    // 2. Update config row
    await client.query(
      `UPDATE autopilot_configs
       SET
          name = $3,
          knowledge_base = $4,
          flow_graph = $5,
          enabled_tool_names = $6,
          updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2`,
      [
        workspaceId,
        configId,
        snapshot.name,
        snapshot.knowledge_base,
        JSON.stringify(snapshot.flow_graph),
        JSON.stringify(snapshot.enabled_tool_names),
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
        `Publicacao v${versionNumber} (IA Autopilot Flow Builder)`,
        JSON.stringify(snapshot),
      ]
    );

    // 4. Delete draft if exists
    await client.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1', [configId]);

    await client.query('COMMIT');
    console.log('[STAGE] Flow committed and published successfully as version', versionNumber);
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
