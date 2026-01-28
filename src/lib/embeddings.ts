import { pipeline } from '@xenova/transformers';

// Configuration for models
const MODELS = {
    chat: 'Xenova/all-MiniLM-L6-v2',       // 384 dimensions, fast
    doc: 'Xenova/multilingual-e5-base'     // 768 dimensions, high accuracy
};

// Global cache to persist models across hot-reloads in development
const globalForEmbeddings = global as unknown as {
    embeddingPipelines: Record<string, any> | undefined;
};

class EmbeddingService {
    private static instances: Record<string, any> = globalForEmbeddings.embeddingPipelines || {};

    /**
     * Get or load the pipeline for a specific model type.
     */
    private static async getPipeline(type: keyof typeof MODELS) {
        if (!this.instances[type]) {
            console.log(`[EmbeddingService] Loading model: ${MODELS[type]}...`);

            // Use 'feature-extraction' task
            this.instances[type] = await pipeline('feature-extraction', MODELS[type]);
            console.log(`[EmbeddingService] Model loaded: ${MODELS[type]}`);

            // Update global cache (for dev environment)
            if (process.env.NODE_ENV !== 'production') {
                globalForEmbeddings.embeddingPipelines = this.instances;
            }
        }
        return this.instances[type];
    }

    /**
     * Generate embedding vector for a given text.
     * @param text The text to embed.
     * @param type 'chat' for short texts/messages, 'doc' for knowledge base documents.
     * @returns Array of numbers representing the vector.
     */
    static async generate(text: string, type: 'chat' | 'doc'): Promise<number[]> {
        try {
            // Basic cleanup to remove excessive whitespace
            const cleanText = text.replace(/\s+/g, ' ').trim();
            if (!cleanText) return [];

            const extractor = await this.getPipeline(type);

            // 'mean' pooling and normalization are standard for these models to get a single sentence vector
            const output = await extractor(cleanText, { pooling: 'mean', normalize: true });

            // Convert Tensor to standard array
            return Array.from(output.data);
        } catch (error) {
            console.error(`[EmbeddingService] Error generating embedding for type '${type}':`, error);
            throw error;
        }
    }
}

// Export a robust singleton function
export const generateEmbedding = EmbeddingService.generate.bind(EmbeddingService);
