import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceAccess, requireWorkspacePermission, toPublicAccessError } from '@/lib/security/access';
import { createPrivateObjectDownloadUrl } from '@/lib/storage/private-s3';

const OBJECT_KEY_PATTERN = /^workspaces\/([0-9a-f-]{36})\/(crm-custom-fields|message-media|whatsapp-studio)\/[0-9a-f-]{36}\.[a-z0-9]+$/i;

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key') || '';
  const match = key.match(OBJECT_KEY_PATTERN);
  if (!match) return NextResponse.json({ code: 'invalid_key', error: 'Invalid object key.' }, { status: 400 });

  try {
    if (match[2] === 'whatsapp-studio') await requireWorkspaceAccess(match[1]);
    else await requireWorkspacePermission(match[1], match[2] === 'message-media' ? 'inbox:access' : 'crm:view');
    const signedUrl = await createPrivateObjectDownloadUrl(key);
    return NextResponse.redirect(signedUrl, { status: 307 });
  } catch (error) {
    const access = toPublicAccessError(error);
    if (access) return NextResponse.json(access, { status: access.status });
    return NextResponse.json(
      { code: 'dependency_unavailable', error: 'Storage temporarily unavailable.' },
      { status: 503 },
    );
  }
}
