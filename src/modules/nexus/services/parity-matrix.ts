export type NexusParityStatus = 'complete' | 'partial' | 'pending';

export type NexusLegacyBlockParity = {
  legacyType: string;
  label: string;
  category: 'basic' | 'logic' | 'ai' | 'dialogy' | 'whatsapp' | 'integrations' | 'utils';
  nativeTypes: string[];
  runtime: 'handler' | 'attachment' | 'pattern' | 'missing';
  status: NexusParityStatus;
  gap?: string;
};

export const NEXUSFLOW_LEGACY_BLOCK_PARITY: readonly NexusLegacyBlockParity[] = [
  { legacyType: 'start', label: 'Gatilho', category: 'basic', nativeTypes: ['trigger.manual', 'trigger.webhook', 'trigger.received_message'], runtime: 'handler', status: 'complete' },
  { legacyType: 'message', label: 'Enviar Texto', category: 'basic', nativeTypes: ['output.respond'], runtime: 'handler', status: 'complete' },
  { legacyType: 'input', label: 'Pergunta', category: 'basic', nativeTypes: ['interaction.input'], runtime: 'handler', status: 'complete' },
  { legacyType: 'option', label: 'Opções', category: 'basic', nativeTypes: ['interaction.options'], runtime: 'handler', status: 'complete' },
  { legacyType: 'media-display', label: 'Mídia', category: 'basic', nativeTypes: ['output.media'], runtime: 'handler', status: 'complete' },
  { legacyType: 'typing-emulation', label: 'Digitando', category: 'basic', nativeTypes: ['logic.wait'], runtime: 'handler', status: 'complete' },
  { legacyType: 'delay', label: 'Aguardar', category: 'basic', nativeTypes: ['logic.wait'], runtime: 'handler', status: 'complete' },
  { legacyType: 'end-flow', label: 'Encerrar', category: 'basic', nativeTypes: ['output.end'], runtime: 'handler', status: 'complete' },

  { legacyType: 'go-to', label: 'Ir para', category: 'logic', nativeTypes: ['logic.goto'], runtime: 'handler', status: 'complete' },
  { legacyType: 'condition', label: 'Condição', category: 'logic', nativeTypes: ['logic.if'], runtime: 'handler', status: 'complete' },
  { legacyType: 'switch', label: 'Switch', category: 'logic', nativeTypes: ['logic.switch'], runtime: 'handler', status: 'complete' },
  { legacyType: 'set-variable', label: 'Definir Variável', category: 'logic', nativeTypes: ['data.set'], runtime: 'handler', status: 'complete' },
  { legacyType: 'json-transform', label: 'Mapear JSON', category: 'logic', nativeTypes: ['data.transform'], runtime: 'handler', status: 'complete' },
  { legacyType: 'code-execution', label: 'Código JS', category: 'logic', nativeTypes: ['data.code'], runtime: 'handler', status: 'complete' },
  { legacyType: 'log-console', label: 'Log de Debug', category: 'logic', nativeTypes: ['data.log'], runtime: 'handler', status: 'complete' },

  { legacyType: 'ai-text-generation', label: 'Escritor IA', category: 'ai', nativeTypes: ['ai.prompt', 'ai.model'], runtime: 'handler', status: 'complete' },
  { legacyType: 'intelligent-agent', label: 'Agente Inteligente', category: 'ai', nativeTypes: ['ai.agent', 'ai.model'], runtime: 'handler', status: 'complete' },
  { legacyType: 'ai-model-config', label: 'AI Model Config', category: 'ai', nativeTypes: ['ai.model'], runtime: 'attachment', status: 'complete' },
  { legacyType: 'ai-memory-config', label: 'Memory Config', category: 'ai', nativeTypes: ['memory.session'], runtime: 'attachment', status: 'complete' },
  { legacyType: 'intention-router', label: 'Intenções', category: 'ai', nativeTypes: ['logic.ai_router', 'ai.model'], runtime: 'handler', status: 'complete' },
  { legacyType: 'http-tool', label: 'Ferramenta API', category: 'ai', nativeTypes: ['tool.http'], runtime: 'attachment', status: 'complete' },
  { legacyType: 'knowledge', label: 'Base de Conhecimento', category: 'ai', nativeTypes: ['knowledge.rag_retriever'], runtime: 'attachment', status: 'complete' },
  { legacyType: 'db-tool', label: 'Ferramenta BD', category: 'ai', nativeTypes: ['tool.database'], runtime: 'attachment', status: 'complete' },

  { legacyType: 'dialogy-send-message', label: 'Enviar mensagem', category: 'dialogy', nativeTypes: ['output.respond'], runtime: 'handler', status: 'complete' },
  { legacyType: 'dialogy-close-chat', label: 'Encerrar chat', category: 'dialogy', nativeTypes: ['output.close_conversation'], runtime: 'handler', status: 'complete' },
  { legacyType: 'dialogy-transfer-team', label: 'Transferir para equipe', category: 'dialogy', nativeTypes: ['output.handoff'], runtime: 'handler', status: 'complete' },
  { legacyType: 'dialogy-transfer-ai', label: 'Transferir para IA', category: 'dialogy', nativeTypes: ['output.handoff'], runtime: 'handler', status: 'complete' },
  { legacyType: 'dialogy-update-crm', label: 'Atualizar CRM', category: 'dialogy', nativeTypes: ['dialogy.crm_update'], runtime: 'handler', status: 'complete' },
  { legacyType: 'dialogy-sgp-contract-status', label: 'Status do contrato SGP', category: 'dialogy', nativeTypes: ['dialogy.sgp_contract_status'], runtime: 'handler', status: 'complete' },
  { legacyType: 'dialogy-sgp-second-copy', label: 'Segunda via SGP', category: 'dialogy', nativeTypes: ['dialogy.sgp_second_copy'], runtime: 'handler', status: 'complete' },
  { legacyType: 'dialogy-sgp-payment-promise', label: 'Promessa de pagamento', category: 'dialogy', nativeTypes: ['dialogy.sgp_payment_promise'], runtime: 'handler', status: 'complete' },

  { legacyType: 'whatsapp-text', label: 'Texto WA', category: 'whatsapp', nativeTypes: ['whatsapp.send_text'], runtime: 'handler', status: 'complete' },
  { legacyType: 'whatsapp-media', label: 'Mídia WA', category: 'whatsapp', nativeTypes: ['whatsapp.send_media'], runtime: 'handler', status: 'complete' },
  { legacyType: 'whatsapp-group', label: 'Grupos WA', category: 'whatsapp', nativeTypes: ['whatsapp.group_create'], runtime: 'handler', status: 'complete' },

  { legacyType: 'capability', label: 'Ferramentas MCP', category: 'integrations', nativeTypes: ['integration.mcp_call', 'tool.mcp'], runtime: 'handler', status: 'complete' },
  { legacyType: 'api-call', label: 'Requisição HTTP', category: 'integrations', nativeTypes: ['integration.http_request'], runtime: 'handler', status: 'complete' },
  { legacyType: 'send-email', label: 'E-mail', category: 'integrations', nativeTypes: ['integration.email'], runtime: 'handler', status: 'complete' },
  { legacyType: 'google-sheets-append', label: 'Google Sheets', category: 'integrations', nativeTypes: ['integration.google_sheets_append'], runtime: 'handler', status: 'complete' },
  { legacyType: 'supabase-read-row', label: 'Supabase Consultar (legado)', category: 'integrations', nativeTypes: ['integration.database'], runtime: 'handler', status: 'complete' },
  { legacyType: 'supabase-create-row', label: 'Supabase Inserir (legado)', category: 'integrations', nativeTypes: ['integration.database'], runtime: 'handler', status: 'complete' },
  { legacyType: 'supabase-update-row', label: 'Supabase Atualizar (legado)', category: 'integrations', nativeTypes: ['integration.database'], runtime: 'handler', status: 'complete' },
  { legacyType: 'supabase-delete-row', label: 'Supabase Excluir (legado)', category: 'integrations', nativeTypes: ['integration.database'], runtime: 'handler', status: 'complete' },
  { legacyType: 'db-select', label: 'DB Consultar', category: 'integrations', nativeTypes: ['integration.database'], runtime: 'handler', status: 'complete' },
  { legacyType: 'db-insert', label: 'DB Inserir', category: 'integrations', nativeTypes: ['integration.database'], runtime: 'handler', status: 'complete' },
  { legacyType: 'db-update', label: 'DB Atualizar', category: 'integrations', nativeTypes: ['integration.database'], runtime: 'handler', status: 'complete' },
  { legacyType: 'db-delete', label: 'DB Excluir', category: 'integrations', nativeTypes: ['integration.database'], runtime: 'handler', status: 'complete' },
  { legacyType: 'redirect', label: 'Redirecionar', category: 'integrations', nativeTypes: ['output.redirect'], runtime: 'handler', status: 'complete' },

  { legacyType: 'time-of-day', label: 'Faixa Horária', category: 'utils', nativeTypes: ['logic.time_window'], runtime: 'handler', status: 'complete' },
  { legacyType: 'date-input', label: 'Pedir Data', category: 'utils', nativeTypes: ['interaction.date'], runtime: 'handler', status: 'complete' },
  { legacyType: 'file-upload', label: 'Pedir Arquivo', category: 'utils', nativeTypes: ['interaction.file'], runtime: 'handler', status: 'complete' },
  { legacyType: 'rating-input', label: 'Pedir Avaliação', category: 'utils', nativeTypes: ['interaction.rating'], runtime: 'handler', status: 'complete' },
] as const;

export function nexusParitySummary() {
  return NEXUSFLOW_LEGACY_BLOCK_PARITY.reduce(
    (summary, item) => ({ ...summary, [item.status]: summary[item.status] + 1 }),
    { complete: 0, partial: 0, pending: 0 },
  );
}
