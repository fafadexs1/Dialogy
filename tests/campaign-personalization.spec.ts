import { describe, expect, it } from 'vitest';
import {
  buildCampaignTemplateSendComponents,
  getCampaignTemplateBodyParameterKeys,
  getCampaignFirstName,
  getCampaignGreeting,
  renderCampaignMessage,
  renderCampaignTemplatePreview,
} from '@/lib/campaigns/personalization';
import { parseCampaignContactsCsv } from '@/lib/campaigns/csv-import';
import type { CampaignTemplate } from '@/lib/types';

describe('campaign personalization', () => {
  const csvTemplate: CampaignTemplate = {
    name: 'cobranca_planilha', language: 'pt_BR',
    components: [{ type: 'BODY', text: 'Olá, {{cliente}}. Valor: {{valor}}. Prazo: {{prazo}}.' }],
    bodyParameterNames: ['cliente', 'valor', 'prazo'],
    bodyParameterColumns: ['Cliente', 'Valor', null],
    bodyParameterValues: ['', '', '05/11'],
  };

  it('resolves each recipient from their CSV row and keeps the preview equal to the sent parameters', () => {
    const { contacts } = parseCampaignContactsCsv('Cliente;Telefone;Valor\nMaria;61984133192;"R$ 10,00"\nJoão;61995215930;"R$ 25,50"');
    const previews = contacts.map(contact => {
      const context = { contactName: contact.name, csvData: contact.csvData };
      const parameters = buildCampaignTemplateSendComponents(csvTemplate, context)[0].parameters;
      expect(parameters[0]).toEqual({ type: 'text', text: contact.csvData.Cliente, parameter_name: 'cliente' });
      expect(parameters[1].text).toBe(contact.csvData.Valor);
      return renderCampaignTemplatePreview(csvTemplate, context);
    });
    expect(previews).toEqual(['Olá, Maria. Valor: R$ 10,00. Prazo: 05/11.', 'Olá, João. Valor: R$ 25,50. Prazo: 05/11.']);
  });

  it('rejects missing or blank mapped values instead of silently using the contact name', () => {
    const rows: (Record<string, string> | undefined)[] = [undefined, { Cliente: 'Maria', Valor: '  ' }, { Cliente: 'Maria' }];
    for (const csvData of rows) {
      expect(() => buildCampaignTemplateSendComponents(csvTemplate, { contactName: 'Maria', csvData }))
        .toThrow(/Coluna/);
    }
  });

  it('uses a personalized fallback for empty cells and contacts outside the CSV', () => {
    const template = { ...csvTemplate, bodyParameterValues: ['{{primeiro_nome}}', 'Consulte seu saldo', '05/11'] };
    expect(renderCampaignTemplatePreview(template, { contactName: 'Maria Silva' }))
      .toBe('Olá, Maria. Valor: Consulte seu saldo. Prazo: 05/11.');
  });

  it('preserves zero, leading zeroes and literal placeholders in imported values', () => {
    const template = { ...csvTemplate, bodyParameterColumns: ['Código', 'Valor', null] };
    expect(renderCampaignTemplatePreview(template, { csvData: { Código: '00042 {{nome}}', Valor: '0' } }))
      .toBe('Olá, 00042 {{nome}}. Valor: 0. Prazo: 05/11.');
  });
  it('renders full name, first name, and greeting variables', () => {
    const result = renderCampaignMessage(
      '{{Sauda\u00e7\u00e3o}}, {{primeiro_nome}}. Cadastro: {{nome}}.',
      {
        contactName: 'Maria Clara Silva',
        now: new Date('2026-07-06T13:00:00.000Z'),
        timeZone: 'America/Sao_Paulo',
      },
    );

    expect(result).toBe('Bom dia, Maria. Cadastro: Maria Clara Silva.');
  });

  it('accepts greeting without accent and preserves unknown placeholders', () => {
    const result = renderCampaignMessage('Oi {{SAUDACAO}} {{apelido}}', {
      contactName: 'Maria',
      now: new Date('2026-07-06T16:00:00.000Z'),
      timeZone: 'America/Sao_Paulo',
    });

    expect(result).toBe('Oi Boa tarde {{apelido}}');
  });

  it('uses the first token of normalized contact names', () => {
    expect(getCampaignFirstName('  Joao   Pedro  Souza ')).toBe('Joao');
  });

  it('chooses greeting by local campaign time', () => {
    expect(getCampaignGreeting(new Date('2026-07-06T13:00:00.000Z'), 'America/Sao_Paulo')).toBe('Bom dia');
    expect(getCampaignGreeting(new Date('2026-07-06T16:00:00.000Z'), 'America/Sao_Paulo')).toBe('Boa tarde');
    expect(getCampaignGreeting(new Date('2026-07-06T22:00:00.000Z'), 'America/Sao_Paulo')).toBe('Boa noite');
  });

  it('builds WhatsApp template parameters from campaign variables in order', () => {
    const template: CampaignTemplate = {
      name: 'boas_vindas',
      language: 'pt_BR',
      components: [{ type: 'BODY', text: '{{1}}, {{2}}!' }],
    };

    const components = buildCampaignTemplateSendComponents(template, {
      contactName: 'Maria Clara Silva',
      campaignMessage: '{{Sauda\u00e7\u00e3o}}, {{primeiro_nome}}!',
      now: new Date('2026-07-06T13:00:00.000Z'),
      timeZone: 'America/Sao_Paulo',
    });

    expect(components).toEqual([{
      type: 'body',
      parameters: [
        { type: 'text', text: 'Bom dia' },
        { type: 'text', text: 'Maria' },
      ],
    }]);
  });

  it('uses the editable values configured for each template field', () => {
    const template: CampaignTemplate = {
      name: 'visita_tecnica',
      language: 'pt_BR',
      components: [{ type: 'BODY', text: '{{1}}, {{2}}! Protocolo: {{3}}.' }],
      bodyParameterValues: ['{{Saudação}}', '{{primeiro_nome}}', 'ATD-2026'],
    };

    expect(buildCampaignTemplateSendComponents(template, {
      contactName: 'Maria Clara Silva',
      now: new Date('2026-07-06T13:00:00.000Z'),
      timeZone: 'America/Sao_Paulo',
    })).toEqual([{
      type: 'body',
      parameters: [
        { type: 'text', text: 'Bom dia' },
        { type: 'text', text: 'Maria' },
        { type: 'text', text: 'ATD-2026' },
      ],
    }]);
  });

  it('detects and sends named Meta template parameters', () => {
    const template: CampaignTemplate = {
      name: 'cobranca',
      language: 'pt_BR',
      components: [{ type: 'BODY', text: 'Olá, {{cliente}}. Fatura {{referencia}}.' }],
      bodyParameterNames: ['cliente', 'referencia'],
      bodyParameterValues: ['{{primeiro_nome}}', 'AGO-2026'],
    };

    expect(getCampaignTemplateBodyParameterKeys(template)).toEqual(['cliente', 'referencia']);
    expect(buildCampaignTemplateSendComponents(template, {
      contactName: 'Maria Silva',
    })).toEqual([{
      type: 'body',
      parameters: [
        { type: 'text', text: 'Maria', parameter_name: 'cliente' },
        { type: 'text', text: 'AGO-2026', parameter_name: 'referencia' },
      ],
    }]);
  });
});
