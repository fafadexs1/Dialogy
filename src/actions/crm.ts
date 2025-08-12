

'use server';

import { db } from '@/lib/db';
import type { Contact, Tag, User, Activity } from '@/lib/types';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { revalidatePath } from 'next/cache';


async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1
        FROM user_workspace_roles uwr
        JOIN role_permissions rp ON uwr.role_id = rp.role_id
        WHERE uwr.user_id = $1 AND uwr.workspace_id = $2 AND rp.permission_id = $3
    `, [userId, workspaceId, permission]);
    return res.rowCount > 0;
}


export async function getContacts(workspaceId: string): Promise<{ contacts: Contact[] | null, error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { contacts: null, error: "Usuário não autenticado." };

    if (!await hasPermission(session.user.id, workspaceId, 'crm:view')) {
         return { contacts: null, error: "Acesso não autorizado." };
    }

    try {
        const res = await db.query(`
            SELECT 
                c.*,
                (SELECT u.full_name FROM users u WHERE u.id = c.owner_id) as owner_name,
                (SELECT MAX(a.date) FROM activities a WHERE a.contact_id = c.id) as last_activity,
                COALESCE(
                    (SELECT array_agg(t.id || '::' || t.label || '::' || t.value || '::' || t.color) 
                     FROM tags t JOIN contact_tags ct ON t.id = ct.tag_id WHERE ct.contact_id = c.id),
                    '{}'::text[]
                ) as tags_agg,
                COALESCE(
                    (SELECT json_agg(act.* ORDER BY act.date DESC) FROM activities act WHERE act.contact_id = c.id),
                    '[]'::json
                ) as activities_agg
            FROM contacts c
            WHERE c.workspace_id = $1
            ORDER BY c.created_at DESC;
        `, [workspaceId]);

        const contacts: Contact[] = res.rows.map(row => ({
            ...row,
            tags: row.tags_agg?.map((tag: string) => {
                const [id, label, value, color] = tag.split('::');
                return { id, label, value, color };
            }) || [],
            owner: row.owner_id ? { id: row.owner_id, name: row.owner_name } : undefined,
            activities: row.activities_agg || [],
        }));
        
        return { contacts };
    } catch (error) {
        console.error("[GET_CONTACTS] Error:", error);
        return { contacts: null, error: "Falha ao buscar contatos." };
    }
}

export async function saveContactAction(prevState: any, formData: FormData): Promise<{ success: boolean; error?: string | null; }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    const workspaceId = formData.get('workspaceId') as string;
    if (!await hasPermission(session.user.id, workspaceId, 'crm:edit')) {
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
        phone: formData.get('phone') as string,
        address: formData.get('address') as string || null,
        service_interest: (formData.get('service_interest') as string) === 'none' ? null : (formData.get('service_interest') as string),
        current_provider: formData.get('current_provider') as string || null,
        owner_id: ownerId || null,
    };
    
    const tagIds = formData.getAll('tags') as string[];

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        let contactId = id;
        
        if (id) { // Update
             await client.query(
                `UPDATE contacts 
                 SET name = $1, email = $2, phone = $3, address = $4, service_interest = $5, current_provider = $6, owner_id = $7
                 WHERE id = $8 AND workspace_id = $9`,
                [data.name, data.email, data.phone, data.address, data.service_interest, data.current_provider, data.owner_id, id, workspaceId]
            );
        } else { // Create
            const res = await client.query(
                `INSERT INTO contacts (workspace_id, name, email, phone, address, service_interest, current_provider, owner_id) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
                [workspaceId, data.name, data.email, data.phone, data.address, data.service_interest, data.current_provider, data.owner_id]
            );
            contactId = res.rows[0].id;
        }

        if (!contactId) throw new Error('Falha ao obter o ID do contato.');

        // Update tags
        await client.query('DELETE FROM contact_tags WHERE contact_id = $1', [contactId]);
        if(tagIds.length > 0) {
            const tagValues = tagIds.map(tagId => `('${contactId}', '${tagId}')`).join(',');
            await client.query(`INSERT INTO contact_tags (contact_id, tag_id) VALUES ${tagValues}`);
        }

        await client.query('COMMIT');
        revalidatePath('/crm');
        revalidatePath('/chat'); // revalidate chat in case contact info changed
        return { success: true, error: null };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("[SAVE_CONTACT] Error:", error);
        return { success: false, error: "Falha ao salvar contato no banco de dados." };
    } finally {
        client.release();
    }
}

