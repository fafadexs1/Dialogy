import 'server-only';

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { unstable_noStore as noStore } from 'next/cache';

import { db } from '@/lib/db';
import { getRobotsDirectives } from '@/lib/seo/indexability';
import { PUBLIC_SEO_ROUTES } from '@/lib/seo/route-registry';
import { SeoEntry, SeoEntrySchema } from '@/types/seo';

const DATA_DIR = path.join(process.cwd(), 'data', 'seo');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

type SeoPageRow = {
    id: string;
    pathname: string;
    title: string | null;
    description: string | null;
    canonical: string | null;
    robots: string | null;
    og_image: string | null;
    og_type: string | null;
    json_ld: string | null;
    updated_at: Date | string;
};

let initializationPromise: Promise<void> | null = null;

function markNoStore() {
    try {
        noStore();
    } catch {
        // Scripts and non-request contexts can reuse the same store safely.
    }
}

function cleanOptional(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function normalizeRobots(value?: string | null): SeoEntry['robots'] {
    const normalized = value?.trim();
    if (
        normalized === 'index, follow'
        || normalized === 'noindex, nofollow'
        || normalized === 'index, nofollow'
        || normalized === 'noindex, follow'
    ) {
        return normalized;
    }
    return 'index, follow';
}

function normalizeOgType(value?: string | null): SeoEntry['ogType'] {
    return value === 'article' || value === 'profile' ? value : 'website';
}

function mapRow(row: SeoPageRow): SeoEntry {
    return SeoEntrySchema.parse({
        id: row.id,
        pathname: row.pathname,
        title: cleanOptional(row.title),
        description: cleanOptional(row.description),
        canonical: cleanOptional(row.canonical),
        robots: normalizeRobots(row.robots),
        ogImage: cleanOptional(row.og_image),
        ogType: normalizeOgType(row.og_type),
        jsonLd: cleanOptional(row.json_ld),
        updatedAt: new Date(row.updated_at).toISOString(),
    });
}

async function readLegacyEntries(): Promise<SeoEntry[]> {
    if (!existsSync(STORE_FILE)) {
        return [];
    }

    try {
        const data = await fs.readFile(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(data);

        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .map((entry) => SeoEntrySchema.safeParse(entry))
            .filter((result) => result.success)
            .map((result) => result.data);
    } catch (error) {
        console.error('[SeoStore] Failed to read legacy store:', error);
        return [];
    }
}

async function ensureTable() {
    // Applied by Prisma migration before runtime.
}

async function countRows() {
    const res = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.seo_pages');
    return Number(res.rows[0]?.count ?? '0');
}

async function insertEntry(entry: {
    id?: string;
    pathname: string;
    title?: string;
    description?: string;
    canonical?: string;
    robots?: SeoEntry['robots'];
    ogImage?: string;
    ogType?: SeoEntry['ogType'];
    jsonLd?: string;
}) {
    const id = cleanOptional(entry.id) || randomUUID();
    const pathname = entry.pathname.trim();
    const now = new Date().toISOString();

    const validated = SeoEntrySchema.parse({
        id,
        pathname,
        title: cleanOptional(entry.title),
        description: cleanOptional(entry.description),
        canonical: cleanOptional(entry.canonical),
        robots: normalizeRobots(entry.robots),
        ogImage: cleanOptional(entry.ogImage),
        ogType: normalizeOgType(entry.ogType),
        jsonLd: cleanOptional(entry.jsonLd),
        updatedAt: now,
    });

    const res = await db.query<SeoPageRow>(
        `
        INSERT INTO public.seo_pages (
            id,
            pathname,
            title,
            description,
            canonical,
            robots,
            og_image,
            og_type,
            json_ld,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (pathname) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            canonical = EXCLUDED.canonical,
            robots = EXCLUDED.robots,
            og_image = EXCLUDED.og_image,
            og_type = EXCLUDED.og_type,
            json_ld = EXCLUDED.json_ld,
            updated_at = EXCLUDED.updated_at
        RETURNING id, pathname, title, description, canonical, robots, og_image, og_type, json_ld, updated_at
        `,
        [
            validated.id,
            validated.pathname,
            validated.title ?? null,
            validated.description ?? null,
            validated.canonical ?? null,
            validated.robots,
            validated.ogImage ?? null,
            validated.ogType,
            validated.jsonLd ?? null,
            validated.updatedAt,
        ]
    );

    return mapRow(res.rows[0]);
}

async function migrateLegacyEntries() {
    const entries = await readLegacyEntries();

    for (const entry of entries) {
        await insertEntry({
            pathname: entry.pathname,
            title: entry.title,
            description: entry.description,
            canonical: entry.canonical,
            robots: entry.robots,
            ogImage: entry.ogImage,
            ogType: entry.ogType,
            jsonLd: entry.jsonLd,
        });
    }
}

async function seedRouteRegistryEntries() {
    for (const route of PUBLIC_SEO_ROUTES) {
        const robots = getRobotsDirectives(route.pathname).index ? 'index, follow' : 'noindex, nofollow';

        await insertEntry({
            pathname: route.pathname,
            title: route.title,
            description: route.description,
            robots,
            ogType: route.ogType || 'website',
        });
    }
}

async function ensureInitialized() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            await ensureTable();

            const existingCount = await countRows();
            if (existingCount > 0) {
                return;
            }

            await migrateLegacyEntries();

            const countAfterLegacy = await countRows();
            if (countAfterLegacy === 0) {
                await seedRouteRegistryEntries();
            }
        })().catch((error) => {
            initializationPromise = null;
            throw error;
        });
    }

    await initializationPromise;
}

