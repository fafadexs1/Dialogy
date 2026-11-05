import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    connect: vi.fn(),
    clientQuery: vi.fn(),
    release: vi.fn(),
    fetchEvolutionAPI: vi.fn(),
    getEvolutionApiConfig: vi.fn(),
    findWhatsappChatByIdentity: vi.fn(),
    findOrCreateWhatsappContact: vi.fn(),
    lockWhatsappIdentityTransaction: vi.fn(),
    getMonthlyChatLimitStatus: vi.fn(),
    enqueueMarketingAutoClose: vi.fn(),
    createClient: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { query: mocks.query, connect: mocks.connect } }));
vi.mock('@/lib/observability/logger', () => ({
    withDebug: (_name: string, operation: unknown) => operation,
}));
vi.mock('@/lib/whatsapp/evolution-api-client', () => ({ fetchEvolutionAPI: mocks.fetchEvolutionAPI }));
vi.mock('@/lib/whatsapp/evolution-config', () => ({ getEvolutionApiConfig: mocks.getEvolutionApiConfig }));
vi.mock('@/lib/whatsapp/contact-identity', () => ({
    findWhatsappChatByIdentity: mocks.findWhatsappChatByIdentity,
    findOrCreateWhatsappContact: mocks.findOrCreateWhatsappContact,
    lockWhatsappIdentityTransaction: mocks.lockWhatsappIdentityTransaction,
    normalizeWhatsappPhoneNumber: (value: string) => value.replace(/\D/g, ''),
}));
vi.mock('@/lib/billing-logic', () => ({ getMonthlyChatLimitStatus: mocks.getMonthlyChatLimitStatus }));
vi.mock('@/lib/queue', () => ({ enqueueMarketingAutoClose: mocks.enqueueMarketingAutoClose }));

