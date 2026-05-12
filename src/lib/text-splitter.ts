/**
 * Utility for splitting text into chunks for RAG.
 * Implements a recursive character splitting strategy similar to LangChain.
 */

interface TextSplitterOptions {
    chunkSize: number;
    chunkOverlap: number;
    separators?: string[];
    preserveHeadings?: boolean;
}

const DEFAULT_OPTIONS: TextSplitterOptions = {
    chunkSize: 1200,
    chunkOverlap: 160,
    separators: ["\n\n", "\n", ". ", " ", ""],
    preserveHeadings: true,
};

export class RecursiveCharacterTextSplitter {
    private chunkSize: number;
    private chunkOverlap: number;
    private separators: string[];
    private preserveHeadings: boolean;

    constructor(options?: Partial<TextSplitterOptions>) {
        this.chunkSize = options?.chunkSize ?? DEFAULT_OPTIONS.chunkSize;
        this.chunkOverlap = options?.chunkOverlap ?? DEFAULT_OPTIONS.chunkOverlap;
        this.separators = options?.separators ?? DEFAULT_OPTIONS.separators!;
        this.preserveHeadings = options?.preserveHeadings ?? DEFAULT_OPTIONS.preserveHeadings!;
    }

    /**
     * Splits text into chunks adhering to size and overlap constraints.
     */
    async splitText(text: string): Promise<string[]> {
        const cleanText = text.replace(/\r\n/g, '\n').trim();
        if (!cleanText) return [];

        if (this.preserveHeadings) {
            const sectionChunks = this.splitBySections(cleanText);
            if (sectionChunks.length > 0) {
                return this.mergeSmallChunks(sectionChunks);
            }
        }

        return this.splitChunk(cleanText);
    }

    private splitChunk(text: string): string[] {
        const finalChunks: string[] = [];
        // Find the best separator to use
        const separator = this.separators.find(s => s === '' || text.includes(s)) || "";

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

        return finalChunks.flatMap((chunk) => (
            chunk.length > this.chunkSize * 1.4 && separator
                ? this.splitChunkWithNextSeparator(chunk, separator)
                : [chunk.trim()]
        )).filter(Boolean);
    }

    private splitChunkWithNextSeparator(text: string, currentSeparator: string): string[] {
        const index = this.separators.indexOf(currentSeparator);
        const nextSeparators = index >= 0 ? this.separators.slice(index + 1) : [' '];
        const nested = new RecursiveCharacterTextSplitter({
            chunkSize: this.chunkSize,
            chunkOverlap: this.chunkOverlap,
            separators: nextSeparators.length > 0 ? nextSeparators : [''],
            preserveHeadings: false,
        });
        return nested.splitChunk(text);
    }

    private splitBySections(text: string): string[] {
        const lines = text.split('\n');
        const sections: string[] = [];
        let current: string[] = [];
        let currentHeading = '';

        const flush = () => {
            const value = current.join('\n').trim();
            if (!value) return;
            if (value.length <= this.chunkSize) {
                sections.push(value);
                return;
            }
            sections.push(...this.splitChunk(value));
        };

        for (const line of lines) {
            const trimmed = line.trim();
            const isHeading =
                /^#{1,6}\s+\S/.test(trimmed) ||
                /^[A-Z0-9][A-Z0-9\s:;,.!?/-]{8,}$/.test(trimmed) ||
                /^(@tool|procedimento|passo|etapa|quando|se)\b/i.test(trimmed);

            if (isHeading && current.length > 0) {
                flush();
                current = currentHeading && !trimmed.startsWith(currentHeading) ? [currentHeading, line] : [line];
                currentHeading = line;
                continue;
            }

            current.push(line);
            if (!currentHeading && isHeading) {
                currentHeading = line;
            }
        }

        flush();
        return sections;
    }

    private mergeSmallChunks(chunks: string[]): string[] {
        const merged: string[] = [];
        let buffer = '';

        for (const chunk of chunks) {
            const candidate = buffer ? `${buffer}\n\n${chunk}` : chunk;
            if (candidate.length <= this.chunkSize) {
                buffer = candidate;
                continue;
            }

            if (buffer) merged.push(buffer);
            buffer = chunk;
        }

        if (buffer) merged.push(buffer);
        return merged.map((chunk, index, all) => {
            if (index === 0 || this.chunkOverlap <= 0) return chunk;
            const previous = all[index - 1] || '';
            const overlap = previous.slice(Math.max(0, previous.length - this.chunkOverlap));
            return `${overlap}\n\n${chunk}`.trim();
        });
    }
}

export const defaultSplitter = new RecursiveCharacterTextSplitter();
