# Phase 0: Research & Technical Decisions

**Feature**: Integração Robusta com MCP do ACS e Consulta Obrigatória a /como-usar
**Date**: 2026-09-14
**Spec**: [spec.md](./spec.md)

---

## 1. Transporte e Conexão com Servidores MCP HTTP

### Problema
O cliente MCP atual da Dialogy depende exclusivamente de `@modelcontextprotocol/sdk` com `StreamableHTTPClientTransport` ou `SSEClientTransport`.
No servidor MCP do ACS (`router-mcp`), o endpoint `/mcp` processa requisições JSON-RPC 2.0 via HTTP POST tradicional retornando `Content-Type: application/json` imediatamente no corpo da resposta HTTP. Enquanto isso, o endpoint GET `/mcp` / `/sse` envia `event: endpoint` e heartbeats periódicos de SSE.
Quando o `StreamableHTTPClientTransport` recebe a notificação `notifications/initialized`, ele tenta abrir uma conexão SSE GET de longa duração para ouvir eventos. Como o servidor responde no corpo do POST e mantém apenas heartbeats no GET, o transporte da biblioteca padrão pode aguardar indefinidamente até estourar o timeout de 20s.

### Decisão
Implementar um **Direct HTTP JSON-RPC 2.0 Transport** como fallback/opção de alta velocidade e confiabilidade:
- Se o servidor estiver configurado com transporte HTTP ou se a conexão inicial do SDK não negociar stream em 2 segundos, o cliente executa POST JSON-RPC 2.0 direto (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`).
- Esse modo é 100% compatível com a especificação MCP JSON-RPC 2.0 (Methods: `initialize`, `tools/list`, `tools/call`), responde em menos de 50ms, não sofre com travamentos de conexão e suporta headers de autenticação como `Authorization` e `ACS_SERVICE_TOKEN`.
- O suporte a `SSEClientTransport` e `StdioClientTransport` permanece disponível e otimizado.

---

## 2. Ingestão e Consulta a `/como-usar` do ACS

### Problema
O usuário destacou que o MCP atual da Dialogy é fraco em seguir instruções à risca e exigiu:
> *"quando formos fazer algo com a IA ele consulte /como-usar do ACS. Deve ser algo que a IA deve ter acesso muito bem e ter facilidade em utilizar."*

No ACS:
- O frontend expõe `/como-usar`, que consulta `http://localhost:8090/manuals` ou `GET /manuals/:tool_name?format=raw`.
- O servidor MCP expõe a ferramenta nativa `get_tool_manual` (com parâmetro `tool_name` opcional para manual individual ou índice completo).
- Os 9 manuais contêm as regras de ouro:
  1. **Zero Plaintext Secrets**: senhas de roteador e Wi-Fi nunca podem trafegar ou ser exibidas desnecessariamente.
  2. **Consolidação Atômica**: `configure_wifi` deve aplicar SSID, senha, canal e rádios em uma transação atômica única, sem reboots múltiplos.
  3. **Reinício Auditado**: `reboot_router` exige `confirm: true` e `reason` técnico obrigatório.
  4. **Diagnóstico Prévio**: coletar potência óptica (`get_router_details`) e rádios (`get_wifi_diagnostics`) antes de tentar qualquer alteração.
  5. **Status de Operações**: comandos pendentes TR-069 devem ser verificados com `get_operation_status`.

### Decisão
Criar uma integração de duas camadas para `/como-usar`:
1. **Camada de Execução Dinâmica (Tool-First)**:
   - A ferramenta `get_tool_manual` é garantida no catálogo do agente.
   - O prompt do sistema no runtime da IA (`process-chat.ts`, `agent-loop.ts`, `auto-responder.ts`) ganha instrução imperativa:
     *"Antes de interagir ou executar qualquer operação em roteadores (CPEs) via ACS, consulte obrigatoriamente as diretrizes em /como-usar invocando `get_tool_manual` ou lendo os manuais técnicos correspondentes. Siga à risca os parâmetros exigidos, a regra Zero Plaintext Secrets e a exigência de confirmação explícita para reboot."*
2. **Camada de Conhecimento e Enriquecimento Automático (Context-First)**:
   - Ao sincronizar o servidor MCP do ACS, a Dialogy detecta o endpoint `/manuals` ou a ferramenta `get_tool_manual` e enriquece a descrição de cada ferramenta com as regras de uso extraídas do manual oficial.
   - Disponibilizar na interface da Dialogy um botão de sincronização de manuais para criar/atualizar automaticamente o documento de conhecimento `"ACS: Como Usar - Manuais Oficiais de Roteadores"` na base RAG do workspace, permitindo que a IA já tenha os manuais carregados em seu contexto inicial sem gastar turnos extras.

---

## 3. Tratamento de Erros Acionáveis para a IA

### Problema
O MCP v2.1 do ACS retorna erros no formato:
```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "❌ Erro [WEAK_PASSWORD]: ..." }],
  "structuredContent": {
    "error_code": "WEAK_PASSWORD",
    "message": "...",
    "remedial_suggestion": "Oriente o cliente a escolher uma senha com pelo menos 8 dígitos."
  }
}
```
Se a Dialogy tratar isso apenas como uma string genérica de falha, a IA não sabe como se corrigir.

### Decisão
No runtime de execução de tools (`runMcpCallTool` em `src/services/agent-tools/runtime.ts` e `autopilot-tool-bridge.ts`):
- Preservar `structuredContent` e `isError`.
- Quando `remedial_suggestion` estiver presente, incluí-la explicitamente na mensagem repassada para o prompt do modelo no próximo turno:
  `[Ação Corretiva Recomendada pelo ACS]: {remedial_suggestion}`.
- Isso orienta a IA a corrigir os dados imediatamente ou formular a pergunta correta para o cliente.
