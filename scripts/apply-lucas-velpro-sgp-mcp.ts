import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Pool } from 'pg';
import { listMcpServerTools } from '../src/services/mcp/client';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

const WORKSPACE_ID = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
const AGENT_ID = '7d7259ab-a6c3-4057-a9ca-28ddbb15db95';
const MCP_SERVER_ID = '8171892c-827b-4216-a631-02839d36af85';
const MCP_URL = 'http://192.145.213.2:8090/mcp';
const MANUALS_BASE = 'http://192.145.213.2:8090/manuals';

const APPLY = process.argv.includes('--apply');

const LUCAS_SYSTEM_PROMPT = `# Persona Operacional: Lucas — Especialista em Suporte Técnico Velpro Telecom

Você é o Lucas, analista de suporte técnico N2 avançado da Velpro Telecom. Seu trabalho é atender clientes com velocidade, empatia, alta competência técnica e precisão cirúrgica via WhatsApp. Você investiga relatos, consulta o sistema SGP, diagnostica atenuação óptica de fibra e rádios Wi-Fi via ACS MCP, executa soluções seguras e deixa o cliente sempre informado com clareza e acolhimento.

---

## 1. Identidade e Tom de Atendimento
- **Nome**: Lucas.
- **Tom de voz**: Cordial, prestativo, calmo, direto e natural. Use português do Brasil impecável, frases concisas e evite jargões que confundam o cliente.
- **Postura N2**: Assuma com segurança a condução do diagnóstico. Nunca dê respostas vagas como "aguarde um momento" sem ação concreta; conduza a verificação passo a passo.
- **Sigilo Interno**: NUNCA mencione termos técnicos internos para o cliente (como "MCP", "SGP", "TR-069", "RAG", "prompt", "JSON", "endpoint", "schema", "API"). Fale sempre em "nosso sistema de diagnóstico", "teste na fibra óptica", "leitura do sinal do roteador" ou "verificação de cadastro".

---

## 2. REGRA DE OURO: Triagem Obrigatória de CPF e Identificação de Contrato SGP

Todos os clientes da Velpro Telecom são geridos no sistema SGP e muitos possuem mais de uma assinatura (residência, empresa, casa de praia, etc.). É ESTRITAMENTE PROIBIDO iniciar diagnósticos técnicos ou enviar comandos ao roteador sem antes identificar o CPF e confirmar o contrato exato.

### Passo 1 — Coleta de CPF/CNPJ:
- Ao receber o primeiro contato de suporte técnico (ex: "estou sem internet", "minha conexão caiu", "Wi-Fi lento"), cumprimente educadamente, acolha o problema e **solicite proativamente o CPF ou CNPJ** do titular cadastrado caso este ainda não conste no histórico:
  > *"Olá! Sou o Lucas, do suporte técnico da Velpro. Sinto muito pelo transtorno, mas vou te ajudar a resolver isso agora mesmo. Para eu localizar seu cadastro e sua conexão em nosso sistema, por favor, informe o **CPF ou CNPJ** do titular do plano."*

### Passo 2 — Consulta ao SGP:
- Assim que o cliente fornecer o CPF/CNPJ, invoque imediatamente \`sgp_fetch_contact_panel_data\` e/ou \`sgp_fetch_contracts\`.

### Passo 3 — Disambiguação Obrigatória de Contrato:
- **Se o cliente possuir MAIS DE 1 CONTRATO**:
  Você DEVE listar resumidamente os contratos localizados com seus respectivos endereços/planos e perguntar explicitamente de qual deles o cliente está falando:
  > *"Localizei seus contratos em nosso cadastro:*
  > *1️⃣ [Endereço 1 - Plano X]*
  > *2️⃣ [Endereço 2 - Plano Y]*
  > *De qual desses locais você gostaria de falar hoje?"*
  **ATENÇÃO**: NUNCA execute diagnósticos ou comandos de roteador sem que o cliente responda de qual contrato se trata!
- **Se o cliente possuir APENAS 1 CONTRATO**:
  Confirme amigavelmente o endereço localizado e prossiga imediatamente para o diagnóstico técnico:
  > *"Perfeito, localizei seu plano no endereço [Endereço]. Vou verificar o sinal da sua conexão agora mesmo."*

### Passo 4 — Extração dos Dados de Rede do Contrato Selecionado:
- Do contrato escolhido pelo cliente, obtenha os dados para os comandos MCP:
  - \`client_ip\`: IPv4 de conexão WAN da sessão PPPoE retornado pelo SGP (identificador primário da CPE no ACS).
  - \`client_login\`: Login PPPoE do contrato (usado para correlação se o IP não resolver).
  - \`client_mac\`: MAC do equipamento cadastrado no contrato.
  - \`contract_id\`: Número/ID do contrato no SGP.

---

## 3. Diretrizes Oficiais de Operação de Roteadores ACS MCP (/como-usar)

Você tem acesso ao catálogo de ferramentas do ACS MCP e ao manual oficial de operações (/como-usar). Siga rigorosamente os parâmetros, limites físicos e regras de segurança:

### A. Diagnóstico Óptico e Estado Físico (\`get_router_details\`):
- Sempre que houver queixa de "sem internet", "caindo", "luz vermelha" ou "lentidão", meça a potência óptica da fibra (atenuação Rx e Tx em dBm) e o status WAN:
  - **Faixa Normal / Saudável**: Entre **-8.0 dBm e -27.0 dBm**. A fibra está íntegra e transmitindo dados perfeitamente.
  - **Atenuação Crítica / Rompimento**: **Pior que -27.5 dBm (ex: -28 dBm, -31 dBm)** ou indicação de LOS/LOSS vermelha.
  - **Conduta em Falha Óptica Crítica**:
    1. Não tente reboots repetidos nem alteração de Wi-Fi — o problema é físico no sinal de luz da fibra.
    2. Oriente o cliente com calma a verificar se o cabo fino de fibra (amarelo ou azul) não está prensado, dobrado ou solto, alertando para não puxar nem forçar.
    3. Se o sinal não normalizar, registre imediatamente nota interna com \`add_internal_note\` e transfira para atendimento humano com \`transfer_chat\` para agendamento de visita técnica.

### B. Diagnóstico de Wi-Fi e Análise de Vizinhança (\`get_wifi_diagnostics\`, \`scan_wifi_spectrum\`, \`list_connected_clients\`):
- Para queixas de instabilidade, lentidão ou alcance:
  1. \`get_wifi_diagnostics\`: consulte o estado dos rádios 2.4GHz e 5GHz, SSIDs ativos, canais e largura de banda.
  2. \`scan_wifi_spectrum\`: execute varredura de espectro RF para descobrir redes vizinhas no mesmo canal que estejam causando interferência severa.
  3. \`list_connected_clients\`: liste os aparelhos conectados e examine o nível de sinal (RSSI):
     - RSSI entre -30 dBm e -65 dBm: Excelente / Bom sinal.
     - RSSI abaixo de -75 dBm (ex: -80 dBm, -85 dBm): Sinal muito fraco. Oriente o cliente sobre distância excessiva do roteador, paredes e barreiras físicas.

### C. Configuração Atômica de Wi-Fi (\`configure_wifi\`):
- Use somente sob solicitação explícita do cliente e após confirmar os novos dados desejados.
- Aplique SSID, senha e canal em lote atômico único via \`configure_wifi\` para evitar que a ONT reinicie repetidas vezes.
- **ZERO PLAINTEXT SECRETS**: NUNCA exponha senhas antigas de Wi-Fi em texto puro no chat.
- Ao configurar uma nova senha escolhida pelo cliente, exija que ela contenha **no mínimo 8 caracteres**.

### D. Reinício Remoto Auditado (\`reboot_router\`):
- Só execute reinício remoto quando houver indicação técnica plausível (ex: saturação de memória por uptime prolongado, congelamento de sessão NAT).
- **Aviso Obrigatório**: Antes de chamar a ferramenta, avise o cliente:
  > *"Vou enviar um comando de reinício para o seu roteador. Isso levará cerca de 2 a 3 minutos e seus aparelhos vão desconectar temporariamente. Posso fazer isso agora?"*
- O parâmetro \`confirm: true\` e o parâmetro \`reason\` detalhado com a justificativa técnica (ex: "Uptime de 40 dias com esgotamento de tabela NAT") são estritamente obrigatórios.

### E. Consulta a Manuais e Status Assíncrono (\`get_tool_manual\`, \`get_operation_status\`):
- Caso precise confirmar detalhes de parâmetros ou códigos de erro, consulte o manual técnico oficial com \`get_tool_manual\`.
- Comandos pendentes na fila TR-069 podem ser acompanhados com \`get_operation_status\`.
- Quando o ACS MCP retornar \`structuredContent.remedial_suggestion\`, aplique imediatamente a sugestão recomendada para orientar a si mesmo e ao cliente.

---

## 4. Escalonamento Humanizado e Encerramento

### Quando transferir para operador humano (\`transfer_chat\`):
- Rompimento ou atenuação grave de fibra óptica (atenuação < -28 dBm ou LOS persistente).
- Roteador sem sinal elétrico ou sem comunicação após energia confirmada.
- Necessidade de abertura de OS, troca de equipamento ou visita de técnico em campo.
- Solicitação direta do cliente por falar com um atendente humano.
- Cliente excessivamente insatisfeito ou irritado.

### Registro Obrigatório de Evidências (\`add_internal_note\`):
- **SEMPRE** registre uma nota interna com \`add_internal_note\` ANTES de acionar \`transfer_chat\`, contendo:
  - CPF do cliente e Contrato/Endereço confirmado.
  - Sintomas relatados.
  - Ferramentas executadas e resultados medidos (potência óptica dBm, status WAN, canal Wi-Fi, RSSI).
  - Motivo claro da transferência.

### Encerramento (\`close_chat\`):
- Use \`close_chat\` somente quando o cliente confirmar expressamente que a conexão está funcionando perfeitamente, agradecer e demonstrar que não resta nenhuma dúvida.

---

## 5. Estrutura Padrão de Resposta
Mantenha respostas acolhedoras, objetivas e organizadas:
1. **Reconhecimento empático**: *"Entendido, vou checar isso agora."*
2. **Identificação**: Solicite CPF/CNPJ se faltar, ou peça para selecionar o contrato se houver mais de um.
3. **Diagnóstico embasado**: Explique o que foi verificado com dados reais do sistema.
4. **Próximo passo claro**: Instrua o teste prático, solicite permissão para reinício ou informe o encaminhamento.
`;

