
'use server';

/**
 * @fileOverview This file contains the Genkit flow for a rule-based autonomous agent
 * that can use tools to gather information and respond to users.
 *
 * - generateAgentResponse - A function that evaluates a customer message and generates a response.
 * - AgentResponseInput - The input type for the generateAgentResponse function.
 * - AgentResponseOutput - The return type for the generateAgentResponse function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import type { NexusFlowInstance, Action, AutopilotConfig } from '@/lib/types';
import { makeHttpRequestTool } from '../tools/webhook-tool';
import { logAutopilotUsage } from '@/actions/autopilot';
import { formatCustomerFacingAiResponse } from '@/lib/ai-response-format';
import {
  assertAiModelOutput,
  runAiModelWithFallback,
  type AiModelKeyCandidate,
} from '@/services/ai/model-client';

// Define a schema for a single automation rule
const ActionSchema = z.union([
  z.object({
    type: z.literal('reply'),
    value: z.string().describe('The text response to send to the user.'),
  }),
  z.object({
    type: z.literal('webhook'),
    url: z.string().url().describe('The URL to send the HTTP request to.'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
    description: z.string().optional(),
    auth: z.record(z.any()).optional(),
    headers: z.record(z.string()).optional(),
    query: z.record(z.string()).optional(),
    bodyType: z.enum(['json', 'form-data']).optional(),
    body: z.record(z.any()).optional().describe('The JSON body for the request. You can use Handlebars variables like {{contact.id}}.'),
  }),
]);


const AutomationRuleSchema = z.object({
  name: z.string().describe('The name of the automation rule.'),
  trigger: z.string().describe('The condition that triggers the automation.'),
  action: ActionSchema,
});

const KnowledgeDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  summary: z.string().nullable().optional(),
});

const ResolvedCaseSchema = z.object({
  summary: z.string(),
  problem: z.string(),
  resolution: z.string(),
  outcome: z.string(),
  closeReasonLabel: z.string().optional().nullable(),
  keywords: z.array(z.string()).optional(),
  similarity: z.number().optional(),
});

const AgentResponseInputSchema = z.object({
  chatId: z.string().describe("The unique identifier for the current chat."),
  customerMessage: z
    .string()
    .describe('The latest message from the customer in the chat.'),
  chatHistory: z
    .string()
    .optional()
    .describe('The history of the chat between the agent and customer.'),
  relevantHistory: z
    .string()
    .optional()
    .describe('Relevant past messages retrieved from vector search (RAG).'),
  resolvedCases: z
    .array(ResolvedCaseSchema)
    .optional()
    .describe('Resolved support cases retrieved from operational memory.'),
  rules: z.array(AutomationRuleSchema).describe('A list of active automation rules to evaluate against.'),
  knowledgeBase: z
    .string()
    .optional()
    .describe('A collection of texts, examples, and instructions that the AI should use as a knowledge base to formulate its answers.'),
  knowledgeBaseDocuments: z
    .array(KnowledgeDocumentSchema)
    .optional()
    .describe('Factual knowledge documents supporting customer-facing claims.'),
  workflowKnowledgeDocuments: z
    .array(KnowledgeDocumentSchema)
    .optional()
    .describe('Operational procedures and policies that govern how the agent should act.'),
  fallbackReply: z
    .string()
    .optional()
    .describe('Mensagem de contingência para quando nenhuma resposta segura puder ser gerada.'),
  escalationPolicy: z
    .string()
    .optional()
    .describe('Politica operacional para quando escalar ou transferir para um humano.'),
  closingPolicy: z
    .string()
    .optional()
    .describe('Politica operacional para quando o atendimento pode ser considerado resolvido ou encerrado.'),
  enabledAgentToolsDescription: z
    .string()
    .optional()
    .describe('Lista textual das ferramentas habilitadas para este agente.'),
  knowledgeToolProcedures: z
    .string()
    .optional()
    .describe('Procedimentos da base de conhecimento que mencionam tools com @nome_da_tool.'),
  intentContext: z
    .string()
    .optional()
    .describe('Contexto deterministico de intencao, workflow e cobertura de conhecimento resolvido pelo servidor.'),
  model: z.string().optional().describe('The AI model to use for the response.'),
  contact: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional().nullable(),
    phone_number_jid: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    tags: z.array(z.any()).optional(),
    custom_fields: z.record(z.any()).optional(),
    lead_score: z.number().optional().nullable(),
    owner: z.any().optional(),
    crm: z.any().optional(),
  })
    .describe('The contact details of the customer.'),
});

export type AgentResponseInput = z.infer<typeof AgentResponseInputSchema>;

const AgentResponseOutputSchema = z.object({
  response: z
    .string()
    .optional()
    .nullable()
    .describe('The generated response to be sent to the customer. This could be a direct text reply or the result from a webhook.'),
  messageBlocks: z
    .array(z.string())
    .optional()
    .nullable()
    .describe('When the response has distinct thematic sections that should be sent as separate WhatsApp messages, split them here. Each element is one message bubble. Use only when there are 2+ clearly distinct topics. For simple/short replies, omit this and use only "response".'),
  triggeredRule: z
    .string()
    .optional()
    .nullable()
    .describe('The name of the rule that was triggered.'),
  actions: z
    .array(z.object({
      type: z.enum([
        'transfer_chat',
        'close_chat',
        'add_internal_note',
        'crm_update_contact_custom_fields',
        'sgp_fetch_contracts',
        'sgp_fetch_contact_panel_data',
        'sgp_generate_invoice_pix',
        'sgp_create_payment_promise',
        'sgp_open_support_ticket',
        'mcp_call_tool',
      ]),
      reason: z.string().optional().nullable(),
      payload: z.record(z.any()).optional().nullable(),
    }))
    .optional()
    .nullable()
    .describe('Structured system actions requested by the AI. The server validates and executes them.'),
});
export type AgentResponseOutput = z.infer<typeof AgentResponseOutputSchema>;

// We create a new input schema for the Flow that includes the config object.
const AutoResponderFlowInputSchema = AgentResponseInputSchema.extend({
  config: z.any().describe("The autopilot config object from the database."),
  workspaceGeminiApiKey: z.string().optional().describe('Workspace-level Gemini key (Integrações > Gemini) used when the agent has no key.'),
});

export async function generateAgentResponse(input: z.infer<typeof AutoResponderFlowInputSchema>): Promise<AgentResponseOutput> {
  // We pass the full input (including config) to the flow
  return autoResponderFlow(input);
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNameVariants(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0] || '';
  const variants = new Set<string>();
  [trimmed, normalizeText(trimmed), first, normalizeText(first)].forEach((variant) => {
    if (variant && variant.length >= 2) {
      variants.add(variant);
    }
  });
  return Array.from(variants);
}

function historyContainsName(chatHistory: string | undefined, variants: string[]): boolean {
  if (!chatHistory || variants.length === 0) return false;
  const normalizedHistory = normalizeText(chatHistory);
  return variants.some((variant) => {
    const normalizedVariant = normalizeText(variant);
    if (!normalizedVariant) return false;
    const pattern = new RegExp(`\\b${escapeRegExp(normalizedVariant)}\\b`, 'i');
    return pattern.test(normalizedHistory);
  });
}

function stripRepeatedName(response: string, contactName: string, chatHistory?: string): string {
  const variants = getNameVariants(contactName);
  if (variants.length === 0 || !historyContainsName(chatHistory, variants)) return response;

  const namePattern = variants.map(escapeRegExp).join('|');
  if (!namePattern) return response;

  let updated = response;
  const greetingPattern = new RegExp(
    `^(\\s*(?:Olá|Ola|Oi|Oiê|Oie|Hey|Bom dia|Boa tarde|Boa noite)\\s*[,!]?\\s*)(${namePattern})(\\b[!,.]?\\s*)`,
    'i'
  );
  updated = updated.replace(greetingPattern, '$1');

  const startNamePattern = new RegExp(`^(\\s*)(${namePattern})(\\b[,:!\\-–—]?\\s*)`, 'i');
  updated = updated.replace(startNamePattern, '$1');

  const commaWrappedPattern = new RegExp(`,\\s*(${namePattern})\\s*,`, 'gi');
  updated = updated.replace(commaWrappedPattern, ',');

  const leadingCommaPattern = new RegExp(`,\\s*(${namePattern})(\\b)`, 'gi');
  updated = updated.replace(leadingCommaPattern, '');

  const trailingCommaPattern = new RegExp(`(${namePattern})\\s*,`, 'gi');
  updated = updated.replace(trailingCommaPattern, '');

  updated = updated.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();

  return updated;
}

const greetingTokenRegex = /\b(ola|oi|oie|oii|hey|bom dia|boa tarde|boa noite)\b/i;
const emojiRegex = /\p{Extended_Pictographic}/u;
const emojiGlobalRegex = /\p{Extended_Pictographic}/gu;

function historyContainsGreeting(chatHistory?: string): boolean {
  if (!chatHistory) return false;
  const normalized = normalizeText(chatHistory);
  return greetingTokenRegex.test(normalized);
}

function containsEmoji(value?: string): boolean {
  if (!value) return false;
  return emojiRegex.test(value);
}

function getEmojiBudget(chatHistory?: string, customerMessage?: string): number {
  if (containsEmoji(customerMessage) || containsEmoji(chatHistory)) return 1;
  return 0;
}

function limitEmojis(response: string, maxEmojis: number): string {
  if (!response) return response;

  if (maxEmojis <= 0) {
    const stripped = response.replace(emojiGlobalRegex, '');
    return stripped.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  }

  let count = 0;
  emojiGlobalRegex.lastIndex = 0;
  const updated = response.replace(emojiGlobalRegex, (match) => {
    if (count < maxEmojis) {
      count += 1;
      return match;
    }
    return '';
  });

  return updated.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

function shouldPreserveCatalogEmojis(response: string): boolean {
  const upper = response.toUpperCase();
  const planMatches = upper.match(/\b\d{2,4}\s*(?:MEGA|MEGAS|MB|GB)\b/g) || [];
  return (
    planMatches.length >= 1 &&
    /\bR\$\s*\d+/i.test(response) &&
    (upper.includes('PLAN') || upper.includes('PROMO') || upper.includes('WI-FI') || upper.includes('WIFI') || upper.includes('CANAIS') || upper.includes('FIBRA')) &&
    emojiRegex.test(response)
  );
}

function stripRepeatedGreeting(response: string, chatHistory?: string): string {
  if (!response || !historyContainsGreeting(chatHistory)) return response;

  let updated = response;
  const greetingPattern = new RegExp(
    `^(\\s*(?:Ola|Ol\\u00e1|Oi|Oie|Oii|Hey|Bom dia|Boa tarde|Boa noite)\\s*[,!]?\\s*)`,
    'i'
  );
  updated = updated.replace(greetingPattern, '');
  updated = updated.replace(/^,\\s*/, '');
  updated = updated.replace(/\\s{2,}/g, ' ').replace(/\\s+([,.!?])/g, '$1').trim();

  return updated;
}

