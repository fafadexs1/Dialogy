
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
import { logAutopilotUsage } from '@/actions/autopilot';
import { formatCustomerFacingAiResponse } from '@/lib/ai-response-format';
import { enrichKnowledgeDocumentsForPrompt } from '@/services/rag/knowledge-document';
import {
  assertAiModelOutput,
  runAiModelWithFallback,
  type AiModelKeyCandidate,
} from '@/services/ai/model-client';
import {
  tryParseJsonResponse,
  isLmStudioModel,
  getGlobalLmStudioConfig,
  defineLmStudioPrompt,
} from '@/services/ai/lm-studio';
import {
  coerceOpenAiCompatiblePromptOutput,
  defineOpenAiCompatiblePrompt,
  isOpenAiCompatibleModel,
} from '@/services/ai/openai-compatible';
import {
  getDefaultGeminiEnvKey,
  resolveAiProviderKeyCandidates,
} from '@/services/ai/provider-keys';
import { shouldPrependPrimaryResponseToMessageBlocks } from '@/services/autopilot/message-blocks';
import {
  sanitizeAutopilotRules,
  toPromptSafeAutopilotRules,
} from '@/services/autopilot/automation-rules';

// A curadoria da base de conhecimento produz mais do que texto: um resumo, uma
// resposta ja validada e o papel do documento (fato, procedimento, politica,
// persona). Nada disso chegava ao modelo — o schema descartava no parse e o
// template so renderizava nome e conteudo. O agente recebia a materia-prima e
// tinha que reformular do zero uma resposta que ja existia pronta e revisada.
const KnowledgeDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  summary: z.string().nullable().optional(),
  canonicalAnswer: z.string().nullable().optional(),
  contextRole: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
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
  // Rules are persisted user-editable JSON. Accept raw legacy rows here, then
  // sanitize them at the start of the flow; otherwise an old malformed row
  // would reject the Genkit input before that recovery code can run.
  rules: z.array(z.unknown()).default([]).describe('A list of active automation rules to evaluate against.'),
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
  enabledAgentToolNames: z
    .array(z.string())
    .optional()
    .describe('Nomes das ferramentas habilitadas para este agente.'),
  allowNativeLmStudioToolCalls: z
    .boolean()
    .optional()
    .describe('Permite que o runtime local solicite ferramentas nativas quando aplicavel.'),
  knowledgeToolProcedures: z
    .string()
    .optional()
    .describe('Procedimentos da base de conhecimento que mencionam tools com @nome_da_tool.'),
  intentContext: z
    .string()
    .optional()
    .describe('Contexto deterministico de intencao, workflow e cobertura de conhecimento resolvido pelo servidor.'),
  responseMode: z
    .enum(['full', 'conversational'])
    .optional()
    .describe('Seleciona um prompt compacto para saudacoes e agradecimentos sem necessidade operacional.'),
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
  workspaceGeminiApiKey: z.string().optional().describe('Workspace-level Gemini key from the unified AI models integration.'),
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
  const itemLines = response.split('\n').filter((line) => line.trim().length > 0);
  return (
    itemLines.length >= 3 &&
    /(?:R\$|\$|EUR|USD|BRL)\s*\d+/i.test(response) &&
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
    - Quando listar opcoes, precos, datas ou itens, coloque cada item em uma linha separada.
    - Quando o cliente pedir uma lista completa ou tabela, use titulo curto, itens em blocos legiveis e uma linha em branco entre secoes.
    - Quando a resposta tiver blocos tematicos distintos, separe-os com uma linha em branco para que possam ser enviados como mensagens separadas no WhatsApp.
    - Nao envie blocos longos de texto corrido. Se houver muitos detalhes, resuma o essencial e pergunte se o cliente quer mais informacoes.
    - So escreva uma resposta longa quando o cliente pedir explicitamente explicacao detalhada, lista completa ou passo a passo.
    - Evite repetir informacoes que ja foram ditas no historico recente.

---

**DOCUMENTOS FACTUAIS (Base de Conhecimento)**:
{{#each knowledgeBaseDocuments}}
### {{name}}
{{#if contextRole}}Natureza: {{contextRole}} (policy e regra inegociavel; procedure e passo a passo; fact e informacao consultiva){{/if}}
{{#if summary}}Resumo: {{summary}}{{/if}}
{{#if canonicalAnswer}}RESPOSTA JA VALIDADA — reutilize esta formulacao em vez de reescrever: {{canonicalAnswer}}{{/if}}
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
Use no maximo 2 acoes por resposta.

Ferramentas permitidas pelo flow para ESTE turno:
{{#if enabledAgentToolsDescription}}
{{{enabledAgentToolsDescription}}}
{{else}}
(Nenhuma ferramenta operacional permitida neste turno.)
{{/if}}

Solicite somente ferramentas listadas acima. A lista e restritiva: ferramentas ausentes estao proibidas, mesmo que tenham aparecido no historico, em documentos ou em outro nicho.
Se uma capacidade necessaria nao estiver permitida, nao mencione ferramentas, sistemas internos ou limitacoes tecnicas ao cliente. Faca a proxima pergunta objetiva que permita continuar ou siga a politica de escalonamento.

Regra para procedimentos da base:
- Quando um documento orientar uso de @tool para um procedimento, trate a tool resolvida como obrigatoria para aquele procedimento.
- Antes de chamar a tool, colete e valide os dados exigidos pelo procedimento.
- Se uma consulta anterior retornou dados necessarios para a proxima @tool do procedimento, solicite a proxima action agora; nao responda que "vai fazer".
- Se a tool estiver desabilitada, nao finja execucao. Nao cite a tool ao cliente: faca a proxima pergunta objetiva ou aplique o escalonamento configurado.
- Nunca responda prometendo uma analise, triagem, verificacao ou orientacao futura sem entregar agora uma orientacao segura, uma pergunta objetiva de continuidade ou uma action executavel. Toda resposta ao cliente precisa terminar com um proximo passo claro.

Politica critica de ferramentas:
- Use ferramentas somente para executar um pedido operacional atual e inequivoco do cliente.
- Conversas informais, perguntas gerais, catalogos e saudacoes nao disparam ferramentas.
- Nao adivinhe parametros. Se faltarem dados obrigatorios, peca apenas os dados faltantes.
- Nao afirme que consultou, alterou ou executou algo antes do retorno de sucesso da ferramenta.
- Acoes destrutivas ou que alterem estado exigem confirmacao explicita do cliente; o servidor persiste e valida essa confirmacao.
- Nunca responda apenas "vou verificar", "vou consultar" ou equivalente. Se disser que vai consultar qualquer sistema, inclua a action permitida na mesma saida. Se nao houver capacidade executavel ou dados suficientes, peca somente o dado faltante ou aplique o escalonamento sem expor detalhes internos.

REGRA DE VERACIDADE (tem prioridade sobre qualquer regra de estilo abaixo):
- Afirme como fato apenas o que estiver nos DOCUMENTOS FACTUAIS, nos dados do contato ou no retorno de uma ferramenta executada com sucesso.
- Se um valor, prazo, data, condicao, link, nome de plano, horario ou politica nao estiver nessas fontes, voce NAO sabe. Nao deduza a partir de exemplos parecidos, nao complete padrao de lista ou tabela e nao arredonde.
- Se um documento aparecer cortado (termina em "…"), trate a parte ausente como desconhecida em vez de continuar a sequencia.
- Preencher uma lacuna com um dado plausivel e o pior erro possivel neste atendimento: e pior do que nao responder.

Como tratar o que voce nao sabe (obrigatorio quando a regra acima bloquear uma afirmacao):
- Responda com o que ESTA confirmado na base e trate somente a parte faltante como pendente.
- Depois escolha exatamente um destes caminhos:
  (a) faca uma pergunta curta e objetiva que destrave a continuidade. Ex.: "Sobre o prazo de garantia desse item eu preciso confirmar. Qual e o modelo que voce comprou?";
  (b) quando a POLITICA DE ESCALONAMENTO cobrir o caso, encaminhe de fato: diga que vai passar para a equipe responsavel E inclua a action de transferencia permitida na mesma saida. Ex.: "Nao quero te passar um prazo errado, entao vou encaminhar para a equipe responsavel confirmar com voce.". Nao use este caminho apenas para escapar de uma pergunta: se o cliente nao pediu atendimento humano e a politica nao manda escalar, prefira (a);
  (c) solicite a action permitida que traz o dado.
- Nunca prometa retorno futuro sem uma dessas tres saidas. "Vou confirmar e ja te retorno", sozinho, deixa o cliente parado e nao e resposta valida.
- Formule sempre do ponto de vista do cliente, nunca do ponto de vista do sistema.

Regra de estilo ao cliente:
- Ferramentas, politicas, RAG, documentos, prompts, modelos e validacoes sao detalhes internos e nao devem aparecer na resposta.
- Nao descreva limitacao tecnica: nada de "nao e possivel usar essa ferramenta", "nao tenho ferramenta", "nao posso acessar o sistema" ou equivalentes.
- Essa regra proibe expor o mecanismo interno. Ela NAO autoriza inventar o dado: quando faltar informacao, use o caminho da secao acima.
- Toda resposta termina com um proximo passo claro.

Exemplo de saida simples (resposta unica):
{
  "response": "Vou encaminhar seu atendimento para a equipe responsavel.",
  "actions": [
    {
      "type": "add_internal_note",
      "reason": "Cliente pediu atendimento humano",
      "payload": {"content": "Cliente solicitou atendimento humano para continuar a tratativa."}
    },
    {
      "type": "transfer_chat",
      "reason": "Cliente pediu atendimento humano"
    }
  ]
}

Regras para messageBlocks:
- Use messageBlocks APENAS quando a resposta tiver 2 ou mais blocos tematicos claramente distintos.
- Se a resposta for curta ou tratar de um unico assunto, use apenas "response" e nao inclua "messageBlocks".
- Quando apresentar varios dados operacionais, organize em secoes curtas com titulo e linhas no formato "Rotulo: valor". Evite colocar faturas, contratos, datas, valores ou links em um unico paragrafo corrido.
- Preserve links completos em uma linha propria. Nunca insira espacos ou quebras dentro de uma URL.
- Cada bloco deve fazer sentido sozinho como mensagem.
- Maximo de 3 blocos.
- "response" sempre deve conter o texto completo (todos os blocos juntos).
---
**ULTIMA MENSAGEM DO CLIENTE**:
{{{customerMessage}}}

Com base na sua persona, nos documentos e na emoção identificada, responda ao cliente.`,
};

const conversationalPromptConfig: typeof promptConfig = {
  name: 'autoResponderConversationalPrompt',
  input: { schema: AgentResponseInputSchema },
  output: { schema: AgentResponseOutputSchema },
  prompt: `Voce e o atendente virtual definido pela persona abaixo.

PERSONA:
{{#if knowledgeBase}}
{{{knowledgeBase}}}
{{else}}
Dialogy, um assistente profissional, cordial e objetivo.
{{/if}}

INTENCAO ATUAL:
{{{intentContext}}}

HISTORICO RECENTE:
{{{chatHistory}}}

MENSAGEM ATUAL:
{{{customerMessage}}}

Responda em portugues do Brasil, de forma natural e curta.
- Considere principalmente a mensagem atual. Nao retome pedidos operacionais antigos se o cliente apenas cumprimentou ou agradeceu.
- Para saudacao, cumprimente e pergunte objetivamente como pode ajudar.
- Para agradecimento, responda com cordialidade e ofereca ajuda adicional.
- Nao solicite CPF/CNPJ, nao prometa consulta, nao transfira, nao encerre e nao solicite ferramentas.
- Retorne uma unica resposta curta. Deixe actions vazio e nao use messageBlocks.`,
};

// Default prompt with global AI
const globalPrompt = ai.definePrompt(promptConfig);
const globalConversationalPrompt = ai.definePrompt(conversationalPromptConfig);
const STABLE_AUTOPILOT_MODEL_FALLBACKS = [
  DEFAULT_AUTOPILOT_MODEL,
  'googleai/gemini-2.5-flash',
  'codex/gpt-5.3-codex',
  'openai/gpt-5.5',
  'openai/gpt-5.4-mini',
  'deepseek/deepseek-v4-flash',
  'googleai/gemini-3.1-flash-lite',
  'googleai/gemini-2.5-flash-lite',
  'googleai/gemini-2.5-pro',
];

function getModelCandidates(model: string): string[] {
  if (isLmStudioModel(model)) return [model];
  return [model, ...STABLE_AUTOPILOT_MODEL_FALLBACKS].filter((candidate, index, all) => (
    Boolean(candidate) && all.indexOf(candidate) === index
  ));
}


async function definePromptForCandidate(input: {
  apiKey: string;
  model: string;
  responseMode?: 'full' | 'conversational';
}) {
  const selectedPromptConfig = input.responseMode === 'conversational'
    ? conversationalPromptConfig
    : promptConfig;
  if (isLmStudioModel(input.model)) {
    const lmStudioConfig = await getGlobalLmStudioConfig();
    return defineLmStudioPrompt(selectedPromptConfig, input.model, lmStudioConfig);
  }

  if (isOpenAiCompatibleModel(input.model)) {
    return defineOpenAiCompatiblePrompt(selectedPromptConfig, input.model, input.apiKey, 'agent');
  }

  const defaultEnvKey = getDefaultGeminiEnvKey();
  if (defaultEnvKey && defaultEnvKey === input.apiKey) {
    return input.responseMode === 'conversational'
      ? globalConversationalPrompt
      : globalPrompt;
  }

  const { genkit } = require('genkit');
  const { googleAI } = require('@genkit-ai/googleai');

  const dynamicAi = genkit({
    plugins: [googleAI({ apiKey: input.apiKey })],
    model: input.model,
    // tools: [makeHttpRequestTool],
  });

  return dynamicAi.definePrompt(selectedPromptConfig);
}

const autoResponderFlow = ai.defineFlow(
  {
    name: 'autoResponderFlow',
    inputSchema: AutoResponderFlowInputSchema,
    outputSchema: AgentResponseOutputSchema,
  },
  async (input) => {
    const model = input.model || DEFAULT_AUTOPILOT_MODEL;
    const normalizedRules = sanitizeAutopilotRules(input.rules);
    if (normalizedRules.invalid.length > 0) {
      console.warn('[AUTORESPONDER_FLOW] Ignoring invalid automation rules:', normalizedRules.invalid);
    }
    const promptInput = AgentResponseInputSchema.parse({
      ...input,
      rules: toPromptSafeAutopilotRules(normalizedRules.rules),
      knowledgeBaseDocuments: enrichKnowledgeDocumentsForPrompt(
        input.knowledgeBaseDocuments ?? input.config?.knowledge_base_documents ?? [],
      ),
      workflowKnowledgeDocuments: input.workflowKnowledgeDocuments ?? [],
      fallbackReply: input.fallbackReply ?? input.config?.default_fallback_reply ?? '',
      escalationPolicy: input.escalationPolicy ?? input.config?.escalation_policy ?? '',
      closingPolicy: input.closingPolicy ?? input.config?.closing_policy ?? '',
    });

    // 1. Resolve provider API keys. Each key is tagged with its runtime provider.
    const lmStudioConfig = isLmStudioModel(model) ? await getGlobalLmStudioConfig() : null;
    const apiKeyCandidates: AiModelKeyCandidate[] = isLmStudioModel(model)
      ? [{ source: 'lmstudio-superadmin', key: lmStudioConfig?.apiToken || 'lm-studio', provider: 'lmstudio' }]
      : await resolveAiProviderKeyCandidates({
          config: input.config,
          workspaceGeminiApiKey: input.workspaceGeminiApiKey,
        });

    if (apiKeyCandidates.length === 0) {
      console.error('[AUTORESPONDER_FLOW_ERROR] Nenhuma chave de API encontrada (Config, Integrações ou ENV).');
      // Continue to configured fallback reply instead of throwing and leaving auto mode silent.
    }

    let output: AgentResponseOutput | null = null;

    if (apiKeyCandidates.length > 0) {
      try {
        const promptRun = await runAiModelWithFallback({
          label: 'autoResponderFlow',
          modelCandidates: getModelCandidates(model),
          apiKeyCandidates,
          maxAttemptsPerCandidate: Number.parseInt(process.env.AI_MODEL_MAX_ATTEMPTS || '', 10) || 2,
          retryBaseDelayMs: Number.parseInt(process.env.AI_MODEL_RETRY_BASE_DELAY_MS || '', 10) || 250,
          retryMaxDelayMs: Number.parseInt(process.env.AI_MODEL_RETRY_MAX_DELAY_MS || '', 10) || 1500,
          execute: async (context) => {
            const effectivePrompt = await definePromptForCandidate({
              apiKey: context.apiKey,
              model: context.model,
              responseMode: promptInput.responseMode || 'full',
            });
            let result: any;
            try {
              result = await effectivePrompt(promptInput, { model: context.model });
            } catch (promptError: any) {
              // Genkit throws INVALID_ARGUMENT when the model returns JSON-as-string
              // instead of structured output (common with LM Studio / local models).
              // Try to recover the raw model text from the error's response object.
              let recoveredText: string | null = null;
              try {
                recoveredText = typeof promptError.response?.text === 'function'
                  ? promptError.response.text()
                  : typeof promptError.response?.text === 'string'
                    ? promptError.response.text
                    : null;
              } catch (_) {}

              if (recoveredText && recoveredText.trim()) {
                const parsed = tryParseJsonResponse(recoveredText);
                if (parsed?.response) {
                  console.warn('[AUTORESPONDER_FLOW] Recovered structured response from raw text after Genkit schema error.');
                  result = { output: parsed, text: recoveredText };
                }
              }

              if (!result) throw promptError;
            }

            let finalResult = result;
            if (!result?.output && result?.text) {
              const parsed = tryParseJsonResponse(result.text);
              if (parsed?.response) {
                console.warn('[AUTORESPONDER_FLOW] Parsed structured response from raw model text.');
                finalResult = Object.create(result);
                Object.defineProperty(finalResult, 'output', {
                  value: parsed,
                  writable: true,
                  enumerable: true,
                  configurable: true,
                });
              }
            }

            if (!finalResult?.output && isOpenAiCompatibleModel(context.model)) {
              const parsedOutput = coerceOpenAiCompatiblePromptOutput<AgentResponseOutput & Record<string, unknown>>(
                finalResult?.output,
                finalResult?.text,
              );
              if (parsedOutput?.response) {
                finalResult = Object.create(finalResult || {});
                Object.defineProperty(finalResult, 'output', {
                  value: parsedOutput,
                  writable: true,
                  enumerable: true,
                  configurable: true,
                });
              }
            }

            assertAiModelOutput(finalResult?.output, 'Auto responder returned no structured output.');
            return finalResult;
          },
          onAttempt: (event) => {
            if (event.status === 'success') {
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
      let outputResponse = formatCustomerFacingAiResponse(sanitized.trim() ? sanitized : output.response);

      // Sanitize each messageBlock if the AI decided to split
      let sanitizedBlocks: string[] | undefined;
      if (output.messageBlocks && Array.isArray(output.messageBlocks) && output.messageBlocks.length > 0) {
        const rawBlocks = output.messageBlocks.map(b => b.trim()).filter(Boolean);
        if (rawBlocks.length > 0) {
          const firstBlock = rawBlocks[0];
          const cleanedResponse = output.response ? output.response.trim() : '';

          // Check if response contains all the blocks
          const responseContainsBlocks = rawBlocks.every(block =>
            cleanedResponse.toLowerCase().includes(block.toLowerCase())
          );

          let reconciledBlocks = [...rawBlocks];
          if (!responseContainsBlocks) {
            // If response is distinct from blocks, prepend response as a separate block
            if (
              cleanedResponse &&
              shouldPrependPrimaryResponseToMessageBlocks(cleanedResponse, rawBlocks) &&
              !firstBlock.toLowerCase().includes(cleanedResponse.toLowerCase()) &&
              !cleanedResponse.toLowerCase().includes(firstBlock.toLowerCase())
            ) {
              reconciledBlocks.unshift(cleanedResponse);
            }
          }

          sanitizedBlocks = reconciledBlocks
            .map((block, i) => {
              const s = sanitizeBlock(block, i === 0);
              return formatCustomerFacingAiResponse(s.trim() ? s : block);
            })
            .filter((block) => block.trim() !== '');

          // If we reconstructed it, let's make sure outputResponse has the full combined response to be safe
          if (reconciledBlocks.length > 1) {
            outputResponse = sanitizedBlocks.join('\n\n');
          }
        }
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