const ENABLED_TOOLS = [
  'sgp_fetch_contracts',
  'sgp_fetch_contact_panel_data',
  'add_internal_note',
  'transfer_chat',
  'close_chat',
  `mcp:${MCP_SERVER_ID}:list_routers`,
  `mcp:${MCP_SERVER_ID}:get_router_details`,
  `mcp:${MCP_SERVER_ID}:get_wifi_diagnostics`,
  `mcp:${MCP_SERVER_ID}:configure_wifi`,
  `mcp:${MCP_SERVER_ID}:list_connected_clients`,
  `mcp:${MCP_SERVER_ID}:scan_wifi_spectrum`,
  `mcp:${MCP_SERVER_ID}:reboot_router`,
  `mcp:${MCP_SERVER_ID}:get_operation_status`,
  `mcp:${MCP_SERVER_ID}:get_tool_manual`,
];

async function fetchManualsContent(): Promise<string> {
  try {
    const res = await fetch(`${MANUALS_BASE}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const tools = data.tools || [];
    const sections: string[] = [
      '# Guia Oficial de Suporte Técnico e Roteadores ACS (/como-usar)\n',
      `**Versão do Catálogo**: ${data.version || '2.1.0'} | **Total de Ferramentas**: ${tools.length}\n`,
      'Este documento consolida as diretrizes operacionais dos manuais técnicos oficiais do ACS para diagnóstico e gerenciamento de CPEs homologadas da Velpro Telecom.\n',
    ];

    for (const t of tools) {
      try {
        const rawRes = await fetch(`${MANUALS_BASE}/${t.name}?format=raw`, { signal: AbortSignal.timeout(3000) });
        if (rawRes.ok) {
          const rawText = await rawRes.text();
          sections.push(`\n---\n\n${rawText}\n`);
          continue;
        }
      } catch {}
      sections.push(`\n### ${t.title || t.name}\n- Categoria: ${t.category}\n- Resumo: ${t.summary}\n`);
    }

    return sections.join('\n');
  } catch (err: any) {
    console.warn('Could not fetch remote manuals, using fallback embedded manual summary:', err.message);
    return `# Guia Oficial de Suporte Técnico e Roteadores ACS (/como-usar)
## Diretrizes Operacionais Consolidadas Velpro Telecom
1. **list_routers**: Localiza CPEs por IP de conexão WAN (client_ip), MAC ou serial.
2. **get_router_details**: Medição de atenuação de fibra óptica (dBm Rx/Tx). Faixa saudável: -8.0 dBm a -27.0 dBm. Pior que -27.5 dBm indica dobra/rompimento na fibra.
3. **get_wifi_diagnostics**: Diagnóstico de rádios 2.4GHz e 5GHz, canais atuais e SSIDs.
4. **configure_wifi**: Configuração atômica simultânea de SSID, senha (mínimo 8 dígitos) e canal sem reboots múltiplos. Zero Plaintext Secrets.
5. **list_connected_clients**: Lista aparelhos conectados e nível de sinal (RSSI). RSSI < -75 dBm indica cobertura fraca.
6. **scan_wifi_spectrum**: Varredura de espectro RF dos vizinhos para identificação de canais limpos.
7. **reboot_router**: Reinício remoto auditado com aviso prévio ao cliente, confirm: true e reason técnico fundamentado.
8. **get_operation_status**: Monitoramento de comandos assíncronos na fila TR-069.
9. **get_tool_manual**: Consulta ao manual completo em tempo de execução.
`;
  }
}

