# Feature Specification: Integração Robusta com MCP do ACS e Consulta Obrigatória a /como-usar

**Feature Branch**: `002-mcp-acs-integration`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "Eu te dei acesso há um novo diretório chamado ACS, nele há um servidor MCP cujo qual fazemos conexões. No nosso MCP da dialogy hoje é muito fraco, preciso que ele siga a risca as instruções e puxe corretamente as ferramentas e quando formos fazer algo com a IA ele consulte /como-usar do ACS. Deve ser algo que a IA deve ter acesso muito bem e ter facilidade em utilizar. Use speckit"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Descoberta e Sincronização Precisa de Ferramentas MCP (Priority: P1)

Como administrador ou desenvolvedor no Dialogy, quero conectar ao servidor MCP do ACS com transporte resiliente (HTTP JSON-RPC direto, SSE ou Stdio) e puxar todas as 9 ferramentas com seus esquemas de entrada estritos, descrições detalhadas de parâmetros e anotações de segurança, sem timeouts e sem erros de formato.

**Why this priority**: Sem a extração precisa e confiável das ferramentas e de seus schemas JSON, a IA não consegue invocar as capacidades do roteador nem validar os dados necessários.

**Independent Test**: Pode ser testado de forma isolada ao cadastrar o servidor MCP `http://localhost:8090/mcp` no painel de integrações da Dialogy e acionar "Sincronizar Ferramentas". O sistema deve listar as 9 ferramentas com zero erros em menos de 2 segundos.

**Acceptance Scenarios**:

1. **Given** o servidor MCP do ACS ativo na porta 8090, **When** o usuário clica em "Sincronizar Ferramentas" ou o sistema executa o sincronismo, **Then** as 9 ferramentas (`list_routers`, `get_router_details`, `get_wifi_diagnostics`, `configure_wifi`, `list_connected_clients`, `scan_wifi_spectrum`, `reboot_router`, `get_operation_status`, `get_tool_manual`) são registradas com schemas completos no workspace.
2. **Given** um transporte HTTP configurado para o servidor MCP, **When** a chamada JSON-RPC `initialize` e `tools/list` é realizada, **Then** o cliente utiliza fallback inteligente direto (POST JSON-RPC / SSE) sem travar em streaming pendente.

---

### User Story 2 - Consulta e Observância Estrita ao Guia /como-usar do ACS pela IA (Priority: P1)

Como atendente inteligente (Autopilot / Workflow Runtime) na Dialogy, ao receber uma demanda de diagnóstico ou configuração de rede/roteador, devo consultar as instruções técnicas de `/como-usar` (através da ferramenta nativa `get_tool_manual` ou de base de manuais técnicos sincronizados) e seguir à risca os requisitos operacionais antes de qualquer ação.

**Why this priority**: Garante que o agente de IA não adivinhe parâmetros nem execute operações de risco (como reboots desnecessários ou trocas parciais de Wi-Fi) e cumpra as diretrizes de segurança (Zero Plaintext Secrets, operações atômicas).

**Independent Test**: Simular uma mensagem de cliente reportando "minha internet está lenta no Wi-Fi" em um chat com o agente. O agente deve planejar a investigação consultando o manual (`get_tool_manual` ou instruções de `/como-usar`) e executar o fluxo de diagnóstico correto (`get_router_details` ou `get_wifi_diagnostics`) antes de propor ações.

**Acceptance Scenarios**:

1. **Given** ferramentas do ACS MCP habilitadas no agente, **When** o prompt do sistema é construído para a IA, **Then** ele inclui a diretriz mandatória de consultar `/como-usar` via `get_tool_manual` e seguir as instruções oficiais de diagnóstico e mitigação.
2. **Given** uma necessidade de reiniciar o roteador, **When** a IA decide chamar `reboot_router`, **Then** a IA fornece obrigatoriamente `confirm: true` e um `reason` descritivo fundamentado nas evidências do atendimento, conforme especificado no manual.
3. **Given** uma necessidade de alterar credenciais Wi-Fi, **When** a IA decide configurar a rede, **Then** a IA aciona a ferramenta consolidada `configure_wifi` com os parâmetros atômicos, evitando quedas repetidas de rádio.

---

### User Story 3 - Integração Fluida e Fácil Acesso aos Manuais para a IA e Operadores (Priority: P2)

Como operador de suporte ou desenvolvedor de fluxos na Dialogy, quero visualizar facilmente o status de conexão do MCP do ACS, pré-visualizar o conteúdo de `/como-usar` diretamente na Dialogy e dispor de enriquecimento automático de manuais como Documentos de Conhecimento na base RAG do agente.

**Why this priority**: Dá visibilidade total ao operador sobre o que a IA está aprendendo e utilizando, facilitando a auditoria e a operação contínua.

