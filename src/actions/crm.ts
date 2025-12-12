
'use server';

import { db } from '@/lib/db';
import type { Contact, Tag, User, Activity, CustomFieldDefinition, SelectableOption } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { withDebug } from '@/lib/observability/logger';

async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2
    `, [userId, workspaceId]);
    return (res.rowCount || 0) > 0;
}


import { buildCountQuery, buildSegmentQuery, CriteriaGroup } from '@/lib/crm-query-builder';
import { Segment } from '@/lib/types';

export async function getContacts(
    workspaceId: string,
    params: {
        page?: number;
        limit?: number;
        segmentId?: string;
        criteria?: CriteriaGroup;
        search?: string;
    } = {}
): Promise<{ contacts: Contact[] | null, total: number, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { contacts: null, total: 0, error: "Usuário não autenticado." };

    if (!await hasPermission(user.id, workspaceId, 'crm:view')) {
        return { contacts: null, total: 0, error: "Acesso não autorizado." };
    }

    try {
        let criteria = params.criteria;

        // If segmentId provided, fetch criteria from DB
        if (params.segmentId) {
            const segmentRes = await db.query('SELECT criteria FROM crm_segments WHERE id = $1 AND workspace_id = $2', [params.segmentId, workspaceId]);
            if (segmentRes.rows.length > 0) {
                params.criteria = segmentRes.rows[0].criteria;
                criteria = params.criteria;
            }
        }

        const page = params.page || 1;
        const limit = params.limit || 50;
        const offset = (page - 1) * limit;

        const countQuery = buildCountQuery(workspaceId, criteria, params.search);
        const dataQuery = buildSegmentQuery(workspaceId, criteria, params.search, limit, offset);

        const [countRes, dataRes] = await Promise.all([
            db.query(countQuery.text, countQuery.values),
            db.query(dataQuery.text, dataQuery.values)
        ]);

        const contacts: Contact[] = dataRes.rows.map(row => ({
            ...row,
            owner: row.owner_id ? { id: row.owner_id, name: row.owner_name } : undefined,
        }));

        return { contacts, total: parseInt(countRes.rows[0].total) };
    } catch (error) {
        console.error("[GET_CONTACTS] Error:", error);
        return { contacts: null, total: 0, error: "Falha ao buscar contatos." };
    }
}

export const createSegment = withDebug(
    'create_segment',
    async function createSegment(
        workspaceId: string,
        name: string,
        description: string | null,
        criteria: CriteriaGroup
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
            return { success: false, error: "Você não tem permissão para criar segmentos." };
        }

        try {
            await db.query(
                'INSERT INTO crm_segments (workspace_id, name, description, criteria) VALUES ($1, $2, $3, $4)',
                [workspaceId, name, description, JSON.stringify(criteria)]
            );
            revalidatePath('/crm');
            return { success: true };
        } catch (error) {
            console.error("[CREATE_SEGMENT] Error:", error);
            return { success: false, error: "Falha ao criar segmento." };
        }
    },
    {
        contextResolver: (workspaceId, name) => ({ payload: { workspaceId, name } })
    }
);

export async function getSegments(workspaceId: string): Promise<{ segments: Segment[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { segments: null, error: "Usuário não autenticado." };

    try {
        const res = await db.query('SELECT * FROM crm_segments WHERE workspace_id = $1 ORDER BY name', [workspaceId]);
        return { segments: res.rows };
    } catch (error) {
        console.error("[GET_SEGMENTS] Error:", error);
        return { segments: null, error: "Falha ao buscar segmentos." };
    }
}


export const saveContactAction = withDebug(
    'save_contact',
    async function saveContactAction(prevState: any, formData: FormData): Promise<{ success: boolean; error?: string | null; }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        const workspaceId = formData.get('workspaceId') as string;
        if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
            return { success: false, error: "Você não tem permissão para editar contatos." };
        }

        const id = formData.get('id') as string | null;
        let ownerId = formData.get('owner_id') as string;
        if (ownerId === 'unassigned') {
            ownerId = ''; // Set to empty string to be saved as NULL
        }

        const data = {
            name: formData.get('name') as string,
            email: formData.get('email') as string || null,
            phone_number_jid: formData.get('phone_number_jid') as string || null,
            address: formData.get('address') as string || null,
            owner_id: ownerId || null,
            avatar_url: formData.get('avatar_url') as string || null,
        };

        const tagIds = formData.getAll('tags') as string[];

        const customFields: Record<string, string> = {};
        for (const [key, value] of formData.entries()) {
            if (key.startsWith('custom_field_')) {
                const fieldId = key.replace('custom_field_', '');
                customFields[fieldId] = value as string;
            }
        }


        const client = await db.connect();
        try {
            await client.query('BEGIN');

            let contactId = id;

            if (id) { // Update
                await client.query(
                    `UPDATE contacts 
                 SET name = $1, email = $2, phone_number_jid = $3, address = $4, owner_id = $5, avatar_url = $6
                 WHERE id = $7 AND workspace_id = $8`,
                    [data.name, data.email, data.phone_number_jid, data.address, data.owner_id, data.avatar_url, id, workspaceId]
                );
            } else { // Create
                const res = await client.query(
                    `INSERT INTO contacts (workspace_id, name, email, phone_number_jid, address, owner_id, avatar_url) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                    [workspaceId, data.name, data.email, data.phone_number_jid, data.address, data.owner_id, data.avatar_url]
                );
                contactId = res.rows[0].id;
            }

            if (!contactId) throw new Error('Falha ao obter o ID do contato.');

            // Update tags
            await client.query('DELETE FROM contact_tags WHERE contact_id = $1', [contactId]);
            if (tagIds.length > 0 && tagIds[0]) {
                const tagValues = tagIds.map(tagId => `('${contactId}', '${tagId}')`).join(',');
                await client.query(`INSERT INTO contact_tags (contact_id, tag_id) VALUES ${tagValues}`);
            }

            // Update custom fields
            await client.query('DELETE FROM contact_custom_field_values WHERE contact_id = $1', [contactId]);
            for (const [fieldId, value] of Object.entries(customFields)) {
                if (value) { // Only save if there's a value
                    await client.query(
                        'INSERT INTO contact_custom_field_values (contact_id, field_id, value) VALUES ($1, $2, $3)',
                        [contactId, fieldId, value]
                    );
                }
            }


            await client.query('COMMIT');
            // revalidatePath('/crm'); // Removed to prevent full page reload on inbox
            // revalidatePath('/chat'); 
            return { success: true, error: null };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("[SAVE_CONTACT] Error:", error);
            return { success: false, error: "Falha ao salvar contato no banco de dados." };
        } finally {
            client.release();
        }
    },
    {
        contextResolver: (prevState, formData) => ({
            payload: {
                id: formData.get('id'),
                name: formData.get('name'),
                email: formData.get('email')
            }
        })
    }
);

