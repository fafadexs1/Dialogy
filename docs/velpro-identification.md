# Identificação SGP antes do encaminhamento — Velpro

**Publicado como v19 em 08/09/2026 às 12:41 (Brasília), após deploy PDC-1.83 confirmado no Easypanel.** Os estados de rascunho descritos abaixo registram as etapas anteriores. Foram substituídas 16 execuções antigas, sem falhas. Evidência em `docs/velpro-identification-publication.json`.

Implementação de 08/09/2026. Workspace Velpro Telecom, fluxo `Fluxo Velpro Final`.

## Complemento: documento informado na segunda via

Implementado após a publicação v19, pendente de novo deploy da aplicação e do worker Nexus pelo Easypanel. Não exige republicar o grafo.

O bloco `dialogy.sgp_second_copy` salva o CPF/CNPJ explicitamente informado no campo mapeado do contato da conversa, somente se os dígitos verificadores forem válidos e a consulta SGP retornar contrato. Salva mesmo sem faturas abertas; não grava em consulta vazia ou com erro e preserva campos preenchidos. A gravação ocorre na primeira consulta, sem repetir nas escolhas de fatura e pagamento.

Validação: 29 testes passaram; build do worker passou; inserção e leitura de CPF/CNPJ, preservação e isolamento verificadas em tabelas temporárias PostgreSQL com rollback, sem alterar contatos reais. Não foi realizado envio de segunda via em produção para este complemento.

## Estado entregue

- Código implementado; rascunho salvo no banco com 70 blocos e quatro identificações SGP.
- Revisão publicada continua `v18`, sem os novos blocos. A ativação depende do deploy pelo Easypanel, a cargo do usuário.
- Rascunho exportado em `docs/velpro-identification-draft.json`.
- Não há migração de banco.

## Comportamento

O novo bloco `dialogy.sgp_identify_customer` consulta o CPF do campo mapeado na integração SGP para o contato do atendimento. O campo da Velpro foi confirmado como `CPF`.

Contratos são apresentados em páginas de seis itens, com endereço e situação, incluindo contratos cancelados para atendimento. Cada página permite informar outro CPF ou voltar. Mesmo um contrato único exige confirmação. Os IDs das linhas têm prefixo para evitar confusão com números de opções.

Se não houver CPF salvo ou contratos encontrados, o cliente pode informar CPF; no Comercial também pode seguir como novo cliente. CPF/CNPJ passa pela validação de dígitos verificadores antes da consulta. Após selecionar um contrato, o documento confirmado é salvo no campo mapeado se estiver vazio. Um campo preenchido é preservado; documentos alternativos não o substituem. A gravação usa o contato da conversa e valida a workspace do contato e do campo. A lista antiga é descartada ao trocar o CPF. Falhas de conexão/configuração seguem uma rota de indisponibilidade, sem alegar que o CPF não existe.

As entradas do Comercial e os encaminhamentos ao Financeiro passam pela identificação. Os caminhos de segunda via e promessa de pagamento mantêm sua lógica atual. A entrada do Suporte também identifica o contrato: ativos seguem o expediente e menu técnico existentes; suspensos e cancelados vão diretamente à disponibilidade do Financeiro, mantendo o contrato escolhido.

Transferência de endereço possui identificação, coleta do novo endereço e encaminhamento exclusivos, usando a equipe e o expediente do Comercial. A resposta “não sei” ao endereço é aceita. O ramo fora de horário preserva o destino configurado atualmente no Comercial. Nenhuma mudança é executada no cadastro/endereço do SGP.

Os três encaminhamentos habilitam `persistReason`: contrato e endereço são renderizados no servidor e anexados à mensagem interna de transferência, na mesma transação da atribuição. Esse resumo só é aceito de chamadas internas autenticadas e não é enviado como mensagem ao cliente. Os demais encaminhamentos mantêm seu comportamento.

## Validação

