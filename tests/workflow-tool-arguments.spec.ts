import { describe, expect, it } from 'vitest';

import {
  normalizeToolArgumentsFromJsonSchema,
  toolInputSchemaForPrompt,
} from '@/services/workflow-runtime/tool-arguments';

describe('schema-driven workflow tool argument normalization', () => {
  it('repairs the observed ACS SSID alias without a tool-specific rule', () => {
    const schema = {
      type: 'object',
      properties: {
        band: { type: 'string', enum: ['2.4', '5'] },
        name: { type: 'string', description: 'Novo nome (SSID) da rede.' },
      },
      required: ['band', 'name'],
    };

    expect(normalizeToolArgumentsFromJsonSchema({
      band: '2.4GHz',
      new_ssid: 'Ribanceirinho2026',
    }, schema)).toEqual({
      band: '2.4',
      name: 'Ribanceirinho2026',
    });
  });

  it('uses a brand-new tool schema to coerce aliases, booleans, arrays and defaults', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        network_name: { type: 'string' },
        enabled: { type: 'boolean' },
        ports: { type: 'array', items: { type: 'integer' } },
        mode: { type: 'string', enum: ['safe', 'fast'], default: 'safe' },
      },
      required: ['network_name', 'enabled', 'ports'],
    };

    expect(normalizeToolArgumentsFromJsonSchema({
      networkName: 'Minha rede',
      is_enabled: 'sim',
      ports: '80, 443',
      ignored: 'remove-me',
    }, schema)).toEqual({
      network_name: 'Minha rede',
      enabled: true,
      ports: [80, 443],
      mode: 'safe',
    });
  });

  it('does not invent required values absent from the conversation', () => {
    const schema = {
      type: 'object',
      properties: {
        command_id: { type: 'string' },
      },
      required: ['command_id'],
    };

    expect(normalizeToolArgumentsFromJsonSchema({}, schema)).toEqual({});
  });

  it('keeps all callable fields and required markers in the compact prompt contract', () => {
    const schema = {
      type: 'object',
      properties: {
        band: { type: 'string', enum: ['2.4', '5'], description: 'Banda da rede.' },
        name: { type: 'string', maxLength: 32, description: 'Novo SSID.' },
      },
      required: ['band', 'name'],
      additionalProperties: false,
      providerMetadata: { irrelevant: true },
    };

    expect(toolInputSchemaForPrompt(schema)).toEqual({
      type: 'object',
      properties: {
        band: { type: 'string', enum: ['2.4', '5'], description: 'Banda da rede.' },
        name: { type: 'string', maxLength: 32, description: 'Novo SSID.' },
      },
      required: ['band', 'name'],
      additionalProperties: false,
    });
  });

  it('coerces values declared through additionalProperties maps', () => {
    const schema = {
      type: 'object',
      properties: {
        parameters: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['parameters'],
    };

    expect(normalizeToolArgumentsFromJsonSchema({
      parameters: { Channel: 6, Enabled: true },
    }, schema)).toEqual({
      parameters: { Channel: '6', Enabled: 'true' },
    });
  });
});