export const deleteContactAction = withDebug(
    'delete_contact',
    async function deleteContactAction(contactId: string): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const contactRes = await client.query('SELECT workspace_id FROM contacts WHERE id = $1', [contactId]);
            if (contactRes.rowCount === 0) return { success: false, error: "Contato não encontrado." };
            const { workspace_id } = contactRes.rows[0];

            if (!await hasPermission(user.id, workspace_id, 'crm:delete')) {
                await client.query('ROLLBACK');
                return { success: false, error: "Você não tem permissão para excluir contatos." };
            }

            await client.query('DELETE FROM contact_tags WHERE contact_id = $1', [contactId]);
            await client.query('DELETE FROM activities WHERE contact_id = $1', [contactId]);
            await client.query('DELETE FROM contact_custom_field_values WHERE contact_id = $1', [contactId]);
            await client.query('DELETE FROM contacts WHERE id = $1', [contactId]);

            await client.query('COMMIT');
            revalidatePath('/crm');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("[DELETE_CONTACT] Error:", error);
            return { success: false, error: "Falha ao excluir o contato." };
        } finally {
            client.release();
        }
    },
    {
        contextResolver: (contactId) => ({ payload: { contactId } })
    }
);

// --- TAGS ACTIONS ---

export async function getTags(workspaceId: string): Promise<{ tags: Tag[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { tags: null, error: "Usuário não autenticado." };

    try {
        const res = await db.query('SELECT id, label, value, color, is_close_reason FROM tags WHERE workspace_id = $1 ORDER BY label', [workspaceId]);
        return { tags: res.rows };
    } catch (error) {
        console.error("[GET_TAGS] Error:", error);
        return { tags: null, error: "Falha ao buscar as etiquetas." };
    }
}

export const createTag = withDebug(
    'create_tag',
    async function createTag(
        workspaceId: string,
        label: string,
        color: string,
        isCloseReason: boolean
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        // Basic permission check
        if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
            return { success: false, error: "Você não tem permissão para criar etiquetas." };
        }

        const value = label.trim().toLowerCase().replace(/\s+/g, '_');

        try {
            await db.query(
                'INSERT INTO tags (workspace_id, label, value, color, is_close_reason) VALUES ($1, $2, $3, $4, $5)',
                [workspaceId, label, value, color, isCloseReason]
            );
            revalidatePath('/crm');
            return { success: true };
        } catch (error) {
            console.error("[CREATE_TAG] Error:", error);
            return { success: false, error: "Falha ao criar etiqueta." };
        }
    },
    {
        contextResolver: (workspaceId, label) => ({ payload: { workspaceId, label } })
    }
);


