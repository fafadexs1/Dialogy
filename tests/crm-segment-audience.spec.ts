import { describe, expect, it } from 'vitest';

import {
    buildSegmentAudienceQuery,
    combineSegmentCriteria,
    type CriteriaGroup,
} from '@/lib/crm-query-builder';

describe('CRM segment audiences', () => {
    it('combines multiple personalized lists with OR semantics', () => {
        const first: CriteriaGroup = {
            operator: 'AND',
            conditions: [{ field: 'tags', operator: 'equals', value: 'vip' }],
        };
        const second: CriteriaGroup = {
            operator: 'AND',
            conditions: [{ field: 'email', operator: 'is_set' }],
        };

        expect(combineSegmentCriteria([first, second])).toEqual({
            operator: 'OR',
            conditions: [first, second],
        });
    });

    it('can resolve a complete audience without browser pagination', () => {
        const query = buildSegmentAudienceQuery(
            'workspace-id',
            {
                operator: 'AND',
                conditions: [{ field: 'email', operator: 'is_set' }],
            }
        );

        expect(query.text).not.toMatch(/\bLIMIT\b/);
        expect(query.text).not.toMatch(/\bOFFSET\b/);
        expect(query.values).toEqual(['workspace-id']);
    });
});
