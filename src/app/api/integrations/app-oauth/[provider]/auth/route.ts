import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/actions/user';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { appAccess, appOAuthConfig, appProvider, createAppAuthorization } from '@/services/ai-apps/app-oauth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest,{params}:{params:Promise<{provider:string}>}) {
  const provider=appProvider((await params).provider), access=appAccess(request.nextUrl.searchParams.get('access'));
  if(!provider || !access) return NextResponse.json({error:'Aplicativo ou permissão inválida.'},{status:400});
  const user=await getCurrentUser(); if(!user?.activeWorkspaceId) return NextResponse.json({error:'Usuário não autenticado.'},{status:401});
  if(!await hasWorkspacePermission(user.id,user.activeWorkspaceId,'workspace:settings:edit')) return NextResponse.json({error:'Acesso negado.'},{status:403});
  try { const config=appOAuthConfig(provider); const authorization=createAppAuthorization({...config,userId:user.id,workspaceId:user.activeWorkspaceId,provider,access});
    const response=NextResponse.redirect(authorization.url); response.cookies.set(`dialogy_${provider}_oauth`,Buffer.from(JSON.stringify({state:authorization.state,verifier:authorization.verifier})).toString('base64url'),{httpOnly:true,secure:config.origin.startsWith('https:'),sameSite:'lax',path:`/api/integrations/app-oauth/${provider}/callback`,maxAge:600}); response.headers.set('Cache-Control','no-store'); return response;
  } catch { return NextResponse.json({error:'Autorização do aplicativo não configurada no servidor.'},{status:503}); }
}
