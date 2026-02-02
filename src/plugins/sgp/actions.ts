
'use server';

import { saveIntegrationConfig, getIntegrationConfig } from '@/actions/integrations';
import { getCustomFieldDefinitions as fetchCustomFields } from '@/actions/crm';
import { getCurrentUser } from '@/actions/user';
import { db } from '@/lib/db';
import { SGPGlobalConfig, SGPUserConfig } from './types';
import { format } from 'date-fns';

// --- Global Config (Admin Only) ---
export async function saveSGPGlobalConfig(workspaceId: string, data: { baseUrl: string; cpfFieldId: string; appId: string; appToken: string; teamSectors: Record<string, string> }) {
    const user = await getCurrentUser();

    if (!user) return { success: false, error: "Unauthorized" };

    // Check permissions
    const currentWorkspace = user.workspaces?.find(w => w.id === workspaceId);

    // Check if user is admin/owner.
    const isAdmin = !!(
        currentWorkspace?.isOwner ||
        currentWorkspace?.roleName === 'Owner' ||
        currentWorkspace?.roleName === 'Admin' ||
        currentWorkspace?.roleName === 'Administrador'
    );

    if (!isAdmin && !user.is_superadmin) {
        return { success: false, error: "Acesso negado: Apenas administradores podem alterar configurações globais." };
    }

    const config = {
        baseUrl: data.baseUrl,
        cpfFieldId: data.cpfFieldId,
        appId: data.appId,
        appToken: data.appToken,
        teamSectors: data.teamSectors
    };

    return await saveIntegrationConfig(workspaceId, 'sgp', config, true);
}

// --- User Config (Any User) ---
export async function saveSGPUserConfig(workspaceId: string, data: { username: string; password?: string }) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: "Unauthorized" };

    if (!data.username || !data.password) {
        return { success: false, error: "Missing credentials" };
    }

    const token = Buffer.from(`${data.username}:${data.password}`).toString('base64');

    const userConfig = {
        username: data.username,
        token: token
    };

    // Storing as a pseudo-provider specific to this user in this workspace
    return await saveIntegrationConfig(workspaceId, `sgp_user_${user.id}`, userConfig, true);
}

export async function getSGPConfig(workspaceId: string) {
    const user = await getCurrentUser();
    if (!user) return { global: null, user: null, isGlobalReady: false, isAdmin: false };

    // Fetch Global Config
    const { config: globalConfig } = await getIntegrationConfig(workspaceId, 'sgp');

    // Fetch User Config
    const { config: userConfigRaw } = await getIntegrationConfig(workspaceId, `sgp_user_${user.id}`);

    // Find the current workspace details to check permissions
    const currentWorkspace = user.workspaces?.find(w => w.id === workspaceId);

    const isAdmin = !!(
        currentWorkspace?.isOwner ||
        currentWorkspace?.roleName === 'Owner' ||
        currentWorkspace?.roleName === 'Admin' ||
        currentWorkspace?.roleName === 'Administrador'
    );

    return {
        global: globalConfig as SGPGlobalConfig | null,
        user: userConfigRaw as SGPUserConfig | null,
        // Helper to check if global config is ready
        isGlobalReady: !!(globalConfig?.baseUrl && globalConfig?.cpfFieldId),
        // Helper to determine if user is admin
        isAdmin
    };
}

export async function getCRMFields(workspaceId: string) {
    return await fetchCustomFields(workspaceId);
}

// Re-export getTeams so the plugin component can use it easily without extra imports
import { getTeams } from '@/actions/teams';
export { getTeams };

