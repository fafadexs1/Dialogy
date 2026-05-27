import { env, pipeline } from '@huggingface/transformers';
import { performance } from 'node:perf_hooks';

type BenchmarkModel = {
  name: string;
  modelId: string;
  pooling: 'mean' | 'cls';
  dtype?: 'q8';
  prefix: (text: string) => string;
};

const MODELS: BenchmarkModel[] = [
  {
    name: 'multilingual-e5-base',
    modelId: 'Xenova/multilingual-e5-base',
    pooling: 'mean',
    prefix: (text) => `passage: ${text}`,
  },
  {
    name: 'bge-m3-q8',
    modelId: 'onnx-community/bge-m3-ONNX',
    pooling: 'cls',
    dtype: 'q8',
    prefix: (text) => text,
  },
];

const INPUTS = [
  'Cliente informa que esta sem conexao e a luz LOS do equipamento esta vermelha.',
  'Para alterar a senha do Wi-Fi, confirme o nome da rede e a nova senha antes de executar a acao.',
  'O cliente deseja contratar um plano de internet e perguntou os valores e as condicoes disponiveis.',
  'Pendencia financeira pode causar bloqueio do contrato; consulte o cadastro antes de orientar pagamento.',
];

const iterations = Math.max(1, Number.parseInt(process.env.EMBEDDING_BENCHMARK_ITERATIONS || '5', 10) || 5);
env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR?.trim() || 'C:/temp/dialogy-transformers-cache';

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function percentile(values: number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

async function benchmark(model: BenchmarkModel) {
  const loadStarted = performance.now();
  const extractor = await pipeline(
    'feature-extraction',
    model.modelId,
    model.dtype ? { dtype: model.dtype } : undefined,
  );
  const loadMs = performance.now() - loadStarted;
  const warmup = await extractor(model.prefix(INPUTS[0]), { pooling: model.pooling, normalize: true });
  const dimensions = warmup.data.length;
  const timings: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const input of INPUTS) {
      const started = performance.now();
      await extractor(model.prefix(input), { pooling: model.pooling, normalize: true });
      timings.push(performance.now() - started);
    }
  }

  return {
    model: model.name,
    dimensions,
    loadMs: round(loadMs),
    samples: timings.length,
    averageEncodeMs: round(timings.reduce((sum, value) => sum + value, 0) / timings.length),
    p50EncodeMs: round(percentile(timings, 0.5)),
    p95EncodeMs: round(percentile(timings, 0.95)),
  };
}

async function main() {
  console.log(`Embedding cache: ${env.cacheDir}`);
  console.log(`Measured encodes per model: ${iterations * INPUTS.length}`);
  const results = [];
  for (const model of MODELS) {
    results.push(await benchmark(model));
  }
  console.table(results);
}

void main().catch((error) => {
  console.error('Embedding benchmark failed:', error);
  process.exitCode = 1;
});
