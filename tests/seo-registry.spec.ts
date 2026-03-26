import { describe, expect, it } from 'vitest';

import { getRobotsDirectives, isIndexablePath } from '@/lib/seo/indexability';
import { PUBLIC_SEO_ROUTES, getIndexablePublicSeoRoutes } from '@/lib/seo/route-registry';
import { getBreadcrumbSchema, getFaqSchema } from '@/lib/seo/schema';

describe('SEO route registry', () => {
    it('covers the main public routes with metadata defaults', () => {
        const paths = PUBLIC_SEO_ROUTES.map((route) => route.pathname);

        expect(paths).toEqual(expect.arrayContaining([
            '/',
            '/about',
            '/pricing',
            '/privacy',
            '/terms',
            '/developer',
            '/creators',
        ]));
    });

    it('keeps indexable routes unique and described', () => {
        const routes = getIndexablePublicSeoRoutes();
        const uniquePaths = new Set(routes.map((route) => route.pathname));

        expect(uniquePaths.size).toBe(routes.length);
        expect(routes.every((route) => route.title.length > 0 && route.description.length > 0)).toBe(true);
    });
});

describe('SEO indexability policy', () => {
    it('allows indexing on public money pages', () => {
        expect(isIndexablePath('/')).toBe(true);
        expect(isIndexablePath('/pricing')).toBe(true);
        expect(getRobotsDirectives('/developer')).toEqual({ index: true, follow: true });
    });

    it('blocks indexing on auth, app and api routes', () => {
        expect(isIndexablePath('/login')).toBe(false);
        expect(isIndexablePath('/settings/billing')).toBe(false);
        expect(isIndexablePath('/inbox/123')).toBe(false);
        expect(getRobotsDirectives('/api/user')).toEqual({ index: false, follow: false });
    });
});

describe('SEO structured data helpers', () => {
    it('builds breadcrumb schema with ordered items', () => {
        const schema = getBreadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Pricing', path: '/pricing' },
        ]);

        expect(schema['@type']).toBe('BreadcrumbList');
        expect(schema.itemListElement).toHaveLength(2);
        expect(schema.itemListElement[1].position).toBe(2);
    });

    it('builds faq schema with accepted answers', () => {
        const schema = getFaqSchema([
            { question: 'Existe trial?', answer: 'Sim, sete dias.' },
        ]);

        expect(schema['@type']).toBe('FAQPage');
        expect(schema.mainEntity[0].acceptedAnswer.text).toBe('Sim, sete dias.');
    });
});