export async function fetchSGPContracts(chatId: string) {
    const user = await getCurrentUser();
    if (!user || !user.activeWorkspaceId) return { success: false, error: "Unauthorized" };

    const workspaceId = user.activeWorkspaceId;
    const { global, user: sgpUser, isGlobalReady } = await getSGPConfig(workspaceId);

    if (!isGlobalReady || !global?.baseUrl || !global?.cpfFieldId) {
        return { success: false, error: "Integração SGP não configurada globalmente." };
    }

    if (!sgpUser?.token || !sgpUser.username) {
        return { success: false, error: "Credenciais SGP do usuário não configuradas." };
    }

    // Fetch Chat to get Contact ID
    const chatRes = await db.query('SELECT contact_id FROM chats WHERE id = $1 AND workspace_id = $2', [chatId, workspaceId]);
    if (chatRes.rowCount === 0) return { success: false, error: "Chat não encontrado." };
    const contactId = chatRes.rows[0].contact_id;

    // Fetch Contact Custom Fields
    // We assume custom fields are stored in a contact_custom_fields table or similar, 
    // BUT looking at `fetchChats` in chats.ts, contact_custom_fields is returned in the chat row or we might need to fetch it from contacts table.
    // Let's check `types.ts` again or `fetchChats` logic. In `fetchChats`, `contact_custom_fields` is joined.
    // Let's use a direct query for filtering custom fields.
    // Assuming `contact_custom_fields` table: contact_id, field_key, field_value.

    // Correction based on `types.ts` and general structure: 
    // List Custom Field ID for CPF from Global Config
    // Usually custom fields are jsonb in contacts or a separate table.
    // Let's query the contact's custom fields.
    const cpfFieldId = global.cpfFieldId;
    const cfRes = await db.query(`
        SELECT value 
        FROM contact_custom_field_values 
        WHERE contact_id = $1 AND field_id = $2
    `, [contactId, cpfFieldId]);

    if (cfRes.rowCount === 0) {
        return { success: false, error: `CPF não encontrado (Não há valor para o campo ID: ${cpfFieldId}).` };
    }

    const cpf = cfRes.rows[0].value;

    if (!cpf) {
        return { success: false, error: `CPF vazio no campo mapeado.` };
    }

    // Clean CPF (remove non-digits) if necessary? User payload shows "cpfcnpj". 
    // Often APIs expect plain numbers or specific format. Let's try sending as is or stripped.
    // User request: "CAMPO QUE O USUÁRIO SELECIONOU DO CRM".

    try {
        const response = await fetch(`${global.baseUrl}/api/ura/clientes/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${sgpUser.token}`
            },
            body: JSON.stringify({ cpfcnpj: cpf })
        });

        if (!response.ok) {
            const txt = await response.text();
            console.error('[SGP] Error fetching contracts:', txt);
            return { success: false, error: `Erro na API SGP: ${response.status} ${response.statusText}` };
        }

        const data = await response.json();

        if (!data.clientes || !Array.isArray(data.clientes) || data.clientes.length === 0) {
            return { success: false, error: "Nenhum cliente encontrado no SGP para este CPF." };
        }

        const contracts = data.clientes.flatMap((cliente: any) => cliente.contratos || []);

        if (contracts.length === 0) {
            return { success: false, error: "Nenhum contrato encontrado." };
        }

        // Format: {{ID_CONTRATO}} - {{PLANO}} - ({{Cidade}}) {{Bairro}}, {{Complemento}}, {{logradouro}}
        const formattedContracts = contracts.map((c: any) => {
            const addr = c.endereco || {};
            // Try to find a meaningful description from services
            const services = c.servicos || [];
            // Use the plan name from the first service if available, else 'Contrato'
            const planDesc = services.length > 0 ? services[0]?.plano?.descricao : 'Contrato';

            return {
                id: c.id?.toString() || '',
                label: `${c.id} - ${planDesc} - (${addr.cidade || ''}) ${addr.bairro || ''}, ${addr.logradouro || ''}`
            };
        });

        return { success: true, contracts: formattedContracts };

    } catch (error) {
        console.error('[SGP] Exception fetching contracts:', error);
        return { success: false, error: "Falha de conexão com SGP." };
    }
}

