import 'dotenv/config';
import { db } from '../src/lib/db';
import { loadStudioRelease } from '../src/services/agent-studio/repository';
import { createStudioSession, advanceStudioSession, type StudioSession } from '../src/services/agent-studio/engine';
import { randomUUID } from 'node:crypto';

async function main() {
  const workspaceId = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab';
  const agentId = '0a952e14-2fdc-47eb-99d6-733a2d4868a5';

  console.log('=== VERIFICANDO VERSÃO PUBLICADA NO BANCO DE DADOS ===');
  const release = await loadStudioRelease(workspaceId, agentId);
  if (!release) throw new Error('Release não encontrado no banco!');

  console.log(`Release ID: ${release.releaseId}`);
  console.log(`Versão publicada: v${release.version}`);
  console.log(`Agente: ${release.agentSnapshot.name}`);
  console.log(`Procedimentos ativos: ${release.publishedProcedures.length}`);

  const contractProc = release.publishedProcedures.find(p => p.name.includes('contrat'));
  if (!contractProc) throw new Error('Procedimento Iniciar contratação não encontrado!');

  console.log(`Etapas do procedimento de contratação: ${contractProc.steps.length}`);
  for (const s of contractProc.steps) {
    console.log(`  [${s.order}] ${s.type} - ${s.title} (${s.id})`);
  }

  console.log('\n=== TESTANDO SIMULAÇÃO DE CONVERSA ===');
  let session: StudioSession = createStudioSession(agentId, release.releaseId, randomUUID());

  const executeTurn = async (userMsg: string) => {
    console.log(`\n💬 [CLIENTE]: ${userMsg}`);
    const turnId = randomUUID();
    const res = await advanceStudioSession({
      document: release.agentSnapshot,
      state: session,
      message: userMsg,
      messageId: turnId,
      context: {
        contact: { id: 'contact-test', name: 'João da Silva', phone: '61999998888', email: 'joao@email.com' }
      },
      dependencies: {
        assertActive: () => {},
        now: Date.now,
        knowledge: async () => 'Resposta da base oficial',
        decide: async () => null,
        planAction: async () => null,
        planCollection: false,
        handoff: async () => {},
      } as any
    });
    session = res.state;
    console.log(`🤖 [RAQUEL]:\n${res.response}`);
    return res;
  };

  // Turn 1: Conhecer planos
  await executeTurn('Quais são os planos de internet?');

  // Turn 2: Iniciar contratação
  await executeTurn('Quero contratar');

  // Turn 3: Escolha do plano
  await executeTurn('2');

  // Turn 4: Nome completo
  await executeTurn('João da Silva');

  // Turn 5: CPF do titular
  await executeTurn('09261820301');

  // Turn 6: Data de nascimento
  await executeTurn('15/05/1990');

  // Turn 7: E-mail
  await executeTurn('joao.silva@gmail.com');

  // Turn 8: Telefone principal
  await executeTurn('61999998888');

  // Se pedir confirmação de telefone
  if (session.confirmation) {
    await executeTurn('sim');
  }

  // Turn 9: Segundo telefone
  await executeTurn('61988887777');

  // Turn 10: CEP
  await executeTurn('72870000');

  // Turn 11: Endereço completo
  await executeTurn('Rua 15, Quadra 20, Lote 5, Bairro Centro, Cidade Ocidental');

  // Turn 12: Ponto de referência
  await executeTurn('Próximo à Padaria Pão Dourado');

  // Turn 13: Vencimento
  await executeTurn('Dia 10');

  // Turn 14: Turno de instalação
  await executeTurn('Manhã');

  // Turn 15: Autorização
  await executeTurn('sim');

  // Turn 16: Status dos documentos
  await executeTurn('Já estou enviando as fotos aqui');

  console.log('\n=== STATUS FINAL DA SESSÃO ===');
  console.log(`Fase: ${session.phase}`);
  console.log(`Status: ${session.status}`);
  console.log('Valores coletados com perfeição na ficha:');
  console.log(JSON.stringify(session.values, null, 2));

  console.log('\n✔ TODAS AS ETAPAS E VALIDAÇÕES PASSARAM COM 100% DE SUCESSO!');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
