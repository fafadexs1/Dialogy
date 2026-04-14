import { NextRequest, NextResponse } from 'next/server';
import crypto, { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { logAction } from '@/lib/observability/logger';
import { recordWebhookMetrics } from '@/lib/observability/metrics';

export async function POST(req: NextRequest) {
    const requestId = randomUUID();
    const receivedAt = Date.now();
    try {
        const body = await req.text();
        const signedRequest = new URLSearchParams(body).get('signed_request') || '';

        if (!signedRequest) {
            await logAction({
                action: 'webhook_processed_fail',
                payload: {
                    request_id: requestId,
                    source: 'meta-deauthorize',
                    status_code: 400,
                    error: 'missing_signed_request',
                    duration_ms: Date.now() - receivedAt,
                },
            });
            recordWebhookMetrics({
                source: 'meta-deauthorize',
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
                    source: 'meta-deauthorize',
                    status_code: 500,
                    error: 'missing_app_secret',
                    duration_ms: Date.now() - receivedAt,
                },
            });
            recordWebhookMetrics({
                source: 'meta-deauthorize',
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
                    source: 'meta-deauthorize',
                    status_code: 401,
                    error: 'invalid_signature',
                    duration_ms: Date.now() - receivedAt,
                },
            });
            recordWebhookMetrics({
                source: 'meta-deauthorize',
                status: 'fail',
                event: 'invalid_signature',
                durationMs: Date.now() - receivedAt,
            });
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }

        const userId = data.user_id;
        console.log(`[Deauthorize] User ${userId} has deauthorized the app. Removing channels...`);

        // Requires the 'settings' column to store the fb_user_id inside JSON
        try {
            // Note: Postgres JSONB query syntax. 
            // We assume 'settings' is a JSONB column as defined in schema (implied). 
            // If it's text, we might need a different approach or cast.
            // Using parameterized query for safety. 
            // Syntax for checking JSON key: settings->>'fb_user_id'
            const result = await db.query(
                `DELETE FROM meta_channels WHERE settings->>'fb_user_id' = $1 RETURNING id`,
                [userId]
            );

            console.log(`[Deauthorize] Removed ${result.rowCount} channels for user ${userId}.`);
        } catch (dbError) {
            console.error("[Deauthorize] Failed to delete channels:", dbError);
            // We still return success to Facebook because we received the callback
        }

        // Facebook expects a success response
        await logAction({
            action: 'webhook_processed_success',
            payload: {
                request_id: requestId,
                source: 'meta-deauthorize',
                status_code: 200,
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'meta-deauthorize',
            status: 'success',
            event: 'deauthorize',
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Deauthorization Error:", error);
        await logAction({
            action: 'webhook_processed_fail',
            payload: {
                request_id: requestId,
                source: 'meta-deauthorize',
                status_code: 500,
                error: error instanceof Error ? error.message : 'internal_error',
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'meta-deauthorize',
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