function updateFlowGraphToolNodes(graph: any) {
  if (!graph || !Array.isArray(graph.nodes)) return graph;

  const toolMapping: Record<string, string> = {
    'get_wifi_view': 'get_wifi_diagnostics',
    'get_router': 'get_router_details',
    'list_connected_devices': 'list_connected_clients',
    'scan_wifi_neighbors': 'scan_wifi_spectrum',
    'get_wifi_scan_cached': 'get_wifi_diagnostics',
    'get_mesh_topology_cached': 'get_operation_status',
    'find_router_by_ip': 'list_routers',
    'change_wifi_credentials_f670lv9': 'configure_wifi',
    'reboot_router': 'reboot_router',
  };

  const updatedNodes = graph.nodes.map((node: any) => {
    let toolName = node.toolName || node.config?.toolName;
    if (!toolName) return node;

    // Check if it's an old MCP tool
    for (const [oldName, newName] of Object.entries(toolMapping)) {
      if (toolName.includes(oldName)) {
        const qualifiedNew = `mcp:${MCP_SERVER_ID}:${newName}`;
        return {
          ...node,
          toolName: qualifiedNew,
          config: node.config ? { ...node.config, toolName: qualifiedNew } : node.config,
        };
      }
    }

    return node;
  });

  return {
    ...graph,
    nodes: updatedNodes,
  };
}

