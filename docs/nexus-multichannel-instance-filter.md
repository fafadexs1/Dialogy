# Correção do filtro de instâncias por canal — 2026-09-08

O gatilho de mensagem recebida aplicava `instanceNames` a todos os canais. Um fluxo com Instagram, Messenger, Telegram e webchat habilitados, mas com `instanceNames: ["zap1"]`, rejeitava mensagens desses canais.

O dispatcher agora consulta os tipos das instâncias no workspace do fluxo. As instâncias selecionadas de WhatsApp restringem somente WhatsApp; as de Telegram restringem somente Telegram. Se nenhum nome selecionado pertence ao canal, todas as instâncias daquele canal são elegíveis. Instagram, Messenger e webchat não usam esse seletor. Instâncias não reconhecidas continuam restritivas em WhatsApp/Telegram, evitando ampliar acesso por ausência de cadastro.

Os filtros de canal, tipo de mensagem e atribuição permanecem aplicados. O cadastro de tipos vem do banco, com escopo de workspace, e não dos metadados da mensagem. A descrição no editor explica a regra. Fluxos já publicados usam o novo comportamento assim que o código atualizado for implantado; não precisam de alteração nas definições.

Validação: 29 testes passaram em quatro arquivos, incluindo o dispatcher com persistência/provedores substituídos por mocks, restrições independentes dos dois canais e preservação do atendimento humano. A consulta ao cadastro foi executada em modo somente leitura no banco conectado. TypeScript e `git diff --check` foram verificados. Nenhuma mensagem foi enviada a clientes nestes testes.

Esta correção geral é de código e ainda requer deploy. A publicação v20 da Velpro realizada anteriormente é uma correção de configuração separada e já está persistida em produção.
