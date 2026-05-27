import { AutoModelForSequenceClassification, AutoTokenizer, env } from '@huggingface/transformers';
import type { KnowledgeBaseDocument } from '@/lib/types';
import { getCanonicalKnowledgeAnswer } from './document-safety';

const RERANKER_MODEL_ID = 'onnx-community/bge-reranker-v2-m3-ONNX';
const DEFAULT_RERANK_CANDIDATE_LIMIT = 4;
const DEFAULT_MAX_RERANK_PASSAGE_CHARACTERS = 1200;

type RerankCandidate = {
  document: KnowledgeBaseDocument;
  originalScore: number;
};

export type CrossEncoderRerankResult = {
  documents: Array<{
    document: KnowledgeBaseDocument;
    originalScore: number;
    rerankerScore: number;
  }>;
  diagnostics: {
    model: string;
    precision: 'q8';
    candidates: number;
    elapsedMs: number;
  };
};

const globalForReranker = global as unknown as {
  ragCrossEncoder?: Promise<{
    tokenizer: any;
    model: any;
  }>;
};

function isEnabled() {
  const configured = process.env.RAG_CROSS_ENCODER_ENABLED?.trim().toLowerCase();
  return configured !== 'false' && configured !== '0' && configured !== 'no';
}

function candidateLimit() {
  const configured = Number.parseInt(process.env.RAG_CROSS_ENCODER_CANDIDATES || '', 10);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(10, configured)
    : DEFAULT_RERANK_CANDIDATE_LIMIT;
}

function maximumPassageCharacters() {
  const configured = Number.parseInt(process.env.RAG_CROSS_ENCODER_MAX_PASSAGE_CHARACTERS || '', 10);
  return Number.isFinite(configured) && configured >= 300
    ? Math.min(4000, configured)
    : DEFAULT_MAX_RERANK_PASSAGE_CHARACTERS;
}

function passageForDocument(document: KnowledgeBaseDocument) {
  const canonicalAnswer = getCanonicalKnowledgeAnswer(document);
  return [
    document.name ? `Titulo: ${document.name}` : '',
    canonicalAnswer ? `Resposta canonica: ${canonicalAnswer}` : '',
    String(document.content || ''),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, maximumPassageCharacters());
}

async function getReranker() {
  if (!globalForReranker.ragCrossEncoder) {
    const cacheDir = process.env.TRANSFORMERS_CACHE_DIR?.trim();
    if (cacheDir) env.cacheDir = cacheDir;

    globalForReranker.ragCrossEncoder = Promise.all([
      AutoTokenizer.from_pretrained(RERANKER_MODEL_ID),
      AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL_ID, { dtype: 'q8' }),
    ]).then(([tokenizer, model]) => ({ tokenizer, model }));
  }
  return globalForReranker.ragCrossEncoder;
}

export async function prewarmCrossEncoderReranker() {
  if (isEnabled()) await getReranker();
}

export async function rerankKnowledgeCandidates(
  query: string,
  candidates: RerankCandidate[],
): Promise<CrossEncoderRerankResult | null> {
  if (!isEnabled() || candidates.length < 2 || !query.trim()) return null;

  const selected = candidates.slice(0, candidateLimit());
  const startedAt = performance.now();
  const { tokenizer, model } = await getReranker();
  const modelInputs = tokenizer(
    selected.map(() => query),
    {
      text_pair: selected.map(({ document }) => passageForDocument(document)),
      padding: true,
      truncation: true,
    },
  );
  const output = await model(modelInputs);
  const logits = output.logits.tolist() as number[][];
  const ranked = selected
    .map((candidate, index) => ({
      ...candidate,
      rerankerScore: Number(logits[index]?.[0] ?? Number.NEGATIVE_INFINITY),
    }))
    .sort((left, right) => right.rerankerScore - left.rerankerScore || right.originalScore - left.originalScore);

  return {
    documents: ranked,
    diagnostics: {
      model: RERANKER_MODEL_ID,
      precision: 'q8',
      candidates: selected.length,
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
    },
  };
}
