
'use server';

import { db } from '@/lib/db';
import type { Contact, Tag, User, Activity, CustomFieldDefinition, SelectableOption } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { withDebug } from '@/lib/observability/logger';
import {
    ensurePipelineTagSchema,
    getPipelineStagesForWorkspace,
} from '@/lib/crm-pipeline-server';
import {
    resolveWhatsappJidForContactSave,
    shouldKeepCurrentWhatsappJidOnUpdate,
} from '@/lib/crm-contact-identity';
import {
    PIPELINE_STAGE_CATEGORY,
    normalizePipelineStageValue,
    type PipelineStage,
} from '@/lib/crm-pipeline';
import {
    buildWhatsappLookupJids,
    normalizeWhatsappJid as normalizeWhatsappContactJid,
} from '@/lib/whatsapp/contact-identity';

async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2
    `, [userId, workspaceId]);
    return (res.rowCount || 0) > 0;
}


import { buildCountQuery, buildSegmentQuery, CriteriaGroup } from '@/lib/crm-query-builder';
import { Segment } from '@/lib/types';

function normalizeWhatsappJid(value?: string | null): string | null {
    return normalizeWhatsappContactJid(value);
}

function normalizeComparableValue(value: unknown): string {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function matchesConversionValue(expected: string | null | undefined, candidate: string | null | undefined): boolean {
    const candidateText = String(candidate ?? '').trim();
    if (!candidateText) return false;

    const expectedText = String(expected ?? '').trim();
    if (!expectedText) return true; // Empty expected means "any non-empty value".

    return normalizeComparableValue(expectedText) === normalizeComparableValue(candidateText);
}

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
                const segmentCriteria = segmentRes.rows[0].criteria as CriteriaGroup | undefined;
                criteria = criteria && segmentCriteria
                    ? { operator: 'AND', conditions: [segmentCriteria, criteria] }
                    : segmentCriteria || criteria;
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

export const deleteSegment = withDebug(
    'delete_segment',
    async function deleteSegment(segmentId: string): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        try {
            const segRes = await db.query('SELECT workspace_id FROM crm_segments WHERE id = $1', [segmentId]);
            if (segRes.rowCount === 0) return { success: false, error: "Segmento não encontrado." };
            const workspaceId = segRes.rows[0].workspace_id;

            if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
                return { success: false, error: "Você não tem permissão para excluir segmentos." };
            }

            await db.query('DELETE FROM crm_segments WHERE id = $1', [segmentId]);
            revalidatePath('/crm');
            return { success: true };
        } catch (error) {
            console.error("[DELETE_SEGMENT] Error:", error);
            return { success: false, error: "Falha ao excluir segmento." };
        }
    },
    {
        contextResolver: (segmentId) => ({ payload: { segmentId } })
    }
);



export const saveContactAction = withDebug(
    'save_contact',
    async function saveContactAction(prevState: any, formData: FormData): Promise<{ success: boolean; error?: string | null; contact?: Contact | null }> {
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
            phone_number_jid: normalizeWhatsappJid(formData.get('phone_number_jid') as string | null),
            address: formData.get('address') as string || null,
            owner_id: ownerId || null,
            avatar_url: formData.get('avatar_url') as string || null,
        };
        const phoneLookupJids = buildWhatsappLookupJids(formData.get('phone_number_jid') as string | null);

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
            const duplicatePhoneError = 'Ja existe um contato com este WhatsApp neste workspace.';

            if (id) { // Update
                const currentContactRes = await client.query(
                    `SELECT phone_number_jid
                     FROM contacts
                     WHERE id = $1
                       AND workspace_id = $2
                     LIMIT 1`,
                    [id, workspaceId]
                );
                if ((currentContactRes.rowCount || 0) === 0) {
                    await client.query('ROLLBACK');
                    return { success: false, error: 'Contato nao encontrado.' };
                }

                const currentPhoneNumberJid = currentContactRes.rows[0]?.phone_number_jid ?? null;
                const hasPhoneLookup = phoneLookupJids.length > 0;
                let hasEquivalentConflict = false;

                if (hasPhoneLookup) {
                    const duplicateRes = await client.query(
                        `SELECT phone_number_jid
                         FROM contacts
                         WHERE workspace_id = $1
                           AND phone_number_jid = ANY($2::text[])
                           AND id <> $3
                         LIMIT 1`,
                        [workspaceId, phoneLookupJids, id]
                    );

                    hasEquivalentConflict = (duplicateRes.rowCount || 0) > 0;
                }

                if (
                    hasEquivalentConflict &&
                    !shouldKeepCurrentWhatsappJidOnUpdate(currentPhoneNumberJid, data.phone_number_jid)
                ) {
                    await client.query('ROLLBACK');
                    return { success: false, error: duplicatePhoneError };
                }

                const persistedPhoneNumberJid = resolveWhatsappJidForContactSave({
                    currentJid: currentPhoneNumberJid,
                    nextJid: data.phone_number_jid,
                    hasEquivalentConflict,
                });

                await client.query(
                    `UPDATE contacts 
                 SET name = $1, email = $2, phone_number_jid = $3, address = $4, owner_id = $5, avatar_url = $6
                 WHERE id = $7 AND workspace_id = $8`,
                    [data.name, data.email, persistedPhoneNumberJid, data.address, data.owner_id, data.avatar_url, id, workspaceId]
                );
            } else { // Create
                if (phoneLookupJids.length > 0) {
                    const duplicateRes = await client.query(
                        `SELECT 1
                         FROM contacts
                         WHERE workspace_id = $1
                           AND phone_number_jid = ANY($2::text[])
                         LIMIT 1`,
                        [workspaceId, phoneLookupJids]
                    );

                    if ((duplicateRes.rowCount || 0) > 0) {
                        await client.query('ROLLBACK');
                        return { success: false, error: duplicatePhoneError };
                    }
                }

                const res = await client.query(
                    `INSERT INTO contacts (workspace_id, name, email, phone_number_jid, address, owner_id, avatar_url) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (workspace_id, phone_number_jid) DO NOTHING
                 RETURNING id`,
                    [workspaceId, data.name, data.email, data.phone_number_jid, data.address, data.owner_id, data.avatar_url]
                );
                if ((res.rowCount || 0) === 0) {
                    await client.query('ROLLBACK');
                    return { success: false, error: duplicatePhoneError };
                }
                contactId = res.rows[0].id;
            }

            if (!contactId) throw new Error('Falha ao obter o ID do contato.');

            // Fetch current custom fields to track changes before updating
            const currentFieldsRes = await client.query(
                'SELECT field_id, value FROM contact_custom_field_values WHERE contact_id = $1',
                [contactId]
            );
            const currentFields = currentFieldsRes.rows.reduce((acc, row) => ({ ...acc, [row.field_id]: row.value }), {});
            const conversionConfigRes = await client.query(
                `
                SELECT
                    COALESCE(to_jsonb(w)->>'conversion_custom_field_id', '') AS conversion_custom_field_id,
                    COALESCE(to_jsonb(w)->>'conversion_custom_field_value', '') AS conversion_custom_field_value
                FROM workspaces w
                WHERE w.id = $1
                `,
                [workspaceId]
            );
            const conversionFieldId = conversionConfigRes.rows[0]?.conversion_custom_field_id || '';
            const conversionFieldValue = conversionConfigRes.rows[0]?.conversion_custom_field_value || '';
            const previousConversionRawValue = conversionFieldId ? (currentFields[conversionFieldId] || '') : '';

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

            // Fetch the updated contact to return to frontend
            const updatedContactRes = await client.query(`
                SELECT c.*, 
                       u.full_name as owner_name,
                       COALESCE(
                           (SELECT json_agg(json_build_object('id', t.id, 'label', t.label, 'color', t.color, 'value', t.value))
                            FROM contact_tags ct
                            JOIN tags t ON ct.tag_id = t.id
                            WHERE ct.contact_id = c.id
                           ), '[]'
                       ) as tags,
                       COALESCE(
                           (SELECT json_object_agg(ccfv.field_id, ccfv.value)
                            FROM contact_custom_field_values ccfv
                            WHERE ccfv.contact_id = c.id
                           ), '{}'
                       ) as custom_fields
                FROM contacts c
                LEFT JOIN users u ON c.owner_id = u.id
                WHERE c.id = $1
            `, [contactId]);

            const updatedContact = updatedContactRes.rows[0] || null;
            if (updatedContact) {
                // Formatting for frontend compatibility
                updatedContact.owner = updatedContact.owner_id ? { id: updatedContact.owner_id, name: updatedContact.owner_name } : undefined;
            }

            if (contactId && conversionFieldId) {
                const updatedCustomFields = (updatedContact?.custom_fields || {}) as Record<string, string>;
                const nextConversionRawValue = updatedCustomFields[conversionFieldId] || '';
                const wasConverted = matchesConversionValue(conversionFieldValue, previousConversionRawValue);
                const isConverted = matchesConversionValue(conversionFieldValue, nextConversionRawValue);
                const missingConversionTimestamp = isConverted && !updatedContact?.converted_at;

                if ((!wasConverted && isConverted) || missingConversionTimestamp) {
                    await client.query(
                        `UPDATE contacts SET converted_at = COALESCE(converted_at, timezone('utc', now())) WHERE id = $1`,
                        [contactId]
                    );
                    if (updatedContact && !updatedContact.converted_at) {
                        updatedContact.converted_at = new Date().toISOString();
                    }
                }
            }

            await client.query('COMMIT');

            // Dispatch Automations for custom field changes
            try {
                const { evaluateAutomations } = await import('@/lib/automation-engine');
                const candidateFieldIds = Array.from(
                    new Set([...Object.keys(currentFields), ...Object.keys(customFields)])
                );
                const changedFields = candidateFieldIds
                    .filter((fieldId) => (customFields[fieldId] ?? '') !== (currentFields[fieldId] ?? ''))
                    .map((fieldId) => [fieldId, customFields[fieldId] ?? ''] as const);

                if (changedFields.length > 0) {
                    const changedFieldsMap = Object.fromEntries(changedFields);
                    const [firstFieldId, firstNewValue] = changedFields[0];

                    console.log(
                        `[AUTOMATION] Dispatching custom_field_changed for contact ${contactId} with ${changedFields.length} changed fields`
                    );
                    await evaluateAutomations({
                        type: 'custom_field_changed',
                        workspaceId,
                        contactId,
                        data: {
                            // Keep legacy single-field payload for compatibility.
                            custom_field_id: firstFieldId,
                            new_value: firstNewValue,
                            // New payload for AND conditions.
                            changed_fields: changedFieldsMap,
                            contact_custom_fields: (updatedContact?.custom_fields || {}) as Record<string, string>,
                            actor_user_id: user.id,
                        }
                    });
                }

                if (changedFields.length === 0) {
                    console.log(`[AUTOMATION] No custom field changes detected for contact ${contactId}`);
                }
            } catch (e) {
                console.error("[SAVE_CONTACT] Error dispatching custom field automations:", e);
            }

            return { success: true, error: null, contact: updatedContact };
        } catch (error) {
            await client.query('ROLLBACK');
            const maybePgError = error as { code?: string; constraint?: string };
            if (maybePgError.code === '23505' && maybePgError.constraint === 'uq_contacts_workspace_phone_jid') {
                return { success: false, error: 'Ja existe um contato com este WhatsApp neste workspace.' };
            }
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
        await ensurePipelineTagSchema();
        const res = await db.query(
            `SELECT id, label, value, color, is_close_reason, team_ids, category, sort_order
             FROM tags
             WHERE workspace_id = $1
             ORDER BY COALESCE(sort_order, 2147483647), label`,
            [workspaceId]
        );
        return { tags: res.rows };
    } catch (error) {
        console.error("[GET_TAGS] Error:", error);
        return { tags: null, error: "Falha ao buscar as etiquetas." };
    }
}

export async function getPipelineStages(workspaceId: string): Promise<{ stages: PipelineStage[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { stages: null, error: "Usuário não autenticado." };

    try {
        if (!await hasPermission(user.id, workspaceId, 'crm:view')) {
            return { stages: null, error: "Acesso não autorizado." };
        }

        const stages = await getPipelineStagesForWorkspace(workspaceId);
        return { stages };
    } catch (error) {
        console.error("[GET_PIPELINE_STAGES] Error:", error);
        return { stages: null, error: "Falha ao buscar etapas do funil." };
    }
}

export const createPipelineStage = withDebug(
    'create_pipeline_stage',
    async function createPipelineStage(
        workspaceId: string,
        label: string,
        color: string
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
            return { success: false, error: "Você não tem permissão para editar o funil." };
        }

        const normalizedLabel = label.trim();
        if (!normalizedLabel) {
            return { success: false, error: "Nome da etapa é obrigatório." };
        }

        const value = normalizePipelineStageValue(normalizedLabel);
        if (!value) {
            return { success: false, error: "Nome da etapa inválido." };
        }

        try {
            await ensurePipelineTagSchema();

            const orderRes = await db.query(
                `
                    SELECT COALESCE(MAX(sort_order), 0) + 100 AS next_order
                    FROM tags
                    WHERE workspace_id = $1
                      AND category = $2
                `,
                [workspaceId, PIPELINE_STAGE_CATEGORY]
            );

            const nextOrder = Number(orderRes.rows[0]?.next_order || 100);

            await db.query(
                `
                    INSERT INTO tags (workspace_id, label, value, color, is_close_reason, team_ids, category, sort_order)
                    VALUES ($1, $2, $3, $4, false, $5, $6, $7)
                `,
                [workspaceId, normalizedLabel, value, color, [], PIPELINE_STAGE_CATEGORY, nextOrder]
            );

            revalidatePath('/crm');
            revalidatePath('/analytics');
            return { success: true };
        } catch (error: any) {
            console.error("[CREATE_PIPELINE_STAGE] Error:", error);
            if (error?.code === '23505') {
                return { success: false, error: "Já existe uma etapa com esse nome neste workspace." };
            }
            return { success: false, error: "Falha ao criar etapa do funil." };
        }
    },
    {
        contextResolver: (workspaceId, label) => ({ payload: { workspaceId, label } })
    }
);

export const deletePipelineStage = withDebug(
    'delete_pipeline_stage',
    async function deletePipelineStage(
        workspaceId: string,
        stageId: string
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
            return { success: false, error: "Você não tem permissão para editar o funil." };
        }

        try {
            await ensurePipelineTagSchema();

            // Check if stage exists and belongs to workspace and is a pipeline stage
            const stageRes = await db.query(
                `SELECT category FROM tags WHERE id = $1 AND workspace_id = $2`,
                [stageId, workspaceId]
            );

            if (stageRes.rowCount === 0) {
                return { success: false, error: "Etapa não encontrada." };
            }

            if (stageRes.rows[0].category !== PIPELINE_STAGE_CATEGORY) {
                return { success: false, error: "Esta etiqueta não é uma etapa de funil." };
            }

            // Ensure there is at least one other stage remaining
            const countRes = await db.query(
                `SELECT COUNT(*) as total FROM tags WHERE workspace_id = $1 AND category = $2`,
                [workspaceId, PIPELINE_STAGE_CATEGORY]
            );

            if (Number(countRes.rows[0].total) <= 1) {
                return { success: false, error: "Não é possível excluir a última etapa do funil." };
            }

            // Delete the contact tags references explicitly (or let ON DELETE CASCADE handle it if present, but explicit is safe)
            await db.query(`DELETE FROM contact_tags WHERE tag_id = $1`, [stageId]);
            
            // Delete the stage
            await db.query(`DELETE FROM tags WHERE id = $1`, [stageId]);

            revalidatePath('/crm');
            revalidatePath('/analytics');
            return { success: true };
        } catch (error: any) {
            console.error("[DELETE_PIPELINE_STAGE] Error:", error);
            return { success: false, error: "Falha ao excluir etapa do funil." };
        }
    },
    {
        contextResolver: (workspaceId, stageId) => ({ payload: { workspaceId, stageId } })
    }
);

export const createTag = withDebug(
    'create_tag',
    async function createTag(
        workspaceId: string,
        label: string,
        color: string,
        isCloseReason: boolean,
        teamIds: string[] = []
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
                'INSERT INTO tags (workspace_id, label, value, color, is_close_reason, team_ids) VALUES ($1, $2, $3, $4, $5, $6)',
                [workspaceId, label, value, color, isCloseReason, teamIds]
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
        isCloseReason: boolean,
        teamIds: string[] = []
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        try {
            await ensurePipelineTagSchema();
            const tagRes = await db.query('SELECT workspace_id, category FROM tags WHERE id = $1', [tagId]);
            if (tagRes.rowCount === 0) return { success: false, error: "Etiqueta não encontrada." };
            const workspaceId = tagRes.rows[0].workspace_id;
            const category = tagRes.rows[0].category;

            if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
                return { success: false, error: "Você não tem permissão para editar etiquetas." };
            }

            const value = label.trim().toLowerCase().replace(/\s+/g, '_');

            if (category === PIPELINE_STAGE_CATEGORY) {
                await db.query(
                    'UPDATE tags SET label = $1, color = $2, is_close_reason = $3, team_ids = $4 WHERE id = $5',
                    [label, color, isCloseReason, teamIds, tagId]
                );
            } else {
                await db.query(
                    'UPDATE tags SET label = $1, value = $2, color = $3, is_close_reason = $4, team_ids = $5 WHERE id = $6',
                    [label, value, color, isCloseReason, teamIds, tagId]
                );
            }
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
            await ensurePipelineTagSchema();
            const tagRes = await db.query('SELECT workspace_id, category FROM tags WHERE id = $1', [tagId]);
            if (tagRes.rowCount === 0) return { success: false, error: "Etiqueta não encontrada." };
            const workspaceId = tagRes.rows[0].workspace_id;
            const category = tagRes.rows[0].category;

            if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
                return { success: false, error: "Você não tem permissão para apagar etiquetas." };
            }

            if (category === PIPELINE_STAGE_CATEGORY) {
                return { success: false, error: "Etapas do funil devem ser gerenciadas pelo kanban." };
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
        const res = await db.query(
            // custom_field_definitions does not expose created_at in this project schema;
            // xmin keeps insertion transaction order, which matches "created first".
            'SELECT id, label, type, placeholder, options FROM custom_field_definitions WHERE workspace_id = $1 ORDER BY xmin::text::bigint ASC, label ASC',
            [workspaceId]
        );
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

export async function getWorkspaceConversionFieldConfig(workspaceId: string): Promise<{
    config: { fieldId: string; fieldValue: string } | null;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { config: null, error: "Usuário não autenticado." };

    try {
        if (!await hasPermission(user.id, workspaceId, 'crm:view')) {
            return { config: null, error: "Acesso não autorizado." };
        }

        const res = await db.query(
            `
            SELECT
                COALESCE(to_jsonb(w)->>'conversion_custom_field_id', '') AS conversion_custom_field_id,
                COALESCE(to_jsonb(w)->>'conversion_custom_field_value', '') AS conversion_custom_field_value
            FROM workspaces w
            WHERE w.id = $1
            `,
            [workspaceId]
        );

        const row = res.rows[0] || {};
        return {
            config: {
                fieldId: row.conversion_custom_field_id || '',
                fieldValue: row.conversion_custom_field_value || '',
            }
        };
    } catch (error) {
        console.error("[GET_WORKSPACE_CONVERSION_FIELD_CONFIG] Error:", error);
        return { config: null, error: "Falha ao buscar configuração de conversão." };
    }
}

export const updateWorkspaceConversionFieldConfig = withDebug(
    'update_workspace_conversion_field_config',
    async function updateWorkspaceConversionFieldConfig(
        workspaceId: string,
        data: { fieldId?: string | null; fieldValue?: string | null }
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
            return { success: false, error: "Você não tem permissão para editar essa configuração." };
        }

        const fieldId = data.fieldId ? String(data.fieldId) : null;
        const fieldValue = fieldId ? String(data.fieldValue || '') : '';

        try {
            if (fieldId) {
                const fieldRes = await db.query(
                    `SELECT 1 FROM custom_field_definitions WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
                    [fieldId, workspaceId]
                );
                if ((fieldRes.rowCount || 0) === 0) {
                    return { success: false, error: "Campo de conversão inválido para este workspace." };
                }
            }

            await db.query(
                `
                UPDATE workspaces
                SET conversion_custom_field_id = $1,
                    conversion_custom_field_value = $2
                WHERE id = $3
                `,
                [fieldId, fieldValue, workspaceId]
            );

            revalidatePath('/crm');
            revalidatePath('/analytics');
            return { success: true };
        } catch (error) {
            console.error("[UPDATE_WORKSPACE_CONVERSION_FIELD_CONFIG] Error:", error);
            return { success: false, error: "Falha ao salvar configuração de conversão." };
        }
    },
    {
        contextResolver: (workspaceId, data) => ({ payload: { workspaceId, fieldId: data.fieldId } })
    }
);

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