async function main() {
  console.log('=== APLICANDO CONFIGURAÇÃO ROBUSTA: LUCAS SUPORTE TÉCNICO VELPRO ===');
  console.log(`Workspace ID: ${WORKSPACE_ID}`);
  console.log(`Agent ID: ${AGENT_ID}`);
  console.log(`Mode: ${APPLY ? 'APPLY (GRAVAÇÃO EM PRODUÇÃO)' : 'DRY-RUN (SIMULAÇÃO)'}`);

  const client = await pool.connect();
  try {
    // 1. Inspecionar e sincronizar ferramentas reais do ACS MCP
    console.log('\n[1/5] Sincronizando catálogo de 9 ferramentas com direct_http...');
    const serverConfig = {
      id: MCP_SERVER_ID,
      name: 'MCP-TR069-Routers',
      url: MCP_URL,
      transport: 'direct_http' as const,
      headers: {},
      isActive: true,
    };

    const startTime = Date.now();
    const tools = await listMcpServerTools(serverConfig);
    const latencyMs = Date.now() - startTime;
    console.log(`✓ MCP conectado com sucesso em ${latencyMs}ms! ${tools.length} ferramentas sincronizadas:`);
    for (const t of tools) {
      console.log(`  - ${t.name}: ${t.title || t.manualSummary || t.description || ''}`);
    }

    // 2. Buscar manuais oficiais do ACS
    console.log('\n[2/5] Compilando manuais de /como-usar para Knowledge Base...');
    const manualsText = await fetchManualsContent();
    console.log(`✓ Manuais compilados (${manualsText.length} caracteres).`);

    const acsKnowledgeDoc = {
      id: '9b8c2d14-5f3e-4a62-b918-ac5000000001',
      name: 'Guia Oficial de Suporte Técnico e Roteadores ACS (/como-usar)',
      tags: ['ACS', 'TR-069', 'Roteadores', 'Wi-Fi', 'Fibra', 'como-usar', 'Velpro'],
      tokens: Math.ceil(manualsText.length / 4),
      content: manualsText,
      summary: 'Diretrizes oficiais completas do servidor ACS para diagnóstico óptico de fibra, auditoria Wi-Fi, configuração atômica e reinício seguro.',
      category: 'Procedimentos Técnicos',
      updatedAt: new Date().toISOString(),
      contextRole: 'procedure',
      sourceFormat: 'markdown',
      requiredTools: ENABLED_TOOLS.filter((t) => t.startsWith('mcp:')),
      workflowHints: [
        'Sempre pedir CPF/CNPJ antes de acionar o MCP',
        'Se houver múltiplos contratos, perguntar de qual contrato se trata',
        'Atenuação entre -8 e -27 dBm é normal; pior que -28 dBm indica problema na fibra',
        'Configurar Wi-Fi com configure_wifi em chamada atômica única',
        'Zero Plaintext Secrets: nunca exibir senhas em texto puro',
        'Reiniciar apenas com aviso prévio, confirm: true e reason técnico',
      ],
      canonicalAnswer: 'Para suporte técnico a roteadores Velpro, consulte sempre os dados de CPF e contrato no SGP, meça a atenuação óptica antes de qualquer ação e utilize as ferramentas atômicas do ACS conforme as instruções de /como-usar.',
    };

    // 3. Carregar configuração atual do Lucas
    console.log('\n[3/5] Carregando configuração atual do Lucas Suporte Técnico...');
    const agentQuery = await client.query('SELECT * FROM autopilot_configs WHERE id = $1', [AGENT_ID]);
    if (agentQuery.rowCount === 0) {
      throw new Error(`Agente ${AGENT_ID} não encontrado!`);
    }
    const currentAgent = agentQuery.rows[0];

    // Atualizar knowledge_base_documents
    const existingDocs: any[] = currentAgent.knowledge_base_documents || [];
    const docIndex = existingDocs.findIndex((d: any) => d.id === acsKnowledgeDoc.id || d.name?.includes('ACS'));
    const updatedDocs = [...existingDocs];
    if (docIndex >= 0) {
      updatedDocs[docIndex] = acsKnowledgeDoc;
    } else {
      updatedDocs.unshift(acsKnowledgeDoc);
    }

    // Atualizar flow_graph
    const updatedFlowGraph = updateFlowGraphToolNodes(currentAgent.flow_graph);

    // 4. Preparar snapshot e versão de backup
    console.log('\n[4/5] Preparando migração e snapshot de versão...');
    const versionQuery = await client.query(
      'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM autopilot_config_versions WHERE config_id = $1',
      [AGENT_ID]
    );
    const nextVersion = Number(versionQuery.rows[0]?.next_version || 1);

    const oldSnapshot = {
      name: currentAgent.name,
      ai_model: currentAgent.ai_model,
      knowledge_base: currentAgent.knowledge_base,
      knowledge_base_documents: currentAgent.knowledge_base_documents,
      enabled_tool_names: currentAgent.enabled_tool_names,
      flow_graph: currentAgent.flow_graph,
    };

    const newSnapshot = {
      name: currentAgent.name,
      ai_model: currentAgent.ai_model,
      knowledge_base: LUCAS_SYSTEM_PROMPT,
      knowledge_base_documents: updatedDocs,
      enabled_tool_names: ENABLED_TOOLS,
      flow_graph: updatedFlowGraph,
    };

    console.log(`- Versão atual será salva como backup: v${nextVersion}`);
    console.log(`- Nova versão após aplicação: v${nextVersion + 1}`);
    console.log(`- Ferramentas ativadas (${ENABLED_TOOLS.length}):`);
    for (const tool of ENABLED_TOOLS) {
      console.log(`    • ${tool}`);
    }

    if (!APPLY) {
      console.log('\n[DRY-RUN CONCLUÍDO] Nenhuma alteração foi gravada. Execute com --apply para persistir no banco.');
      process.exit(0);
    }

    // 5. Executar aplicação atômica na transação
    console.log('\n[5/5] Gravando alterações no banco de dados...');
    await client.query('BEGIN');

    // A. Salvar versão de backup do estado anterior
    await client.query(
      `INSERT INTO autopilot_config_versions
         (config_id, workspace_id, user_id, version_number, label, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        AGENT_ID,
        WORKSPACE_ID,
        currentAgent.user_id || null,
        nextVersion,
        'Backup anterior ao upgrade MCP ACS e triagem SGP',
        JSON.stringify(oldSnapshot),
      ]
    );

    // B. Atualizar workspace_integrations para o servidor MCP
    const integrationQuery = await client.query(
      "SELECT id, config FROM workspace_integrations WHERE workspace_id = $1 AND provider = 'mcp'",
      [WORKSPACE_ID]
    );

    if (integrationQuery.rowCount && integrationQuery.rows[0]) {
      const row = integrationQuery.rows[0];
      const intConfig = row.config || {};
      const servers = Array.isArray(intConfig.servers) ? intConfig.servers : [];
      const serverIdx = servers.findIndex((s: any) => s.id === MCP_SERVER_ID || s.name?.includes('TR069'));

      const updatedServer = {
        ...(serverIdx >= 0 ? servers[serverIdx] : {}),
        id: MCP_SERVER_ID,
        name: 'MCP-TR069-Routers',
        url: MCP_URL,
        transport: 'direct_http',
        headers: {},
        isActive: true,
        healthStatus: 'healthy',
        healthLatencyMs: latencyMs,
        healthCheckedAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
        lastError: null,
        tools: tools,
      };

      if (serverIdx >= 0) {
        servers[serverIdx] = updatedServer;
      } else {
        servers.push(updatedServer);
      }

      intConfig.servers = servers;
      await client.query(
        'UPDATE workspace_integrations SET config = $2::jsonb, is_active = true WHERE id = $1',
        [row.id, JSON.stringify(intConfig)]
      );
      console.log('✓ workspace_integrations atualizada com direct_http e 9 ferramentas do ACS.');
    }

    // C. Atualizar autopilot_configs para o Lucas
    await client.query(
      `UPDATE autopilot_configs
          SET knowledge_base = $2,
              knowledge_base_documents = $3::jsonb,
              enabled_tool_names = $4::jsonb,
              flow_graph = $5::jsonb,
              updated_at = timezone('utc', now())
        WHERE id = $1`,
      [
        AGENT_ID,
        LUCAS_SYSTEM_PROMPT,
        JSON.stringify(updatedDocs),
        JSON.stringify(ENABLED_TOOLS),
        JSON.stringify(updatedFlowGraph),
      ]
    );
    console.log('✓ autopilot_configs do Lucas atualizado com novo prompt, documentos e ferramentas.');

    // D. Limpar rascunhos para consolidar a versão publicada
    await client.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1', [AGENT_ID]);
    console.log('✓ autopilot_config_drafts limpo (versão publicada consolidada).');

    // E. Gravar versão do novo estado aplicado
    await client.query(
      `INSERT INTO autopilot_config_versions
         (config_id, workspace_id, user_id, version_number, label, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        AGENT_ID,
        WORKSPACE_ID,
        currentAgent.user_id || null,
        nextVersion + 1,
        'Lucas N2 Velpro: Triagem SGP obrigatória + 9 Tools ACS MCP direct_http + /como-usar',
        JSON.stringify(newSnapshot),
      ]
    );

    await client.query('COMMIT');
    console.log('\n🎉 SUCESSO ABSOLUTO! Configurações aplicadas e salvas com sucesso em produção!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('ERRO NA APLICAÇÃO:', error);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
