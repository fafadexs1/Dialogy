import { AutoModelForSequenceClassification, AutoTokenizer, env } from '@huggingface/transformers';
import type { KnowledgeBaseDocument } from '@/lib/types';
import { getCanonicalKnowledgeAnswer } from './document-safety';

export const BGE_RERANKER_V2_M3_MODEL_ID = 'onnx-community/bge-reranker-v2-m3-ONNX';
const DEFAULT_MAX_RERANK_PASSAGE_CHARACTERS = 1200;

type RerankCandidate = {
  document: KnowledgeBaseDocument;
  originalScore: number;
};

export type BgeRerankerV2M3Result = {
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
  bgeRerankerV2M3?: Promise<{
    tokenizer: any;
    model: any;
  }>;
  bgeRerankerV2M3Queue?: Promise<void>;
};

function isEnabled() {
  const configured = process.env.RAG_BGE_RERANKER_V2_M3_ENABLED?.trim().toLowerCase();
  return configured === 'true' || configured === '1' || configured === 'yes';
}

function maximumPassageCharacters() {
  const configured = Number.parseInt(
    process.env.RAG_BGE_RERANKER_V2_M3_MAX_PASSAGE_CHARACTERS || '',
    10,
  );
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
  if (!globalForReranker.bgeRerankerV2M3) {
    const cacheDir = process.env.TRANSFORMERS_CACHE_DIR?.trim();
    if (cacheDir) env.cacheDir = cacheDir;

    globalForReranker.bgeRerankerV2M3 = Promise.all([
      AutoTokenizer.from_pretrained(BGE_RERANKER_V2_M3_MODEL_ID),
      AutoModelForSequenceClassification.from_pretrained(BGE_RERANKER_V2_M3_MODEL_ID, { dtype: 'q8' }),
    ]).then(([tokenizer, model]) => ({ tokenizer, model }));
  }
  return globalForReranker.bgeRerankerV2M3;
}

async function runRerankerSerialized<T>(task: () => Promise<T>): Promise<T> {
  const previous = globalForReranker.bgeRerankerV2M3Queue || Promise.resolve();
  const running = previous.catch(() => undefined).then(task);
  const settled = running.then(() => undefined, () => undefined);
  globalForReranker.bgeRerankerV2M3Queue = settled;
  try {
    return await running;
  } finally {
    if (globalForReranker.bgeRerankerV2M3Queue === settled) {
      globalForReranker.bgeRerankerV2M3Queue = undefined;
    }
  }
}

function disposeTensors(value: Record<string, unknown> | null | undefined) {
  const disposed = new Set<unknown>();
  for (const tensor of Object.values(value || {})) {
    if (!tensor || disposed.has(tensor)) continue;
    disposed.add(tensor);
    (tensor as { dispose?: () => void }).dispose?.();
  }
}

export async function prewarmBgeRerankerV2M3() {
  if (isEnabled()) await getReranker();
}

export async function rerankKnowledgeCandidatesWithBgeV2M3(
  query: string,
  candidates: RerankCandidate[],
): Promise<BgeRerankerV2M3Result | null> {
  if (!isEnabled() || candidates.length < 2 || !query.trim()) return null;

  const startedAt = performance.now();
  const { tokenizer, model } = await getReranker();
  const ranked = await runRerankerSerialized(async () => {
    let modelInputs: Record<string, unknown> | undefined;
    let output: Record<string, unknown> | undefined;
    try {
      modelInputs = tokenizer(
        candidates.map(() => query),
        {
          text_pair: candidates.map(({ document }) => passageForDocument(document)),
          padding: true,
          truncation: true,
        },
      );
      output = await model(modelInputs);
      const logits = (output as any).logits.tolist() as number[][];
      return candidates
        .map((candidate, index) => ({
          ...candidate,
          rerankerScore: Number(logits[index]?.[0] ?? Number.NEGATIVE_INFINITY),
        }))
        .sort((left, right) => right.rerankerScore - left.rerankerScore || right.originalScore - left.originalScore);
    } finally {
      disposeTensors(output);
      disposeTensors(modelInputs);
    }
  });

  return {
    documents: ranked,
    diagnostics: {
      model: BGE_RERANKER_V2_M3_MODEL_ID,
      precision: 'q8',
      candidates: candidates.length,
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
    },
  };
}
