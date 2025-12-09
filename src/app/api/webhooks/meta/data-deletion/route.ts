import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

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

        // Implementation of actual deletion logic would go here.
        // For now, we return the confirmation URL as required by Facebook.

        const confirmationCode = data.user_id || 'deletion_request_received';
        const statusUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://dialogy.app'}/deletion-status?id=${confirmationCode}`;

        return NextResponse.json({
            url: statusUrl,
            confirmation_code: confirmationCode,
        });

    } catch (error) {
        console.error("Data Deletion Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

function base64decode(str: string) {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
