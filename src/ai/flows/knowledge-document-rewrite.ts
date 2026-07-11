import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { z } from 'zod';

import { ai } from '@/ai/genkit';
import { DEFAULT_AUTOPILOT_MODEL } from '@/lib/ai-models';
import type { KnowledgeBaseDocument } from '@/lib/types';
import { isLmStudioModel } from '@/services/ai/lm-studio';
import { requestLmStudioJson } from '@/services/ai/lm-studio-client';
import { isOpenAiCompatibleModel, requestOpenAiCompatibleJson } from '@/services/ai/openai-compatible';
import { runAiModelWithFallback, type AiModelKeyCandidate } from '@/services/ai/model-client';
import { toCanonicalKnowledgeMarkdown } from '@/services/rag/knowledge-document';

const KnowledgeDocumentRewriteSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
  summary: z.string().min(1),
  category: z.string(), // Permite categoria vazia de modelos como Deepseek
  tags: z.array(z.string()).max(12),
  contextRole: z.enum(['fact', 'procedure', 'policy', 'persona']),
  canonicalAnswer: z.string(),
  workflowHints: z.array(z.string()).max(12),
  requiredTools: z.array(z.string()).max(12),
});

export type ImprovedKnowledgeDocument = z.infer<typeof KnowledgeDocumentRewriteSchema>;

function protectedKnowledgeTokens(value: string): string[] {
  return Array.from(value.matchAll(/@[a-zA-Z0-9_.:-]+|\b\d+(?:[.,]\d+)?\b/g))
    .map((match) => match[0].toLowerCase());
}

function preservesSourceKnowledge(source: string, rewritten: string): boolean {
  const normalizedSource = source.trim();
  const normalizedRewrite = rewritten.trim();
  if (!normalizedRewrite) return false;

  const minimumRatio = normalizedSource.length >= 400 ? 0.65 : 0.45;
  if (normalizedRewrite.length < normalizedSource.length * minimumRatio) return false;

  const rewriteLower = normalizedRewrite.toLowerCase();
  return protectedKnowledgeTokens(normalizedSource).every((token) => rewriteLower.includes(token));
}

export function preserveKnowledgeDocumentSource(
  document: KnowledgeBaseDocument,
  improved: ImprovedKnowledgeDocument,
): ImprovedKnowledgeDocument {
  if (preservesSourceKnowledge(document.content || '', improved.content)) return improved;

  const originalMarkdown = toCanonicalKnowledgeMarkdown(document);
  return {
    ...improved,
    content: [
      `# ${improved.name.trim() || document.name || 'Documento'}`,
      improved.summary.trim() ? `## Resumo para busca\n${improved.summary.trim()}` : '',
      `## Conteudo oficial preservado\n${originalMarkdown}`,
    ].filter(Boolean).join('\n\n'),
  };
}

const promptConfig = {
  name: 'knowledgeDocumentRewritePrompt',
  input: {
    schema: z.object({
      name: z.string(),
      content: z.string(),
      category: z.string(),
      toolMentions: z.string(),
    }),
  },
  output: { schema: KnowledgeDocumentRewriteSchema },
  prompt: `Reescreva uma nota de base de conhecimento para recuperacao RAG.

Objetivos:
- Produzir Markdown objetivo, bem dividido por titulos e subtitulos.
- Facilitar busca semantica e textual sem alterar nenhum fato.
- Preservar integralmente valores, datas, contatos, restricoes e mencoes @tool.
- O campo content deve conter o documento reescrito completo. Nunca substitua procedimentos por um resumo.
- Para procedimentos, explicitar objetivo, quando usar, pre-condicoes, passos numerados e resultado esperado.
- Para fatos, colocar a resposta oficial cedo e evitar texto redundante.
- Nao inventar informacoes ausentes.

Documento atual:
Titulo: {{name}}
Categoria atual: {{category}}
Tools que devem ser preservadas: {{toolMentions}}

Conteudo:
{{{content}}}`,
};

const defaultPrompt = ai.definePrompt(promptConfig);

const rewriteJsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    content: { type: 'string' },
    summary: { type: 'string' },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    contextRole: { type: 'string', enum: ['fact', 'procedure', 'policy', 'persona'] },
    canonicalAnswer: { type: 'string' },
    workflowHints: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    requiredTools: { type: 'array', items: { type: 'string' }, maxItems: 12 },
  },
  required: ['name', 'content', 'summary', 'category', 'tags', 'contextRole', 'canonicalAnswer', 'workflowHints', 'requiredTools'],
  additionalProperties: false,
};

const rewriteFallbackModels = [
  DEFAULT_AUTOPILOT_MODEL,
  'googleai/gemini-2.5-flash',
  'openai/gpt-5.4-mini',
  'deepseek/deepseek-chat',
];

export async function improveKnowledgeDocumentForRag(input: {
  document: KnowledgeBaseDocument;
  model: string;
  apiKey?: string;
  apiKeyCandidates?: AiModelKeyCandidate[];
}): Promise<ImprovedKnowledgeDocument> {
  const toolMentions = Array.from(String(input.document.content || '').matchAll(/@([a-zA-Z0-9_.:-]+)/g))
    .map((match) => `@${match[1]}`)
    .join(', ');
  const promptInput = {
    name: input.document.name || 'Documento',
    content: String(input.document.content || '').slice(0, 24000),
    category: input.document.category || '',
    toolMentions,
  };

  const executeRewrite = async (model: string, apiKey: string) => {
    const common = {
      schema: KnowledgeDocumentRewriteSchema,
      schemaName: 'dialogy_knowledge_document_rewrite',
      jsonSchema: rewriteJsonSchema,
      systemPrompt: 'Otimize documentos para RAG. Preserve fatos e tools. Responda somente JSON valido.',
      userPrompt: [
        `Titulo: ${promptInput.name}`,
        `Categoria: ${promptInput.category}`,
        `Tools obrigatorias: ${promptInput.toolMentions}`,
        `Conteudo:\n${promptInput.content}`,
      ].join('\n\n'),
      timeoutMs: 30000,
      maxTokens: 2400,
    };

    if (isLmStudioModel(model)) {
      return requestLmStudioJson({ model, ...common });
    }
    if (isOpenAiCompatibleModel(model)) {
      return requestOpenAiCompatibleJson({ model, apiKey, ...common });
    }

    const defaultKey = process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
    const prompt = apiKey === defaultKey
    ? defaultPrompt
    : genkit({ plugins: [googleAI({ apiKey })], model }).definePrompt(promptConfig);
    const result = await prompt(promptInput, { model });
    if (!result.output) throw new Error('A IA nao retornou um documento estruturado.');
    return KnowledgeDocumentRewriteSchema.parse(result.output);
  };

  const fallbackKeys = input.apiKeyCandidates?.length
    ? input.apiKeyCandidates
    : [{ source: 'explicit', key: input.apiKey || '', provider: undefined }];
  const run = await runAiModelWithFallback({
    label: 'knowledgeDocumentRewrite',
    modelCandidates: [input.model, ...rewriteFallbackModels],
    apiKeyCandidates: fallbackKeys,
    maxAttemptsPerCandidate: 1,
    execute: ({ model, apiKey }) => executeRewrite(model, apiKey),
  });
  return preserveKnowledgeDocumentSource(input.document, run.result);
}