// --- Agent Prompt ---

// --- Agent Prompt Config ---
const promptConfig = {
  name: 'autoResponderPrompt',
  // tools: [makeHttpRequestTool],
  input: { schema: AgentResponseInputSchema },
  output: { schema: AgentResponseOutputSchema },
  prompt: `Você é um agente de atendimento virtual inteligente e empático.
Abaixo está a sua **DEFINIÇÃO DE PERSONA**. Você DEVE assumir esta identidade, tom de voz e nome.

---
**SUA IDENTIDADE (PERSONA)**:
{{{knowledgeBase}}}
---

Se a definição acima estiver vazia, assuma que você é 'Dialogy', um assistente virtual útil e profissional.

**ANÁLISE DE CONTEXTO E EMOÇÃO**:
1. **Intenção**: Identifique o que o usuário quer AGORA. Use o histórico (até 15 msgs) para entender o fluxo.
2. **Emoção**: Sinta a emoção do usuário (frustração, dúvida, gratidão, raiva).
   - Se o usuário estiver frustrado/irritado: Peça desculpas, seja objetivo e resolva rápido. NÃO use piadas.
   - Se o usuário estiver confuso: Seja extremamente didático, "explique como se eu tivesse 5 anos".
   - Se o usuário estiver neutro/feliz: Mantenha o tom cordial e eficiente.
3. **Tom de Voz**: Seja sempre educado, paciente e inteligente.
   - Explique termos técnicos se necessário.
   - Nunca seja arrogante ou robótico.
   - **NÃO repita o nome do usuário**. Use no máximo 1x por conversa e apenas na primeira resposta ou se for realmente necessário.
   - Se o nome já aparecer no histórico ou em uma mensagem anterior sua, **não use novamente**.
   - Prefira saudações sem nome (ex: "Olá!") ou comece direto com a resposta.
   - Evite repeticao: nao repita saudacoes, frases prontas ou a mesma pergunta em respostas seguidas.
   - Se ja cumprimentou ou ofereceu ajuda no historico recente, va direto ao ponto.
   - Emojis: use com moderacao. No maximo 1 por mensagem e apenas se o usuario usar emojis ou o tom for informal.
   - Evite emojis em temas serios ou quando o usuario estiver frustrado/irritado.

**DIRETRIZES DE RESPOSTA**:
1. **Prioridade Máxima (Regras)**:
    - Verifique **REGRAS DE AUTOMAÇÃO**. Se o gatilho for acionado, siga a regra cegamente.
2. **Base de Conhecimento**:
    - Use os **DOCUMENTOS FACTUAIS** como fonte de verdade para valores, planos, datas, links e demais afirmacoes ao cliente.
    - Use os **PROCEDIMENTOS E POLITICAS** somente para decidir os proximos passos do atendimento; eles nao comprovam precos ou ofertas.
    - Trate documentos factuais como fonte de verdade dos dados e componha a resposta naturalmente para a pergunta atual.
    - Nao copie nem dispare uma resposta fixa apenas porque um documento pede envio exato, usa termos como "resposta oficial" ou apresenta um modelo pronto.
    - Preserve fatos relevantes, valores, prazos, links e restricoes informados na base.
3. **Resposta Natural**:
    - Se não houver regra, construa uma resposta baseada na sua persona + documentos + análise emocional.
4. **Formato e tamanho para WhatsApp**:
    - Responda de forma curta por padrao: 1 a 3 paragrafos, com no maximo 3 frases curtas por paragrafo.
    - Separe paragrafos com uma linha em branco quando houver mais de uma ideia ou topico.
    - Quando listar opcoes, planos, precos ou itens, coloque CADA item em uma linha separada. Exemplo:
      💡 PLANOS SOMENTE INTERNET
      100 MEGA: R$79,99/mes*
      300 MEGA (Mais vendido): R$89,90/mes*
      500 MEGA: R$99,90/mes*
    - Quando o cliente pedir todos os planos, lista completa, tabela de precos ou "me manda todos", formate como catalogo de WhatsApp: titulo, linha em branco, secao, linha em branco, cada plano em bloco proprio, linha em branco entre planos e separadores entre secoes.
    - Em catalogos de planos, preserve os icones, negrito com *texto*, quebras de linha e espacamento. Nunca coloque varios planos na mesma linha ou no mesmo paragrafo.
    - Exemplo de catalogo:
      🚀 *CONHECA NOSSOS PLANOS DE INTERNET FIBRA*
      Velocidade, estabilidade e tecnologia para voce!

      ━━━━━━━━━━━━━━━

      💡 *PLANOS SOMENTE INTERNET*

      🔹 *100 MEGA*
      📶 Wi-Fi 5
      💰 R$79,99/mes pagando em dia
      💰 R$89,99/mes

      🔹 *300 MEGA*
      📶 Wi-Fi 5
      💰 R$89,90/mes pagando em dia
      💰 R$95,90/mes
    - Quando a resposta tiver blocos tematicos distintos (ex: lista de planos + promocao + pergunta), separe-os com uma linha em branco para que possam ser enviados como mensagens separadas no WhatsApp.
    - Nao envie blocos longos de texto corrido. Se houver muitos detalhes, resuma o essencial e pergunte se o cliente quer mais informacoes.
    - So escreva uma resposta longa quando o cliente pedir explicitamente explicacao detalhada, lista completa ou passo a passo.
    - Evite repetir informacoes que ja foram ditas no historico recente.

---

**DOCUMENTOS FACTUAIS (Base de Conhecimento)**:
{{#each knowledgeBaseDocuments}}
### {{name}}
{{{content}}}
{{/each}}

---
**PROCEDIMENTOS E POLITICAS DO ATENDIMENTO**:
{{#each workflowKnowledgeDocuments}}
### {{name}}
{{{content}}}
{{/each}}

---
**PROCEDIMENTOS COM TOOLS MENCIONADAS NA BASE (@tool)**:
{{#if knowledgeToolProcedures}}
{{{knowledgeToolProcedures}}}
{{else}}
(Nenhum procedimento com @tool foi identificado nos documentos relevantes.)
{{/if}}

---
**REGRAS DE AUTOMAÇÃO**:
{{#each rules}}
- Nome: "{{name}}"
  - Gatilho: "{{trigger}}"
  - Ação: {{json action}}
{{/each}}
---
**DADOS DO CONTATO**:
{{json contact}}
---
**ROTEAMENTO DETERMINISTICO DO SERVIDOR**:
{{#if intentContext}}
{{{intentContext}}}
{{else}}
(Nenhum roteamento deterministico informado.)
{{/if}}
---
**CONTEXTO HISTÓRICO RELEVANTE (Memória)**:
{{#if relevantHistory}}
{{{relevantHistory}}}
{{else}}
(Nenhum contexto histórico relevante encontrado)
{{/if}}
---
**HISTÓRICO DO CHAT (Contexto Recente)**:
{{#if chatHistory}}
{{{chatHistory}}}
{{else}}
(Sem histórico anterior)
{{/if}}
---
**RESPOSTA DE CONTINGÊNCIA**:
{{{fallbackReply}}}
---
**POLITICA DE ESCALONAMENTO PARA HUMANO**:
{{#if escalationPolicy}}
{{{escalationPolicy}}}
{{else}}
(Nenhuma politica especifica definida. Se nao tiver seguranca, informe que vai envolver um atendente humano.)
{{/if}}
---
**POLITICA DE ENCERRAMENTO**:
{{#if closingPolicy}}
{{{closingPolicy}}}
{{else}}
(Nenhuma politica especifica definida. Nao encerre nem diga que vai encerrar sem confirmacao clara do cliente.)
{{/if}}
---
**ÚLTIMA MENSAGEM DO CLIENTE**:
**FERRAMENTAS DISPONIVEIS (Dialogy Agent Tools)**:
Voce pode solicitar acoes estruturadas no campo "actions". O servidor validara e executara.
Use no maximo 4 acoes por resposta.

Ferramentas habilitadas para este agente:
{{#if enabledAgentToolsDescription}}
{{{enabledAgentToolsDescription}}}
{{else}}
(Use apenas as ferramentas permitidas abaixo.)
{{/if}}

Solicite somente ferramentas habilitadas para este agente. Se uma ferramenta necessaria nao estiver habilitada, responda sem inventar consulta/acao e escale conforme a politica.

Regra para procedimentos da base:
- Quando um documento orientar uso de @tool para um procedimento, trate a tool resolvida como obrigatoria para aquele procedimento.
- Antes de chamar a tool, colete e valide os dados exigidos pelo procedimento.
- Se uma consulta anterior retornou dados necessarios para a proxima @tool do procedimento, solicite a proxima action agora; nao responda que "vai fazer".
- Se a tool estiver desabilitada, nao finja execucao; informe que vai encaminhar ou pedir apoio humano.

Ferramentas permitidas:
1. transfer_chat
   - Use quando precisar envolver humano ou setor.
   - Payload aceito: {"teamName":"Financeiro"} ou {"teamId":"..."} ou {"agentId":"..."}.
   - Sempre explique ao cliente em "response" que vai transferir.
2. close_chat
   - Use quando o cliente pedir claramente para encerrar/finalizar/fechar/desligar a conversa, chat, chamado ou atendimento.
   - Tambem use em pedidos curtos como "encerra ai", "pode finalizar", "fecha por aqui", "pode desligar o chat", quando o contexto for terminar a conversa.
   - Nao use para cancelar/encerrar contrato, plano, assinatura, servico ou internet; nesses casos trate como cancelamento comercial/suporte.
   - Payload aceito: {"notes":"Cliente pediu encerramento pelo WhatsApp.","sendCloseMessage":false}.
   - Se disser que encerrou/finalizou/fechou o atendimento, inclua obrigatoriamente esta action na mesma saida.
3. add_internal_note
   - Use para deixar uma nota interna para a equipe.
   - Use somente quando houver transferencia, escalonamento ou um detalhe critico que um humano precise saber.
   - Payload aceito: {"content":"Resumo objetivo para o humano"}.
   - A nota deve ter no maximo 3 frases curtas e 280 caracteres.
   - Nunca escreva texto de auditoria, assinatura, repeticao da persona, "fim da nota", "registro concluido" ou explicacoes sobre o proprio sistema.
   - A nota nao sera enviada ao cliente.
4. crm_update_contact_custom_fields
   - Use para preencher/atualizar campos do CRM do contato atual quando o cliente informar um dado claro.
   - Exemplo para CPF: {"fields":{"CPF":"01298570174"}}. Pode usar o nome do campo ou o ID do campo.
   - Nunca atualize contato de outra pessoa. Nunca invente valores.
5. sgp_fetch_contact_panel_data
   - Use para consultar dados do SGP do contato atual depois que o CPF/CNPJ estiver salvo no CRM.
   - Retorna cliente, contratos, status de conexao e faturas.
   - Nao diga que acessou/verificou o SGP antes da ferramenta ser executada com sucesso.
6. sgp_fetch_contracts
   - Use para listar contratos do cliente no SGP.
7. sgp_generate_invoice_pix
   - Use apenas quando houver fatura e contrato claros. Payload: {"invoiceId":"...","contractId":"..."}.
8. sgp_create_payment_promise
   - Use apenas quando o cliente pedir promessa de pagamento e informar data. Payload: {"contractId":"...","promiseDate":"yyyy-MM-dd","sendSms":true}.
9. mcp_call_tool
   - Use para chamar uma ferramenta MCP externa habilitada para este agente.
   - Payload aceito: {"toolName":"mcp:<serverId>:<toolName>","arguments":{"campo":"valor"}}.
   - "arguments" deve ser sempre um objeto JSON, nunca uma string. Exemplo correto para reboot_router: {"toolName":"mcp:<serverId>:reboot_router","arguments":{"device_id":"...","client_ip":"...","reason":"Cliente solicitou reinicializacao"}}.
   - Use exatamente o nome qualificado mostrado na lista de ferramentas habilitadas.

Ferramenta bloqueada para IA:
- sgp_open_support_ticket. Nunca solicite esta ferramenta. Abertura de chamado/OS no SGP deve ficar com humano.

Regra critica:
- Se precisar consultar SGP mas ainda nao recebeu CPF/CNPJ, peca o CPF/CNPJ.
- Se receber CPF/CNPJ, pode primeiro solicitar crm_update_contact_custom_fields e sgp_fetch_contact_panel_data.
- Se a consulta ainda nao foi feita ou falhou, nao afirme "estou vendo seu sinal", "acessei o sistema" ou "verifiquei seu contrato".
- Nunca responda apenas "vou verificar", "vou consultar" ou equivalente. Se disser que vai verificar/consultar qualquer sistema, inclua a action da ferramenta necessaria na mesma saida. Se nao houver ferramenta habilitada ou dados suficientes, diga isso claramente e encaminhe/peca o dado faltante.

Exemplo de saida simples (resposta unica):
{
  "response": "Vou encaminhar seu atendimento para o setor responsavel.",
  "actions": [
    {
      "type": "add_internal_note",
      "reason": "Cliente pediu assunto financeiro",
      "payload": {"content": "Cliente pediu segunda via de boleto. Verificar dados antes de enviar."}
    },
    {
      "type": "transfer_chat",
      "reason": "Assunto financeiro sensivel",
      "payload": {"teamName": "Financeiro"}
    }
  ]
}

Exemplo de saida com multiplas mensagens (messageBlocks):
{
  "response": "Com certeza! Aqui estao as opcoes...\n\nAlem disso temos uma promocao...",
  "messageBlocks": [
    "Com certeza! Aqui estao as nossas opcoes:\n\n💡 PLANOS SOMENTE INTERNET\n100 MEGA: R$79,99/mes*\n300 MEGA (Mais vendido): R$89,90/mes*\n500 MEGA: R$99,90/mes*\n\n*Valores com desconto de pontualidade.",
    "Alem disso, temos uma promocao especial de maio: 1000 Megas + 60 Canais por R$99,90/mes! Algum desses planos parece ideal para o seu uso?"
  ]
}

Regras para messageBlocks:
- Use messageBlocks APENAS quando a resposta tiver 2 ou mais blocos tematicos claramente distintos.
- Se a resposta for curta ou tratar de um unico assunto, use apenas "response" e nao inclua "messageBlocks".
- Cada bloco deve fazer sentido sozinho como mensagem.
- Maximo de 3 blocos.
- "response" sempre deve conter o texto completo (todos os blocos juntos).
---{{{customerMessage}}}

Com base na sua persona, nos documentos e na emoção identificada, responda ao cliente.`,
};

