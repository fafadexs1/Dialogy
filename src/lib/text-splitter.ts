/**
 * Utility for splitting text into chunks for RAG.
 * Implements a recursive character splitting strategy similar to LangChain.
 */

interface TextSplitterOptions {
    chunkSize: number;
    chunkOverlap: number;
    separators?: string[];
}

const DEFAULT_OPTIONS: TextSplitterOptions = {
    chunkSize: 800, // Characters ~ 150-200 tokens
    chunkOverlap: 100, // Characters
    separators: ["\n\n", "\n", " ", ""] // Priority order for splitting
};

export class RecursiveCharacterTextSplitter {
    private chunkSize: number;
    private chunkOverlap: number;
    private separators: string[];

    constructor(options?: Partial<TextSplitterOptions>) {
        this.chunkSize = options?.chunkSize ?? DEFAULT_OPTIONS.chunkSize;
        this.chunkOverlap = options?.chunkOverlap ?? DEFAULT_OPTIONS.chunkOverlap;
        this.separators = options?.separators ?? DEFAULT_OPTIONS.separators!;
    }

    /**
     * Splits text into chunks adhering to size and overlap constraints.
     */
    async splitText(text: string): Promise<string[]> {
        const finalChunks: string[] = [];
        let goodSplits: string[] = [];

        // Find the best separator to use
        const separator = this.separators.find(s => text.includes(s)) || "";

        // Initial split by separator
        const splits = separator ? text.split(separator) : [text];

        let currentChunk: string[] = [];
        let currentLength = 0;

        for (const split of splits) {
            const splitLen = split.length;

            if (currentLength + splitLen + (currentChunk.length > 0 ? separator.length : 0) > this.chunkSize) {
                if (currentChunk.length > 0) {
                    const chunk = currentChunk.join(separator);
                    finalChunks.push(chunk);

                    // Handle overlap
                    // Keep the last few splits that fit within overlap + remainder
                    while (currentLength > this.chunkOverlap && currentChunk.length > 0) {
                        const removed = currentChunk.shift();
                        currentLength -= (removed?.length || 0) + (currentChunk.length > 0 ? separator.length : 0);
                    }
                }
            }

            currentChunk.push(split);
            currentLength += splitLen + (currentChunk.length > 1 ? separator.length : 0);
        }

        if (currentChunk.length > 0) {
            finalChunks.push(currentChunk.join(separator));
        }

        return finalChunks;
    }
}

export const defaultSplitter = new RecursiveCharacterTextSplitter();