export const seoStore = {
    async list(): Promise<SeoEntry[]> {
        markNoStore();
        await ensureInitialized();

        const res = await db.query<SeoPageRow>(
            `
            SELECT id, pathname, title, description, canonical, robots, og_image, og_type, json_ld, updated_at
            FROM public.seo_pages
            ORDER BY pathname ASC
            `
        );

        return res.rows.map(mapRow);
    },

    async getById(id: string): Promise<SeoEntry | undefined> {
        markNoStore();
        await ensureInitialized();

        const res = await db.query<SeoPageRow>(
            `
            SELECT id, pathname, title, description, canonical, robots, og_image, og_type, json_ld, updated_at
            FROM public.seo_pages
            WHERE id = $1
            LIMIT 1
            `,
            [id]
        );

        return res.rows[0] ? mapRow(res.rows[0]) : undefined;
    },

    async getByPath(pathname: string): Promise<SeoEntry | undefined> {
        markNoStore();
        await ensureInitialized();

        const res = await db.query<SeoPageRow>(
            `
            SELECT id, pathname, title, description, canonical, robots, og_image, og_type, json_ld, updated_at
            FROM public.seo_pages
            WHERE pathname = $1
            LIMIT 1
            `,
            [pathname]
        );

        return res.rows[0] ? mapRow(res.rows[0]) : undefined;
    },

    async upsert(entry: Partial<SeoEntry> & { pathname: string }): Promise<SeoEntry> {
        markNoStore();
        await ensureInitialized();

        const existingById = cleanOptional(entry.id)
            ? await seoStore.getById(entry.id as string)
            : undefined;

        if (existingById) {
            const now = new Date().toISOString();
            const merged = SeoEntrySchema.parse({
                ...existingById,
                ...entry,
                id: existingById.id,
                pathname: entry.pathname.trim(),
                title: cleanOptional(entry.title ?? existingById.title),
                description: cleanOptional(entry.description ?? existingById.description),
                canonical: cleanOptional(entry.canonical ?? existingById.canonical),
                robots: normalizeRobots(entry.robots ?? existingById.robots),
                ogImage: cleanOptional(entry.ogImage ?? existingById.ogImage),
                ogType: normalizeOgType(entry.ogType ?? existingById.ogType),
                jsonLd: cleanOptional(entry.jsonLd ?? existingById.jsonLd),
                updatedAt: now,
            });

            const res = await db.query<SeoPageRow>(
                `
                UPDATE public.seo_pages
                SET
                    pathname = $2,
                    title = $3,
                    description = $4,
                    canonical = $5,
                    robots = $6,
                    og_image = $7,
                    og_type = $8,
                    json_ld = $9,
                    updated_at = $10
                WHERE id = $1
                RETURNING id, pathname, title, description, canonical, robots, og_image, og_type, json_ld, updated_at
                `,
                [
                    merged.id,
                    merged.pathname,
                    merged.title ?? null,
                    merged.description ?? null,
                    merged.canonical ?? null,
                    merged.robots,
                    merged.ogImage ?? null,
                    merged.ogType,
                    merged.jsonLd ?? null,
                    merged.updatedAt,
                ]
            );

            return mapRow(res.rows[0]);
        }

        return insertEntry({
            id: cleanOptional(entry.id),
            pathname: entry.pathname,
            title: entry.title,
            description: entry.description,
            canonical: entry.canonical,
            robots: entry.robots,
            ogImage: entry.ogImage,
            ogType: entry.ogType,
            jsonLd: entry.jsonLd,
        });
    },

    async delete(id: string): Promise<void> {
        markNoStore();
        await ensureInitialized();

        await db.query('DELETE FROM public.seo_pages WHERE id = $1', [id]);
    },

    async syncPublicRoutes(): Promise<{ seeded: number }> {
        markNoStore();
        await ensureInitialized();

        const res = await db.query<{ pathname: string }>(
            'SELECT pathname FROM public.seo_pages WHERE pathname = ANY($1::text[])',
            [PUBLIC_SEO_ROUTES.map((route) => route.pathname)]
        );
        const existing = new Set(res.rows.map((row) => row.pathname));
        let seeded = 0;

        for (const route of PUBLIC_SEO_ROUTES) {
            if (existing.has(route.pathname)) {
                continue;
            }

            const robots = getRobotsDirectives(route.pathname).index ? 'index, follow' : 'noindex, nofollow';
            await insertEntry({
                pathname: route.pathname,
                title: route.title,
                description: route.description,
                robots,
                ogType: route.ogType || 'website',
            });
            seeded += 1;
        }

        return { seeded };
    },
};
