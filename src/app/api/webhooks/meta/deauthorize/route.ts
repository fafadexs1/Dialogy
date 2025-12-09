import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const signedRequest = formData.get('signed_request') as string;

        if (!signedRequest) {
            return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 });
        }

        const appSecret = process.env.FACEBOOK_APP_SECRET;

        if (!appSecret) {
            console.error("FACEBOOK_APP_SECRET is not defined");
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
        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Deauthorization Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

function base64decode(str: string) {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
