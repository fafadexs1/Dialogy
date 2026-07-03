import { env, pipeline } from '@huggingface/transformers';

export type DocumentEmbeddingModel = 'bge-m3';

type EmbeddingProfile = {
    modelId: string;
    dimensions: number;
    pooling: 'mean' | 'cls';
    dtype?: 'q8';
    prefixes: boolean;
};

export const DOCUMENT_EMBEDDING_MODEL: DocumentEmbeddingModel = 'bge-m3';
export const DOCUMENT_EMBEDDING_PROFILE: EmbeddingProfile = {
    modelId: 'onnx-community/bge-m3-ONNX',
    dimensions: 1024,
    pooling: 'cls',
    dtype: 'q8',
    prefixes: false,
};
export const DOCUMENT_EMBEDDING_DIMENSIONS = DOCUMENT_EMBEDDING_PROFILE.dimensions;

const MODELS: Record<'chat' | 'doc', EmbeddingProfile> = {
    chat: {
        modelId: 'Xenova/all-MiniLM-L6-v2',
        dimensions: 384,
        pooling: 'mean',
        prefixes: false,
    },
    doc: DOCUMENT_EMBEDDING_PROFILE,
};

type EmbeddingType = keyof typeof MODELS;
type DocumentEmbeddingMode = 'default' | 'query' | 'passage';
type EmbeddingGenerateOptions = {
    mode?: DocumentEmbeddingMode;
};

const configuredCacheDir = process.env.TRANSFORMERS_CACHE_DIR?.trim();
if (configuredCacheDir) {
    env.cacheDir = configuredCacheDir;
}

const globalForEmbeddings = global as unknown as {
    embeddingPipelines: Record<string, Promise<any>> | undefined;
    embeddingQueues: Record<string, Promise<void>> | undefined;
};

function normalizeWhitespace(text: string) {
    return text.replace(/\s+/g, ' ').trim();
}

function hasDocumentPrefix(text: string) {
    return /^(query|passage)\s*:/i.test(text);
}

function prepareEmbeddingInput(text: string, type: EmbeddingType, options?: EmbeddingGenerateOptions) {
    const cleanText = normalizeWhitespace(text);
    if (!cleanText) return '';

    const profile = MODELS[type];
    if (type !== 'doc' || !profile.prefixes) return cleanText;

    const mode = options?.mode || 'default';
    if (mode === 'default' || hasDocumentPrefix(cleanText)) return cleanText;

    return `${mode}: ${cleanText}`;
}

class EmbeddingService {
    private static instances: Record<string, Promise<any>> =
        globalForEmbeddings.embeddingPipelines ||= {};
    private static queues: Record<string, Promise<void>> =
        globalForEmbeddings.embeddingQueues ||= {};

    private static cacheKey(type: EmbeddingType) {
        const profile = MODELS[type];
        return `${type}:${profile.modelId}:${profile.dtype || 'default'}`;
    }

    private static async getPipeline(type: EmbeddingType) {
        const profile = MODELS[type];
        const cacheKey = this.cacheKey(type);
        if (!this.instances[cacheKey]) {
            console.log(`[EmbeddingService] Loading model: ${profile.modelId} (${profile.dtype || 'default'})...`);
            let loading: Promise<any>;
            loading = pipeline(
                'feature-extraction',
                profile.modelId,
                profile.dtype ? { dtype: profile.dtype } : undefined,
            ).then((loaded) => {
                console.log(`[EmbeddingService] Model loaded: ${profile.modelId}`);
                return loaded;
            }).catch((error) => {
                if (this.instances[cacheKey] === loading) delete this.instances[cacheKey];
                throw error;
            });
            this.instances[cacheKey] = loading;
        }
        return this.instances[cacheKey];
    }

    private static async runSerialized<T>(type: EmbeddingType, task: () => Promise<T>): Promise<T> {
        const cacheKey = this.cacheKey(type);
        const previous = this.queues[cacheKey] || Promise.resolve();
        const running = previous.catch(() => undefined).then(task);
        const settled = running.then(() => undefined, () => undefined);
        this.queues[cacheKey] = settled;
        try {
            return await running;
        } finally {
            if (this.queues[cacheKey] === settled) delete this.queues[cacheKey];
        }
    }

    static async generate(text: string, type: EmbeddingType, options?: EmbeddingGenerateOptions): Promise<number[]> {
        try {
            const cleanText = prepareEmbeddingInput(text, type, options);
            if (!cleanText) return [];

            const profile = MODELS[type];
            const extractor = await this.getPipeline(type);
            return await this.runSerialized(type, async () => {
                let output: any;
                try {
                    output = await extractor(cleanText, { pooling: profile.pooling, normalize: true });
                    const vector = Array.from(output.data) as number[];
                    if (vector.length !== profile.dimensions) {
                        throw new Error(
                            `Model ${profile.modelId} returned ${vector.length} dimensions; expected ${profile.dimensions}.`,
                        );
                    }
                    return vector;
                } finally {
                    output?.dispose?.();
                }
            });
        } catch (error) {
            console.error(`[EmbeddingService] Error generating embedding for type '${type}':`, error);
            throw error;
        }
    }

    static async prewarm(types: EmbeddingType[] = ['doc']) {
        await Promise.all(types.map((type) => this.getPipeline(type)));
    }
}

export const generateEmbedding = EmbeddingService.generate.bind(EmbeddingService);
export const prewarmEmbeddingModels = EmbeddingService.prewarm.bind(EmbeddingService);

export function generateDocumentQueryEmbedding(text: string) {
    return EmbeddingService.generate(text, 'doc', { mode: 'query' });
}

export function generateDocumentPassageEmbedding(text: string) {
    return EmbeddingService.generate(text, 'doc', { mode: 'passage' });
}