export const updateCustomFieldDefinition = withDebug(
    'update_custom_field',
    async function updateCustomFieldDefinition(
        fieldId: string,
        field: Partial<Omit<CustomFieldDefinition, 'id' | 'workspace_id'>>
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: "Usuário não autenticado." };

        try {
            const fieldRes = await db.query('SELECT workspace_id FROM custom_field_definitions WHERE id = $1', [fieldId]);
            if (fieldRes.rowCount === 0) return { success: false, error: "Campo não encontrado." };
            const workspaceId = fieldRes.rows[0].workspace_id;

            if (!await hasPermission(user.id, workspaceId, 'crm:edit')) {
                return { success: false, error: "Você não tem permissão para editar campos." };
            }

            const setClauses: string[] = [];
            const values: any[] = [];
            let idx = 1;

            if (field.label !== undefined) {
                setClauses.push(`label = $${idx++}`);
                values.push(field.label);
            }
            if (field.type !== undefined) {
                setClauses.push(`type = $${idx++}`);
                values.push(field.type);
            }
            if (field.placeholder !== undefined) {
                setClauses.push(`placeholder = $${idx++}`);
                values.push(field.placeholder);
            }
            if (field.options !== undefined) {
                setClauses.push(`options = $${idx++}`);
                values.push(JSON.stringify(field.options || []));
            }

            if (setClauses.length === 0) {
                return { success: false, error: "Nenhuma alteração enviada." };
            }

            values.push(fieldId);

            await db.query(
                `UPDATE custom_field_definitions
                 SET ${setClauses.join(', ')}
                 WHERE id = $${idx}`,
                values
            );

            revalidatePath('/crm');
            return { success: true };
        } catch (error) {
            console.error("[UPDATE_CUSTOM_FIELD] Error:", error);
            return { success: false, error: "Falha ao atualizar campo personalizado." };
        }
    },
    {
        contextResolver: (fieldId, field) => ({ payload: { fieldId, label: field.label } })
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

            await db.query(
                `
                UPDATE workspaces
                SET conversion_custom_field_id = NULL,
                    conversion_custom_field_value = ''
                WHERE conversion_custom_field_id = $1
                `,
                [fieldId]
            );

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

export async function getContactStatistics(
    contactId: string,
    period: 'this_month' | 'last_7_days' | 'last_month' | 'all_time' = 'this_month'
): Promise<{
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

        const buildPeriodClause = (column: string) => {
            switch (period) {
                case 'all_time':
                    return `1=1`;
                case 'last_month':
                    return `${column} >= date_trunc('month', NOW()) - interval '1 month' AND ${column} < date_trunc('month', NOW())`;
                case 'last_7_days':
                    return `${column} >= NOW() - interval '7 days'`;
                case 'this_month':
                default:
                    return `${column} >= date_trunc('month', NOW()) AND ${column} < date_trunc('month', NOW()) + interval '1 month'`;
            }
        };

        const chatPeriodClause = buildPeriodClause('c.created_at');
        const closeReasonPeriodClause = buildPeriodClause('COALESCE(c.closed_at, c.created_at)');
        const activitiesPeriodClause = buildPeriodClause('a.date');

        // 1. Total Chats & Last Contact (filtered period)
        const chatsRes = await client.query(`
            SELECT 
                COUNT(*) as total,
                MAX(created_at) as last_contact
            FROM chats c
            WHERE c.contact_id = $1
              AND ${chatPeriodClause}
        `, [contactId]);

        const totalChats = parseInt(chatsRes.rows[0].total || '0');
        const lastContactDate = chatsRes.rows[0].last_contact;

        // 2. Close Reasons Distribution (filtered period)
        const reasonsRes = await client.query(`
            SELECT 
                t.label as tag,
                t.color,
                COUNT(*) as count
            FROM chats c
            JOIN tags t ON c.close_reason_tag_id = t.id
            WHERE c.contact_id = $1
              AND c.status = 'encerrados'
              AND ${closeReasonPeriodClause}
            GROUP BY t.label, t.color
            ORDER BY count DESC
        `, [contactId]);

        const closeReasons = reasonsRes.rows.map(r => ({
            tag: r.tag,
            color: r.color,
            count: parseInt(r.count)
        }));

        // 3. Activities (Notes, filtered period)
        const activitiesRes = await client.query(`
            SELECT 
                a.*,
                u.full_name as user_name,
                u.avatar_url as user_avatar
            FROM activities a
            JOIN users u ON a.user_id = u.id
            WHERE a.contact_id = $1
              AND ${activitiesPeriodClause}
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
