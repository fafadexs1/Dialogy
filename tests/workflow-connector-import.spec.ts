import { describe, expect, it } from 'vitest';
import { importCurl, importOpenApi } from '@/services/workflow-runtime/connector-import';
import { ConnectorDefinitionSchema } from '@/services/workflow-runtime/connector-contract';

describe('connector imports are configuration only', () => {
  it('strips credentials and retains typed JSON', () => {
    const result = importCurl(`curl -X POST 'https://api.example.com/items?api_key=hidden' -H 'Authorization: Bearer secret' -H 'Content-Type: application/json' --data '{"amount":42}'`);
    expect(result.definition.http).toMatchObject({ method: 'POST', body: { amount: 42 }, bodyType: 'json' });
    expect(JSON.stringify(result)).not.toContain('hidden'); expect(JSON.stringify(result)).not.toContain('Bearer secret');
    expect(result.warnings).toHaveLength(2);
    expect(result.definition.approval).toBe('required');
  });
  it('rejects local file access and shell fragments', () => {
    expect(() => importCurl('curl https://example.com --data-binary @secret.txt')).toThrow('não são lidos');
    expect(() => importCurl('curl https://example.com && echo secret')).toThrow();
    expect(() => importCurl('curl https://example.com -o local-file')).toThrow();
  });
  it('supports quoting and continuations without expanding variables', () => {
    const result = importCurl(`curl https://example.com \\\n -H 'X-Label: $HOME; literal'`);
    expect(result.definition.http.headers['X-Label']).toBe('$HOME; literal');
  });
  it('imports local OpenAPI schemas and maps path/query/body arguments', () => {
    const [operation] = importOpenApi({ openapi: '3.0.3', servers: [{ url: 'https://api.example.com/v1' }], components: { schemas: { Body: { type: 'object', properties: { title: { type: 'string' } } } } }, paths: { '/orders/{id}': { post: { operationId: 'updateOrder', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'locale', in: 'query', schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Body' } } } } } } } });
    expect(operation.definition.http.url).toContain('/orders/{{arguments.id}}');
    expect(operation.definition.http.query.locale).toBe('{{arguments.locale}}');
    expect(operation.definition.inputSchema).toMatchObject({ required: ['id', 'body'], properties: { body: { type: 'object' } } });
  });
  it('never fetches remote references and rejects variable origins', () => {
    expect(() => importOpenApi({ openapi: '3.0.3', servers: [{ url: 'https://api.example.com' }], paths: { '/': { get: { parameters: [{ $ref: 'https://evil.test/schema' }] } } } })).toThrow('externas');
    expect(ConnectorDefinitionSchema.safeParse({ name: 'Unsafe', http: { method: 'GET', url: 'https://{{arguments.host}}/data' } }).success).toBe(false);
  });
});