// Default prompt with global AI
const globalPrompt = ai.definePrompt(promptConfig);
const STABLE_AUTOPILOT_MODEL_FALLBACKS = [
  DEFAULT_AUTOPILOT_MODEL,
  'googleai/gemini-2.0-flash-lite',
  'googleai/gemini-1.5-pro',
];

function getDefaultGeminiEnvKey(): string {
  return process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
}

function getModelCandidates(model: string): string[] {
  return [model, ...STABLE_AUTOPILOT_MODEL_FALLBACKS].filter((candidate, index, all) => (
    Boolean(candidate) && all.indexOf(candidate) === index
  ));
}

function definePromptForCandidate(input: {
  apiKey: string;
  model: string;
}) {
  const defaultEnvKey = getDefaultGeminiEnvKey();
  if (defaultEnvKey && defaultEnvKey === input.apiKey) {
    return globalPrompt;
  }

  const { genkit } = require('genkit');
  const { googleAI } = require('@genkit-ai/googleai');

  const dynamicAi = genkit({
    plugins: [googleAI({ apiKey: input.apiKey })],
    model: input.model,
    // tools: [makeHttpRequestTool],
  });

  return dynamicAi.definePrompt(promptConfig);
}

const autoResponderFlow = ai.defineFlow(
  {
    name: 'autoResponderFlow',
    inputSchema: AutoResponderFlowInputSchema,
    outputSchema: AgentResponseOutputSchema,
  },
  async (input) => {
    const model = input.model || DEFAULT_AUTOPILOT_MODEL;
    const promptInput = AgentResponseInputSchema.parse({
      ...input,
      knowledgeBaseDocuments: input.knowledgeBaseDocuments ?? input.config?.knowledge_base_documents ?? [],
      workflowKnowledgeDocuments: input.workflowKnowledgeDocuments ?? [],
      fallbackReply: input.fallbackReply ?? input.config?.default_fallback_reply ?? '',
      escalationPolicy: input.escalationPolicy ?? input.config?.escalation_policy ?? '',
      closingPolicy: input.closingPolicy ?? input.config?.closing_policy ?? '',
    });

    // 1. Resolve Gemini API key (agent -> workspace integration -> env)
    const configKey = input.config?.gemini_api_key?.trim();
    const workspaceKey = input.workspaceGeminiApiKey?.trim();
    const envKey = getDefaultGeminiEnvKey();
    const apiKeyCandidates: AiModelKeyCandidate[] = [
      { source: 'agent', key: configKey },
      { source: 'workspace', key: workspaceKey },
      { source: 'env', key: envKey && envKey !== 'no-key-configured' ? envKey : '' },
    ].filter((candidate): candidate is AiModelKeyCandidate => Boolean(candidate.key));
    const uniqueApiKeyCandidates = apiKeyCandidates.filter((candidate, index, all) => (
      all.findIndex((item) => item.key === candidate.key) === index
    ));

    if (uniqueApiKeyCandidates.length === 0) {
      console.error('[AUTORESPONDER_FLOW_ERROR] Nenhuma chave de API encontrada (Config, Integrações ou ENV).');
      // Continue to configured fallback reply instead of throwing and leaving auto mode silent.
    }

    let output: AgentResponseOutput | null = null;

    if (uniqueApiKeyCandidates.length > 0) {
      try {
        const promptRun = await runAiModelWithFallback({
          label: 'autoResponderFlow',
          modelCandidates: getModelCandidates(model),
          apiKeyCandidates: uniqueApiKeyCandidates,
          maxAttemptsPerCandidate: Number.parseInt(process.env.AI_MODEL_MAX_ATTEMPTS || '', 10) || 2,
          retryBaseDelayMs: Number.parseInt(process.env.AI_MODEL_RETRY_BASE_DELAY_MS || '', 10) || 250,
          retryMaxDelayMs: Number.parseInt(process.env.AI_MODEL_RETRY_MAX_DELAY_MS || '', 10) || 1500,
          execute: async (context) => {
            const effectivePrompt = definePromptForCandidate({
              apiKey: context.apiKey,
              model: context.model,
            });
            const result = await effectivePrompt(promptInput, { model: context.model });
            assertAiModelOutput(result?.output, 'Auto responder returned no structured output.');
            return result;
          },
          onAttempt: (event) => {
            if (event.status === 'success') {
              if (event.keySource !== 'agent' && configKey) {
                console.warn(`[AUTORESPONDER_FLOW] Gemini key fallback succeeded with ${event.keySource} key.`);
              }
              if (event.model !== model) {
                console.warn(`[AUTORESPONDER_FLOW] Model fallback succeeded with "${event.model}" instead of "${model}".`);
              }
              return;
            }

            console.warn('[AUTORESPONDER_FLOW_ERROR] Prompt attempt failed:', {
              model: event.model,
              keySource: event.keySource,
              attempt: event.attempt,
              errorCode: event.errorCode,
              retryable: event.retryable,
              durationMs: event.durationMs,
              errorMessage: event.errorMessage,
            });
          },
        });
        const result = promptRun.result;
        output = result.output;

        // Log usage in the background without awaiting it.
        // This allows the flow to return faster.
        if (result.usage && input.config?.id) {
          logAutopilotUsage({
            configId: input.config.id,
            flowName: 'autoResponderFlow',
            modelName: promptRun.model,
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            totalTokens: result.usage.totalTokens ?? 0,
            ruleName: output?.triggeredRule ?? undefined,
          }).catch(err => {
            // Log the error but don't block the main flow.
            console.error("[AUTOPILOT_USAGE_LOG_ERROR]", err);
          });
        }
      } catch (error) {
        console.error('[AUTORESPONDER_FLOW_ERROR] All prompt attempts failed:', error);
        output = null;
      }
    }

    // Only return a response if the AI decided a rule was triggered or it could answer.
    // This also prevents returning `null` values which would violate the Zod schema.
    if (output?.response && output.response.trim() !== '') {
      const emojiBudget = getEmojiBudget(input.chatHistory, input.customerMessage);
      const sanitizeBlock = (text: string, isFirstBlock: boolean) => {
        let result = stripRepeatedName(text, input.contact?.name ?? '', input.chatHistory);
        if (isFirstBlock) result = stripRepeatedGreeting(result, input.chatHistory);
        if (shouldPreserveCatalogEmojis(result)) return result;
        return limitEmojis(result, emojiBudget);
      };

      const sanitized = sanitizeBlock(output.response, true);
      const outputResponse = formatCustomerFacingAiResponse(sanitized.trim() ? sanitized : output.response);

      // Sanitize each messageBlock if the AI decided to split
      let sanitizedBlocks: string[] | undefined;
      if (output.messageBlocks && output.messageBlocks.length > 1) {
        sanitizedBlocks = output.messageBlocks
          .map((block, i) => {
            const s = sanitizeBlock(block, i === 0);
            return formatCustomerFacingAiResponse(s.trim() ? s : block);
          })
          .filter((block) => block.trim() !== '');
      }

      return {
        ...output,
        response: outputResponse,
        ...(sanitizedBlocks && sanitizedBlocks.length > 1 ? { messageBlocks: sanitizedBlocks } : { messageBlocks: undefined }),
      };
    }
    const fallback = input.config?.default_fallback_reply?.trim();
    if (fallback) {
      const emojiBudget = getEmojiBudget(input.chatHistory, input.customerMessage);
      const sanitized = limitEmojis(
        stripRepeatedGreeting(
          stripRepeatedName(fallback, input.contact?.name ?? '', input.chatHistory),
          input.chatHistory
        ),
        emojiBudget
      );
      const outputResponse = formatCustomerFacingAiResponse(sanitized.trim() ? sanitized : fallback);
      return {
        response: outputResponse,
        triggeredRule: output?.triggeredRule ?? null,
      };
    }
    // Otherwise, return an empty object, indicating no action should be taken.
    return {};
  }
);
