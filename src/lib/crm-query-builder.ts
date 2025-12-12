
import { Segment } from "./types";

export type Operator = 'equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'is_set' | 'is_not_set';
export type Field = 'name' | 'email' | 'phone_number_jid' | 'owner_id' | 'tags' | 'last_activity' | 'created_at' | 'status';

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
    return {
        text: `SELECT COUNT(*) as total FROM contacts c WHERE ${whereClause}`,
        values
    };
}

export function buildSegmentQuery(workspaceId: string, criteria?: CriteriaGroup, search?: string, limit = 50, offset = 0) {
    const { whereClause, values } = buildWhereClause(workspaceId, criteria, search);

    const query = `
        SELECT 
            c.*,
            (SELECT u.full_name FROM users u WHERE u.id = c.owner_id) as owner_name,
            (SELECT MAX(a.date) FROM activities a WHERE a.contact_id = c.id) as last_activity,
            COALESCE(
                (SELECT json_agg(json_build_object('id', t.id, 'label', t.label, 'value', t.value, 'color', t.color))
                 FROM tags t JOIN contact_tags ct ON t.id = ct.tag_id WHERE ct.contact_id = c.id),
                '[]'::json
            ) as tags
        FROM contacts c
        WHERE ${whereClause}
        ORDER BY c.created_at DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;

    return {
        text: query,
        values: [...values, limit, offset]
    };
}

function buildWhereClause(workspaceId: string, criteria?: CriteriaGroup, search?: string) {
    const values: any[] = [workspaceId];
    let whereParts = [`c.workspace_id = $1`];

    if (search) {
        values.push(`%${search.toLowerCase()}%`);
        whereParts.push(`(LOWER(c.name) LIKE $${values.length} OR LOWER(c.email) LIKE $${values.length})`);
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

    if (cond.field === 'last_activity') {
        // Subquery for max activity date
        field = `(SELECT MAX(date) FROM activities WHERE contact_id = c.id)`;
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
        case 'is_set':
            return `${field} IS NOT NULL`;
        case 'is_not_set':
            return `${field} IS NULL`;
        default:
            return '';
    }
}
