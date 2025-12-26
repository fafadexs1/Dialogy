import { MetadataRoute } from 'next';
import { seoStore } from '@/services/seo-store';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const entries = await seoStore.list();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const sitemapEntries: MetadataRoute.Sitemap = entries
        .filter((entry) => !entry.robots.includes('noindex'))
        .map((entry) => ({
            url: `${baseUrl}${entry.pathname}`,
            lastModified: entry.updatedAt,
            changeFrequency: 'weekly',
            priority: entry.pathname === '/' ? 1.0 : 0.8,
        }));

    return sitemapEntries;
}
