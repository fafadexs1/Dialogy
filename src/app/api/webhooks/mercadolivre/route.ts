import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { MercadoLivreMessagingService, MercadoLivreAccountRecord } from '@/services/mercadolivre/messaging-service';
import { logAction } from '@/lib/observability/logger';
import { recordWebhookMetrics } from '@/lib/observability/metrics';

export async function POST(request: Request) {
    const requestId = randomUUID();
    const receivedAt = Date.now();
    try {
        const body = await request.json();
        const { topic, resource, user_id, received } = body;
        const payloadBytes = Buffer.byteLength(JSON.stringify(body ?? {}));

        await logAction({
            action: 'webhook_received',
            payload: {
                request_id: requestId,
                source: 'mercadolivre',
                event: topic,
                user_id,
                payload_bytes: payloadBytes,
            },
        });

        console.log(`[ML Webhook] Topic: ${topic}, Resource: ${resource}, User: ${user_id}`);

        // Validate if we have this user
        const accountRes = await db.query(
            'SELECT id, workspace_id, user_id, access_token, refresh_token FROM mercadolivre_accounts WHERE user_id = $1',
            [user_id]
        );

        if ((accountRes.rowCount ?? 0) === 0) {
            console.warn(`[ML Webhook] Received event for unknown user_id: ${user_id}`);
            await logAction({
                action: 'webhook_processed_success',
                payload: {
                    request_id: requestId,
                    source: 'mercadolivre',
                    status_code: 200,
                    event: topic,
                    result: 'ignored_user_not_found',
                    payload_bytes: payloadBytes,
                    duration_ms: Date.now() - receivedAt,
                },
            });
            recordWebhookMetrics({
                source: 'mercadolivre',
                status: 'success',
                event: topic,
                durationMs: Date.now() - receivedAt,
            });
            return NextResponse.json({ status: 'ignored', reason: 'User not found locally' });
        }

        const account: MercadoLivreAccountRecord = accountRes.rows[0];
        const service = new MercadoLivreMessagingService(account);

        // Handle Topics
        if (topic === 'questions') {
            const questionId = resource.split('/').pop();
            console.log(`[ML Webhook] Processing Question ID: ${questionId}`);

            try {
                const question = await service.getQuestion(questionId!);
                if (!question || !question.id) throw new Error('Question not found');

                // {
                //   "id": 12123123,
                //   "seller_id": 123456,
                //   "text": "Hola...",
                //   "status": "UNANSWERED",
                //   "item_id": "MLA123123",
                //   "from": { "id": 123123 },
                //   "date_created": "..."
                // }

                const buyerId = question.from.id;
                const itemId = question.item_id;
                const text = question.text;
                const status = question.status; // UNANSWERED | ANSWERED | CLOSED_UNANSWERED | UNDER_REVIEW

                // 1. Find/Create Contact (Buyer)
                // We don't have name/avatar unless we fetch user info (which might be public or restricted)
                // For now, use Buyer ID as name or placeholder.
                let contactId: string;
                const contactRes = await db.query(
                    'SELECT id FROM contacts WHERE phone_number_jid = $1 AND workspace_id = $2',
                    [String(buyerId), account.workspace_id]
                );

                if ((contactRes.rowCount ?? 0) > 0) {
                    contactId = contactRes.rows[0].id;
                } else {
                    const newContact = await db.query(
                        `INSERT INTO contacts (workspace_id, name, phone_number_jid, created_at)
                         VALUES ($1, $2, $3, NOW()) RETURNING id`,
                        [account.workspace_id, `Comprador ML ${buyerId}`, String(buyerId)]
                    );
                    contactId = newContact.rows[0].id;
                }

                // 2. Find/Create Chat
                // We group by Item ID? Or just one chat per Buyer?
                // Usually one chat per buyer is better for CRM context. But ML questions are per Item.
                // Let's stick to one chat per Buyer for now defined by 'mercadolivre' source.

                let chatId: string;
                const chatRes = await db.query(
                    `SELECT id
                     FROM chats
                     WHERE contact_id = $1
                       AND source = 'mercadolivre'
                       AND workspace_id = $2
                       AND status IN ('gerais', 'atendimentos')
                     ORDER BY updated_at DESC NULLS LAST, created_at DESC
                     LIMIT 1`,
                    [contactId, account.workspace_id]
                );

                if ((chatRes.rowCount ?? 0) > 0) {
                    chatId = chatRes.rows[0].id;
                } else {
                    const newChat = await db.query(
                        `INSERT INTO chats (workspace_id, contact_id, source, status, created_at, updated_at)
                         VALUES ($1, $2, 'mercadolivre', 'gerais', NOW(), NOW()) RETURNING id`,
                        [account.workspace_id, contactId]
                    );
                    chatId = newChat.rows[0].id;
                }

                // 3. Insert Message
                // Check duplication by external ID (questionId)
                // Using 'message_id_from_api' to store question_id
                const msgCheck = await db.query('SELECT id FROM messages WHERE message_id_from_api = $1', [String(questionId)]);
                if ((msgCheck.rowCount ?? 0) === 0) {
                    await db.query(
                        `INSERT INTO messages (
                            workspace_id, chat_id, type, content, from_me, is_read, 
                            message_id_from_api, api_message_status, 
                            metadata, created_at
                        ) VALUES ($1, $2, 'text', $3, false, false, $4, $5, $6, $7)`,
                        [
                            account.workspace_id,
                            chatId,
                            text,
                            String(questionId),
                            status,
                            {
                                event: 'mercadolivre_question',
                                itemId,
                                questionId,
                                buyerId,
                                isQuestion: true
                            },
                            new Date(question.date_created || Date.now())
                        ]
                    );
                }

            } catch (err) {
                console.error('[ML Webhook] Error processing question:', err);
            }

        } else if (topic === 'messages') {
            // Messages (Post-sale)
            const messageId = resource.split('/').pop(); // resource: /messages/{id}
            console.log(`[ML Webhook] Processing Message ID: ${messageId}`);

            try {
                const message = await service.getMessage(messageId!);
                // {
                //   "id": "...",
                //   "text": "...",
                //   "from": { "user_id": "..." },
                //   "to": { "user_id": "..." },
                //   "resource": "/orders/{order_id}",
                //   "resource_id": 123123
                // }

                // Ignora mensagens enviadas por mim (Seller)
                if (String(message.from.user_id) === String(account.user_id)) {
                    await logAction({
                        action: 'webhook_processed_success',
                        payload: {
                            request_id: requestId,
                            source: 'mercadolivre',
                            status_code: 200,
                            event: topic,
                            workspace_id: account.workspace_id,
                            result: 'ignored_from_me',
                            duration_ms: Date.now() - receivedAt,
                        },
                    });
                    recordWebhookMetrics({
                        source: 'mercadolivre',
                        status: 'success',
                        event: topic,
                        durationMs: Date.now() - receivedAt,
                    });
                    return NextResponse.json({ status: 'ignored', reason: 'From me' });
                }

                const buyerId = message.from.user_id;
                const text = message.text;
                const resourcePath = message.resource; // /orders/123...
                const packId = message.resource_id; // Order ID

                // 1. Find/Create Contact
                let contactId: string;
                const contactRes = await db.query(
                    'SELECT id FROM contacts WHERE phone_number_jid = $1 AND workspace_id = $2',
                    [String(buyerId), account.workspace_id]
                );
                if ((contactRes.rowCount ?? 0) > 0) {
                    contactId = contactRes.rows[0].id;
                } else {
                    const newContact = await db.query(
                        `INSERT INTO contacts (workspace_id, name, phone_number_jid, created_at)
                         VALUES ($1, $2, $3, NOW()) RETURNING id`,
                        [account.workspace_id, `Comprador ML ${buyerId}`, String(buyerId)]
                    );
                    contactId = newContact.rows[0].id;
                }

                // 2. Find/Create Chat
                let chatId: string;
                const chatRes = await db.query(
                    `SELECT id
                     FROM chats
                     WHERE contact_id = $1
                       AND source = 'mercadolivre'
                       AND workspace_id = $2
                       AND status IN ('gerais', 'atendimentos')
                     ORDER BY updated_at DESC NULLS LAST, created_at DESC
                     LIMIT 1`,
                    [contactId, account.workspace_id]
                );
                if ((chatRes.rowCount ?? 0) > 0) {
                    chatId = chatRes.rows[0].id;
                } else {
                    const newChat = await db.query(
                        `INSERT INTO chats (workspace_id, contact_id, source, status, created_at, updated_at)
                         VALUES ($1, $2, 'mercadolivre', 'gerais', NOW(), NOW()) RETURNING id`,
                        [account.workspace_id, contactId]
                    );
                    chatId = newChat.rows[0].id;
                }

                // 3. Insert Message
                const msgCheck = await db.query('SELECT id FROM messages WHERE message_id_from_api = $1', [String(messageId)]);
                if (msgCheck.rowCount === 0) {
                    await db.query(
                        `INSERT INTO messages (
                            workspace_id, chat_id, type, content, from_me, is_read, 
                            message_id_from_api, api_message_status, 
                            metadata, created_at
                        ) VALUES ($1, $2, 'text', $3, false, false, $4, 'RECEIVED', $5, NOW())`,
                        [
                            account.workspace_id,
                            chatId,
                            text,
                            String(messageId),
                            {
                                event: 'mercadolivre_message',
                                packId,
                                buyerId,
                                isQuestion: false
                            }
                        ]
                    );
                }

            } catch (err) {
                console.error('[ML Webhook] Error processing message:', err);
            }
        }

        await logAction({
            action: 'webhook_processed_success',
            payload: {
                request_id: requestId,
                source: 'mercadolivre',
                status_code: 200,
                event: topic,
                workspace_id: account.workspace_id,
                payload_bytes: payloadBytes,
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'mercadolivre',
            status: 'success',
            event: topic,
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json({ status: 'ok' });

    } catch (err: any) {
        console.error('[ML Webhook] Error:', err);
        const statusCode = err instanceof SyntaxError ? 400 : 500;
        const errorCode = err instanceof SyntaxError ? 'invalid_json' : 'internal_error';
        await logAction({
            action: 'webhook_processed_fail',
            payload: {
                request_id: requestId,
                source: 'mercadolivre',
                status_code: statusCode,
                error: errorCode,
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'mercadolivre',
            status: 'fail',
            event: errorCode,
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json(
            { error: statusCode === 400 ? 'invalid_json' : 'Internal Error' },
            { status: statusCode }
        );
    }
}
