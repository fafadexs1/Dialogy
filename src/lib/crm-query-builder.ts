
import { Segment } from "./types";

export type Operator = 'equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'between' | 'is_set' | 'is_not_set';
export type Field = 'name' | 'email' | 'phone_number_jid' | 'owner_id' | 'tags' | 'last_activity' | 'contacted_at' | 'created_at' | 'status' | string;

export interface Condition {
    field: Field;
    operator: Operator;
    value?: any;
}

export interface CriteriaGroup {
    operator: 'AND' | 'OR';
    conditions: (Condition | CriteriaGroup)[];
}

export function buildCountQuery(workspaceId: string, criteria?: CriteriaGroup, search?: string) {
    const { whereClause, values } = buildWhereClause(workspaceId, criteria, search);
    const dedupeKeyExpression = buildContactDedupeKeyExpression('c');
    const lastActivityExpression = buildLastActivityExpression('c');

    return {
        text: `
            WITH ranked_contacts AS (
                SELECT
                    c.id,
                    ROW_NUMBER() OVER (
                        PARTITION BY ${dedupeKeyExpression}
                        ORDER BY ${lastActivityExpression} DESC NULLS LAST, c.created_at DESC NULLS LAST, c.id DESC
                    ) AS rn
                FROM contacts c
                WHERE ${whereClause}
            )
            SELECT COUNT(*) as total
            FROM ranked_contacts
            WHERE rn = 1
        `,
        values
    };
}

