import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { getWorkspaceLimits, isWorkspaceSubscriptionActive, getWorkspaceBillingStatus } from '../src/lib/billing-logic';

async function verify() {
  const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';

  console.log('=== VERIFICANDO ACESSO DA WORKSPACE VELPRO ===');
  
  const status = await getWorkspaceBillingStatus(workspaceId);
  console.log(`Status de Billing: ${status}`);

  const isActive = await isWorkspaceSubscriptionActive(workspaceId);
  console.log(`Assinatura Ativa (isWorkspaceSubscriptionActive): ${isActive}`);

  const limits = await getWorkspaceLimits(workspaceId);
  console.log(`Bloqueado (blocked): ${limits.blocked}`);
  console.log(`Plano: ${limits.plan}`);
  console.log(`Disponibilidade: ${limits.availability}`);
  console.log(`Limite Mensal de Chats: ${limits.limits.monthly_chats}`);
  console.log(`Limite de Usuários: ${limits.limits.users}`);
  console.log(`Limite WhatsApp: ${limits.limits.whatsapp}`);
  console.log(`Autopilot Agents: ${limits.limits.autopilot_agents}`);
  console.log(`IA BYOK: ${limits.limits.ai_byok}`);
  console.log(`Transcrição: ${limits.limits.transcription}`);

  if (limits.blocked) {
    throw new Error('FALHA: Workspace continua bloqueada!');
  }
  if (!isActive) {
    throw new Error('FALHA: Assinatura não reporta ativa!');
  }

  console.log('\n>>> SUCESSO: Workspace da Velpro está 100% liberada e operacional! <<<');
  process.exit(0);
}

verify().catch((err) => {
  console.error(err);
  process.exit(1);
});
