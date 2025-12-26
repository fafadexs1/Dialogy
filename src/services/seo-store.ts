import 'server-only';
import fs from 'fs/promises';
import path from 'path';
import { unstable_noStore as noStore } from 'next/cache';
import { Mutex } from 'async-mutex';
import { SeoEntry, SeoEntrySchema } from '@/types/seo';
import { randomUUID } from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data', 'seo');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const mutex = new Mutex();

// Helper to ensure directory exists
async function ensureDir() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
}

// Helper to read raw data
async function readStore(): Promise<SeoEntry[]> {
    noStore(); // Force fresh read
    try {
        await ensureDir();
        const data = await fs.readFile(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        // Validate array but don't fail entire read if one item is bad (filter bad ones?) 
        // For now assume strictly valid or empty.
        if (!Array.isArray(parsed)) return [];
        return parsed as SeoEntry[];
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

// Helper to write raw data atomically
async function writeStore(data: SeoEntry[]) {
    await ensureDir();
    const tempFile = `${STORE_FILE}.tmp.${randomUUID()}`;
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tempFile, STORE_FILE);
}

export const seoStore = {
    async list(): Promise<SeoEntry[]> {
        return readStore();
    },

    async getById(id: string): Promise<SeoEntry | undefined> {
        const entries = await readStore();
        return entries.find((e) => e.id === id);
    },

    async getByPath(pathname: string): Promise<SeoEntry | undefined> {
        const entries = await readStore();
        return entries.find((e) => e.pathname === pathname);
    },

    async upsert(entry: Partial<SeoEntry> & { pathname: string }): Promise<SeoEntry> {
        return await mutex.runExclusive(async () => {
            const entries = await readStore();
            const now = new Date().toISOString();

            let targetIndex = -1;

            if (entry.id) {
                targetIndex = entries.findIndex((e) => e.id === entry.id);
            } else {
                // Constructing new? Check if path exists to avoid duplicates if creating new
                targetIndex = entries.findIndex((e) => e.pathname === entry.pathname);
            }

            let newEntry: SeoEntry;

            if (targetIndex >= 0) {
                // Update existing
                newEntry = {
                    ...entries[targetIndex],
                    ...entry,
                    updatedAt: now,
                };
                // Re-validate full object
                newEntry = SeoEntrySchema.parse(newEntry);
                entries[targetIndex] = newEntry;
            } else {
                // Create new
                const id = entry.id || randomUUID();
                newEntry = SeoEntrySchema.parse({
                    robots: 'index, follow', // Default
                    ogType: 'website',      // Default
                    ...entry,
                    id,
                    updatedAt: now
                });
                entries.push(newEntry);
            }

            await writeStore(entries);
            return newEntry;
        });
    },

    async delete(id: string): Promise<void> {
        await mutex.runExclusive(async () => {
            const entries = await readStore();
            const filtered = entries.filter((e) => e.id !== id);
            if (filtered.length !== entries.length) {
                await writeStore(filtered);
            }
        });
    }
};
