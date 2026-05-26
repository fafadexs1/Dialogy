import { NextResponse } from 'next/server';

import { createTrackedWhatsappClick } from '@/lib/marketing-attribution-server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  props: { params: Promise<{ workspaceId: string; instanceName: string }> }
) {
  const params = await props.params;
  const url = new URL(request.url);
  const message = url.searchParams.get('text') || url.searchParams.get('message');

  const trackedClick = await createTrackedWhatsappClick({
    workspaceId: params.workspaceId,
    instanceName: params.instanceName,
    requestUrl: url,
    message,
  });

  if (!trackedClick) {
    return NextResponse.json(
      {
        error: 'Instancia sem telefone de WhatsApp configurado para tracking.',
      },
      { status: 404 }
    );
  }

  return NextResponse.redirect(trackedClick.redirectUrl, 302);
}
