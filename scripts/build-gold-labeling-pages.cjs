// Builds one offline labelling page per rater from the masked gold-dataset export.
//   node scripts/build-gold-labeling-pages.cjs [--raters=2]
// Input:  .gold-dataset/*.jsonl      (npx tsx scripts/export-gold-candidates.ts --export --confirm-sensitive)
// Output: .gold-dataset/package/rotulagem-rater-a.html, rotulagem-rater-b.html and GUIA.md
// The pages hold masked customer conversations: they never leave the machine unless somebody sends them.
// Progress is autosaved in the browser; "Baixar rotulagem" writes a .jsonl that scripts/gold-agreement.cjs reads.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, '.gold-dataset');
const outDir = path.join(dataDir, 'package');
const raters = Math.max(1, Math.min(4, Number((process.argv.find((a) => a.startsWith('--raters=')) || '--raters=2').split('=')[1])));
if (!fs.existsSync(dataDir)) throw new Error('Rode antes: npx tsx scripts/export-gold-candidates.ts --export --confirm-sensitive');

const files = fs.readdirSync(dataDir).filter((name) => name.endsWith('.jsonl')).sort();
const conversations = files.flatMap((name) => fs.readFileSync(path.join(dataDir, name), 'utf8').split('\n').filter(Boolean).map(JSON.parse));
if (!conversations.length) throw new Error('Nenhuma conversa em .gold-dataset/.');

