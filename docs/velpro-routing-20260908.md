# Falha de CPF e retorno ao menu em 08/09/2026

## Casos adicionais conferidos

- 5561993645657: na conversa `0e6df010-a0cf-480e-9f89-ea05fd6f5c8d`, o CPF conservou `other_cpf` e o clique posterior `new_customer` também foi rejeitado durante a etapa `cpf`. Corrigido o identificador para aceitar o ID/texto de Ainda não sou cliente durante a coleta, somente com `allowNewCustomer: true`. Dois testes reproduziram a falha antes do ajuste; 23 testes de identificação e roteamento passaram depois, incluindo bloqueio dessa saída no Financeiro. Atendimento atribuído pelo usuário ao Comercial às 18:18 UTC; nenhuma alteração no atendimento nesta investigação.
- 5561985253039: na conversa `9faead23-4e06-434e-8571-fd377cceafea`, o CPF foi recebido às 18:04:10 UTC. A execução `nexus_message_8eab5c6a77100ce4bccae77e6fe5fa32bdb9036f2e0aa3f036c25b93ea006ae7` falhou em `velpro_sgp_second_copy` com `SGP_INVOICE_NOT_FOUND`. Nenhuma tentativa de entrega do boleto ocorreu. A definição v20 possui apenas conexão de sucesso nesse bloco, sem saída de erro conectada, e por isso não respondeu/encaminhou automaticamente. O atendimento foi atribuído manualmente ao Financeiro às 18:19 UTC. Isso comprova o resultado da rotina naquela execução; não é uma auditoria independente das faturas atuais do SGP. Não houve alteração dessa configuração publicada nesta investigação.

As três conversas informadas apresentaram o mesmo defeito na versão publicada v20. O executor mesclava recursivamente a resposta atual com `context.__resumeInput` anterior. Assim, mensagens digitadas conservavam `selectedOptionId: other_cpf`. O identificador priorizava esse ID sobre o CPF ou a palavra Voltar, rejeitando respostas válidas.

Os registros de `workflow_node_runs` confirmaram o CPF em `input.resume.value` e o botão anterior em `input.resume.selectedOptionId`. O problema foi reproduzido com dois testes inicialmente falhando no executor real. A correção substitui integralmente o payload de retomada em todos os seus caminhos. Também permite o botão `back` e seu texto completo durante a coleta do documento.

Uma consulta real ao SGP com o primeiro documento recebido em cada conversa confirmou documento válido e contrato ativo nos números 5561998773030, 5561996374943 e 5574981278864. O replay do identificador avançou pela saída `selected` nos três casos. Evidência sem documentos: `velpro-routing-20260908-verification.json`. O script captura a entrega e desativa a gravação no CRM; não envia mensagens nem transfere clientes.

Os três fluxos históricos foram cancelados quando atendentes humanos assumiram as conversas. Nenhuma conversa foi reaberta, reatribuída ou reprocessada em produção nesta correção.

Validação local: 53 testes em seis arquivos; TypeScript e build do worker Nexus. O replay consulta o provedor real, mas a entrega e a atribuição final não foram executadas em produção.

Implantação pendente: atualizar aplicação e worker Nexus pelo processo habitual. A correção está no runtime e não exige republicar o grafo v20 nem executar migração. O acesso ao navegador/painel falhou duas vezes por timeout nesta sessão; não foi possível implantar ou confirmar uma versão corrigida em produção. Após o deploy, validar uma conversa de homologação desde Informar CPF/CNPJ até a atribuição persistida, incluindo retorno ao menu.
