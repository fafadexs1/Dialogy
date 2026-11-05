import { describe, expect, it } from 'vitest';
import { resolveAgentHttpApproval } from '@/modules/nexus/services/agent-http-approval';

describe('HTTP tool approval binding', () => {
  const config = { method: 'POST', url: 'https://api.example.com/items/{{arguments.id}}', query: { source: '{{arguments.source}}' }, headers: { 'X-Ticket': '{{current.id}}' }, bodyType: 'json', body: { text: '{{arguments.text}}' }, credentialId: 'credential' };
  it('materializes a complete fixed-origin proposal from explicit arguments', () => {
    const result = resolveAgentHttpApproval(config, { id: '42', source: 'chat', text: '{{variables.secret}}' });
    expect(result.proposal).toMatchObject({ method: 'POST', url: 'https://api.example.com/items/42?source=chat', headers: { 'X-Ticket': '42' }, body: { text: '{{variables.secret}}' }, credentialId: 'credential' });
    expect(result.request.body).toEqual({ text: '{{variables.secret}}' });
  });
  it('rejects unstated execution context and dynamic origins', () => {
    expect(() => resolveAgentHttpApproval({ ...config, body: { text: '{{variables.secret}}' } }, {})).toThrow('argumentos explícitos');
    expect(() => resolveAgentHttpApproval({ ...config, url: 'https://{{arguments.host}}/api' }, { host: 'example.com' })).toThrow('origem');
    expect(() => resolveAgentHttpApproval({ ...config, body: '{{arguments.__proto__}}' }, {})).toThrow('argumentos explícitos');
  });
});
