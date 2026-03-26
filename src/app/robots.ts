import { MetadataRoute } from 'next';

import { getRobotsDisallowList } from '@/lib/seo/indexability';
import { getSeoSiteContext } from '@/lib/seo/metadata';

export default async function robots(): Promise<MetadataRoute.Robots> {
    const site = await getSeoSiteContext();
    const isProduction = process.env.NODE_ENV === 'production';

    if (!isProduction) {
        return {
            rules: {
                userAgent: '*',
                disallow: '/',
            },
            sitemap: `${site.baseUrl}/sitemap.xml`,
            host: site.baseUrl,
        };
    }

    const aiDisallow = ['/superadmin/', '/api/', '/private/', '/inbox/', '/settings/', '/analytics/', '/crm/', '/campaigns/', '/automations/', '/team/'];
    const aiAllow = ['/', '/pricing', '/about', '/developer/', '/privacy', '/terms', '/creators'];

    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: getRobotsDisallowList(),
            },
            {
                userAgent: 'GPTBot',
                allow: aiAllow,
                disallow: aiDisallow,
            },
            {
                userAgent: 'ChatGPT-User',
                allow: aiAllow,
                disallow: aiDisallow,
            },
            {
                userAgent: 'Claude-Web',
                allow: aiAllow,
                disallow: aiDisallow,
            },
            {
                userAgent: 'PerplexityBot',
                allow: aiAllow,
                disallow: aiDisallow,
            },
            {
                userAgent: 'Googlebot',
                allow: '/',
                disallow: ['/superadmin/', '/api/', '/private/'],
            },
        ],
        sitemap: `${site.baseUrl}/sitemap.xml`,
        host: site.baseUrl,
    };
}
