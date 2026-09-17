# Feature Specification: Agente Lucas Suporte Técnico Velpro com ACS MCP e Validação SGP

**Feature Branch**: `003-lucas-velpro-mcp-sgp`  
**Created**: 2026-09-15  
**Status**: Ready for Implementation  
**Constraints**: Zero modificações no código-fonte (`src/`). Todas as alterações são realizadas via banco de dados (`autopilot_configs`, `workspace_integrations`), prompts operacionais e sincronização de ferramentas/manuais.

**Input**: User description:
> "Ajuste o nosso agente Lucas Suporte Técnico da workspace Velpro Telecom com as ferramentas do nosso MCP para que ele seja incrível no suporte técnico. use speckit para fazer algo incrível. Você não deve modificar o código. Lembrando que os clientes são do SGP, então meio que você deve ajustar para ele pedir o CPF e o contrato que ele está falando."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Triagem e Identificação Obrigatória de CPF e Contrato SGP (Priority: P1)

Como cliente da Velpro Telecom que entra em contato pelo WhatsApp para suporte técnico,  
Quero ser recebido cordialmente pelo Lucas, informar meu CPF/CNPJ e selecionar de qual contrato/endereço estou falando,  
Para que o suporte atue com precisão no meu circuito correto, sem risco de diagnosticar ou alterar o equipamento de outra residência ou contrato.

**Why this priority**: No provedor Velpro, os clientes estão cadastrados no SGP e podem ter múltiplos contratos (ex.: casa, empresa, sítio). Diagnosticar ou reiniciar um roteador sem vincular ao contrato correto causaria graves incidentes operacionais.

**Independent Test**:
1. Enviar mensagem inicial: *"Olá, minha internet caiu"*.
2. Verificar que o Lucas solicita o CPF/CNPJ do titular de forma educada e clara antes de qualquer diagnóstico de rede.
3. Informar o CPF. O Lucas invoca `sgp_fetch_contact_panel_data` e `sgp_fetch_contracts`.
4. Havendo mais de 1 contrato, o Lucas lista os endereços/planos e pergunta: *"Identifiquei mais de um contrato no seu cadastro: [1] Rua A, [2] Rua B. De qual deles você está falando hoje?"*.
5. O Lucas aguarda a confirmação do contrato antes de avançar para qualquer ferramenta técnica.

**Acceptance Scenarios**:
1. **Given** um cliente sem identificação no chat, **When** ele relata qualquer problema técnico, **Then** Lucas solicita o CPF/CNPJ do titular.
2. **Given** o CPF fornecido, **When** a consulta ao SGP retorna mais de um contrato, **Then** Lucas lista os contratos de forma resumida e amigável e exige a escolha do contrato pelo cliente antes de acionar o MCP.
3. **Given** o contrato identificado, **When** o cliente confirma o endereço, **Then** Lucas extrai o IP de conexão (`client_ip`) ou PPPoE para correlacionar no ACS.

---

### User Story 2 - Integração Resiliente e Sincronização das 9 Ferramentas do ACS MCP (Priority: P1)

Como analista de suporte técnico e operador da plataforma,  
Quero que a integração MCP do workspace Velpro utilize transporte HTTP JSON-RPC 2.0 direto (`direct_http`) e disponibilize as 9 ferramentas oficiais do servidor ACS,  
Para que o Lucas execute diagnósticos ópticos, análise de Wi-Fi e ações remotas sem erros de timeout, falhas de circuito ou ferramentas inexistentes.

**Why this priority**: Atualmente o Lucas possui ferramentas desatualizadas no cadastro (`get_wifi_view`, `find_router_by_ip`, etc.) que não correspondem ao servidor ACS atual, e o transporte `streamable_http` causou circuito aberto. Atualizar para `direct_http` e mapear as 9 ferramentas reais é essencial para o agente funcionar.

**Independent Test**:
1. Atualizar o transporte do servidor `MCP-TR069-Routers` para `direct_http` em `workspace_integrations`.
2. Sincronizar as 9 ferramentas oficiais: `list_routers`, `get_router_details`, `get_wifi_diagnostics`, `configure_wifi`, `list_connected_clients`, `scan_wifi_spectrum`, `reboot_router`, `get_operation_status`, `get_tool_manual`.
3. Validar que `listMcpServerTools` retorna status saudável e latência < 100ms.

**Acceptance Scenarios**:
1. **Given** o workspace Velpro Telecom (`e3b476a1-5de8-4744-80b5-a5d23fe15fab`), **When** o servidor MCP `8171892c-827b-4216-a631-02839d36af85` é configurado com `direct_http`, **Then** `healthStatus` é atualizado para `healthy` e `lastError` é limpo.
2. **Given** o agente Lucas Suporte Técnico (`7d7259ab-a6c3-4057-a9ca-28ddbb15db95`), **When** as ferramentas são habilitadas, **Then** `enabled_tool_names` contém as 9 ferramentas MCP ativas + ferramentas SGP + ferramentas de gestão de chat (`transfer_chat`, `close_chat`, `add_internal_note`).

---

### User Story 3 - Suporte Técnico de Alto Nível Seguindo /como-usar do ACS (Priority: P1)

Como cliente da Velpro Telecom,  
Quero que o Lucas analise tecnicamente minha conexão (potência óptica da fibra, canais Wi-Fi, dispositivos conectados, interferência de vizinhos) e resolva meu problema de forma segura,  
Para que eu tenha um atendimento rápido, humano e profissional sem necessidade de esperar na fila por um atendente humano quando o problema for resolvível remotamente.

**Why this priority**: É o cerne da solicitação do usuário: tornar o Lucas *incrível no suporte técnico*, respeitando à risca o manual `/como-usar`.