export const updateTag = withDebug(
    'update_tag',
    async function updateTag(
        tagId: string,
        label: string,
        color: string,
        isCloseReason: boolean
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        try {
            const tagRes = await db.query('SELECT workspace_id FROM tags WHERE id = $1', [tagId]);
            if (tagRes.rowCount === 0) return { success: false, error: "Etiqueta não encontrada." };
            const workspaceId = tagRes.rows[0].workspace_id;

            if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
                return { success: false, error: "Você não tem permissão para editar etiquetas." };
            }

            const value = label.trim().toLowerCase().replace(/\s+/g, '_');

            await db.query(
                'UPDATE tags SET label = $1, value = $2, color = $3, is_close_reason = $4 WHERE id = $5',
                [label, value, color, isCloseReason, tagId]
            );
            revalidatePath('/crm');
            return { success: true };
        } catch (error) {
            console.error("[UPDATE_TAG] Error:", error);
            return { success: false, error: "Falha ao atualizar etiqueta." };
        }
    },
    {
        contextResolver: (tagId, label) => ({ payload: { tagId, label } })
    }
);


export const deleteTag = withDebug(
    'delete_tag',
    async function deleteTag(tagId: string): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        try {
            const tagRes = await db.query('SELECT workspace_id FROM tags WHERE id = $1', [tagId]);
            if (tagRes.rowCount === 0) return { success: false, error: "Etiqueta não encontrada." };
            const workspaceId = tagRes.rows[0].workspace_id;

            if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
                return { success: false, error: "Você não tem permissão para apagar etiquetas." };
            }

            await db.query('DELETE FROM tags WHERE id = $1', [tagId]);
            revalidatePath('/crm');
            return { success: true };
        } catch (error) {
            console.error("[DELETE_TAG] Error:", error);
            return { success: false, error: "Falha ao apagar etiqueta." };
        }
    },
    {
        contextResolver: (tagId) => ({ payload: { tagId } })
    }
);



// --- END TAGS ---


// --- CUSTOM FIELDS ---

