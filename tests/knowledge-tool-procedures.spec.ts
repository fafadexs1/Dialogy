import { describe, expect, it } from 'vitest';

import { extractKnowledgeToolProcedures } from '@/services/agent-tools/knowledge-procedures';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';

describe('knowledge tool procedures', () => {
  it('resolves fully qualified MCP mentions from knowledge documents', () => {
    const tools: AgentToolCatalogItem[] = [
      {
        name: 'mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router',
        version: 'mcp',
        description: 'Reinicia roteador pelo IP.',
        class: 'retrieval',
        riskLevel: 'medium',
        sideEffect: 'medium',
        idempotent: false,
        timeoutMs: 8000,
        maxAttempts: 1,
        requiresHumanApproval: false,
        customerVisible: true,
        allowedIntents: ['troubleshooting'],
        requiredSlots: [],
        fallbackAction: 'handoff',
        source: 'mcp',
        enabledByDefault: false,
      },
    ];

    const procedures = extractKnowledgeToolProcedures({
      documents: [
        {
          id: 'doc-1',
          name: 'Reiniciar Roteador do Cliente',
          content: 'Consultar SGP, pegar o IPv4 e usar @mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router.',
        },
      ],
      tools,
      enabledToolNames: ['mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router'],
    });

    expect(procedures).toHaveLength(1);
    expect(procedures[0]).toMatchObject({
      toolMention: '@mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router',
      toolName: 'mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router',
      enabled: true,
    });
  });
});
