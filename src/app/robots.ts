import { MetadataRoute } from 'next';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const isProduction = process.env.NODE_ENV === 'production';

    if (!isProduction) {
        return {
            rules: {
                userAgent: '*',
                disallow: '/',
            },
            sitemap: `${baseUrl}/sitemap.xml`,
        };
    }

    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/superadmin/', '/api/', '/private/'],
        },
        sitemap: `${baseUrl}/sitemap.xml`,
    };
}
