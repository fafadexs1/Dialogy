import { describe, expect, it } from 'vitest';

import {
    buildGoogleAdsCustomerMatchCsv,
    normalizeGoogleAdsPhone,
    sanitizeGoogleAdsCsvFilename,
} from '@/lib/google-ads-customer-match';

describe('Google Ads Customer Match CSV', () => {
    it('uses accepted headers and normalizes Brazilian phones to E.164', () => {
        const result = buildGoogleAdsCustomerMatchCsv([
            {
                name: 'Maria Silva',
                email: ' Maria.Silva@Example.com ',
                phone_number_jid: '61995215930@s.whatsapp.net',
            },
        ]);

        expect(result.csv).toBe(
            'Email,Phone\nmaria.silva@example.com,+5561995215930'
        );
        expect(result.exportedCount).toBe(1);
        expect(result.skippedCount).toBe(0);
    });

    it('keeps one valid identifier and skips contacts without match data', () => {
        const result = buildGoogleAdsCustomerMatchCsv([
            { email: 'cliente@example.com' },
            { phone: '+55 (61) 99999-0000' },
            { email: 'email-invalido' },
            { name: 'Sem contato' },
        ]);

        expect(result.csv.split('\n')).toEqual([
            'Email,Phone',
            'cliente@example.com,',
            ',+5561999990000',
        ]);
        expect(result.exportedCount).toBe(2);
        expect(result.skippedCount).toBe(2);
    });

    it('removes device suffixes and creates a safe filename', () => {
        expect(normalizeGoogleAdsPhone('5561999990000:4@s.whatsapp.net'))
            .toBe('+5561999990000');
        expect(sanitizeGoogleAdsCsvFilename('Clientes Premium — São Paulo'))
            .toBe('clientes-premium-sao-paulo-google-ads.csv');
    });
});
