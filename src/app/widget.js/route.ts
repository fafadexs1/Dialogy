import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const base = request.nextUrl.origin;
  const script = `(function(){
  if(window.__dialogyWebchatLoaded)return;window.__dialogyWebchatLoaded=true;
  var s=document.currentScript;var key=s&&s.getAttribute('data-widget-id');if(!key){console.error('[Dialogy] data-widget-id ausente');return;}
  var origin=window.location.origin;var side='right';var color='#2563eb';
  var wrap=document.createElement('div');wrap.id='dialogy-webchat-root';wrap.style.cssText='position:fixed;z-index:2147483000;bottom:20px;right:20px;font-family:Inter,system-ui,sans-serif';
  var frame=document.createElement('iframe');frame.title='Chat Dialogy';frame.allow='clipboard-write';frame.style.cssText='display:none;width:min(390px,calc(100vw - 24px));height:min(640px,calc(100vh - 96px));border:0;border-radius:20px;box-shadow:0 22px 70px rgba(15,23,42,.24);background:#fff;margin-bottom:12px';
  frame.src='${base}/webchat/'+encodeURIComponent(key)+'?origin='+encodeURIComponent(origin)+'&url='+encodeURIComponent(location.href)+'&referrer='+encodeURIComponent(document.referrer);
  var button=document.createElement('button');button.type='button';button.setAttribute('aria-label','Abrir atendimento');button.style.cssText='margin-left:auto;display:flex;width:58px;height:58px;border:0;border-radius:999px;align-items:center;justify-content:center;background:'+color+';color:white;box-shadow:0 12px 30px rgba(15,23,42,.25);cursor:pointer';button.innerHTML='<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';
  var open=false;button.onclick=function(){open=!open;frame.style.display=open?'block':'none';button.setAttribute('aria-label',open?'Fechar atendimento':'Abrir atendimento');};
  window.addEventListener('message',function(e){if(e.origin!=='${base}')return;if(e.data&&e.data.type==='dialogy:webchat:close'){open=false;frame.style.display='none';}if(e.data&&e.data.type==='dialogy:webchat:config'){color=e.data.primaryColor||color;side=e.data.position||side;button.style.background=color;wrap.style.right=side==='right'?'20px':'auto';wrap.style.left=side==='left'?'20px':'auto';}});
  document.body.appendChild(wrap);wrap.appendChild(frame);wrap.appendChild(button);
})();`;
  return new NextResponse(script, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
