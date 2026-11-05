import 'dotenv/config';
import { db } from '../src/lib/db';
import { runStudioConversation } from '../src/services/agent-studio/runtime';
import { selectStudioConversationRelease } from '../src/services/agent-studio/release-selection';

import { randomUUID } from 'node:crypto';

async function main() {
  const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
  const agentId = '7d7259ab-a6c3-4057-a9ca-28ddbb15db95';
  const chatId = 'e7e596b8-4d5d-4645-a3b8-219077767920';
  const messageId = randomUUID();

  console.log('1. Carregando release ativa e store para chat...');
  const studioSelection = await selectStudioConversationRelease({
    workspaceId,
    agentId,
    chatId,
    sourceMessageId: messageId,
  });

  if (!studioSelection.release) {
    throw new Error('Nenhuma release ativa encontrada!');
  }
  const releaseVersion = (studioSelection.release as any).versionNumber || studioSelection.release.version;
  console.log(`✔ Release carregada: v${releaseVersion}`);

  const configRow = (await db.query('SELECT * FROM autopilot_configs WHERE id = $1', [agentId])).rows[0];
  const contactRow = (await db.query(
    'SELECT c.* FROM contacts c JOIN chats ch ON ch.contact_id = c.id WHERE ch.id = $1',
    [chatId]
  )).rows[0];

  console.log('2. Executando simulação de turno no Estúdio Adaptativo...');
  console.log('Mensagem do cliente: "meu CPF é 86675273191, pode me informar os contratos? Não sei de cor"');

  const result = await runStudioConversation({
    release: studioSelection.release,
    state: studioSelection.store.state,
    config: configRow,
    chatId,
    messageId,
    message: 'meu CPF é 86675273191, pode me informar os contratos? Não sei de cor',
    contact: contactRow,
    chatHistory: 'Cliente: meu CPF é 86675273191, pode me informar os contratos? Não sei de cor',
    checkpoint: async () => {},
    assertCurrent: async () => {},
    runNative: async (action) => {
      console.log('>>> runNative called:', action);
      return {};
    }
  });

  console.log('\n========================================================================');
  console.log('=== RESPOSTA DO LUCAS: ===');
  console.log('========================================================================');
  console.log(result.response);
  console.log('========================================================================');
  console.log('Operações executadas:', result.state.reasoning?.operations.map(o => ({
    title: o.title,
    capabilityId: o.capabilityId,
    status: o.status,
    valuesCount: Object.keys(o.values).length
  })));
  console.log('Status da sessão:', result.state.status, 'fase:', result.state.phase);
}

main().catch((err) => {
  console.error('Erro na simulação:', err);
  process.exit(1);
});
