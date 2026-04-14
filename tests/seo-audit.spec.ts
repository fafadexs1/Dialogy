import { expect, test } from '@playwright/test';

test.describe('Heavy SEO Audit - Google Search Compliance', () => {
    test.beforeEach(async ({ page }) => {
        // We use localhost:9002 because that is the port defined in package.json for dev:next
        await page.goto('http://localhost:9002');
    });

    test('Verification of Meta Tags', async ({ page }) => {
        const title = await page.title();
        console.log(`[SEO-AUDIT] Title: ${title}`);
        expect(title.toLowerCase()).toContain('chatbot');

        const description = await page.getAttribute('meta[name="description"]', 'content');
        console.log(`[SEO-AUDIT] Description: ${description}`);
        expect(description?.toLowerCase()).toContain('chatbot');

        const keywords = await page.getAttribute('meta[name="keywords"]', 'content');
        console.log(`[SEO-AUDIT] Keywords: ${keywords}`);
        expect(keywords?.toLowerCase()).toContain('chatbot');
    });

    test('Verification of Canonical URL', async ({ page }) => {
        const canonical = await page.getAttribute('link[rel="canonical"]', 'href');
        console.log(`[SEO-AUDIT] Canonical: ${canonical}`);
        expect(canonical).toBe('https://dialogy.klyraai.com.br/');
    });

    test('Verification of JSON-LD (Schema.org) Deduplication', async ({ page }) => {
        const jsonLdScripts = await page.locator('script[type="application/ld+json"]').all();
        console.log(`[SEO-AUDIT] Found ${jsonLdScripts.length} JSON-LD blocks.`);

        const contents = await Promise.all(jsonLdScripts.map(s => s.textContent()));
        
        let faqCount = 0;
        for (const content of contents) {
            if (content && content.includes('FAQPage')) {
                faqCount++;
            }
        }

        console.log(`[SEO-AUDIT] FAQPage blocks found: ${faqCount}`);
        expect(faqCount).toBeLessThanOrEqual(1);
    });

    test('Verification of Heading Structure', async ({ page }) => {
        const h1Count = await page.locator('h1').count();
        expect(h1Count).toBe(1);
        console.log(`[SEO-AUDIT] H1 check: ${h1Count} found.`);
    });

    test('Verification of Image Accessibility', async ({ page }) => {
        const images = await page.locator('img').all();
        for (const img of images) {
            const alt = await img.getAttribute('alt');
            const src = await img.getAttribute('src');
            if (!alt) {
                console.warn(`[SEO-AUDIT] Warning: Image without alt tag found: ${src}`);
            }
        }
    });
});
