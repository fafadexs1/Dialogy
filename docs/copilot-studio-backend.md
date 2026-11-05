# Copiloto de conversa integrado ao Studio

Implementação local de 19/09/2026. Não houve deploy nem alteração de publicações ou sessões de clientes.

## Comportamento

Agentes com publicação Studio passam por uma execução consultiva própria. O modo assistido deixa de tentar avançar a máquina de estados do atendimento autônomo. Agentes sem publicação Studio conservam o caminho legado.

1. Carrega até 80 mensagens visíveis da conversa, com transcrições e respostas do atendente. Notas internas, mensagens com falha e dados de outro workspace são excluídos. A regeneração considera também respostas humanas posteriores à mensagem original do cliente.
2. Usa o cliente de IA da plataforma, compartilhado com o raciocínio do Studio, para identificar pedidos e selecionar procedimentos da publicação atual.
3. Realiza até três buscas na base autorizada. O índice ordena os documentos; o conteúdo vem do snapshot publicado, evitando usar uma edição posterior ou fonte de outro agente. O histórico e as fontes têm limites de contexto.
4. Produz resposta em blocos e, separadamente, resumo para o operador, informações essenciais pendentes, alertas, fontes citadas e próximos passos. Referências de documentos e de etapas são restringidas ao material efetivamente disponibilizado ao modelo.
5. Persiste e publica no canal de sugestões existente. A interface mostra os detalhes em “Como cheguei nesta resposta”.

Não executa HTTP, MCP, CRM, transferências, encerramentos nem envio ao cliente nessa execução consultiva. Essas operações aparecem como recomendações para o humano. Não grava checkpoints ou memória do executor autônomo. O runtime adaptativo existente não foi alterado.

## Concorrência e acesso

- Ações da conversa mantêm autenticação e autorização existentes.
- Solicitações manuais carregam o agente selecionado na fila, impedindo sua conversão em atendimento automático após mudança de atribuição.
- Ativação exige conversa humana; desativação não desliga um atendimento que já passou para agente autônomo.
- Valida workspace, agente ativo, modo, mensagem original e última mensagem visível antes, durante e após a geração, inclusive antes do broadcast.
- A hidratação não retorna sugestões de outro agente, conversa encerrada/desativada ou contexto já ultrapassado.
- A geração não registra consultas operacionais de outras execuções como se fossem suas.

## Validação

- 40 testes focados passaram em seis arquivos: lógica consultiva, servidor, SQL em PGlite, publicação, integração com o orquestrador e teste opt-in com modelo real.
- Teste do provedor real: DeepSeek configurado pela plataforma, conversa e procedimento fictícios, sem efeitos em clientes. Preservou a escolha de 700 mega sem mesh, tratou CEP opcional desconhecido sem bloquear o atendimento e recomendou consulta de cobertura ao humano. Última geração: aproximadamente 9,5 segundos. Evidência em `copilot-studio-model-smoke.json`.
- As consultas novas de contexto também foram executadas no PostgreSQL configurado com IDs inexistentes, confirmando compatibilidade SQL e recusa de escopo inexistente sem escrever dados.
- TypeScript e build do worker de IA aprovados. ESLint sem erros; permanece um aviso preexistente sobre `<img>` no avatar.
- Regressão adicional: 45 testes passaram e um falhou em `agent-studio-reasoning-runtime.spec.ts:114`. A expectativa de uma leitura de memória encontra duas: inicialização do runtime e leitura do raciocínio. Os hashes de `runtime.ts`, `reasoning-runtime.ts` e desse teste são idênticos aos de HEAD; nenhum desses arquivos foi alterado por esta implementação.

Este resultado não comprova homologação de uma conversa real em produção, execução de integrações externas ou qualidade perfeita de todas as respostas. O rascunho continua dependendo da revisão do atendente. Não foi criada migração: os metadados novos usam o JSON de insights existente.

## Reproduzir

```powershell
npx vitest run tests/agent-studio-copilot.spec.ts tests/agent-studio-copilot-database.spec.ts tests/copilot-actions.spec.ts tests/autopilot-copilot-suggestion.spec.ts tests/autopilot-studio-copilot-routing.spec.ts
npx tsc --noEmit --pretty false
npm run worker:ai:build
```

O teste `agent-studio-copilot-model-live.spec.ts` exige `DIALOGY_COPILOT_LIVE=1`, chama o provedor real e só permite o workspace fictício quando a cobrança interna da plataforma está desativada. Não executar esse teste em um ambiente com cobrança ativa sem preparar um workspace dedicado.
