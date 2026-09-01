import { describe, expect, it } from 'vitest';
import { studioMcpFields } from '@/services/agent-studio/mcp-fields';
import { buildStudioMcpArguments } from '@/services/agent-studio/data-mapping';
import { McpToolStepConfigSchema } from '@/services/agent-studio/types';

describe('guided MCP parameters', () => {
  it('shows nested objects as named fields and preserves booleans, lists and enums', () => {
    const fields = studioMcpFields({ type: 'object', required: ['customer'], properties: {
      customer: { title: 'Cliente', type: 'object', required: ['email'], properties: { email: { title: 'E-mail', type: 'string' }, notify: { title: 'Avisar', type: 'boolean' } } },
      format: { title: 'Formato', type: 'string', enum: ['pdf', 'pix'] }, lines: { title: 'Itens', type: 'array' },
    } });
    expect(fields['customer.email']).toMatchObject({ title: 'Cliente › E-mail', required: true });
    expect(fields['customer.notify'].required).toBe(false); expect(fields.format.enum).toEqual(['pdf', 'pix']); expect(fields.lines.type).toBe('array');
    const config = McpToolStepConfigSchema.parse({ serverId: 'server', qualifiedToolName: 'mcp:server:tool', friendlyToolName: 'Gerar', argumentMappings: [
      { argumentName: 'customer.email', sourceChipKey: 'test@example.com', sourceChipLabel: 'E-mail', sourceType: 'static_value', valueType: 'text' },
      { argumentName: 'customer.notify', sourceChipKey: 'false', sourceChipLabel: 'Avisar', sourceType: 'static_value', valueType: 'boolean' },
    ] });
    expect(buildStudioMcpArguments(config, { values: {} })).toEqual({ customer: { email: 'test@example.com', notify: false } });
  });
  it('does not require a nested leaf whose parent is optional', () => {
    const fields = studioMcpFields({ properties: { optional: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } });
    expect(fields['optional.name'].required).toBe(false);
  });
});
