import { createServer } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { z } from 'genkit';

import {
  coerceLmStudioPromptOutput,
  defineLmStudioPrompt,
  getLmStudioModelId,
  isLmStudioModel,
  normalizeLmStudioConfig,
  parseLmStudioConfig,
  parseLmStudioStructuredText,
  tryParseJsonResponse,
} from '@/services/ai/lm-studio';
import {
  buildLmStudioNativeTools,
  convertLmStudioNativeToolCalls,
  requestLmStudioNativeToolActions,
} from '@/services/ai/lm-studio-native-tools';

describe('LM Studio runtime config', () => {
  it('recognizes local models and preserves nested LM Studio model ids', () => {
    expect(isLmStudioModel('lmstudio/openai/gpt-oss-20b')).toBe(true);
    expect(getLmStudioModelId('lmstudio/openai/gpt-oss-20b')).toBe('openai/gpt-oss-20b');
  });

  it('normalizes the global endpoint and supports servers without auth enabled', () => {
    expect(normalizeLmStudioConfig({
      baseUrl: 'http://host.docker.internal:1234/v1/',
      apiToken: '',
    })).toEqual({
      baseUrl: 'http://host.docker.internal:1234/v1',
      apiToken: '',
    });
    expect(parseLmStudioConfig('invalid-json')).toEqual({ baseUrl: '', apiToken: '' });
  });

  it('parses structured JSON returned as LM Studio text content', () => {
    const text = JSON.stringify({
      response: 'Resposta para o cliente',
      messageBlocks: null,
      triggeredRule: null,
      actions: [],
    });

    expect(parseLmStudioStructuredText(text)).toMatchObject({
      response: 'Resposta para o cliente',
      actions: [],
    });
    expect(coerceLmStudioPromptOutput(null, text)).toMatchObject({
      response: 'Resposta para o cliente',
      actions: [],
    });
  });

  it('sends structured prompts to the OpenAI-compatible endpoint with the complete model id', async () => {
    let requestBody: any;
    let authorization = '';
    const server = createServer((request, response) => {
      authorization = String(request.headers.authorization || '');
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: requestBody.model,
          choices: [{
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({ answer: 'ok' }),
            },
          }],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        }));
      });
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    try {
      const prompt = defineLmStudioPrompt({
        name: 'lmStudioTestPrompt',
        input: { schema: z.object({ question: z.string() }) },
        output: { schema: z.object({ answer: z.string() }) },
        prompt: '{{question}}',
      }, 'lmstudio/openai/gpt-oss-20b', {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiToken: 'global-token',
      });

      const result = await prompt({ question: 'ping' });

      expect(result.output).toEqual({ answer: 'ok' });
      expect(requestBody.model).toBe('openai/gpt-oss-20b');
      expect(requestBody.response_format).toMatchObject({
        type: 'json_schema',
        json_schema: {
          name: 'dialogy_response',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              actions: {
                type: ['array', 'null'],
                items: {
                  type: 'object',
                  required: ['type', 'reason', 'payload'],
                },
              },
            },
            required: ['response', 'messageBlocks', 'triggeredRule', 'actions'],
            additionalProperties: false,
          },
        },
      });
      expect(authorization).toBe('Bearer global-token');
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('successfully parses the stringified JSON payload from Gemma-4 in the real environment', () => {
    const rawContent = "{\"response\": \"Olá! Vi que você demonstrou interesse no plano de 1000 MEGA, que é a última geração com Wi-Fi 6 e mais canais de TV. 😊\\n\\nPara darmos início ao seu pré-cadastro e verificar se há disponibilidade na sua região, preciso de algumas informações. Podemos começar pelo seu nome completo?\", \"messageBlocks\": null, \"triggeredRule\": null, \"actions\": []}";
    
    const result = tryParseJsonResponse(rawContent);

    expect(result).not.toBeNull();
    expect(result?.response).toContain("plano de 1000 MEGA");
    expect(result?.response).toContain("nome completo?");
    expect(result?.response).toContain("😊");
    expect(result?.messageBlocks).toBeNull();
    expect(result?.actions).toEqual([]);
  });
});

describe('LM Studio native tools', () => {
  it('advertises only enabled read-only SGP tools', () => {
    expect(buildLmStudioNativeTools([
      'transfer_chat',
      'sgp_fetch_contracts',
      'sgp_generate_invoice_pix',
    ])).toEqual([
      expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({
          name: 'sgp_fetch_contracts',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        }),
      }),
    ]);
  });

  it('drops model arguments when converting native calls into internal actions', () => {
    expect(convertLmStudioNativeToolCalls([
      {
        function: {
          name: 'sgp_fetch_contact_panel_data',
          arguments: JSON.stringify({ cpfCnpj: '12345678901' }),
        },
      },
      {
        function: {
          name: 'transfer_chat',
          arguments: JSON.stringify({ teamName: 'Financeiro' }),
        },
      },
    ])).toEqual([
      {
        type: 'sgp_fetch_contact_panel_data',
        reason: 'LM Studio native tool call: sgp_fetch_contact_panel_data',
        payload: {},
      },
    ]);
  });

  it('requests native tool calls through chat completions and preserves the model id', async () => {
    let requestBody: any;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'native-test',
                type: 'function',
                function: {
                  name: 'sgp_fetch_contracts',
                  arguments: JSON.stringify({ cpfCnpj: 'invented-value' }),
                },
              }],
            },
          }],
        }));
      });
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    try {
      const actions = await requestLmStudioNativeToolActions({
        config: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiToken: '',
        },
        model: 'lmstudio/local/qwen-tool-model',
        enabledToolNames: ['sgp_fetch_contracts'],
        customerMessage: 'Quero consultar meu contrato.',
      });

      expect(requestBody.model).toBe('local/qwen-tool-model');
      expect(requestBody.tool_choice).toBe('auto');
      expect(requestBody.tools).toHaveLength(1);
      expect(actions).toEqual([
        {
          type: 'sgp_fetch_contracts',
          reason: 'LM Studio native tool call: sgp_fetch_contracts',
          payload: {},
        },
      ]);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