export async function deleteContactAction(contactId: string): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };
    
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const contactRes = await client.query('SELECT workspace_id FROM contacts WHERE id = $1', [contactId]);
        if (contactRes.rowCount === 0) return { success: false, error: "Contato não encontrado."};
        const { workspace_id } = contactRes.rows[0];

        if (!await hasPermission(session.user.id, workspace_id, 'crm:delete')) {
            await client.query('ROLLBACK');
            return { success: false, error: "Você não tem permissão para excluir contatos." };
        }
        
        await client.query('DELETE FROM contact_tags WHERE contact_id = $1', [contactId]);
        await client.query('DELETE FROM activities WHERE contact_id = $1', [contactId]);
        await client.query('DELETE FROM contacts WHERE id = $1', [contactId]);
        
        await client.query('COMMIT');
        revalidatePath('/crm');
        return { success: true };
    } catch(error) {
        await client.query('ROLLBACK');
        console.error("[DELETE_CONTACT] Error:", error);
        return { success: false, error: "Falha ao excluir o contato." };
    } finally {
      client.release();
    }
}

// --- TAGS ACTIONS ---

export async function getTags(workspaceId: string): Promise<{ tags: Tag[] | null, error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { tags: null, error: "Usuário não autenticado." };

    try {
        const res = await db.query('SELECT id, label, value, color, is_close_reason FROM tags WHERE workspace_id = $1 ORDER BY label', [workspaceId]);
        return { tags: res.rows };
    } catch (error) {
        console.error("[GET_TAGS] Error:", error);
        return { tags: null, error: "Falha ao buscar as etiquetas." };
    }
}

export async function createTag(
    workspaceId: string, 
    label: string, 
    color: string, 
    isCloseReason: boolean
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    // Basic permission check
    if (!await hasPermission(session.user.id, workspaceId, 'crm:edit')) {
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
}


export async function updateTag(
    tagId: string, 
    label: string, 
    color: string, 
    isCloseReason: boolean
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    try {
        const tagRes = await db.query('SELECT workspace_id FROM tags WHERE id = $1', [tagId]);
        if (tagRes.rowCount === 0) return { success: false, error: "Etiqueta não encontrada." };
        const workspaceId = tagRes.rows[0].workspace_id;

        if (!await hasPermission(session.user.id, workspaceId, 'crm:edit')) {
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
}


export async function deleteTag(tagId: string): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    try {
        const tagRes = await db.query('SELECT workspace_id FROM tags WHERE id = $1', [tagId]);
        if (tagRes.rowCount === 0) return { success: false, error: "Etiqueta não encontrada." };
        const workspaceId = tagRes.rows[0].workspace_id;

        if (!await hasPermission(session.user.id, workspaceId, 'crm:edit')) {
            return { success: false, error: "Você não tem permissão para apagar etiquetas." };
        }

        await db.query('DELETE FROM tags WHERE id = $1', [tagId]);
        revalidatePath('/crm');
        return { success: true };
    } catch (error) {
        console.error("[DELETE_TAG] Error:", error);
        return { success: false, error: "Falha ao apagar etiqueta." };
    }
}



// --- END TAGS ---

export async function getWorkspaceUsers(workspaceId: string): Promise<{ users: User[] | null, error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { users: null, error: "Usuário não autenticado." };

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


export async function addActivityAction(
    prevState: any,
    formData: FormData
): Promise<{ success: boolean; error?: string | null; }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

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
        user_id: session.user.id,
    };
    
    if(!contactId || !activity.type || !activity.notes) {
        return { success: false, error: "Dados da atividade incompletos."}
    }

    try {
        const contactRes = await db.query('SELECT workspace_id FROM contacts WHERE id = $1', [contactId]);
        if (contactRes.rowCount === 0) return { success: false, error: "Contato não encontrado."};
        const { workspace_id } = contactRes.rows[0];

        if (!await hasPermission(session.user.id, workspace_id, 'crm:edit')) {
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
}

    