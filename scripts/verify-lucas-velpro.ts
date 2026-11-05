import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Pool } from 'pg';
import { listMcpServerTools, callMcpServerTool } from '../src/services/mcp/client';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

const WORKSPACE_ID = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
const AGENT_ID = '7d7259ab-a6c3-4057-a9ca-28ddbb15db95';
const MCP_SERVER_ID = '8171892c-827b-4216-a631-02839d36af85';

async function main() {
  console.log('=== VERIFICAÇÃO INTEGRAL: LUCAS SUPORTE TÉCNICO VELPRO ===\n');

  const client = await pool.connect();
  let passedGates = 0;
  const totalGates = 6;

  try {
    // Gate 1: Verificar MCP Integration no banco
    console.log('[Gate 1] Verificando integração MCP no banco de dados...');
    const intRes = await client.query(
      "SELECT id, config, is_active FROM workspace_integrations WHERE workspace_id = $1 AND provider = 'mcp'",
      [WORKSPACE_ID]
    );
    const mcpConfig = intRes.rows[0]?.config?.servers?.[0];
    if (
      mcpConfig &&
      mcpConfig.transport === 'direct_http' &&
      mcpConfig.healthStatus === 'healthy' &&
      mcpConfig.lastError === null &&
      mcpConfig.tools?.length === 9
    ) {
      console.log(`✓ Gate 1 APROVADO: Server "${mcpConfig.name}" ativo, direct_http, healthy, ${mcpConfig.tools.length} ferramentas.`);
      passedGates++;
    } else {
      console.error('✗ Gate 1 FALHOU:', mcpConfig);
    }

    // Gate 2: Conexão direta e latência MCP
    console.log('\n[Gate 2] Testando handshake e listagem ao vivo de ferramentas MCP...');
    const startTime = Date.now();
    const liveTools = await listMcpServerTools(mcpConfig);
    const latency = Date.now() - startTime;
    if (liveTools.length === 9 && latency < 500) {
      console.log(`✓ Gate 2 APROVADO: 9 ferramentas listadas em ${latency}ms via direct_http.`);
      passedGates++;
    } else {
      console.error(`✗ Gate 2 FALHOU: ${liveTools.length} ferramentas em ${latency}ms.`);
    }

    // Gate 3: Invocação de ferramenta MCP ao vivo (get_tool_manual)
    console.log('\n[Gate 3] Testando chamada ao vivo de tool MCP (get_tool_manual)...');
    const manualResult = await callMcpServerTool({
      server: mcpConfig,
      toolName: 'get_tool_manual',
      arguments: { tool_name: 'get_router_details' },
      totalTimeoutMs: 5000,
    });
    const content = (manualResult as any)?.content;
    const isError = (manualResult as any)?.isError;
    if (!isError && Array.isArray(content) && content.length > 0) {
      const text = String((content[0] as any)?.text || '');
      console.log(`✓ Gate 3 APROVADO: get_tool_manual retornou manual com ${text.length} caracteres!`);
      console.log(`  Prévia do manual: "${text.slice(0, 120)}..."`);
      passedGates++;
    } else {
      console.error('✗ Gate 3 FALHOU:', manualResult);
    }

    // Gate 4: Configuração do Agente Lucas
    console.log('\n[Gate 4] Verificando autopilot_configs do Lucas Suporte Técnico...');
    const agentRes = await client.query('SELECT * FROM autopilot_configs WHERE id = $1', [AGENT_ID]);
    const agent = agentRes.rows[0];

    const hasSgpRules = agent.knowledge_base?.includes('Triagem Obrigatória de CPF') &&
                        agent.knowledge_base?.includes('Disambiguação Obrigatória de Contrato') &&
                        agent.knowledge_base?.includes('sgp_fetch_contact_panel_data');

    const hasAcsRules = agent.knowledge_base?.includes('Faixa Normal / Saudável') &&
                        agent.knowledge_base?.includes('-8.0 dBm e -27.0 dBm') &&
                        agent.knowledge_base?.includes('ZERO PLAINTEXT SECRETS') &&
                        agent.knowledge_base?.includes('configure_wifi') &&
                        agent.knowledge_base?.includes('reboot_router');

    const enabledToolsCount = agent.enabled_tool_names?.length || 0;

    if (hasSgpRules && hasAcsRules && enabledToolsCount === 14) {
      console.log(`✓ Gate 4 APROVADO: Prompt operacional enriquecido com regras SGP + ACS e ${enabledToolsCount} ferramentas ativadas.`);
      passedGates++;
    } else {
      console.error('✗ Gate 4 FALHOU:', { hasSgpRules, hasAcsRules, enabledToolsCount });
    }

    // Gate 5: Documentos de Conhecimento (/como-usar)
    console.log('\n[Gate 5] Verificando Knowledge Base Documents de /como-usar...');
    const acsDoc = (agent.knowledge_base_documents || []).find((d: any) => d.name?.includes('como-usar'));
    if (acsDoc && acsDoc.content?.length > 10000) {
      console.log(`✓ Gate 5 APROVADO: Documento oficial "${acsDoc.name}" indexado com ${acsDoc.content.length} caracteres.`);
      passedGates++;
    } else {
      console.error('✗ Gate 5 FALHOU: Documento não encontrado ou incompleto.');
    }

    // Gate 6: Histórico de Versões e Limpeza de Drafts
    console.log('\n[Gate 6] Verificando versionamento e integridade de rascunhos...');
    const draftsRes = await client.query('SELECT count(*) FROM autopilot_config_drafts WHERE config_id = $1', [AGENT_ID]);
    const versionsRes = await client.query('SELECT version_number, label FROM autopilot_config_versions WHERE config_id = $1 ORDER BY version_number DESC LIMIT 2', [AGENT_ID]);
    
    const draftCount = Number(draftsRes.rows[0].count);
    const latestVersion = versionsRes.rows[0];

    if (draftCount === 0 && latestVersion) {
      console.log(`✓ Gate 6 APROVADO: Rascunhos limpos (0 pendências), versão ativa v${latestVersion.version_number}: "${latestVersion.label}".`);
      passedGates++;
    } else {
      console.error('✗ Gate 6 FALHOU:', { draftCount, latestVersion });
    }

    console.log('\n=========================================');
    console.log(`RESULTADO DA AUDITORIA: ${passedGates}/${totalGates} GATES APROVADOS (${Math.round((passedGates / totalGates) * 100)}%)`);
    console.log('=========================================');

    if (passedGates === totalGates) {
      console.log('🏆 AGENTE LUCAS SUPORTE TÉCNICO ESTÁ 100% PRONTO E INCRÍVEL!');
    }
  } finally {
    client.release();
    process.exit(passedGates === totalGates ? 0 : 1);
  }
}

main().catch(err => {
  console.error('Erro na auditoria:', err);
  process.exit(1);
});
