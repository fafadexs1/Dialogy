import 'dotenv/config';
import { db } from '../lib/db';

async function migrate() {
    console.log('[MIGRATE] Creating seo_pages table if not exists...');
    
    try {
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
        
        console.log('[MIGRATE] seo_pages table is ready.');

    } catch (e) {
        console.error('[MIGRATE] Failed:', e);
    } finally {
        process.exit(0);
    }
}

migrate();
