// Single reviewed ticket; refuses to act if the reviewed conversation changes.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const ticketId = '60e6df5c-af2d-4a14-8781-c9f8aa1f78a3';
const expectedAt = '2026-09-06T13:14:56.511Z';
const message = 'Olá! Aqui é a assistência automatizada da Dialogy. Ainda precisamos do exemplo solicitado para verificar a mudança de aba: acontece no computador ou no celular, qual classificação você aplica e para qual aba a tela muda? Pode informar um horário aproximado, sem dados pessoais. Como não recebemos retorno, este é um aviso de inatividade: se não houver resposta nas próximas 24 horas, o chamado poderá ser encerrado por inatividade, sem ser considerado problema resolvido. Você poderá reabri-lo se o comportamento continuar. A sugestão de classificar diretamente na lista permanece registrada.';
const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
async function main() {
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='5s'");
    await db.query("SET LOCAL lock_timeout='2s'");
    const t = (await db.query('SELECT status,updated_at FROM support_tickets WHERE id=$1 FOR UPDATE', [ticketId])).rows[0];
    const rows = (await db.query('SELECT m.id,m.user_id,m.is_staff,m.created_at,u.is_superadmin FROM support_messages m JOIN users u ON u.id=m.user_id WHERE m.ticket_id=$1 ORDER BY m.created_at', [ticketId])).rows;
    if (t?.status !== 'open' || new Date(t.updated_at).toISOString() !== expectedAt || rows.length !== 1
      || !rows[0].is_staff || !rows[0].is_superadmin || new Date(rows[0].created_at).toISOString() !== expectedAt
      || Date.now() - new Date(rows[0].created_at).getTime() < 48 * 3600000) throw new Error('REVIEW_CHANGED');
    if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ eligible: true, ticketId, previousAt: rows[0].created_at })); return; }
    const result = (await db.query('INSERT INTO support_messages(ticket_id,user_id,message,is_staff) VALUES($1,$2,$3,true) RETURNING id,created_at', [ticketId, rows[0].user_id, message])).rows[0];
    await db.query('UPDATE support_tickets SET updated_at=$2 WHERE id=$1', [ticketId, result.created_at]);
    await db.query('COMMIT');
    const check = (await db.query('SELECT m.id,m.created_at,t.status FROM support_messages m JOIN support_tickets t ON t.id=m.ticket_id WHERE m.id=$1 AND m.ticket_id=$2 AND m.message=$3', [result.id,ticketId,message])).rows;
    console.log(JSON.stringify({ persisted: check, nextReviewAfter: new Date(new Date(result.created_at).getTime()+86400000).toISOString() }));
  } finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
}
main().catch(e => { console.error(e.code || e.message); process.exitCode=1; });
