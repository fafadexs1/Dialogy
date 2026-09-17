# Implementation Plan: Agente Lucas Suporte Técnico Velpro com ACS MCP e Validação SGP

**Branch**: `003-lucas-velpro-mcp-sgp` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

## Summary

Este plano estabelece a modernização completa do agente **Lucas Suporte Técnico** no workspace **Velpro Telecom** (`e3b476a1-5de8-4744-80b5-a5d23fe15fab`). A solução entrega suporte técnico automatizado de nível N2 de excelência para clientes conectados ao provedor Velpro, com:
1. **Triagem Cadastral e Resolução de Contrato SGP**: O Lucas solicita obrigatoriamente o CPF/CNPJ do titular e, caso existam múltiplos contratos, apresenta as opções de endereço/plano e exige a escolha do cliente antes de qualquer comando técnico.
2. **Infraestrutura MCP Resiliente via `direct_http`**: Atualização do transporte para JSON-RPC 2.0 direto contra `http://192.145.213.2:8090/mcp`, eliminando timeouts de SSE e restaurando o status saudável (`healthy`).
3. **Catálogo Oficial das 9 Ferramentas do ACS**: Mapeamento e habilitação das ferramentas reais do servidor TR-069, substituindo os identificadores legados obsoletos.
4. **Base de Conhecimento e Prompt Operacional de Alto Padrão**: Injeção do guia oficial `/como-usar`, regras de atenuação óptica da fibra (-8 dBm a -27 dBm), auditoria de clientes (RSSI), configuração atômica de Wi-Fi, política Zero Plaintext Secrets e reinício remoto auditado.
5. **Integração de Manuais Técnicos em Documentos de Conhecimento**: Criação do documento canônico de `/como-usar` no acervo do agente.
6. **Execução sem Alteração de Código**: 100% aplicado através de banco de dados e script auditado idempotente com backup de versão (`autopilot_config_versions`).

---

## Technical Context

- **Workspace**: Velpro Telecom (`e3b476a1-5de8-4744-80b5-a5d23fe15fab`)
- **Agent Config ID**: `7d7259ab-a6c3-4057-a9ca-28ddbb15db95` (Lucas Suporte Técnico)
- **Model**: `deepseek/deepseek-v4-flash`
- **SGP Integration**: Base URL `https://velpro.sgp.tsmx.com.br`, AppId `Discordrotas`
- **MCP Server**: `8171892c-827b-4216-a631-02839d36af85` ("MCP-TR069-Routers")
- **Target Endpoint**: `http://192.145.213.2:8090/mcp` (com fallback local `http://localhost:8090/mcp`)
- **Transport**: `direct_http`
- **Database**: PostgreSQL (Prisma + `pg` Pool)
- **Execution CLI**: `@dotenvx/dotenvx` + `tsx`

---

## Constitution & Constraints Check

- [x] **Regra Absoluta do Usuário: Zero modificações de código em `src/`**: Nenhuma alteração será feita em arquivos `.ts` ou `.tsx` do sistema. Toda a entrega é realizada via banco de dados e scripts de orquestração.
- [x] **Multi-Tenant Isolation**: Todos os updates são rigorosamente restritos ao `workspace_id = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab'`.
- [x] **Idempotência e Versionamento**: Criação de snapshot prévio em `autopilot_config_versions` antes de aplicar qualquer modificação.
- [x] **Zero Plaintext Secrets**: O prompt e manuais proíbem expressamente a exposição de senhas de clientes em texto plano.

---

## Implementation Steps

### Step 1: Sincronização e Reparo da Integração MCP no Workspace
- Criar script `scripts/apply-lucas-velpro-sgp-mcp.ts`.
- Carregar as 9 ferramentas reais via `listMcpServerTools` com transporte `direct_http`.
- Atualizar a linha em `workspace_integrations`:
  - `transport: 'direct_http'`
  - `url: 'http://192.145.213.2:8090/mcp'`
  - `healthStatus: 'healthy'`
  - `lastError: null`
  - `tools: [9 ferramentas com schemas e anotações completas]`
  - `syncedAt: new Date().toISOString()`

