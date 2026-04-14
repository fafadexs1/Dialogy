import { describe, expect, it } from 'vitest';

import {
    HOME_SEO_KEYWORDS,
    HOME_SEO_TITLE,
} from '@/content/home-seo';
import { PUBLIC_SEO_ROUTES } from '@/lib/seo/route-registry';

describe('SEO Chatbot Keyword Verification', () => {
    it('should have "chatbot" in the Home SEO Title', () => {
        expect(HOME_SEO_TITLE.toLowerCase()).toContain('chatbot');
    });

    it('should have "chatbot" keywords in the home registry', () => {
        const homeRoute = PUBLIC_SEO_ROUTES.find(r => r.pathname === '/');
        expect(homeRoute?.keywords).toContain('chatbot para WhatsApp');
        expect(homeRoute?.keywords).toContain('chatbot inteligente');
    });

    it('should have a description that mentions chatbot', () => {
        const homeRoute = PUBLIC_SEO_ROUTES.find(r => r.pathname === '/');
        expect(homeRoute?.description.toLowerCase()).toContain('chatbot');
    });
});
