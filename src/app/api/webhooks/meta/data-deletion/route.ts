import { NextRequest, NextResponse } from 'next/server';
import crypto, { randomUUID } from 'crypto';
import { logAction } from '@/lib/observability/logger';
import { recordWebhookMetrics } from '@/lib/observability/metrics';

export async function POST(req: NextRequest) {
    const requestId = randomUUID();
    const receivedAt = Date.now();
    try {
        const formData = await req.formData();
        const signedRequest = formData.get('signed_request') as string;

        if (!signedRequest) {
            await logAction({
                action: 'webhook_processed_fail',
                payload: {
                    request_id: requestId,
                    source: 'meta-data-deletion',
                    status_code: 400,
                    error: 'missing_signed_request',
                    duration_ms: Date.now() - receivedAt,
                },
            });
            recordWebhookMetrics({
                source: 'meta-data-deletion',
                status: 'fail',
                event: 'missing_signed_request',
                durationMs: Date.now() - receivedAt,
            });
            return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 });
        }

        const appSecret = process.env.FACEBOOK_APP_SECRET;

        if (!appSecret) {
            console.error("FACEBOOK_APP_SECRET is not defined");
            await logAction({
                action: 'webhook_processed_fail',
                payload: {
                    request_id: requestId,
                    source: 'meta-data-deletion',
                    status_code: 500,
                    error: 'missing_app_secret',
                    duration_ms: Date.now() - receivedAt,
                },
            });
            recordWebhookMetrics({
                source: 'meta-data-deletion',
                status: 'fail',
                event: 'missing_app_secret',
                durationMs: Date.now() - receivedAt,
            });
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const [encodedSig, payload] = signedRequest.split('.');
        const sig = base64decode(encodedSig);
        const data = JSON.parse(base64decode(payload));

        // Verify Signature
        const expectedSig = crypto
            .createHmac('sha256', appSecret)
            .update(payload)
            .digest();

        if (Buffer.compare(Buffer.from(sig, 'binary'), expectedSig) !== 0) {
            await logAction({
                action: 'webhook_processed_fail',
                payload: {
                    request_id: requestId,
                    source: 'meta-data-deletion',
                    status_code: 401,
                    error: 'invalid_signature',
                    duration_ms: Date.now() - receivedAt,
                },
            });
            recordWebhookMetrics({
                source: 'meta-data-deletion',
                status: 'fail',
                event: 'invalid_signature',
                durationMs: Date.now() - receivedAt,
            });
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }

        // Implementation of actual deletion logic would go here.
        // For now, we return the confirmation URL as required by Facebook.

        const confirmationCode = data.user_id || 'deletion_request_received';
        const statusUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://dialogy.app'}/deletion-status?id=${confirmationCode}`;

        await logAction({
            action: 'webhook_processed_success',
            payload: {
                request_id: requestId,
                source: 'meta-data-deletion',
                status_code: 200,
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'meta-data-deletion',
            status: 'success',
            event: 'data_deletion',
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json({
            url: statusUrl,
            confirmation_code: confirmationCode,
        });

    } catch (error) {
        console.error("Data Deletion Error:", error);
        await logAction({
            action: 'webhook_processed_fail',
            payload: {
                request_id: requestId,
                source: 'meta-data-deletion',
                status_code: 500,
                error: error instanceof Error ? error.message : 'internal_error',
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'meta-data-deletion',
            status: 'fail',
            event: 'internal_error',
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

function base64decode(str: string) {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