- Consulta real ao SGP com o CPF autorizado: 20 contratos, 19 ativos e 1 cancelado.
- Novo bloco executado com o campo CPF real do contato: 20 contratos acessíveis em quatro páginas, com 9, 10, 10 e 5 opções.
- Confirmação de contrato e reconsulta via “outro CPF” usando o mesmo CPF autorizado; campo CRM permaneceu idêntico.
- Evidência sem CPF completo em `docs/velpro-identification-live-results.json`.
- 66 testes passaram em oito arquivos, incluindo retomada pelo executor, paginação, troca de identidade, isolamento do contato, projeção de dados, erro do SGP, preservação do fluxo e resumo do encaminhamento.
- `npx tsc --noEmit --pretty false`: passou.
- `npm run worker:nexus:build`: passou.
- Validação estrutural do rascunho: zero erros e zero avisos.
- Releitura do banco confirmou três blocos novos no rascunho e nenhum na revisão publicada v18.

Os testes do canal capturaram as saídas localmente: nenhuma mensagem foi enviada e nenhum atendimento foi transferido. Entrega WhatsApp e encaminhamento com persistência em produção ainda dependem do deploy e de uma conversa de homologação. Não foi executado build completo do Next.js; o frontend passou pela checagem TypeScript.

## Deploy e ativação

1. Enviar esta versão pelo processo habitual do Easypanel, atualizando aplicação e serviços que executam o runtime Nexus.
2. Após os serviços estarem na nova versão, abrir o Fluxo Velpro Final na workspace Velpro, conferir o rascunho e publicá-lo.
3. Homologar uma conversa autorizada: Comercial, Financeiro e Transferência de endereço; escolher contrato, trocar CPF e conferir o resumo interno após encaminhamento.

Não publicar o rascunho antes da atualização do runtime: a versão anterior não conhece o novo tipo de bloco. Não executar o importador legado para essa atualização, pois ele reconstrói o fluxo e pode substituir edições atuais.

O script `npx tsx scripts/upgrade-velpro-identification.ts` valida/exporta o estado atual. Com `--apply`, salva somente o rascunho e registra uma versão de edição; nunca publica. A transformação é idempotente.

O script `npx tsx scripts/verify-velpro-identification-live.ts <CPF autorizado>` repete a consulta real sem envio de mensagens, exigindo um atendimento existente com esse CPF no campo mapeado.

## Atualização: CPF/CNPJ e gravação do documento

O rascunho usa `velproIdentificationVersion: 3` e `saveDocumentIfEmpty: true` nos quatro blocos. O campo permanece chamado CPF, mas recebe CPF ou CNPJ normalizado, sem pontuação. Documentos com dígitos verificadores inválidos não são consultados nem salvos. Um documento não encontrado no SGP também não é gravado por este bloco.

O validador contempla CNPJ numérico e alfanumérico, com o cálculo da [documentação da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj). Não foi feita uma consulta real com CNPJ: o teste real usou somente o CPF autorizado. O suporte do provedor SGP a CNPJ alfanumérico ainda não foi homologado; o documento é enviado sem remover letras.

Gravação e releitura no PostgreSQL foram verificadas em tabelas temporárias, com rollback, pelo script `scripts/verify-sgp-document-persistence.ts`. Evidência: `docs/sgp-document-persistence-results.json`. Nenhum contato de produção foi modificado nos testes. O script de consulta real desabilita explicitamente a gravação.

## Suporte com encaminhamento pela situação do contrato

Ao escolher Suporte, o cliente identifica CPF/CNPJ e confirma o contrato antes do expediente/menu técnico. A regra usa `statusTone` do contrato selecionado, normalizado a partir da resposta SGP: `active` segue Suporte; `suspended` e `cancelled` seguem aviso de encaminhamento e disponibilidade do Financeiro. Não passa novamente pela identificação financeira. Situação desconhecida e falha de consulta seguem aviso de conferência manual e a disponibilidade do Suporte. Expedientes e destinos já configurados são preservados.

O encaminhamento técnico também grava o resumo interno do contrato. As rotas de recuperação dos quatro identificadores estão habilitadas com `customErrorRoute: true`, conforme exigido pelo executor.

Validação deste ajuste: 31 testes passaram em quatro arquivos, incluindo cinco cenários no fluxo completo usando o executor real e efeitos externos interceptados. A consulta real ao CPF autorizado confirmou 19 contratos ativos e um cancelado; a seleção do cancelado preservou `statusTone: cancelled`. Nenhuma mensagem foi enviada nem transferência real foi executada. TypeScript e build do worker Nexus passaram. O rascunho tem 70 blocos, zero erros/avisos, e aguarda deploy/publicação.
