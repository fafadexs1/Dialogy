import {
    createSGPJsonRequestInit,
    getSGPActiveWorkspaceContext,
    isSGPContextError,
    withSGPApplicationCredentials,
} from '../../runtime';

export async function generateSGPInvoicePixImpl(
    invoiceId: string,
    contractId: string
): Promise<{
    success: boolean;
    error?: string;
    payload?: any;
    raw?: string;
}> {
    const context = await getSGPActiveWorkspaceContext();
    if (isSGPContextError(context)) {
        return { success: false, error: context.error };
    }

    const { global, sgpUser, isGlobalReady } = context;
    if (!isGlobalReady || !global?.baseUrl) {
        return { success: false, error: 'Integracao SGP nao configurada globalmente.' };
    }

    if (!sgpUser?.token || !sgpUser.username) {
        return { success: false, error: 'Credenciais SGP do usuario nao configuradas.' };
    }

    const cleanInvoiceId = String(invoiceId ?? '').replace(/\D/g, '');
    const cleanContractId = String(contractId ?? '').replace(/\D/g, '');

    if (!cleanInvoiceId || !cleanContractId) {
        return { success: false, error: 'Fatura ou contrato invalido para gerar PIX.' };
    }

    try {
        const response = await fetch(
            `${global.baseUrl}/api/ura/pagamento/pix/${cleanInvoiceId}`,
            createSGPJsonRequestInit(
                sgpUser.token,
                withSGPApplicationCredentials(global, {
                    contrato: Number(cleanContractId),
                })
            )
        );

        const raw = await response.text();
        if (!response.ok) {
            console.error('[SGP] Error generating PIX:', raw);
            return { success: false, error: `Erro na API SGP: ${response.status} ${response.statusText}` };
        }

        try {
            return {
                success: true,
                payload: JSON.parse(raw),
                raw,
            };
        } catch {
            return {
                success: true,
                raw,
            };
        }
    } catch (error) {
        console.error('[SGP] Exception generating PIX:', error);
        return { success: false, error: 'Falha de conexao com SGP.' };
    }
}
