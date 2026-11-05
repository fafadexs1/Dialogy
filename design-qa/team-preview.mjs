// Local visual QA of the actual /team component, using in-memory demo data.
// No authentication or production data is accessed by this preview.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { PERMISSIONS } from '../src/lib/permissions-catalog.ts';

const out = resolve('scratch/team-preview');
mkdirSync(out, { recursive: true });
const fixture = `
const user = { id: 'member-0', name: 'Marina', activeWorkspaceId: 'preview-workspace', workspaces: [{ id: 'preview-workspace', name: 'Dialogy Studio' }] };
export const useCurrentUser = () => user;
export const useToast = () => ({ toast });
export function toast() {}
const members = ['Marina Oliveira', 'Pedro Santos', 'Luiza Costa', 'Rafael Lima', 'Clara Almeida', 'João Mendes'].map((name, i) => ({ id: 'member-' + i, name, avatar: '', email: name.split(' ')[0].toLowerCase() + '@example.test', online: i < 3, roleId: i === 0 ? 'admin' : 'role', role: i === 0 ? 'Administrador' : 'Atendimento', team: ['Sucesso do Cliente', 'Comercial', 'Suporte técnico', 'Comercial', 'Nenhuma', 'Sucesso do Cliente'][i], memberSince: ['jan. de 2026', 'mar. de 2026', 'abr. de 2026', 'jun. de 2026', 'set. de 2026', 'out. de 2026'][i], autopilotUsage: 0 }));
const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const permissions = ${JSON.stringify(PERMISSIONS)};
const roles = [
  { id: 'role', name: 'Atendimento', description: 'Quem transforma cada conversa em uma boa experiência.', is_default: true, permissions: permissions.filter(p => ['crm:view','crm:edit','inbox:access','teams:view','members:view','shortcuts:manage'].includes(p.id)) },
  { id: 'admin', name: 'Administrador', description: 'Acesso completo para cuidar de todo o workspace.', is_default: false, permissions: [...permissions] },
  { id: 'manager', name: 'Gestão', description: 'Visibilidade para acompanhar pessoas, conversas e resultados.', is_default: false, permissions: permissions.filter(p => p.id.includes('view') || p.id === 'inbox:access') }
];
members[3].avatar = '/preview-avatar.jpg';
const teams = ['Sucesso do Cliente', 'Comercial', 'Suporte técnico'].map((name, i) => ({ id: 'team-' + i, name, color: ['#648b73', '#c38b60', '#8398ad'][i], roleId: 'role', members: members.slice(0, 3 - i), agentRoutingConfig: { enabled: true, keywords: ['ajuda', 'suporte'] }, businessHours: days.map((day, d) => ({ id: 'day-' + d, day, isEnabled: d > 0 && d < 6, startTime: '09:00', endTime: '18:00' })), scheduleExceptions: [
  { id: 'past-1', team_id: 'team-' + i, date: '2026-10-12', description: 'Nossa Senhora Aparecida', is_closed: true, start_time: null, end_time: null },
  { id: 'past-2', team_id: 'team-' + i, date: '2026-09-07', description: 'Independência do Brasil', is_closed: true, start_time: null, end_time: null },
  { id: 'past-3', team_id: 'team-' + i, date: '2025-12-25', description: 'Natal', is_closed: true, start_time: null, end_time: null },
  { id: 'future-1', team_id: 'team-' + i, date: '2026-11-02', description: 'Finados', is_closed: true, start_time: null, end_time: null },
  { id: 'future-2', team_id: 'team-' + i, date: '2026-12-18', description: 'Encontro da equipe', is_closed: false, start_time: '09:00', end_time: '12:00' }
] }));
export async function getTeams() { return { teams: structuredClone(teams) }; }
export async function getWorkspaceMembers() { return { members: [...structuredClone(members), { ...members[2], team: 'Comercial' }] }; }
export async function updateMemberRoleAction(state, form) { const member = members.find(m => m.id === form.get('memberId')); const role = roles.find(r => r.id === form.get('roleId')); Object.assign(member, { roleId: role.id, role: role.name }); return { success: true }; }
export async function removeMemberAction(id) { const i = members.findIndex(m => m.id === id); members.splice(i, 1); return { success: true }; }
export async function getRolesAndPermissions() { return { roles: structuredClone(roles), permissions, canEdit: !location.search.includes('readonly') }; }
export async function updateRolePermissionAction(roleId, permissionId, enabled) { await new Promise(resolve => setTimeout(resolve, 350)); if (location.search.includes('fail-save')) return { success: false, error: 'Falha de conexão simulada na prévia local.' }; const role = roles.find(r => r.id === roleId); role.permissions = role.permissions.filter(p => p.id !== permissionId); if (enabled) role.permissions.push(permissions.find(p => p.id === permissionId)); return { success: true }; }
export async function createRoleAction(state, form) { const id = 'role-' + Date.now(); const name = form.get('name'); if (roles.some(r => r.name === name)) return { success: false, error: 'Já existe uma função com este nome.' }; roles.push({ id, name, description: form.get('description'), is_default: false, permissions: [] }); return { success: true, roleId: id }; }
export async function updateRoleAction(state, form) { Object.assign(roles.find(r => r.id === form.get('roleId')), { name: form.get('name'), description: form.get('description') }); return { success: true }; }
export async function deleteRoleAction(id) { const role = roles.find(r => r.id === id); if (role.is_default || role.name === 'Administrador' || members.some(m => m.roleId === id)) return { success: false, error: 'Esta função é protegida ou está vinculada a pessoas.' }; roles.splice(roles.findIndex(r => r.id === id), 1); return { success: true }; }
export async function getTags() { return { tags: [{ id: 'tag', label: 'Cliente', color: '#648b73' }] }; }
export async function createScheduleException(teamId, data) { teams.find(t => t.id === teamId).scheduleExceptions.push({ ...data, id: 'new-' + Date.now(), team_id: teamId }); return { success: true }; }
export async function deleteScheduleException(id) { teams.forEach(t => t.scheduleExceptions = t.scheduleExceptions.filter(e => e.id !== id)); return { success: true }; }
export async function updateTeam(id, data) { Object.assign(teams.find(t => t.id === id), data); return { success: true }; }
export async function addTeamMember(id, memberId) { teams.find(t => t.id === id).members.push(members.find(m => m.id === memberId)); return { success: true }; }
export async function removeTeamMember(id, memberId) { const team = teams.find(t => t.id === id); team.members = team.members.filter(m => m.id !== memberId); return { success: true }; }
export async function updateBusinessHours(id, hourId, data) { Object.assign(teams.find(t => t.id === id).businessHours.find(h => h.id === hourId), data); return { success: true }; }
export async function deleteTeam(id) { const i = teams.findIndex(t => t.id === id); teams.splice(i, 1); return { success: true }; }
export async function createTeam(data) { const team = { ...teams[0], ...data, id: 'new-team', color: '#648b73', members: [], scheduleExceptions: [] }; teams.push(team); return { team }; }
`;

