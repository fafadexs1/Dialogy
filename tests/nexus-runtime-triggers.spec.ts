import { describe, expect, it } from 'vitest';

import { hashNexusWebhookToken, verifyNexusWebhookToken } from '@/modules/nexus/services/deployment';
import {
  MAX_NEXUS_INTERNAL_EVENT_DEPTH,
  prepareDialogyNexusInternalEvent,
} from '@/modules/nexus/services/dialogy-event-dispatcher';
import { nexusInternalEventTriggerMatches } from '@/modules/nexus/services/internal-event-dispatcher';
import {
  materializeNexusSubflowInput,
  materializeNexusTriggerVariables,
} from '@/modules/nexus/services/runtime';
import {
  nexusMessageTriggerMatch,
  nexusMessageTriggerIsCatchAll,
  nexusMessageTriggerMatches,
  nexusChatCanReceiveAutomation,
  nexusWaitingExecutionIsSuperseded,
  rankNexusMessageTriggerCandidates,
} from '@/modules/nexus/services/message-dispatcher';
import {
  findBestNexusKeywordMatch,
  scoreNexusKeywordMatch,
} from '@/modules/nexus/services/trigger-matching';
import { assertValidCronExpression, cronMatchesDate } from '@/services/workflow-runtime';

describe('Nexus published triggers', () => {
  it('matches message keywords without depending on accents or casing', () => {
    expect(nexusMessageTriggerMatches({ matchMode: 'any_keyword', keywords: ['segunda via', 'CONTRATO'] }, 'Quero a Segunda Vía')).toBe(true);
    expect(nexusMessageTriggerMatches({ matchMode: 'all_keywords', keywords: ['segunda', 'contrato'] }, 'Quero segunda via')).toBe(false);
    expect(nexusMessageTriggerMatches({ matchMode: 'regex', pattern: '^quero atendimento$', caseSensitive: false }, 'Quero atendimento')).toBe(true);
  });

  it('preserves Nexus phrase coverage, typo tolerance and per-keyword thresholds', () => {
    expect(scoreNexusKeywordMatch('tenho interesse no plano', 'Olá, cheguei pelo site e tenho interesse no plano de 1000 MEGA')).toBe(100);
    expect(scoreNexusKeywordMatch('falar com especialista', 'falar com espcialista')).toBeGreaterThanOrEqual(80);
    expect(findBestNexusKeywordMatch(
      ['fatura', 'segunda via de fatura'],
      { fatura: 100, 'segunda via de fatura': 75 },
      'quero a segunda via da minha fatura',
    )?.keyword).toBe('segunda via de fatura');
    expect(nexusMessageTriggerMatches({
      matchMode: 'any_keyword',
      keywords: ['600 MEGA + Site'],
      keywordThresholds: { '600 MEGA + Site': 100 },
    }, 'Oi, eu quero o plano de 600 mega com site')).toBe(true);
  });

  it('returns the exact imported keyword output and distinguishes it from a catch-all fallback', () => {
    expect(nexusMessageTriggerMatch({
      matchMode: 'any_keyword',
      keywords: ['600 MEGA + Site'],
      keywordThresholds: { '600 MEGA + Site': 80 },
      keywordOutputPorts: { '600 MEGA + Site': 'plano_site' },
      defaultOutput: 'qualquer_mensagem',
      fallbackToAnyMessage: true,
    }, 'Tenho interesse em 600 mega e site')).toMatchObject({
      catchAll: false,
      keyword: '600 MEGA + Site',
      outputPortId: 'plano_site',
    });
    expect(nexusMessageTriggerMatch({
      matchMode: 'any_keyword',
      keywords: ['600 MEGA + Site'],
      defaultOutput: 'qualquer_mensagem',
      fallbackToAnyMessage: true,
    }, 'Olá')).toEqual({ catchAll: true, score: 0, matchedWeight: 0, outputPortId: 'qualquer_mensagem' });
  });

  it('classifies any-message triggers as workspace fallbacks', () => {
    expect(nexusMessageTriggerIsCatchAll({ matchMode: 'all' })).toBe(true);
    expect(nexusMessageTriggerIsCatchAll({})).toBe(true);
    expect(nexusMessageTriggerIsCatchAll({ matchMode: 'any_keyword', keywords: ['boleto'] })).toBe(false);
    expect(nexusMessageTriggerIsCatchAll({ matchMode: 'regex', pattern: '^boleto$' })).toBe(false);
  });

  it('suppresses the catch-all flow whenever a specific workspace phrase matches', () => {
    const ranked = rankNexusMessageTriggerCandidates([
      { id: 'velpro-catch-all', priority: 100, match: { catchAll: true, score: 0, matchedWeight: 0, outputPortId: 'message' } },
      { id: 'plano-site', priority: 0, match: { catchAll: false, score: 100, matchedWeight: 3, outputPortId: 'message' } },
    ]);
    expect(ranked.map((candidate) => candidate.id)).toEqual(['plano-site']);
  });

  it('does not resume a waiting execution from a superseded published version', () => {
    expect(nexusWaitingExecutionIsSuperseded({
      workflowVersion: 'v11',
      publishedWorkflowVersion: 'v12',
    })).toBe(true);
    expect(nexusWaitingExecutionIsSuperseded({
      workflowVersion: 'v12',
      publishedWorkflowVersion: 'v12',
    })).toBe(false);
    expect(nexusWaitingExecutionIsSuperseded({
      workflowVersion: 'v11',
      publishedWorkflowVersion: null,
    })).toBe(false);
  });

  it('scopes received-message triggers by channel, instance and assignment policy', () => {
    const config = {
      matchMode: 'all',
      platforms: ['whatsapp'],
      instanceNames: ['zap1'],
      messageTypes: ['text'],
      startPolicy: 'unassigned_only',
    };
    expect(nexusMessageTriggerMatches(config, 'Olá', {
      platform: 'WhatsApp', instanceName: 'ZAP1', messageType: 'text', agentId: null, assignedSystemAgentId: null,
    })).toBe(true);
    expect(nexusMessageTriggerMatches(config, 'Olá', {
      platform: 'whatsapp', instanceName: 'outra', messageType: 'text', agentId: null, assignedSystemAgentId: null,
    })).toBe(false);
    expect(nexusMessageTriggerMatches(config, 'Olá', {
      platform: 'whatsapp', instanceName: 'zap1', messageType: 'text', agentId: 'agent-1', assignedSystemAgentId: null,
    })).toBe(false);
    expect(nexusMessageTriggerMatches(config, 'Olá', {
      platform: 'whatsapp', instanceName: 'zap1', messageType: 'text', chatStatus: 'atendimentos', agentId: null, assignedSystemAgentId: null,
    })).toBe(false);
    expect(nexusChatCanReceiveAutomation('gerais')).toBe(true);
    expect(nexusChatCanReceiveAutomation('atendimentos')).toBe(false);
  });

  it('materializes imported webhook variable mappings without flattening nested variables', () => {
    expect(materializeNexusTriggerVariables({
      variableMappings: [
        { jsonPath: 'contact.name', flowVariable: 'cliente.nome' },
        { jsonPath: 'conversation.id', flowVariable: 'id_conversa' },
      ],
    }, {
      body: { contact: { name: 'Fabrício' }, conversation: { id: 'chat-1' } },
    })).toEqual({ cliente: { nome: 'Fabrício' }, id_conversa: 'chat-1' });
  });

  it('materializes subflow mappings while preserving exact object values', () => {
    const runtimeInput = {
      node: {
        config: {
          inputMapping: {
            cliente: '{{variables.cliente}}',
            'pedido.plano': '{{current.plano}}',
            saudacao: 'Olá, {{variables.cliente.nome}}',
          },
        },
      },
      input: { plano: '600 Mega' },
      execution: {
        variables: { cliente: { nome: 'Fabrício', documento: '123' } },
        context: {},
      },
    } as unknown as Parameters<typeof materializeNexusSubflowInput>[0];

    expect(materializeNexusSubflowInput(runtimeInput)).toEqual({
      cliente: { nome: 'Fabrício', documento: '123' },
      pedido: { plano: '600 Mega' },
      saudacao: 'Olá, Fabrício',
    });
  });

  it('validates and evaluates five-field cron in the configured timezone', () => {
    assertValidCronExpression('0 9 * * 1-5', 'America/Sao_Paulo');
    expect(cronMatchesDate('0 9 * * 1-5', new Date('2026-08-25T12:00:00.000Z'), 'America/Sao_Paulo')).toBe(true);
    expect(cronMatchesDate('0 9 * * 1-5', new Date('2026-08-25T13:00:00.000Z'), 'America/Sao_Paulo')).toBe(false);
    expect(() => assertValidCronExpression('61 9 * * *', 'UTC')).toThrow();
    expect(() => assertValidCronExpression('* * *', 'UTC')).toThrow();
    expect(() => assertValidCronExpression('* * * * *', 'Mars/Olympus')).toThrow();
  });

  it('matches trusted internal events by an exact normalized name', () => {
    expect(nexusInternalEventTriggerMatches({ eventName: 'chat.closed' }, 'CHAT.CLOSED')).toBe(true);
    expect(nexusInternalEventTriggerMatches({ eventName: 'chat.closed' }, 'chat.transferred')).toBe(false);
    expect(nexusInternalEventTriggerMatches({ eventName: '' }, 'chat.closed')).toBe(false);
  });

  it('normalizes internal event causation and suppresses recursive cycles', () => {
    const prepared = prepareDialogyNexusInternalEvent({
      workspaceId: ' workspace-1 ',
      eventName: ' CHAT.CLOSED ',
      eventId: 'message-1',
      payload: { chatId: 'chat-1' },
      eventChain: ['contact.updated'],
    });

    expect(prepared).toMatchObject({
      event: {
        workspaceId: 'workspace-1',
        eventName: 'chat.closed',
        eventId: 'message-1',
        eventChain: ['contact.updated', 'chat.closed'],
        context: {
          nexusInternalEventChain: ['contact.updated', 'chat.closed'],
          nexusInternalEventDepth: 2,
        },
      },
    });
    expect(prepareDialogyNexusInternalEvent({
      workspaceId: 'workspace-1',
      eventName: 'chat.closed',
      eventId: 'message-2',
      eventChain: ['chat.closed'],
    })).toEqual({ event: null, suppressed: 'cycle' });
  });

  it('suppresses internal event chains at the bounded depth', () => {
    const eventChain = Array.from({ length: MAX_NEXUS_INTERNAL_EVENT_DEPTH }, (_, index) => `event.${index}`);
    expect(prepareDialogyNexusInternalEvent({
      workspaceId: 'workspace-1',
      eventName: 'chat.closed',
      eventId: 'message-depth',
      eventChain,
    })).toEqual({ event: null, suppressed: 'depth_limit' });
  });

  it('stores only a constant-time verifiable webhook token hash', () => {
    const hash = hashNexusWebhookToken('nxs_secret_value');
    expect(hash).not.toContain('secret_value');
    expect(verifyNexusWebhookToken('nxs_secret_value', hash)).toBe(true);
    expect(verifyNexusWebhookToken('nxs_wrong_value', hash)).toBe(false);
    expect(verifyNexusWebhookToken('', hash)).toBe(false);
  });
});