### Step 2: Geração do Documento Canônico de Conhecimento `/como-usar`
- Consultar `/manuals` no servidor ACS.
- Compilar o documento de conhecimento estruturado em Markdown com todas as instruções operacionais dos 9 manuais do ACS:
  - `list_routers.md`: Localização por IP, MAC, serial.
  - `get_router_details.md`: Diagnóstico de fibra óptica (-8 dBm a -27 dBm ideal; < -28 dBm crítico), uptime e WAN.
  - `get_wifi_diagnostics.md`: Frequências 2.4GHz e 5GHz, canais, SSIDs.
  - `configure_wifi.md`: Configuração atômica, senha mínima 8 dígitos, sem reboots extras.
  - `list_connected_clients.md`: Tabela de clientes e RSSI (< -75 dBm cobertura fraca).
  - `scan_wifi_spectrum.md`: Espectro RF e escolha de canais limpos.
  - `reboot_router.md`: Reinício auditado com aviso ao cliente, `confirm: true` e `reason`.
  - `get_operation_status.md`: Fila TR-069 assíncrona.
  - `get_tool_manual.md`: Guia de consulta em tempo de execução.
- Salvar como documento de conhecimento anexado à configuração do Lucas (`knowledge_base_documents`).

### Step 3: Construção do Prompt Operacional e Knowledge Base de Alto Nível
- Substituir o texto do `knowledge_base` do Lucas por uma diretriz operacional robusta e estruturada:
  1. **Persona e Papel**: Lucas, analista de suporte técnico N2 da Velpro Telecom. Tom humano, calmo, seguro e objetivo.
  2. **Regra de Ouro da Triagem SGP (CPF + Contrato)**:
     - Pedir CPF/CNPJ logo no início do atendimento técnico se não estiver presente.
     - Invocar `sgp_fetch_contact_panel_data` e `sgp_fetch_contracts`.
     - **Disambiguação Obrigatória de Contrato**: Se houver mais de 1 contrato cadastrado, listar os endereços e planos e perguntar: *"Identifiquei mais de um contrato no seu cadastro: [1] Endereço A - Plano X; [2] Endereço B - Plano Y. De qual deles você gostaria de falar hoje?"*. NUNCA executar ferramentas técnicas sem a definição inequívoca do contrato.
     - Extrair o IP WAN (`client_ip`) ou PPPoE do contrato selecionado para passar como parâmetro nas ferramentas do ACS.
  3. **Diagnóstico Estruturado e Regras `/como-usar`**:
     - Sem internet ou cabo desconectado: verificar status WAN e atenuação óptica com `get_router_details`.
     - Atenuação óptica: se entre -8 e -27 dBm, sinal de fibra normal. Se pior que -28 dBm, indicar falha física e transferir para chamado com nota.
     - Lentidão ou Wi-Fi ruim: consultar `get_wifi_diagnostics`, listar clientes com `list_connected_clients` e varrer espectro com `scan_wifi_spectrum`.
     - Troca de Wi-Fi: usar `configure_wifi` atômica, senha >= 8 caracteres, nunca revelar senhas em texto puro.
     - Reinício: avisar o cliente da queda temporária (2-3 minutos), obter concordância e chamar `reboot_router` com `confirm: true` e `reason`.
  4. **Escalonamento e Transferência**:
     - Em caso de falha de fibra, equipamento inoperante, necessidade de OS presencial ou cliente insatisfeito: registrar nota detalhada com `add_internal_note` e transferir para o setor Suporte com `transfer_chat`.

### Step 4: Atualização das Ferramentas Habilitadas
- Configurar `enabled_tool_names` do Lucas com as 14 ferramentas necessárias:
  - `sgp_fetch_contracts`
  - `sgp_fetch_contact_panel_data`
  - `add_internal_note`
  - `transfer_chat`
  - `close_chat`
  - `mcp:8171892c-827b-4216-a631-02839d36af85:list_routers`
  - `mcp:8171892c-827b-4216-a631-02839d36af85:get_router_details`
  - `mcp:8171892c-827b-4216-a631-02839d36af85:get_wifi_diagnostics`
  - `mcp:8171892c-827b-4216-a631-02839d36af85:configure_wifi`
  - `mcp:8171892c-827b-4216-a631-02839d36af85:list_connected_clients`
  - `mcp:8171892c-827b-4216-a631-02839d36af85:scan_wifi_spectrum`
  - `mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router`
  - `mcp:8171892c-827b-4216-a631-02839d36af85:get_operation_status`
  - `mcp:8171892c-827b-4216-a631-02839d36af85:get_tool_manual`

### Step 5: Teste, Simulação e Auditoria
- Criar script `scripts/verify-lucas-velpro.ts`.
- Executar verificação da configuração aplicada e simular o raciocínio do modelo nos cenários críticos de suporte técnico.
