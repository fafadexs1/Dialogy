import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pipeline: vi.fn(),
  dispose: vi.fn(),
  active: 0,
  maximumActive: 0,
}));

vi.mock('@huggingface/transformers', () => ({
  env: {},
  pipeline: mocks.pipeline,
}));

import { generateDocumentQueryEmbedding } from '@/lib/embeddings';

describe('embedding native-memory lifecycle', () => {
  it('deduplicates model loading, serializes inference, and disposes every output tensor', async () => {
    const extractor = vi.fn(async () => {
      mocks.active += 1;
      mocks.maximumActive = Math.max(mocks.maximumActive, mocks.active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      mocks.active -= 1;
      return {
        data: new Float32Array(1024),
        dispose: mocks.dispose,
      };
    });
    mocks.pipeline.mockResolvedValue(extractor);

    const vectors = await Promise.all([
      generateDocumentQueryEmbedding('primeira consulta'),
      generateDocumentQueryEmbedding('segunda consulta'),
      generateDocumentQueryEmbedding('terceira consulta'),
    ]);

    expect(mocks.pipeline).toHaveBeenCalledOnce();
    expect(extractor).toHaveBeenCalledTimes(3);
    expect(mocks.maximumActive).toBe(1);
    expect(mocks.dispose).toHaveBeenCalledTimes(3);
    expect(vectors.every((vector) => vector.length === 1024)).toBe(true);
  });
});