await build({
  stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import TeamPage from './src/app/team/page'; import MembersPage from './src/app/team/members/page'; import PermissionsPage from './src/app/team/permissions/page'; if (location.search.includes('dark')) document.documentElement.className = 'dark'; createRoot(document.getElementById('root')).render(location.pathname.includes('permissions') ? <PermissionsPage /> : location.pathname.includes('members') ? <MembersPage /> : <TeamPage />);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, outfile: resolve(out, 'app.js'), jsx: 'automatic', loader: { '.css': 'local-css' }, define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'local-fixtures', setup(build) {
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'preview-link' }));
    build.onLoad({ filter: /.*/, namespace: 'preview-link' }, () => ({ contents: `import React from 'react'; export default function Link({ href, children, prefetch, ...props }) { const target = href === '/team' ? '/' : href === '/team/members' ? '/members' : href === '/team/permissions' ? '/permissions' : 'http://localhost:9002' + href; return <a {...props} href={target}>{children}</a>; }`, loader: 'jsx', resolveDir: process.cwd() }));
    build.onResolve({ filter: /^@\/(actions\/(teams|crm|members|permissions)|hooks\/(use-online-status|use-toast))$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'jsx' }));
  } }],
});
const css = readFileSync('src/app/globals.css', 'utf8').replace(/^@import[^;]+;/gm, '');
const compiled = await postcss([tailwindcss({ content: ['./src/app/team/**/*.tsx', './src/components/ui/**/*.{ts,tsx}'], theme: (await import('../tailwind.config.ts')).default.theme, plugins: (await import('../tailwind.config.ts')).default.plugins })]).process(css, { from: undefined });
writeFileSync(resolve(out, 'tailwind.css'), compiled.css);
writeFileSync(resolve(out, 'index.html'), `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1" /><meta charset="utf-8" /><title>Dialogy · Equipes · Prévia local</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/tailwind.css" /><link rel="stylesheet" href="/app.css" /><style>body{margin:0;font-family:Inter,sans-serif}#root{min-height:100vh}button,input{font:inherit}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
createServer((req, res) => {
  const name = (req.url || '/').split('?')[0];
  if (name === '/preview-avatar.jpg') {
    res.setHeader('Content-Type', 'image/jpeg');
    res.end(readFileSync(resolve('public/helton.jpg')));
    return;
  }
  if (name === '/mobile') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Dialogy · Prévia de celular</title><style>body{margin:0;background:#deddd6;display:flex;justify-content:center}iframe{width:390px;height:2200px;border:0}</style><iframe title="Dialogy no celular" src="/' + ((req.url || '').includes('permissions') ? 'permissions' : (req.url || '').includes('members') ? 'members' : '') + ((req.url || '').includes('dark') ? '?dark' : '') + '"></iframe>');
    return;
  }
  const file = { '/': 'index.html', '/members': 'index.html', '/permissions': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css', '/tailwind.css': 'tailwind.css' }[name];
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
  res.end(readFileSync(resolve(out, file)));
}).listen(9051, '127.0.0.1', () => console.log('Team visual QA: http://127.0.0.1:9051'));
