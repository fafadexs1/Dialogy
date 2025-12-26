import { z } from 'zod';

const urlOrPath = z.string().refine((value) => {
    if (!value) return true;
    if (value.startsWith('/')) return true;
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}, 'Invalid URL');

export const GlobalSeoSchema = z.object({
    siteName: z.string().min(1, 'Site name is required').max(50, 'Site name too long'),
    slogan: z.string().max(100, 'Slogan too long').optional(),
    titleTemplate: z.string().optional().describe('e.g. "%s | My Site"'),
    description: z.string().max(300).optional(),

    // Branding
    faviconUrl: urlOrPath.optional(),
    logoUrl: urlOrPath.optional(),

    // Theme
    themeColor: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'Invalid hex color').optional().or(z.literal('')),

    // Social
    defaultOgImage: urlOrPath.optional(),
    twitterHandle: z.string().optional(),
});

export type GlobalSeoSettings = z.infer<typeof GlobalSeoSchema>;