**Independent Test**: Acessar a página `/integrations/mcp` e visualizar a documentação/manuais sincronizados do ACS com um clique em "Ver Manuais / Como Usar", confirmando a formatação Markdown renderizada.

**Acceptance Scenarios**:

1. **Given** a página de MCP da Dialogy, **When** o operador seleciona o servidor ACS, **Then** ele tem acesso a um botão de atalho para inspecionar os manuais técnicos oficiais (`/como-usar`).
2. **Given** a sincronização de ferramentas do ACS, **When** a opção de enriquecer conhecimento operacional estiver ativada, **Then** os manuais de `/como-usar` são indexados na base do agente para recuperação contextual imediata.

---

### Edge Cases

- O que acontece se o servidor MCP estiver temporariamente offline ou a CPE estiver inacessível? O sistema reporta erro estruturado com código de erro e sugestão corretiva sem expor detalhes internos ao cliente final.
- O que acontece se a IA tentar chamar uma ferramenta sem consultar o manual ou com parâmetros incompletos? O gateway de capacidade rejeita a chamada informando quais parâmetros obrigatórios estão ausentes e orienta a consulta a `get_tool_manual`.
- O que acontece se a resposta da ferramenta retornar `isError: true` com `structuredContent.remedial_suggestion`? O agente utiliza a sugestão corretiva para orientar o próximo passo seguro ou esclarecer a dúvida com o cliente.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O cliente MCP da Dialogy DEVE suportar transporte JSON-RPC 2.0 direto via HTTP POST (com suporte a headers de autenticação como `ACS_SERVICE_TOKEN`), garantindo compatibilidade imediata com o servidor do ACS sem bloqueios de stream SSE.
- **FR-002**: O sistema DEVE sincronizar e cadastrar perfeitamente as 9 ferramentas do ACS (`list_routers`, `get_router_details`, `get_wifi_diagnostics`, `configure_wifi`, `list_connected_clients`, `scan_wifi_spectrum`, `reboot_router`, `get_operation_status`, `get_tool_manual`), mapeando tipagem, obrigatoriedade e descrições ricas de cada parâmetro.
- **FR-003**: Os prompts do sistema no runtime da IA (`process-chat.ts`, `agent-loop.ts`, `auto-responder.ts`) DEVEM incluir regras mandatórias de operação quando ferramentas do ACS estiverem ativas, instruindo a IA a consultar `/como-usar` (via `get_tool_manual` ou base sincronizada) e a respeitar o fluxo padrão de diagnóstico.
- **FR-004**: O sistema DEVE permitir a consulta direta do endpoint de manuais (`/manuals` e `/manuals/:tool_name?format=raw`) ou via ferramenta `get_tool_manual`, fornecendo a documentação técnica integral em Markdown.
- **FR-005**: O sistema DEVE preservar total isolamento multi-inquilino (`workspaceId`), garantindo que servidores e credenciais de um provedor não vazem para outro.
- **FR-006**: As respostas de erro com formato acionável da ACS MCP (`remedial_suggestion` e `error_code`) DEVEM ser repassadas de forma estruturada para que o modelo de IA tome a ação corretiva apropriada.

### Key Entities

- **McpServerConfig**: Representa a configuração do servidor MCP no workspace, contendo id, nome, url, transporte, headers (com suporte a tokens de serviço ACS), status de saúde e ferramentas sincronizadas.
- **McpToolConfig & Manual**: Definição da ferramenta MCP enriquecida com metadados do manual técnico oficial (`/como-usar`), parâmetros tipados e categoria de risco.
- **RouterOperationalPolicy**: Regras de conformidade injetadas no contexto do agente de IA determinando o passo-a-passo obrigatório de atendimento e diagnóstico de roteadores.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das 9 ferramentas do ACS MCP são sincronizadas na Dialogy com validação estrita de schema e zero timeouts.
- **SC-002**: 100% das chamadas realizadas pela IA em cenários de teste utilizam parâmetros válidos e tipados conforme a especificação do manual de `/como-usar`.
- **SC-003**: Nenhuma credencial administrativa ou senha de cliente trafega em texto não higienizado nos logs de auditoria ou respostas.
- **SC-004**: O tempo de sincronização e teste de conexão do MCP permanece abaixo de 2 segundos sob condições normais de rede local.

## Assumptions

- O servidor MCP do ACS roda localmente na porta 8090 (ou via URL configurada) com acesso ao MongoDB e à API do ACS na porta 8000.
- A ferramenta `get_tool_manual` e os endpoints HTTP `/manuals` do ACS são as fontes oficiais de documentação técnica do guia `/como-usar`.
- A IA possui capacidade de invocar ferramentas estruturadas com JSON Schema compatível.