export function buildSegmentQuery(workspaceId: string, criteria?: CriteriaGroup, search?: string, limit = 50, offset = 0) {
    const { whereClause, values } = buildWhereClause(workspaceId, criteria, search);
    const lastActivityExpression = buildLastActivityExpression('c');
    const dedupeKeyExpression = buildContactDedupeKeyExpression('c');

    const query = `
        WITH ranked_contacts AS (
        SELECT 
            c.*,
            (SELECT u.full_name FROM users u WHERE u.id = c.owner_id) as owner_name,
            ${lastActivityExpression} as last_activity,
            COALESCE(
                (SELECT json_agg(json_build_object('id', t.id, 'label', t.label, 'value', t.value, 'color', t.color))
                 FROM tags t JOIN contact_tags ct ON t.id = ct.tag_id WHERE ct.contact_id = c.id),
                '[]'::json
            ) as tags,
            ROW_NUMBER() OVER (
                PARTITION BY ${dedupeKeyExpression}
                ORDER BY ${lastActivityExpression} DESC NULLS LAST, c.created_at DESC NULLS LAST, c.id DESC
            ) AS rn
        FROM contacts c
        WHERE ${whereClause}
        )
        SELECT *
        FROM ranked_contacts
        WHERE rn = 1
        ORDER BY last_activity DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;

    return {
        text: query,
        values: [...values, limit, offset]
    };
}

function buildContactDedupeKeyExpression(contactAlias = 'c'): string {
    return `COALESCE(
        NULLIF(
            regexp_replace(
                COALESCE(${contactAlias}.phone_canonical, ${contactAlias}.phone_number_jid, ${contactAlias}.phone, ''),
                '[^0-9]',
                '',
                'g'
            ),
            ''
        ),
        ${contactAlias}.id::text
    )`;
}

function buildLastActivityExpression(contactAlias = 'c'): string {
    return `(
        SELECT MAX(activity_at)
        FROM (
            SELECT MAX(a.date)::timestamptz AS activity_at
            FROM activities a
            WHERE a.contact_id = ${contactAlias}.id
            UNION ALL
            SELECT MAX(m.created_at)::timestamptz AS activity_at
            FROM chats ch
            JOIN messages m
              ON m.chat_id = ch.id
             AND m.workspace_id = ch.workspace_id
            WHERE ch.workspace_id = ${contactAlias}.workspace_id
              AND ch.contact_id = ${contactAlias}.id
            UNION ALL
            SELECT MAX(ch.last_activity_at)::timestamptz AS activity_at
            FROM chats ch
            WHERE ch.workspace_id = ${contactAlias}.workspace_id
              AND ch.contact_id = ${contactAlias}.id
        ) activity_sources
    )`;
}

function buildWhereClause(workspaceId: string, criteria?: CriteriaGroup, search?: string) {
    const values: any[] = [workspaceId];
    let whereParts = [`c.workspace_id = $1`];

    if (search) {
        values.push(`%${search.toLowerCase()}%`);
        const textParam = values.length;
        const digits = search.replace(/\D/g, '');
        if (digits.length >= 3) {
            values.push(`%${digits}%`);
            whereParts.push(`(
                LOWER(c.name) LIKE $${textParam}
                OR LOWER(c.email) LIKE $${textParam}
                OR LOWER(COALESCE(c.phone_number_jid, '')) LIKE $${textParam}
                OR LOWER(COALESCE(c.phone, '')) LIKE $${textParam}
                OR regexp_replace(COALESCE(c.phone_number_jid, c.phone, ''), '[^0-9]', '', 'g') LIKE $${values.length}
            )`);
        } else {
            whereParts.push(`(
                LOWER(c.name) LIKE $${textParam}
                OR LOWER(c.email) LIKE $${textParam}
                OR LOWER(COALESCE(c.phone_number_jid, '')) LIKE $${textParam}
                OR LOWER(COALESCE(c.phone, '')) LIKE $${textParam}
            )`);
        }
    }

    if (criteria && criteria.conditions.length > 0) {
        const { sql, newValues } = processGroup(criteria, values);
        if (sql) {
            whereParts.push(`(${sql})`);
        }
    }

    return { whereClause: whereParts.join(' AND '), values };
}

function processGroup(group: CriteriaGroup, currentValues: any[]): { sql: string, newValues: any[] } {
    const parts: string[] = [];

    for (const condition of group.conditions) {
        if ('conditions' in condition) {
            // Nested Group
            const res = processGroup(condition as CriteriaGroup, currentValues);
            if (res.sql) parts.push(`(${res.sql})`);
        } else {
            // Leaf Condition
            const cond = condition as Condition;
            const sql = processCondition(cond, currentValues);
            if (sql) parts.push(sql);
        }
    }

    if (parts.length === 0) return { sql: '', newValues: currentValues };
    return { sql: parts.join(` ${group.operator} `), newValues: currentValues };
}

function processCondition(cond: Condition, values: any[]): string {
    let field = `c.${cond.field}`;

    // Special field handling
    if (cond.field === 'tags') {
        // Tag filtering usually uses EXISTS or JOIN. For dynamic WHERE, subquery is easiest
        // "EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON ct.tag_id = t.id WHERE ct.contact_id = c.id AND t.value = ?)"
        values.push(cond.value);
        return `EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON ct.tag_id = t.id WHERE ct.contact_id = c.id AND t.value = $${values.length})`;
    }

    if (cond.field === 'last_activity' || cond.field === 'contacted_at') {
        field = buildLastActivityExpression('c');
    }

    // Custom Fields
    if (cond.field.startsWith('custom_field_')) {
        const fieldId = cond.field.replace('custom_field_', '');
        // Generic subquery for custom fields
        // EXISTS (SELECT 1 FROM contact_custom_field_values ccfv WHERE ccfv.contact_id = c.id AND ccfv.field_id = '...' AND ccfv.value [OP] ...)

        let valueCondition = '';
        if (cond.operator === 'is_set') {
            valueCondition = `ccfv.value IS NOT NULL AND ccfv.value != ''`;
        } else if (cond.operator === 'is_not_set') {
            // This is tricky because "not set" usually means no row exists.
            // OR row exists but value is empty.
            // NOT EXISTS (...)
            return `NOT EXISTS (SELECT 1 FROM contact_custom_field_values ccfv WHERE ccfv.contact_id = c.id AND ccfv.field_id = '${fieldId}' AND ccfv.value IS NOT NULL AND ccfv.value != '')`;
        } else {
            if (cond.operator === 'equals') {
                values.push(cond.value);
                valueCondition = `ccfv.value = $${values.length}`;
            } else if (cond.operator === 'contains') {
                values.push(`%${cond.value}%`);
                valueCondition = `ccfv.value ILIKE $${values.length}`;
            } else if (cond.operator === 'gt') { // For simplicity treat as string or cast if we knew type
                values.push(cond.value);
                valueCondition = `ccfv.value > $${values.length}`;
            } else if (cond.operator === 'lt') {
                values.push(cond.value);
                valueCondition = `ccfv.value < $${values.length}`;
            }
        }

        if (valueCondition) {
            return `EXISTS (SELECT 1 FROM contact_custom_field_values ccfv WHERE ccfv.contact_id = c.id AND ccfv.field_id = '${fieldId}' AND ${valueCondition})`;
        }
        return '';
    }

    switch (cond.operator) {
        case 'equals':
            values.push(cond.value);
            return `${field} = $${values.length}`;
        case 'contains':
            values.push(`%${cond.value}%`);
            return `${field} ILIKE $${values.length}`;
        case 'gt':
            values.push(cond.value);
            return `${field} > $${values.length}`;
        case 'lt':
            values.push(cond.value);
            return `${field} < $${values.length}`;
        case 'gte':
            values.push(cond.value);
            return `${field} >= $${values.length}`;
        case 'lte':
            values.push(cond.value);
            return `${field} <= $${values.length}`;
        case 'between': {
            const from = cond.value?.from;
            const to = cond.value?.to;
            if (!from && !to) return '';
            if (from && to) {
                values.push(from, to);
                return `${field} >= $${values.length - 1}::date AND ${field} < ($${values.length}::date + INTERVAL '1 day')`;
            }
            values.push(from || to);
            return from
                ? `${field} >= $${values.length}::date`
                : `${field} < ($${values.length}::date + INTERVAL '1 day')`;
        }
        case 'is_set':
            return `${field} IS NOT NULL`;
        case 'is_not_set':
            return `${field} IS NULL`;
        default:
            return '';
    }
}
