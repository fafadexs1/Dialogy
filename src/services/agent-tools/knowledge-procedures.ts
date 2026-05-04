import type { KnowledgeBaseDocument } from '@/lib/types';
import type { AgentToolCatalogItem } from './catalog';

export type KnowledgeToolProcedure = {
  documentName: string;
  toolMention: string;
  toolName: string;
  enabled: boolean;
  excerpt: string;
};

const TOOL_MENTION_PATTERN = /@([a-zA-Z0-9_.:\-]+)/g;
const MAX_EXCERPT_CHARS = 700;

function normalizeToolToken(value: string) {
  return value.trim().replace(/[.,;!?]+$/g, '').toLowerCase();
}

function getMentionExcerpt(content: string, index: number): string {
  const start = Math.max(0, index - 240);
  const end = Math.min(content.length, index + 460);
  return content
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EXCERPT_CHARS);
}

function buildToolLookup(tools: AgentToolCatalogItem[]) {
  const lookup = new Map<string, AgentToolCatalogItem>();
  for (const tool of tools) {
    const aliases = [
      tool.name,
      tool.name.split(':').at(-1) || '',
      tool.name.replace(/^mcp:[^:]+:/, ''),
    ].filter(Boolean);

    for (const alias of aliases) {
      lookup.set(normalizeToolToken(alias), tool);
    }
  }
  return lookup;
}

export function extractKnowledgeToolProcedures(input: {
  documents: KnowledgeBaseDocument[];
  tools: AgentToolCatalogItem[];
  enabledToolNames: string[];
}): KnowledgeToolProcedure[] {
  const lookup = buildToolLookup(input.tools);
  const enabled = new Set(input.enabledToolNames);
  const procedures: KnowledgeToolProcedure[] = [];

  for (const document of input.documents || []) {
    const content = document.content || '';
    TOOL_MENTION_PATTERN.lastIndex = 0;

    for (const match of content.matchAll(TOOL_MENTION_PATTERN)) {
      const mention = (match[1] || '').replace(/[.,;!?]+$/g, '');
      const tool = lookup.get(normalizeToolToken(mention));
      if (!tool) continue;

      const excerpt = getMentionExcerpt(content, match.index || 0);
      const alreadyAdded = procedures.some((procedure) => (
        procedure.documentName === document.name &&
        procedure.toolName === tool.name &&
        procedure.excerpt === excerpt
      ));
      if (alreadyAdded) continue;

      procedures.push({
        documentName: document.name || 'Documento sem nome',
        toolMention: `@${mention}`,
        toolName: tool.name,
        enabled: enabled.has(tool.name),
        excerpt,
      });
    }
  }

  return procedures.slice(0, 12);
}

export function formatKnowledgeToolProcedures(procedures: KnowledgeToolProcedure[]): string {
  if (procedures.length === 0) return '';

  return procedures
    .map((procedure, index) => [
      `${index + 1}. Documento: ${procedure.documentName}`,
      `Tool mencionada: ${procedure.toolMention}`,
      `Tool resolvida: ${procedure.toolName}`,
      `Status: ${procedure.enabled ? 'habilitada para este agente' : 'desabilitada para este agente'}`,
      `Procedimento: ${procedure.excerpt}`,
    ].join('\n'))
    .join('\n\n');
}

