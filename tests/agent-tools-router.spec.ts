import { describe, expect, it } from 'vitest';

import { routeDeterministicAgentTools } from '@/services/agent-tools/router';

const teams = [
  { id: 'team-support', name: 'Suporte' },
  { id: 'team-finance', name: 'Financeiro' },
  { id: 'team-sales', name: 'Comercial' },
];

describe('agent tools deterministic router', () => {
  it('routes direct team mentions without waiting for the LLM to choose the tool', () => {
    const result = routeDeterministicAgentTools({
      customerMessage: 'Pode me passar para o Financeiro? Preciso da segunda via do boleto.',
      contactName: 'Cliente Teste',
      availableTeams: teams,
    });

    expect(result.matchedReason).toContain('Financeiro');
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].type).toBe('add_internal_note');
    expect(result.actions[1]).toMatchObject({
      type: 'transfer_chat',
      payload: { teamId: 'team-finance' },
    });
  });

  it('routes explicit sector transfer phrased as "me transfere para o setor comercial"', () => {
    const result = routeDeterministicAgentTools({
      customerMessage: 'Me transfere para o setor comercial?',
      availableTeams: [
        {
          id: 'team-sales',
          name: 'Comercial',
          routingConfig: {
            enabled: true,
            autoTransfer: true,
            keywords: ['contratar', 'assinar', 'adquirir'],
            responseHint: 'Iremos transferir para o setor comercial, um momento!',
          },
        },
      ],
    });

    expect(result.matchedReason).toContain('Comercial');
    expect(result.responseHint).toBe('Vou encaminhar seu atendimento para a equipe Comercial.');
    expect(result.actions[1]).toMatchObject({
      type: 'transfer_chat',
      payload: { teamId: 'team-sales' },
    });
  });

  it('routes configurable team rules only when the customer explicitly asks for that team', () => {
    const result = routeDeterministicAgentTools({
      customerMessage: 'Pode me transferir para a Agenda? Preciso reagendar minha consulta para amanha',
      availableTeams: [
        ...teams,
        {
          id: 'team-scheduling',
          name: 'Agenda',
          routingConfig: {
            enabled: true,
            autoTransfer: true,
            keywords: ['consulta', 'reagendar', 'horario'],
            responseHint: 'Vou encaminhar seu atendimento para nossa equipe de agenda.',
          },
        },
      ],
    });

    expect(result.matchedReason).toContain('Agenda');
    expect(result.responseHint).toBe('Vou encaminhar seu atendimento para nossa equipe de agenda.');
    expect(result.actions[1]).toMatchObject({
      type: 'transfer_chat',
      payload: { teamId: 'team-scheduling' },
    });
  });

  it('routes human handoff requests using workspace-defined domain keywords', () => {
    const result = routeDeterministicAgentTools({
      customerMessage: 'Quero falar com um atendente para reagendar minha consulta.',
      availableTeams: [{
        id: 'team-scheduling',
        name: 'Agenda',
        routingConfig: {
          enabled: true,
          autoTransfer: true,
          keywords: ['reagendar', 'consulta'],
        },
      }, ...teams],
    });

    expect(result.matchedReason).toContain('Agenda');
    expect(result.actions[1]).toMatchObject({
      type: 'transfer_chat',
      payload: { teamId: 'team-scheduling' },
    });
  });

  it('routes explicit human handoff requests even without a sector', () => {
    const result = routeDeterministicAgentTools({
      customerMessage: 'Transfere para um humano por favor?',
      availableTeams: teams,
    });

    expect(result.matchedReason).toContain('atendimento humano');
    expect(result.responseHint).toContain('Suporte');
    expect(result.actions[1]).toMatchObject({
      type: 'transfer_chat',
      payload: { teamId: 'team-support' },
    });
  });

  it('does not route commercial purchase intent while the AI can still conclude the sale', () => {
    const result = routeDeterministicAgentTools({
      customerMessage: 'Quero assinar esse de 1000 MEGA.',
      availableTeams: teams,
    });

    expect(result.actions).toHaveLength(0);
    expect(result.matchedReason).toBeNull();
  });

  it('does not route configurable commercial keywords for self-service purchase messages', () => {
    const result = routeDeterministicAgentTools({
      customerMessage: 'Quero assinar esse de 1000 MEGA.',
      availableTeams: [
        ...teams.slice(0, 2),
        {
          id: 'team-sales',
          name: 'Comercial',
          routingConfig: {
            enabled: true,
            autoTransfer: true,
            keywords: ['assinar', 'contratar', '1000 mega'],
          },
        },
      ],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.matchedReason).toBeNull();
    expect(result.candidates[0]).toMatchObject({
      toolName: 'transfer_chat',
      source: 'configured_keyword',
      team: { id: 'team-sales', name: 'Comercial' },
    });
  });

  it('does not route configured support keywords when transfer is part of another intent', () => {
    const result = routeDeterministicAgentTools({
      customerMessage: 'Quero transferir a internet para outro endereco.',
      availableTeams: [
        {
          id: 'team-support',
          name: 'Suporte',
          routingConfig: {
            enabled: true,
            autoTransfer: true,
            keywords: ['internet', 'transferir internet'],
          },
        },
      ],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.matchedReason).toBeNull();
    expect(result.candidates[0]).toMatchObject({
      toolName: 'transfer_chat',
      source: 'configured_keyword',
      team: { id: 'team-support', name: 'Suporte' },
    });
  });

  it('does not route a team mention when the customer did not ask for transfer or a human', () => {
    const result = routeDeterministicAgentTools({
      customerMessage: 'Financeiro: preciso da segunda via do boleto.',
      availableTeams: teams,
    });

    expect(result.actions).toHaveLength(0);
    expect(result.matchedReason).toBeNull();
    expect(result.candidates[0]).toMatchObject({
      toolName: 'transfer_chat',
      source: 'team_mention',
      team: { id: 'team-finance', name: 'Financeiro' },
    });
  });

  it('does not route vague messages without team mention or human handoff', () => {
    const result = routeDeterministicAgentTools({
      customerMessage: 'Minha internet esta lenta, o que posso fazer?',
      availableTeams: teams,
    });

    expect(result.actions).toHaveLength(0);
    expect(result.matchedReason).toBeNull();
  });
});
