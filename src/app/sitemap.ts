import { MetadataRoute } from 'next';

import { getSeoSiteContext } from '@/lib/seo/metadata';
import { getIndexablePublicSeoRoutes } from '@/lib/seo/route-registry';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const site = await getSeoSiteContext();
    const lastModified = new Date();

    return getIndexablePublicSeoRoutes().map((route) => ({
        url: `${site.baseUrl}${route.pathname}`,
        lastModified,
        changeFrequency: route.changeFrequency,
        priority: route.priority,
    }));
}