// Deterministic shuffle so raters do not see the strata in blocks (the stratum name hints at the outcome).
const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const rand = seeded(20261105);
const order = conversations.map((c) => [rand(), c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
// Hide what really happened: raters judge from the conversation, not from the weak label or stratum.
const blindId = (index) => 'c' + String(index + 1).padStart(3, '0');
// System lines that announce the real transfer or close would anchor the rater on what the human did.
const HIDDEN_EVENTS = new Set(['transfer', 'transfer_queued', 'close']);
const blind = order.map((c, index) => ({ conversationId: blindId(index), position: index + 1,
  turns: c.turns.filter((turn) => !(turn.role === 'system' && HIDDEN_EVENTS.has(turn.event))) }));

const HANDOFF = [['cliente_pediu', 'Cliente pediu uma pessoa'], ['fora_de_escopo', 'Fora do escopo da IA'], ['risco_sensivel', 'Risco ou dado sensível'],
  ['falha_de_ferramenta', 'Falha de ferramenta'], ['incerteza_alta', 'Incerteza alta depois de esclarecer'], ['limite_de_turnos', 'Conversa sem progresso'],
  ['operacao_incerta', 'Operação sem confirmação'], ['reclamacao_grave', 'Reclamação grave']];
const CLOSE = [['cliente_confirmou', 'Cliente confirmou que acabou'], ['resolucao_comprovada', 'Resolvido e sem pendência'], ['inatividade_pos_followup', 'Sumiu depois do aviso']];

const page = (rater) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rotulagem ${rater}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--mute:#5d6676;--line:#dde1e8;--acc:#2457d6;--cus:#e8eefc;--bot:#eef3ee;--sys:#f1f1f1;--ok:#1f7a45}
@media(prefers-color-scheme:dark){:root{--bg:#14161a;--card:#1c1f25;--ink:#e8eaee;--mute:#9aa3b2;--line:#2c313a;--acc:#7da2ff;--cus:#22304f;--bot:#1f2a21;--sys:#262a31;--ok:#5fcf8f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header h1{font-size:16px;margin:0;flex:1 1 auto}.meter{color:var(--mute);font-size:13px}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:7px 12px;cursor:pointer}
button.primary{background:var(--acc);border-color:var(--acc);color:#fff}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
main{display:grid;grid-template-columns:220px 1fr;gap:16px;padding:16px;max-width:1100px;margin:0 auto}
@media(max-width:760px){main{grid-template-columns:1fr}}
nav{display:flex;flex-wrap:wrap;gap:6px;align-content:flex-start}
nav button{padding:4px 9px;font-size:13px}nav button.done{border-color:var(--ok);color:var(--ok)}nav button.cur{background:var(--acc);border-color:var(--acc);color:#fff}
.chat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:82%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word}
.msg small{display:block;color:var(--mute);font-size:11px;margin-bottom:2px}
.customer{align-self:flex-start;background:var(--cus)}.agent_or_bot,.ai{align-self:flex-end;background:var(--bot)}
.system{align-self:center;background:var(--sys);color:var(--mute);font-size:13px}
.decide{align-self:flex-start;display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:6px 0 10px 4px;font-size:13px}
.decide label{color:var(--mute)}select,textarea{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
.decide.act select.d{border-color:var(--acc);font-weight:600}
textarea{width:100%;min-height:64px}.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px}
.note{color:var(--mute);font-size:13px}
</style></head><body>
<header><h1>Rotulagem · ${rater}</h1><span class="meter" id="meter"></span>
<button id="load">Carregar arquivo salvo</button><button class="primary" id="save">Baixar rotulagem</button><input type="file" id="file" accept=".jsonl" hidden></header>
<main><nav id="nav" aria-label="Conversas"></nav><section><div class="chat" id="chat"></div>
<div class="bar"><label><input type="checkbox" id="rev"> Revisei esta conversa inteira</label><button id="prev">Anterior</button><button id="next">Próxima</button></div>
<p class="note">Para cada mensagem do cliente, escolha o que um atendente automático ideal faria <b>depois dela</b>. O padrão é “continuar”. Só mude quando for transferir ou encerrar. Na dúvida entre continuar e encerrar, continue. Marque “Revisei” ao terminar; conversa sem essa marca não conta.</p>
<label class="note" for="note">Observações desta conversa (por exemplo, dado pessoal sem máscara ou áudio que faltou)</label><textarea id="note"></textarea></section></main>
<script>
var DATA=${JSON.stringify(blind).replace(/</g, '\\u003c')};
var HANDOFF=${JSON.stringify(HANDOFF)}, CLOSE=${JSON.stringify(CLOSE)}, RATER=${JSON.stringify(rater)};
var KEY='gold-labels-'+RATER, state={}, cur=0;
try{state=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){state={}}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
function entry(id){return state[id]||(state[id]={decisions:{},reviewed:false,note:''})}
function opts(list,sel,ph){var h='<option value="">'+ph+'</option>';list.forEach(function(o){h+='<option value="'+o[0]+'"'+(sel===o[0]?' selected':'')+'>'+o[1]+'</option>'});return h}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function who(r){return r==='customer'?'Cliente':r==='ai'?'IA':r==='system'?'Sistema':'Atendente ou bot'}
function render(){
  var c=DATA[cur],e=entry(c.conversationId),h='';
  c.turns.forEach(function(t){
    h+='<div class="msg '+t.role+'"><small>'+who(t.role)+(t.event?' · '+esc(t.event):'')+' · '+t.t+'s</small>'+esc(t.text)+'</div>';
    if(t.role==='customer'){
      var d=e.decisions[t.idx]||{decision:'continue'};
      h+='<div class="decide'+(d.decision!=='continue'?' act':'')+'"><label>Depois desta mensagem:</label>'
        +'<select class="d" data-t="'+t.idx+'"><option value="continue"'+(d.decision==='continue'?' selected':'')+'>Continuar</option>'
        +'<option value="handoff"'+(d.decision==='handoff'?' selected':'')+'>Transferir para uma pessoa</option>'
        +'<option value="close"'+(d.decision==='close'?' selected':'')+'>Encerrar</option></select>'
        +(d.decision==='handoff'?'<select class="r" data-t="'+t.idx+'">'+opts(HANDOFF,d.reason,'Motivo…')+'</select>':'')
        +(d.decision==='close'?'<select class="r" data-t="'+t.idx+'">'+opts(CLOSE,d.closeBasis,'Base…')+'</select>':'')+'</div>';
    }
  });
  document.getElementById('chat').innerHTML=h;
  document.getElementById('rev').checked=!!e.reviewed;document.getElementById('note').value=e.note||'';
  var n='';DATA.forEach(function(x,i){var done=entry(x.conversationId).reviewed;n+='<button class="'+(done?'done ':'')+(i===cur?'cur':'')+'" data-i="'+i+'" aria-label="Conversa '+(i+1)+(done?' revisada':'')+'">'+(i+1)+'</button>'});
  document.getElementById('nav').innerHTML=n;
  var done=DATA.filter(function(x){return entry(x.conversationId).reviewed}).length;
  document.getElementById('meter').textContent=done+' de '+DATA.length+' revisadas';
  window.scrollTo(0,0);
}
document.getElementById('chat').addEventListener('change',function(ev){
  var el=ev.target,t=el.getAttribute('data-t');if(t===null)return;var e=entry(DATA[cur].conversationId);
  if(el.classList.contains('d')){e.decisions[t]={decision:el.value};if(el.value==='continue')delete e.decisions[t];}
  else{var d=e.decisions[t]||{};if(d.decision==='handoff')d.reason=el.value;else d.closeBasis=el.value;e.decisions[t]=d}
  persist();render();
});
document.getElementById('nav').addEventListener('click',function(ev){var i=ev.target.getAttribute('data-i');if(i!==null){cur=+i;render()}});
document.getElementById('rev').addEventListener('change',function(ev){entry(DATA[cur].conversationId).reviewed=ev.target.checked;persist();render()});
document.getElementById('note').addEventListener('input',function(ev){entry(DATA[cur].conversationId).note=ev.target.value;persist()});
document.getElementById('prev').onclick=function(){cur=Math.max(0,cur-1);render()};
document.getElementById('next').onclick=function(){cur=Math.min(DATA.length-1,cur+1);render()};
document.getElementById('save').onclick=function(){
  var lines=DATA.map(function(c){var e=entry(c.conversationId),ds=[];
    Object.keys(e.decisions).forEach(function(k){var d=e.decisions[k],o={turn:+k,decision:d.decision};if(d.reason)o.reason=d.reason;if(d.closeBasis)o.closeBasis=d.closeBasis;ds.push(o)});
    return JSON.stringify({conversationId:c.conversationId,turns:c.turns,gold:{rater:RATER,reviewed:!!e.reviewed,decisions:ds,note:e.note||''}})});
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\\n')+'\\n'],{type:'application/x-ndjson'}));a.download='rotulagem-'+RATER+'.jsonl';a.click();
};
document.getElementById('load').onclick=function(){document.getElementById('file').click()};
document.getElementById('file').onchange=function(ev){var f=ev.target.files[0];if(!f)return;var r=new FileReader();r.onload=function(){
  r.result.split('\\n').filter(Boolean).forEach(function(l){try{var o=JSON.parse(l),e=entry(o.conversationId);e.reviewed=!!(o.gold&&o.gold.reviewed);e.note=(o.gold&&o.gold.note)||'';e.decisions={};
    ((o.gold&&o.gold.decisions)||[]).forEach(function(d){e.decisions[d.turn]={decision:d.decision,reason:d.reason,closeBasis:d.closeBasis}})}catch(x){}});persist();render()};r.readAsText(f)};
render();
</script></body></html>`;

fs.mkdirSync(outDir, { recursive: true });
const letters = 'abcd';
for (let i = 0; i < raters; i += 1) {
  const name = `rater-${letters[i]}`;
  fs.writeFileSync(path.join(outDir, `rotulagem-${name}.html`), page(name), 'utf8');
}
// Maps the blinded export back to the strata for the later analysis. Stays on this machine, not in the package sent out.
fs.writeFileSync(path.join(dataDir, 'answer-key.json'), JSON.stringify(order.map((c, index) => ({
  conversationId: blindId(index), originalId: c.conversationId, position: index + 1, stratum: c.stratum, weakLabel: c.weakLabel })), null, 2), 'utf8');
fs.copyFileSync(path.join(root, 'docs', 'GOLD-DATASET-rotulagem.md'), path.join(outDir, 'GUIA.md'));
console.log(JSON.stringify({ conversations: blind.length, pages: raters, out: path.relative(root, outDir),
  note: 'answer-key.json (grupo e desfecho real de cada conversa) fica em .gold-dataset/ e NÃO deve ser enviado.' }));
