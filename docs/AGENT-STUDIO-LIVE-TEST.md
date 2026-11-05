# Teste ponta a ponta no Estúdio

No chat do Estúdio, **Ponta a ponta → Iniciar teste com ações reais** cria um contato `[Teste IA]` e um atendimento no Inbox. Não publica nem altera o agente ativo. O teste fixa o rascunho, o modelo e os contratos das conexões no início da sessão.

- IA e fontes selecionadas são reais. HTTP/MCP usam as credenciais do workspace e retornam os dados efetivos, sem respostas fictícias.
- CRM/etiquetas alteram o contato criado para o teste. As APIs externas operam sobre os identificadores fornecidos pelo autor, portanto podem alterar dados de produção.
- Transferências e encerramentos usam as ações autenticadas do sistema. Horários, disponibilidade da equipe e permissões continuam valendo. Após a transferência, respostas humanas no Inbox aparecem no Estúdio.
- O contexto de entrada aceita JSON para testar dados normalmente fornecidos por um fluxo. Anexos PDF, imagens, TXT e CSV de até 9 MB usam armazenamento privado e o mesmo processamento de coleta de arquivo do agente.
- Este é um canal de chat real dentro do Estúdio/Inbox. Não verifica a entrega física de WhatsApp/Instagram/Evolution: essa parte exige enviar uma mensagem pelo canal correspondente.
- Recarregar recupera a sessão nesta aba. Iniciar outro teste mantém os registros anteriores e não desfaz ações externas. A sessão aceita novas mensagens por até 24 horas.

**Permissões:** gerenciar automações, editar configurações do workspace, editar CRM, acessar Inbox e visualizar equipes. Cada envio revalida as permissões. O modo **Simular ações** continua disponível sem executar integrações reais.

O servidor guarda a configuração fixa e o estado cifrado. O navegador envia somente o identificador da sessão, a mensagem e um eventual arquivo. Reservas de execução, checkpoints antes das ações e IDs idempotentes impedem repetição em envios duplicados. Operações interrompidas com resultado incerto exigem conferência no sistema externo antes de outro teste.

## Banco e validação

A migração `20260830210000_agent_studio_live_tests` cria uma tabela exclusiva do servidor, com RLS e sem acesso dos papéis `anon`/`authenticated`. Os testes não entram nas métricas de publicações do Estúdio, mas seus atendimentos reais aparecem no Inbox e podem contar para os limites do plano.

Verificar: `node scripts/verify-agent-studio-live-test.mjs`

Aplicar somente esta migração, sem executar outras migrações pendentes: `node scripts/verify-agent-studio-live-test.mjs --apply`

Regressão: `npx vitest run tests/agent-studio-live-test.spec.ts tests/agent-studio-authorization.spec.ts tests/agent-studio-runtime.spec.ts`

Os testes automatizados usam Postgres embarcado (PGlite), o motor real e adaptadores controlados para o provedor/APIs. Não fazem operações em contas externas de clientes.