export async function createSGPServiceOrder(chatId: string, contractId: string, notes: string) {
    const user = await getCurrentUser();
    if (!user || !user.activeWorkspaceId) return { success: false, error: "Unauthorized" };

    const workspaceId = user.activeWorkspaceId;
    const { global, user: sgpUser, isGlobalReady } = await getSGPConfig(workspaceId);

    if (!isGlobalReady || !global?.baseUrl || !global?.teamSectors) {
        return { success: false, error: "Integração SGP incompleta (verifique Configuração Global e Setores)." };
    }

    if (!sgpUser?.token || !sgpUser.username) {
        return { success: false, error: "Credenciais SGP do usuário ausentes." };
    }

    // Fetch Chat to get details (Contact, Team)
    // We need team_id for sector mapping (via agent's team), and contact info for payload
    const chatRes = await db.query(`
        SELECT 
            tm.team_id, 
            ct.name as contact_name, 
            ct.phone_number_jid as contact_phone 
        FROM chats c
        JOIN contacts ct ON c.contact_id = ct.id
        LEFT JOIN team_members tm ON c.agent_id = tm.user_id
        WHERE c.id = $1 AND c.workspace_id = $2
        LIMIT 1
    `, [chatId, workspaceId]);

    if (chatRes.rowCount === 0) return { success: false, error: "Chat/Contato não encontrado." };

    const { team_id, contact_name, contact_phone } = chatRes.rows[0];

    // Determine Sector
    if (!team_id) {
        return { success: false, error: "Chat não está atribuído a uma equipe. Impossível determinar setor SGP." };
    }

    const sectorId = global.teamSectors[team_id];
    if (!sectorId) {
        return { success: false, error: "Equipe atual não possui setor SGP mapeado." };
    }

    // Clean contractId - keep numbers only as per request
    const cleanContractId = contractId.replace(/\D/g, '');

    // Format date: "2025-01-31 12:00"
    const now = new Date();
    // Use workspace timezone if possible? User said "EM PT-BR JÁ". 
    // Assuming server time or UTC adjusted to -3.
    // 'yyyy-MM-dd HH:mm'
    const formattedDate = format(now, 'yyyy-MM-dd HH:mm');

    // Clean phone - remove @s.whatsapp.net suffix if present
    const cleanPhone = contact_phone ? contact_phone.replace(/@.*$/, '') : '';

    const payload = {
        contrato: Number(cleanContractId), // User said "APENAS OS NÚMEROS". API might expect number or string? JSON usually handles number.
        ocorrenciatipo: 6,
        metodo: 5,
        setor: Number(sectorId), // Assuming number based on "valor do setor"
        conteudo: notes || "Sem observações.",
        observacao: "Atendido via Dialogy",
        usuario: sgpUser.username,
        responsavel: sgpUser.username,
        responsaveloc: sgpUser.username,
        conteudolimpo: 1,
        desativa_os: 1,
        contato_nome: contact_name || "Cliente",
        status_encerrado: 1,
        ...(cleanPhone ? { contato_telefone: cleanPhone } : {}),
        data_hora_agendamento: formattedDate
    };

    try {
        const response = await fetch(`${global.baseUrl}/api/ura/chamado/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${sgpUser.token}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const txt = await response.text();
            console.error('[SGP] Error creating Service Order:', txt);
            let errorMsg = response.statusText;
            try {
                const json = JSON.parse(txt);
                errorMsg = json.message || json.error || json.erro || json.msg || txt;
            } catch (e) {
                if (txt && txt.length < 200) errorMsg = txt;
            }
            return { success: false, error: `SGP Erro: ${errorMsg}` };
        }

        const data = await response.json();
        // Return success and maybe the OS ID if available in response
        return { success: true, apiResponse: data };

    } catch (error) {
        console.error('[SGP] Exception creating Service Order:', error);
        return { success: false, error: "Erro de conexão ao criar OS no SGP." };
    }
}