**Independent Test**:
1. Cenário Lentidão: O cliente reclama de lentidão no Wi-Fi. Lucas consulta `get_router_details` (atenuação óptica) e `get_wifi_diagnostics` + `scan_wifi_spectrum`. Identifica interferência no canal 6 e sugere alteração para canal mais limpo ou ajusta via `configure_wifi`.
2. Cenário Reinício: O cliente pede para reiniciar o modem. Lucas avisa que a conexão cairá por 2 a 3 minutos, pede confirmação, e chama `reboot_router` passando `confirm: true` e `reason` fundamentado.
3. Cenário Senha Wi-Fi: O cliente pede troca de senha. Lucas exige senha com no mínimo 8 caracteres, executa `configure_wifi` de forma atômica e NUNCA exibe senhas antigas em texto plano (Zero Plaintext Secrets).
4. Cenário Falha Óptica (LOS Vermelho): Atenuação pior que -28 dBm ou LOS aceso. Lucas detecta problema físico na fibra, orienta verificação básica de cabos sem forçar e transfere para a equipe humana via `transfer_chat`, registrando nota detalhada com `add_internal_note`.

**Acceptance Scenarios**:
1. **Given** um relato de perda de sinal ou lentidão, **When** Lucas executa diagnóstico, **Then** ele primeiro mede a atenuação óptica (`get_router_details`) antes de alterar configurações Wi-Fi.
2. **Given** qualquer ação em roteadores, **When** Lucas consulta o manual `/como-usar`, **Then** ele segue os parâmetros estritos e trata erros acionáveis com a sugestão corretiva (`remedial_suggestion`).
3. **Given** uma necessidade de transferência humana, **When** Lucas chama `transfer_chat`, **Then** ele registra previamente uma nota interna (`add_internal_note`) contendo CPF, contrato, IP, sintomas, testes executados e diagnóstico.

---

## Edge Cases

1. **CPF não localizado no SGP**: Lucas informa que não localizou contrato com o CPF informado, pede para conferir os dígitos ou enviar o CNPJ/nome do titular cadastrado.
2. **Múltiplos contratos no mesmo CPF**: Lucas exibe a lista dos contratos com respectivos endereços/planos e não prossegue com ferramentas técnicas até que o cliente especifique qual deles está apresentando instabilidade.
3. **CPE inacessível ou IP não correlacionado**: Se `list_routers` ou `get_router_details` não encontrar a CPE pelo IP do SGP, Lucas tenta correlation por MAC ou login PPPoE. Se persistir inacessível e a fibra estiver ok, orienta verificação de energia do roteador.
4. **Cliente solicita atendente humano ou está irritado**: Lucas acolhe a insatisfação com empatia, registra nota interna com todo o histórico e transfere de imediato com `transfer_chat`.
5. **Atenuação óptica crítica (< -28 dBm)**: Lucas não tenta reboots repetidos nem alterações de canal; reconhece falha na infraestrutura de fibra óptica e transfere para abertura de visita técnica.

---

## Requirements

### Functional Requirements

- **FR-001**: O agente Lucas DEVE solicitar proativamente o CPF/CNPJ do titular no início da triagem técnica caso o identificador não esteja presente no contexto.
- **FR-002**: O agente Lucas DEVE consultar o SGP (`sgp_fetch_contracts` e `sgp_fetch_contact_panel_data`) e identificar os contratos vinculados. Se houver mais de um contrato, DEVE listar as opções e exigir a escolha do cliente antes de executar diagnósticos de roteador.
- **FR-003**: O transporte do servidor MCP da Velpro DEVE ser configurado como `direct_http` com URL `http://192.145.213.2:8090/mcp`, restabelecendo a saúde da integração sem travamentos de circuito.
- **FR-004**: As ferramentas habilitadas do Lucas DEVEM incluir o catálogo atualizado de 9 ferramentas do ACS MCP + 5 ferramentas da plataforma (`sgp_fetch_contracts`, `sgp_fetch_contact_panel_data`, `add_internal_note`, `transfer_chat`, `close_chat`).
- **FR-005**: O prompt operacional (Knowledge Base) do Lucas DEVE conter as diretrizes oficiais de `/como-usar` do ACS:
  - Verificação de potência óptica de fibra: normal (-8 dBm a -27 dBm); falha grave (< -28 dBm).
  - Regra Zero Plaintext Secrets: proibição absoluta de revelar senhas de Wi-Fi em texto puro.
  - Regra de Operação Atômica: `configure_wifi` deve ser invocado em bloco único para evitar reboots múltiplos.
  - Regra de Reinício Seguro: `reboot_router` exige aviso prévio ao cliente, `confirm: true` e `reason` técnico preenchido.
  - Regra de Escalonamento: registro de evidências em `add_internal_note` antes de invocar `transfer_chat`.
- **FR-006**: Os manuais oficiais de `/como-usar` DEVEM ser integrados aos documentos de conhecimento (`knowledge_base_documents`) do agente para consulta instantânea de parâmetros e códigos de erro.
- **FR-007**: Nenhuma linha de código em `src/` DEVE ser modificada. Todas as atualizações DEVEM ser efetuadas no banco de dados via script idempotente com backup de versão.

---

## Success Criteria

- **SC-001**: O agente Lucas exige o CPF e resolve o contrato antes de qualquer intervenção técnica no roteador.
- **SC-002**: 100% das 9 ferramentas do ACS MCP estão sincronizadas e ativas para o agente Lucas no workspace Velpro.
- **SC-003**: Conexão com o servidor MCP com latência inferior a 100ms via `direct_http` e circuito íntegro (`healthy`).
- **SC-004**: Simulações de suporte técnico confirmam o fluxo: Triagem CPF -> Identificação Contrato -> Diagnóstico Óptico/Wi-Fi -> Solução/Ação Segura ou Transferência com Nota.
