import 'dotenv/config';
import { getGlobalLmStudioConfig } from '../src/services/ai/lm-studio';

async function testDirect() {
  console.log('--- DIRECT LM STUDIO API TEST ---');

  const config = await getGlobalLmStudioConfig();
  console.log('Using config:', config);

  const url = `${config.baseUrl}/chat/completions`;
  const modelId = 'google/gemma-4-e4b';

  const requestBody = {
    model: modelId,
    messages: [
      {
        role: 'system',
        content: 'Você é um assistente virtual. Responda em JSON.'
      },
      {
        role: 'user',
        content: 'Olá! Qual o plano de 1000 MEGA?'
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'dialogy_response',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            response: { type: 'string' },
            messageBlocks: {
              type: 'array',
              items: { type: 'string' }
            },
            triggeredRule: { type: 'string' },
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  reason: { type: 'string' },
                  payload: { type: 'object' }
                },
                required: ['type', 'reason', 'payload']
              }
            }
          },
          required: ['response', 'messageBlocks', 'triggeredRule', 'actions']
        }
      }
    }
  };

  console.log('Sending request to:', url);
  console.log('Request body:', JSON.stringify(requestBody, null, 2));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiToken ? { 'Authorization': `Bearer ${config.apiToken}` } : {})
      },
      body: JSON.stringify(requestBody)
    });

    console.log('Response Status:', res.status, res.statusText);
    const text = await res.text();
    console.log('Response Text:', text);
  } catch (err) {
    console.error('Error during direct call:', err);
  }
}

testDirect();
