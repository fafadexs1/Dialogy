import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/actions/user';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { saveNexusCredential } from '@/modules/nexus/services/credentials';
import { requestPublicHttps } from '@/modules/nexus/services/public-http';
import { appOAuthConfig, appProvider, verifyAppAuthorization } from '@/services/ai-apps/app-oauth';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest,{params}:{params:Promise<{provider:string}>}) {
  const provider=appProvider((await params).provider); if(!provider) return NextResponse.json({error:'Aplicativo inválido.'},{status:400});
  let config:ReturnType<typeof appOAuthConfig>; try {config=appOAuthConfig(provider);} catch {return NextResponse.json({error:'Autorização não configurada.'},{status:503});}
  const redirect=(status:string)=>{const url=new URL('/integrations/ai-apps',config.origin); url.searchParams.set('app_oauth',status); const response=NextResponse.redirect(url); response.cookies.set(`dialogy_${provider}_oauth`,'',{httpOnly:true,secure:config.origin.startsWith('https:'),sameSite:'lax',path:`/api/integrations/app-oauth/${provider}/callback`,maxAge:0});response.headers.set('Cache-Control','no-store');return response;};
  const code=request.nextUrl.searchParams.get('code'),state=request.nextUrl.searchParams.get('state');
  if(request.nextUrl.searchParams.has('error')) return redirect('cancelado'); if(!code || code.length>4096 || !state) return redirect('invalido');
  const verified=verifyAppAuthorization(state,request.cookies.get(`dialogy_${provider}_oauth`)?.value,config.clientSecret,provider); if(!verified) return redirect('invalido');
  const user=await getCurrentUser(); if(!user || user.id!==verified.userId || user.activeWorkspaceId!==verified.workspaceId || !await hasWorkspacePermission(user.id,verified.workspaceId,'workspace:settings:edit')) return redirect('sem_permissao');
  try {
    const github=provider==='github'; const basic=Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const response=await requestPublicHttps({url:github?'https://github.com/login/oauth/access_token':'https://api.notion.com/v1/oauth/token',method:'POST',headers:github?{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'}:{'Content-Type':'application/json','Notion-Version':'2025-09-03',Authorization:`Basic ${basic}`},body:github?new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,redirect_uri:config.redirectUri,code_verifier:verified.verifier}).toString():JSON.stringify({grant_type:'authorization_code',code,redirect_uri:config.redirectUri}),timeoutMs:15000,maxResponseBytes:64000,signal:AbortSignal.timeout(15000)});
    const data=JSON.parse(response.body.toString('utf8')) as Record<string,unknown>;
    if(typeof data.access_token!=='string' || !data.access_token || data.access_token.length>16000 || /[\r\n]/.test(data.access_token) || (github && (typeof data.scope!=='string' || !data.scope.split(/[ ,]+/).includes('repo'))) || (!github && (typeof data.refresh_token!=='string' || !data.refresh_token || data.refresh_token.length>10000))) return redirect('token_invalido');
    const origin=github?'https://api.github.com':'https://api.notion.com';
    const payload=github?{token:data.access_token,clientId:config.clientId,clientSecret:config.clientSecret}:{provider:'notion',tokenUrl:'https://api.notion.com/v1/oauth/token',allowedOrigin:origin,clientId:config.clientId,clientSecret:config.clientSecret,refreshToken:data.refresh_token,grantType:'refresh_token',accessToken:data.access_token,expiresAt:Date.now()+3600000};
    await saveNexusCredential({workspaceId:verified.workspaceId,userId:user.id,name:`${github?'GitHub':'Notion'} · ${verified.access==='read'?'leitura':'leitura e escrita'}`,type:github?'bearer':'oauth2',payload,metadata:{kind:'agent_http',provider,access:verified.access,allowedOrigin:origin,baseUrl:origin,authType:github?'bearer_token':'oauth2'}});
    return redirect('conectado');
  } catch {return redirect('falha');}
}
