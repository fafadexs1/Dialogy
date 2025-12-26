import 'server-only';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { unstable_noStore as noStore } from 'next/cache';
import { db } from '@/lib/db';
import { GlobalSeoSettings, GlobalSeoSchema } from '@/types/seo-global';

const SETTINGS_KEY = 'global_seo_settings';
const LEGACY_FILE = path.join(process.cwd(), 'data', 'seo', 'global.json');

const DEFAULT_SETTINGS: GlobalSeoSettings = {
    siteName: 'My Application',
    titleTemplate: '%s | My Application',
    slogan: '',
    description: '',
    faviconUrl: '',
    themeColor: '#ffffff',
};

type GlobalSeoRecord = {
    settings: GlobalSeoSettings;
    updatedAt: string | null;
};

function parseSettings(raw: unknown): GlobalSeoSettings {
    if (!raw || typeof raw !== 'object') {
        return DEFAULT_SETTINGS;
    }
    const merged = { ...DEFAULT_SETTINGS, ...(raw as Partial<GlobalSeoSettings>) };
    const parsed = GlobalSeoSchema.safeParse(merged);
    if (!parsed.success) {
        console.error('[GlobalSeoStore] Invalid settings payload:', parsed.error);
        return DEFAULT_SETTINGS;
    }
    return parsed.data;
}

async function readLegacySettings(): Promise<GlobalSeoSettings | null> {
    if (!existsSync(LEGACY_FILE)) {
        return null;
    }
    try {
        const data = await fs.readFile(LEGACY_FILE, 'utf-8');
        if (!data) return null;
        const parsed = JSON.parse(data);
        return parseSettings(parsed);
    } catch (error) {
        console.error('[GlobalSeoStore] Failed to read legacy settings:', error);
        return null;
    }
}

export const globalSeoStore = {
    get: async (): Promise<GlobalSeoSettings> => {
        const record = await globalSeoStore.getWithMeta();
        return record.settings;
    },

    getWithMeta: async (): Promise<GlobalSeoRecord> => {
        noStore();
        try {
            const res = await db.query(
                'SELECT value, updated_at FROM system_settings WHERE key = $1',
                [SETTINGS_KEY]
            );
            if (res.rowCount === 0) {
                const legacy = await readLegacySettings();
                if (legacy) {
                    try {
                        await globalSeoStore.save(legacy);
                    } catch (error) {
                        console.error('[GlobalSeoStore] Failed to migrate legacy settings:', error);
                    }
                    return { settings: legacy, updatedAt: new Date().toISOString() };
                }
                return { settings: DEFAULT_SETTINGS, updatedAt: null };
            }

            const rawValue = res.rows[0]?.value;
            const updatedAt = res.rows[0]?.updated_at
                ? new Date(res.rows[0].updated_at).toISOString()
                : null;

            if (!rawValue) {
                return { settings: DEFAULT_SETTINGS, updatedAt };
            }

            try {
                const parsed = JSON.parse(rawValue);
                return { settings: parseSettings(parsed), updatedAt };
            } catch (error) {
                console.error('[GlobalSeoStore] Failed to parse stored settings:', error);
                return { settings: DEFAULT_SETTINGS, updatedAt };
            }
        } catch (e) {
            console.error('[GlobalSeoStore] Error reading settings from DB:', e);
            return { settings: DEFAULT_SETTINGS, updatedAt: null };
        }
    },

    save: async (settings: GlobalSeoSettings): Promise<void> => {
        const validData = GlobalSeoSchema.parse(settings);
        await db.query(
            `
            INSERT INTO system_settings (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
            `,
            [SETTINGS_KEY, JSON.stringify(validData)]
        );
    }
};
