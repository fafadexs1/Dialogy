import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateAgentForPublication } from '@/services/agent-studio/assistant-validator';
import {
  advanceStudioSession,
  createStudioSession,
  type StudioEngineDependencies,
  type StudioSession,
} from '@/services/agent-studio/engine';
import {
  AgentStudioDocumentSchema,
  type AgentStudioDocument,
} from '@/services/agent-studio/types';

const artifactPath = path.join(process.cwd(), 'artifacts', 'agents', 'raquel-consultora-velpro.json');
const document = AgentStudioDocumentSchema.parse(JSON.parse(fs.readFileSync(artifactPath, 'utf8')));

function conversation(source: AgentStudioDocument = document) {
  let state: StudioSession = createStudioSession(source.id, 'draft-1', crypto.randomUUID());
  let turn = 0;
  const dependencies: StudioEngineDependencies = {
    execute: vi.fn(async () => ({ values: {} })),
    knowledge: vi.fn(async () => null),
    handoff: vi.fn(async () => {}),
    checkpoint: vi.fn(async () => {}),
  };

  return {
    dependencies,
    get state() {
      return state;
    },
    async send(message: string) {
      const result = await advanceStudioSession({
        document: source,
        state,
        message,
        messageId: `turn-${++turn}`,
        dependencies,
      });
      state = result.state;
      return result;
    },
  };
}

async function recommendation(answers: [string, string, string, string]) {
  const chat = conversation();
  await chat.send('Me ajude a escolher o melhor plano');
  await chat.send(answers[0]);
  await chat.send(answers[1]);
  await chat.send(answers[2]);
  return chat.send(answers[3]);
}

describe('Raquel | Consultora Velpro', () => {
  it('is a valid, publishable sales-agent draft with safe data collection', () => {
    expect(validateAgentForPublication(document)).toEqual({ valid: true, issues: [] });
    expect(document.serviceType).toBe('sales');
    expect(document.status).toBe('published');
    expect(document.publishedVersion).toBe(23);
    expect(document.resolveStage.procedures).toHaveLength(7);

    expect(document.rules.prohibitedDataLabels).toEqual(
      expect.arrayContaining(['senha', 'token', 'dados do cartão']),
    );
  });

  it('presents every official plan with punctuality and normal prices', () => {
    const catalog = document.resolveStage.procedures.find((procedure) => procedure.name === 'Conhecer planos e preços');
    const message = catalog?.steps[0]?.messageText || '';

    expect(message).toContain('500 MEGA');
    expect(message).toContain('*R$ 99,90/mês* com desconto de pontualidade · R$ 109,90 valor normal');
    expect(message).toContain('600 MEGA');
    expect(message).toContain('*R$ 109,90/mês* com desconto de pontualidade · R$ 119,90 valor normal');
    expect(message).toContain('800 MEGA');
    expect(message).toContain('*R$ 125,90/mês* com desconto de pontualidade · R$ 135,90 valor normal');
    expect(message).toContain('1000 MEGA');
    expect(message).toContain('*R$ 149,90/mês* com desconto de pontualidade · R$ 159,90 valor normal');
    expect(message).toContain('Instalação 100% Gratuita e Isenta');
    expect(message).toContain('https://velpro.net.br/tv');
  });

  it.each([
    ['500 MEGA', ['1', '1', 'não', 'não']],
    ['600 MEGA', ['2', '2', 'sim', 'não']],
    ['800 MEGA', ['5', '3', 'sim', 'não']],
    ['1000 MEGA', ['2', '4', 'não', 'sim']],
  ] as const)('recommends %s for the matching customer profile', async (plan, answers) => {
    const result = await recommendation([...answers]);
    expect(result.response).toContain(plan);
    expect(result.state.status).toBe('waiting_input');
  });

  it('qualifies a sales lead and hands it to Comercial with complete registration and doc flexibility', async () => {
    const chat = conversation();
    await chat.send('Quero contratar');
    await chat.send('1');
    await chat.send('Maria da Silva');
    await chat.send('09261820301');
    await chat.send('15/05/1990');
    await chat.send('maria@email.com');
    await chat.send('61999999999');
    await chat.send('sim'); // confirmação do telefone principal
    await chat.send('61988887777');
    await chat.send('72800-000');
    await chat.send('Rua das Flores, 100, Centro');
    await chat.send('Próximo à padaria');
    await chat.send('Dia 10');
    await chat.send('Tarde');
    await chat.send('sim'); // consentimento
    const result = await chat.send('Já estou enviando as fotos aqui'); // flexibilidade dos docs

    expect(result.state.status).toBe('transferred');
    expect(result.state.turnCount).toBe(16);
    expect(result.state.values).toMatchObject({
      selected_plan: expect.stringContaining('500 MEGA'),
      lead_name: 'Maria da Silva',
      lead_cpf: '09261820301',
      birth_date: '1990-05-15',
      lead_email: 'maria@email.com',
      lead_phone: '61999999999',
      secondary_phone: '61988887777',
      installation_cep: '72800000',
      installation_address: 'Rua das Flores, 100, Centro',
      installation_reference: 'Próximo à padaria',
      due_day: 'Dia 10',
      installation_shift: 'Tarde',
      contact_consent: true,
      docs_status: 'Já estou enviando as fotos aqui',
    });
    expect(chat.dependencies.handoff).toHaveBeenCalledWith(
      'b3b71514-098f-49fa-b922-f38a40065ef6',
      expect.stringContaining('[PRÉ-AGENDAMENTO GARANTIDO PELA RAQUEL'),
      expect.any(Object),
      expect.any(String),
    );
  });

  it('collects only CEP and address before handing coverage analysis to Comercial', async () => {
    const chat = conversation();
    await chat.send('Quero consultar cobertura');
    await chat.send('72800-000');
    const result = await chat.send('Rua das Palmeiras, 25, Centro');

    expect(result.state.status).toBe('transferred');
    expect(result.state.turnCount).toBe(3);
    expect(result.state.values).toMatchObject({
      coverage_cep: '72800000',
      coverage_address: 'Rua das Palmeiras, 25, Centro',
    });
    expect(chat.dependencies.handoff).toHaveBeenCalledWith(
      'b3b71514-098f-49fa-b922-f38a40065ef6',
      expect.any(String),
      expect.any(Object),
      expect.any(String),
    );
  });

  it.each([
    ['Sou cliente e estou sem internet', 'b9a74d62-7f65-46c1-a5ae-4887fde9926e'],
    ['Preciso da segunda via da fatura', 'e4991d0b-917c-42e7-8cde-014b0bdf5bb8'],
  ])('routes %s to %s', async (message, team) => {
    const chat = conversation();
    const result = await chat.send(message);
    expect(result.state.status).toBe('transferred');
    expect(chat.dependencies.handoff).toHaveBeenCalledWith(
      team,
      expect.any(String),
      expect.any(Object),
      expect.any(String),
    );
  });
});
