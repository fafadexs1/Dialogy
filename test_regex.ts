import { extractKnowledgeToolProcedures, formatKnowledgeToolProcedures } from './src/services/agent-tools/knowledge-procedures';

const documents = [{
  id: "16c51932-7aa9-4637-99e1-748ea1e9296d",
  name: "Reiniciar Roteador do Cliente",
  content: "Para reiniciar o roteador do cliente você deve verificar se o CPF do cliente já está nas tools, e buscar nas informações do SGP o endereço e o IPV4 que está naquele endereço @mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router, você deve pegar o endereço ip e usar na ferramenta para reiniciar o roteador corretamente."
}];

const tools = [
  { name: 'mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router', description: '' }
];

const procedures = extractKnowledgeToolProcedures({
  documents: documents as any,
  tools: tools as any,
  enabledToolNames: ['mcp:8171892c-827b-4216-a631-02839d36af85:reboot_router']
});

const formatted = formatKnowledgeToolProcedures(procedures);
console.log(formatted);

const match = formatted.match(/Tool resolvida:\s*(mcp:[^\s]*(?:reboot|restart|reinici)[^\s]*)\b/i);
console.log("Match:", match?.[1] || "null");