export async function getCustomFieldDefinitions(workspaceId: string): Promise<{ fields: CustomFieldDefinition[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { fields: null, error: "Usuário não autenticado." };

    try {
        const res = await db.query('SELECT id, label, type, placeholder, options FROM custom_field_definitions WHERE workspace_id = $1 ORDER BY label', [workspaceId]);
        const fields: CustomFieldDefinition[] = res.rows.map(row => ({
            ...row,
            options: typeof row.options === 'string' ? JSON.parse(row.options) : row.options
        }));
        return { fields };
    } catch (error) {
        console.error("[GET_CUSTOM_FIELDS] Error:", error);
        return { fields: null, error: "Falha ao buscar os campos personalizados." };
    }
}

export const createCustomFieldDefinition = withDebug(
    'create_custom_field',
    async function createCustomFieldDefinition(
        workspaceId: string,
        field: Omit<CustomFieldDefinition, 'id' | 'workspace_id'>
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
            return { success: false, error: "Você não tem permissão para criar campos." };
        }

        try {
            await db.query(
                'INSERT INTO custom_field_definitions (workspace_id, label, type, placeholder, options) VALUES ($1, $2, $3, $4, $5)',
                [workspaceId, field.label, field.type, field.placeholder, field.options ? JSON.stringify(field.options) : '[]']
            );
            revalidatePath('/crm');
            return { success: true };
        } catch (error) {
            console.error("[CREATE_CUSTOM_FIELD] Error:", error);
            return { success: false, error: "Falha ao criar campo personalizado." };
        }
    },
    {
        contextResolver: (workspaceId, field) => ({ payload: { workspaceId, label: field.label } })
    }
);


export const deleteCustomFieldDefinition = withDebug(
    'delete_custom_field',
    async function deleteCustomFieldDefinition(fieldId: string): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        try {
            const fieldRes = await db.query('SELECT workspace_id FROM custom_field_definitions WHERE id = $1', [fieldId]);
            if (fieldRes.rowCount === 0) return { success: false, error: "Campo não encontrado." };
            const workspaceId = fieldRes.rows[0].workspace_id;

            if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
                return { success: false, error: "Você não tem permissão para apagar campos." };
            }

            await db.query('DELETE FROM custom_field_definitions WHERE id = $1', [fieldId]);
            revalidatePath('/crm');
            return { success: true };
        } catch (error) {
            console.error("[DELETE_CUSTOM_FIELD] Error:", error);
            return { success: false, error: "Falha ao apagar campo personalizado." };
        }
    },
    {
        contextResolver: (fieldId) => ({ payload: { fieldId } })
    }
);


// --- END CUSTOM FIELDS ---


