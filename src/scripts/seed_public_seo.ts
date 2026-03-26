import 'dotenv/config';

import { randomUUID } from 'crypto';

import { GLOBAL_SEO_DB_DEFAULTS, getPublicSeoDbDefaults } from '@/content/seo-db-defaults';
import { db } from '@/lib/db';

async function ensureTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS public.seo_pages (
            id text PRIMARY KEY,
            pathname text UNIQUE NOT NULL,
            title text,
            description text,
            canonical text,
            robots text NOT NULL DEFAULT 'index, follow',
            og_image text,
            og_type text NOT NULL DEFAULT 'website',
            json_ld text,
            updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
        );

        CREATE INDEX IF NOT EXISTS idx_seo_pages_pathname ON public.seo_pages(pathname);
    `);
}

async function main() {
    await ensureTable();
    const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const routes = getPublicSeoDbDefaults(baseUrl);

    await db.query(
        `
        INSERT INTO system_settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = NOW()
        `,
        ['global_seo_settings', JSON.stringify(GLOBAL_SEO_DB_DEFAULTS)]
    );

    let synced = 0;

    for (const route of routes) {
        const res = await db.query(
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
            RETURNING id
            `,
            [
                randomUUID(),
                route.pathname,
                route.title,
                route.description,
                route.canonical,
                route.robots,
                route.ogImage,
                route.ogType,
                route.jsonLd,
                new Date().toISOString(),
            ]
        );

        if (res.rowCount) {
            synced += 1;
        }
    }

    const total = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.seo_pages');

    console.log('[SEO] Global settings synced: 1');
    console.log(`[SEO] Public routes synced: ${synced}`);
    console.log(`[SEO] Total SEO entries in database: ${total.rows[0]?.count ?? '0'}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[SEO] Failed to seed public SEO entries:', error);
        process.exit(1);
    });
