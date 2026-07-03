import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tokenizer: vi.fn(),
  model: vi.fn(),
  fromTokenizer: vi.fn(),
  fromModel: vi.fn(),
  disposeInput: vi.fn(),
  disposeLogits: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({
  env: {},
  AutoTokenizer: { from_pretrained: mocks.fromTokenizer },
  AutoModelForSequenceClassification: { from_pretrained: mocks.fromModel },
}));

import { rerankKnowledgeCandidatesWithBgeV2M3 } from '@/services/rag/bge-reranker-v2-m3';

describe('BGE Reranker v2 M3', () => {
  beforeEach(() => {
    process.env.RAG_BGE_RERANKER_V2_M3_ENABLED = 'true';
    vi.clearAllMocks();
    mocks.tokenizer.mockReturnValue({
      input_ids: { dispose: mocks.disposeInput },
    });
    mocks.model.mockResolvedValue({
      logits: {
        tolist: () => [[1], [2], [3], [4], [5], [6], [7]],
        dispose: mocks.disposeLogits,
      },
    });
    mocks.fromTokenizer.mockResolvedValue(mocks.tokenizer);
    mocks.fromModel.mockResolvedValue(mocks.model);
  });

  it('reranks every received candidate without a pre-ranking cutoff', async () => {
    const candidates = Array.from({ length: 7 }, (_, index) => ({
      document: {
        id: `doc-${index}`,
        name: `Documento ${index}`,
        content: `Conteudo ${index}`,
      },
      originalScore: 100 - index,
    }));

    const result = await rerankKnowledgeCandidatesWithBgeV2M3('consulta completa', candidates);

    expect(mocks.tokenizer).toHaveBeenCalledWith(
      Array(7).fill('consulta completa'),
      expect.objectContaining({ text_pair: expect.arrayContaining(['Titulo: Documento 6\nConteudo 6']) }),
    );
    expect(result?.documents).toHaveLength(7);
    expect(result?.documents[0].document.id).toBe('doc-6');
    expect(result?.diagnostics.candidates).toBe(7);
    expect(mocks.disposeInput).toHaveBeenCalledOnce();
    expect(mocks.disposeLogits).toHaveBeenCalledOnce();
  });
});