export async function getWorkspaceUsers(workspaceId: string): Promise<{ users: User[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { users: null, error: "Usuário não autenticado." };

    try {
        const res = await db.query(`
            SELECT u.id, u.full_name as name, u.avatar_url as avatar, u.email
            FROM users u
            JOIN user_workspace_roles uwr ON u.id = uwr.user_id
            WHERE uwr.workspace_id = $1
            ORDER BY u.full_name
        `, [workspaceId]);
        return { users: res.rows };
    } catch (error) {
        console.error("[GET_WORKSPACE_USERS] Error:", error);
        return { users: null, error: "Falha ao buscar usuários do workspace." };
    }
}


export const addActivityAction = withDebug(
    'add_activity',
    async function addActivityAction(
        prevState: any,
        formData: FormData
    ): Promise<{ success: boolean; error?: string | null; }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        const contactId = formData.get('contactId') as string;

        // Tratamento especial para o formulário de tentativa de contato
        const outcome = formData.get('outcome') as string;
        let notes = formData.get('notes') as string;
        if (outcome) {
            let formattedNotes = `Resultado: ${outcome.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
            if (notes) {
                formattedNotes += ` - Notas: ${notes}`;
            }
            notes = formattedNotes;
        }


        const activity: Omit<Activity, 'id'> = {
            contact_id: contactId,
            type: formData.get('type') as Activity['type'],
            notes: notes,
            date: new Date().toISOString(),
            user_id: user.id,
        };

        if (!contactId || !activity.type || !activity.notes) {
            return { success: false, error: "Dados da atividade incompletos." }
        }

        try {
            const contactRes = await db.query('SELECT workspace_id FROM contacts WHERE id = $1', [contactId]);
            if (contactRes.rowCount === 0) return { success: false, error: "Contato não encontrado." };
            const { workspace_id } = contactRes.rows[0];

            if (!await hasPermission(user.id, workspace_id, 'crm:edit')) {
                return { success: false, error: "Você não tem permissão para adicionar atividades." };
            }

            await db.query(
                'INSERT INTO activities (contact_id, user_id, type, notes, date) VALUES ($1, $2, $3, $4, $5)',
                [activity.contact_id, activity.user_id, activity.type, activity.notes, activity.date]
            );

            revalidatePath('/crm');
            revalidatePath(`/api/chats/${workspace_id}`);
            return { success: true, error: null };
        } catch (error) {
            console.error("[ADD_ACTIVITY] Error:", error);
            return { success: false, error: "Falha ao registrar atividade." };
        }
    },
    {
        contextResolver: (prevState, formData) => ({
            payload: {
                contactId: formData.get('contactId'),
                type: formData.get('type')
            }
        })
    }
);

export async function getContactStatistics(contactId: string): Promise<{
    stats: {
        totalChats: number;
        totalNotes: number;
        lastContactDate: string | null;
        closeReasons: { tag: string; color: string; count: number }[];
        activities: Activity[];
    } | null;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { stats: null, error: "Usuário não autenticado." };

    const client = await db.connect();
    try {
        const contactRes = await client.query('SELECT workspace_id FROM contacts WHERE id = $1', [contactId]);
        if (contactRes.rowCount === 0) return { stats: null, error: "Contato não encontrado." };
        const { workspace_id } = contactRes.rows[0];

        if (!await hasPermission(user.id, workspace_id, 'crm:view')) {
            return { stats: null, error: "Acesso não autorizado." };
        }

        // 1. Total Chats & Last Contact
        const chatsRes = await client.query(`
            SELECT 
                COUNT(*) as total,
                MAX(created_at) as last_contact
            FROM chats 
            WHERE contact_id = $1
        `, [contactId]);

        const totalChats = parseInt(chatsRes.rows[0].total || '0');
        const lastContactDate = chatsRes.rows[0].last_contact;

        // 2. Close Reasons Distribution
        const reasonsRes = await client.query(`
            SELECT 
                t.label as tag,
                t.color,
                COUNT(*) as count
            FROM chats c
            JOIN tags t ON c.close_reason_tag_id = t.id
            WHERE c.contact_id = $1 AND c.status = 'encerrados'
            GROUP BY t.label, t.color
            ORDER BY count DESC
        `, [contactId]);

        const closeReasons = reasonsRes.rows.map(r => ({
            tag: r.tag,
            color: r.color,
            count: parseInt(r.count)
        }));

        // 3. Activities (Notes)
        const activitiesRes = await client.query(`
            SELECT 
                a.*,
                u.full_name as user_name,
                u.avatar_url as user_avatar
            FROM activities a
            JOIN users u ON a.user_id = u.id
            WHERE a.contact_id = $1
            ORDER BY a.date DESC
        `, [contactId]);

        const activities: Activity[] = activitiesRes.rows.map(row => ({
            id: row.id,
            contact_id: row.contact_id,
            type: row.type,
            date: row.date,
            notes: row.notes,
            user_id: row.user_id,
            user_name: row.user_name, // Adding these to the type locally for display
            user_avatar: row.user_avatar
        } as any));

        return {
            stats: {
                totalChats,
                totalNotes: activities.length,
                lastContactDate,
                closeReasons,
                activities
            }
        };

    } catch (error) {
        console.error("[GET_CONTACT_STATS] Error:", error);
        return { stats: null, error: "Falha ao buscar estatísticas." };
    } finally {
        client.release();
    }
}
