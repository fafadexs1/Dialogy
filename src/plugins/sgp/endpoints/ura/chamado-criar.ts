import { format } from 'date-fns';

import { db } from '@/lib/db';

import {
    createSGPJsonRequestInit,
    extractPhoneFromWhatsappJid,
    getSGPActiveWorkspaceContext,
    isSGPContextError,
    withSGPApplicationCredentials,
} from '../../runtime';

export async function createSGPServiceOrderImpl(
    chatId: string,
    contractId: string,
    notes: string
): Promise<{
    success: boolean;
    error?: string;
    apiResponse?: any;
}> {
    const normalizedNotes = String(notes || '').trim();
    if (!normalizedNotes) {
        return { success: false, error: 'Notas obrigatorias para criar OS no SGP.' };
    }

    const context = await getSGPActiveWorkspaceContext();
    if (isSGPContextError(context)) {
        return { success: false, error: context.error };
    }

    const { workspaceId, global, sgpUser, isGlobalReady } = context;

    if (!isGlobalReady || !global?.baseUrl || !global?.teamSectors) {
        return { success: false, error: 'Integracao SGP incompleta (verifique Configuracao Global e Setores).' };
    }

    if (!sgpUser?.token || !sgpUser.username) {
        return { success: false, error: 'Credenciais SGP do usuario ausentes.' };
    }

    const chatRes = await db.query(
        `
        SELECT
            tm.team_id,
            ct.name as contact_name,
            ct.phone_number_jid as contact_phone
        FROM chats c
        JOIN contacts ct ON c.contact_id = ct.id
        LEFT JOIN team_members tm ON c.agent_id = tm.user_id
        WHERE c.id = $1 AND c.workspace_id = $2
        LIMIT 1
    `,
        [chatId, workspaceId]
    );

    if (chatRes.rowCount === 0) {
        return { success: false, error: 'Chat/Contato nao encontrado.' };
    }

    const { team_id: teamId, contact_name: contactName, contact_phone: contactPhone } = chatRes.rows[0];

    if (!teamId) {
        return { success: false, error: 'Chat nao esta atribuido a uma equipe. Impossivel determinar setor SGP.' };
    }

    const sectorId = global.teamSectors[teamId];
    if (!sectorId) {
        return { success: false, error: 'Equipe atual nao possui setor SGP mapeado.' };
    }

    const phone = extractPhoneFromWhatsappJid(contactPhone);
    const payload = {
        contrato: Number(contractId.replace(/\D/g, '')),
        ocorrenciatipo: 6,
        metodo: 5,
        setor: Number(sectorId),
        conteudo: normalizedNotes,
        observacao: 'Atendido via Dialogy',
        usuario: sgpUser.username,
        responsavel: sgpUser.username,
        responsaveloc: sgpUser.username,
        conteudolimpo: 1,
        desativa_os: 1,
        contato_nome: contactName || 'Cliente',
        status_encerrado: 1,
        ...(phone ? { contato_telefone: phone } : {}),
        data_hora_agendamento: format(new Date(), 'yyyy-MM-dd HH:mm'),
    };

    try {
        const response = await fetch(
            `${global.baseUrl}/api/ura/chamado/`,
            createSGPJsonRequestInit(
                sgpUser.token,
                withSGPApplicationCredentials(global, payload)
            )
        );

        if (!response.ok) {
            const text = await response.text();
            console.error('[SGP] Error creating Service Order:', text);

            let errorMessage = response.statusText;
            try {
                const errorJson = JSON.parse(text);
                errorMessage = errorJson.message || errorJson.error || errorJson.erro || errorJson.msg || text;
            } catch {
                if (text && text.length < 200) {
                    errorMessage = text;
                }
            }

            return { success: false, error: `SGP Erro: ${errorMessage}` };
        }

        const data = await response.json();
        return { success: true, apiResponse: data };
    } catch (error) {
        console.error('[SGP] Exception creating Service Order:', error);
        return { success: false, error: 'Erro de conexao ao criar OS no SGP.' };
    }
}