// Keep unrelated channels and background infrastructure out of this API/action regression test.
vi.mock('next/cache', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase', () => ({}));
vi.mock('@/services/whatsapp/send-text-message', () => ({}));
vi.mock('@/services/whatsapp/send-image-message', () => ({}));
vi.mock('@/services/whatsapp/send-video-message', () => ({}));
vi.mock('@/services/whatsapp/send-audio-message', () => ({}));
vi.mock('@/services/whatsapp/send-document-message', () => ({}));
vi.mock('@/services/whatsapp/send-list-message', () => ({}));
vi.mock('@/services/whatsapp/send-buttons-message', () => ({}));
vi.mock('@/services/meta/instagram-messaging-service', () => ({}));
vi.mock('@/services/meta/messenger-messaging-service', () => ({}));
vi.mock('@/services/meta/meta-channel.service', () => ({}));
vi.mock('@/lib/observability/inbox-events', () => ({}));
vi.mock('@/lib/presence-server', () => ({}));
vi.mock('@/services/telegram/bot-api', () => ({}));
vi.mock('@/services/rag/case-memory', () => ({}));
vi.mock('@/lib/whatsapp/customer-window', () => ({}));
vi.mock('@/lib/realtime/chat-broadcast', () => ({}));
vi.mock('@/server/inbox/access', () => ({}));
vi.mock('@/lib/security/system-agent-access', () => ({}));
vi.mock('@/services/messages/archive-outbound-media', () => ({}));

import { retryMessageAction, sendAgentTemplateAction } from '@/actions/messages';
import { POST } from '@/app/api/agent/templates/send/route';
import type { MessageMetadata } from '@/lib/types';

const agent = { id: 'agent-1', workspace_id: 'workspace-1', is_active: true, type: 'marketing' };
const input = {
    agentId: agent.id,
    workspaceId: agent.workspace_id,
    numberid: '5511999990000',
    instanceName: 'test-instance',
    name: 'test_invoice',
    language: 'pt_BR',
};
const pixError = 'Código PIX vazio ou ausente (pix_dynamic_code.code). Gere o PIX no sistema de origem e tente novamente.';

function pixComponents(code: unknown) {
    return [
        { type: 'body', parameters: [{ type: 'text', text: 'Fatura de teste' }] },
        {
            type: 'button',
            sub_type: 'order_details',
            parameters: [{
                type: 'action',
                action: {
                    order_details: {
                        payment_settings: [{ type: 'pix_dynamic_code', pix_dynamic_code: { code } }],
                    },
                },
            }],
        },
    ];
}

function request(body: Record<string, unknown>, token: string | null = 'test-token') {
    return new Request('http://localhost/api/agent/templates/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    });
}

function insertedMessage() {
    const inserts = mocks.clientQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO messages'));
    expect(inserts).toHaveLength(1);
    const values = inserts[0][1];
    return {
        id: values[0],
        workspaceId: values[1],
        chatId: values[2],
        content: values[4],
        fromMe: values[5],
        providerId: values[6],
        status: values[7],
        metadata: values[9] as MessageMetadata,
        senderSystemAgentId: values[11],
        senderUserId: values[12],
    };
}

describe('template failures in the conversation', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.query.mockResolvedValue({ rowCount: 1, rows: [agent] });
        mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
        mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[]) => ({
            rowCount: 1,
            rows: sql.includes('INSERT INTO chats') ? [{ id: values[0] }] : [],
        }));
        mocks.findWhatsappChatByIdentity.mockResolvedValue({ id: 'chat-1' });
        mocks.findOrCreateWhatsappContact.mockResolvedValue({
            normalizedJid: '5511999990000@s.whatsapp.net',
            contact: { id: 'contact-1' },
        });
        mocks.getMonthlyChatLimitStatus.mockResolvedValue({ allowed: true });
        mocks.getEvolutionApiConfig.mockResolvedValue({ api_url: 'https://evolution.example', api_key: 'test-key' });
        mocks.fetchEvolutionAPI.mockResolvedValue({ key: { id: 'wamid.test-1' } });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(['', '  ', null, undefined])('persists an invalid PIX (%s) as FAILED before returning HTTP 422', async (code) => {
        const components = pixComponents(code);
        const response = await POST(request({ ...input, components }));

        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ success: false, error: pixError });
        const message = insertedMessage();
        expect(message).toMatchObject({
            workspaceId: agent.workspace_id,
            chatId: 'chat-1',
            content: 'Fatura de teste',
            fromMe: true,
            providerId: null,
            status: 'FAILED',
            senderSystemAgentId: agent.id,
            senderUserId: null,
            metadata: {
                isTemplate: true,
                templateName: input.name,
                templateComponents: JSON.parse(JSON.stringify(components)),
                isMarketing: true,
                send_error: pixError,
                send_error_details: {
                    source: 'dialogy_template_validation',
                    status: 'FAILED',
                    reason: pixError,
                    code: 'INVALID_TEMPLATE_PAYLOAD',
                    captured_at: expect.any(String),
                },
            },
        });
        expect(mocks.clientQuery).toHaveBeenLastCalledWith('COMMIT');
        expect(mocks.release).toHaveBeenCalledOnce();
        expect(mocks.getEvolutionApiConfig).not.toHaveBeenCalled();
        expect(mocks.fetchEvolutionAPI).not.toHaveBeenCalled();
        expect(mocks.enqueueMarketingAutoClose).not.toHaveBeenCalled();
        expect(mocks.query).toHaveBeenCalledTimes(1); // Authentication only; no later status update.
    });

    it('records divergent invoice amounts as FAILED and returns 422 without sending', async () => {
        const components = [
            { type: 'body', parameters: [{ text: 'Cliente' }, { text: '3647' }, { text: '15/10/2026' }, { text: '79.99' }] },
            { type: 'button', sub_type: 'order_details', parameters: [{ action: { order_details: {
                total_amount: { value: 9990, offset: 100 },
                order: { subtotal: { value: 9990, offset: 100 }, items: [{ amount: { value: 9990, offset: 100 }, quantity: 1 }] },
            } } }] },
        ];
        const response = await POST(request({ ...input, components }));
        expect(response.status).toBe(422);
        expect(insertedMessage()).toMatchObject({ status: 'FAILED', metadata: { send_error: expect.stringMatching(/valor do texto.*difere/) } });
        expect(mocks.fetchEvolutionAPI).not.toHaveBeenCalled();
    });

    it.each([null, undefined, {}])('also records components that are not a list (%s)', async (components) => {
        const response = await POST(request({ ...input, components }));

        expect(response.status).toBe(422);
        expect(insertedMessage()).toMatchObject({
            status: 'FAILED',
            content: '[Template: test_invoice]',
            metadata: { send_error: 'Os componentes do template devem ser enviados em uma lista (components).' },
        });
        expect(mocks.fetchEvolutionAPI).not.toHaveBeenCalled();
    });

    it('keeps the failure in an existing closed conversation without reopening it', async () => {
        mocks.findWhatsappChatByIdentity.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'closed-chat' });

        await sendAgentTemplateAction({ ...input, components: pixComponents('') });

        expect(insertedMessage().chatId).toBe('closed-chat');
        expect(mocks.clientQuery.mock.calls.some(([sql]) => /(?:UPDATE|INSERT INTO) chats/.test(sql))).toBe(false);
    });

    it('creates a conversation when necessary and still does not send invalid PIX', async () => {
        mocks.findWhatsappChatByIdentity.mockResolvedValue(null);

        const result = await sendAgentTemplateAction({ ...input, components: pixComponents('') });

        expect(result).toMatchObject({ success: false, statusCode: 422 });
        const chatInsert = mocks.clientQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO chats'));
        expect(chatInsert).toBeDefined();
        expect(insertedMessage().chatId).toBe(chatInsert![1][0]);
        expect(mocks.getMonthlyChatLimitStatus).toHaveBeenCalledWith(agent.workspace_id);
        expect(mocks.fetchEvolutionAPI).not.toHaveBeenCalled();
    });

    it('never sends when saving the failed attempt fails', async () => {
        mocks.clientQuery.mockImplementation(async (sql: string) => {
            if (sql.includes('INSERT INTO messages')) throw new Error('Database unavailable');
            return { rowCount: 0, rows: [] };
        });

        const result = await sendAgentTemplateAction({ ...input, components: pixComponents('') });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Database unavailable');
        expect(mocks.clientQuery).toHaveBeenLastCalledWith('ROLLBACK');
        expect(mocks.release).toHaveBeenCalledOnce();
        expect(mocks.fetchEvolutionAPI).not.toHaveBeenCalled();
    });

    it('still sends valid templates and only sets SENT after provider acceptance', async () => {
        const result = await sendAgentTemplateAction({
            ...input, components: pixComponents('000201010212-test'), renderedContent: 'Fatura renderizada',
        });

        expect(result.success).toBe(true);
        expect(insertedMessage()).toMatchObject({ status: 'PENDING', content: 'Fatura renderizada' });
        expect(insertedMessage().metadata.send_error).toBeUndefined();
        expect(mocks.fetchEvolutionAPI).toHaveBeenCalledOnce();
        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("ELSE 'SENT'"), ['wamid.test-1', insertedMessage().id]);
        const commitIndex = mocks.clientQuery.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
        expect(mocks.clientQuery.mock.invocationCallOrder[commitIndex]).toBeLessThan(mocks.fetchEvolutionAPI.mock.invocationCallOrder[0]);
    });

    it('records an unconfirmed provider response as FAILED with its reason', async () => {
        mocks.fetchEvolutionAPI.mockResolvedValue({ message: 'Template not found', code: 132001 });

        const result = await sendAgentTemplateAction({ ...input, components: [], renderedContent: 'Template de teste' });

        expect(result).toMatchObject({ success: false, statusCode: 502 });
        const failureUpdate = mocks.query.mock.calls.find(([sql]) => sql.includes("api_message_status = 'FAILED'"));
        expect(failureUpdate?.[1][1]).toBe('Template not found');
        expect(JSON.parse(failureUpdate![1][2])).toMatchObject({ reason: 'Template not found', status: 'FAILED' });
        expect(mocks.fetchEvolutionAPI).toHaveBeenCalledOnce();
    });

    it('records missing provider configuration as a failure in the conversation', async () => {
        mocks.getEvolutionApiConfig.mockResolvedValue(null);

        const result = await sendAgentTemplateAction({ ...input, components: [] });

        expect(result.success).toBe(false);
        const failureUpdate = mocks.query.mock.calls.find(([sql]) => sql.includes("api_message_status = 'FAILED'"));
        expect(failureUpdate?.[1][1]).toContain('Configuracao da Evolution API nao encontrada');
        expect(mocks.fetchEvolutionAPI).not.toHaveBeenCalled();
    });

    it('preserves the reason when Evolution rejects the send', async () => {
        mocks.fetchEvolutionAPI.mockRejectedValue(new Error('Template indisponível para pt_BR'));

        const result = await sendAgentTemplateAction({ ...input, components: [], renderedContent: 'Template de teste' });

        expect(result.success).toBe(false);
        const failureUpdate = mocks.query.mock.calls.find(([sql]) => sql.includes("api_message_status = 'FAILED'"));
        expect(failureUpdate?.[1][1]).toBe('Template indisponível para pt_BR');
        expect(JSON.parse(failureUpdate![1][2])).toMatchObject({ reason: 'Template indisponível para pt_BR' });
        expect(mocks.fetchEvolutionAPI).toHaveBeenCalledOnce();
    });

    it('does not let Reenviar turn invalid PIX into a plain-text send or erase its failure', async () => {
        mocks.createClient.mockResolvedValue({
            auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
        });
        mocks.query
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [{
                    id: 'message-1',
                    workspace_id: agent.workspace_id,
                    type: 'text',
                    from_me: true,
                    api_message_status: 'FAILED',
                    metadata: { isTemplate: true, templateComponents: pixComponents(''), send_error: pixError },
                }],
            })
            .mockResolvedValueOnce({ rowCount: 1, rows: [{}] });

        const result = await retryMessageAction('message-1');

        expect(result).toEqual({ success: false, error: pixError });
        expect(mocks.query).toHaveBeenCalledTimes(2);
        expect(mocks.query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true);
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(mocks.fetchEvolutionAPI).not.toHaveBeenCalled();
    });

    it('does not create a conversation when the destination is missing', async () => {
        const response = await POST(request({ ...input, numberid: '', components: pixComponents('') }));

        expect(response.status).toBe(400);
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(mocks.fetchEvolutionAPI).not.toHaveBeenCalled();
    });

    it.each([null, 'inactive', 'invalid'])('does not record a message without an authorized active agent (%s)', async (token) => {
        if (token === 'inactive') mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ ...agent, is_active: false }] });
        if (token === 'invalid') mocks.query.mockResolvedValue({ rowCount: 0, rows: [] });

        const response = await POST(request({ ...input, components: pixComponents('') }, token));

        expect(response.status).toBe(token ? 403 : 401);
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(mocks.fetchEvolutionAPI).not.toHaveBeenCalled();
    });
});
