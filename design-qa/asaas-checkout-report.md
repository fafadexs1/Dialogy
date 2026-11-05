# Checkout Dialogy — verificação de 13/09/2026

## Resultado

Implementação local de pagamento da fatura existente por Pix, boleto e cartão. O painel de faturamento abre o novo diálogo no lugar do redirecionamento para pagamento. A interface foi exercitada com ações fictícias, sem criar cobrança ou enviar pagamento ao Asaas.

## Evidência executada

- Vitest: 58 testes passaram em `asaas-checkout`, `asaas-billing` e `asaas-access`. Cobrem autenticação, propriedade do workspace ativo, associação/valor/ambiente da fatura, Pix, boleto, recusa, timeout, checkpoint e estorno após tentativa inconclusiva.
- `npx tsc --noEmit --pretty false`: passou.
- ESLint dos arquivos de cobrança alterados, testes e scripts: passou.
- `git diff --check`: passou; Git informou apenas conversão de finais de linha.
- Migração executada duas vezes sobre uma tabela temporária no PostgreSQL, com escrita/leitura do checkpoint e rollback. Tipo `timestamp with time zone`, nullable, verificado.
- Navegador: geração e cópia de Pix; geração da linha digitável; seleção de cartão; máscaras; envio fictício seguido de limpeza do formulário e mensagem de erro; estados confirmado, inconclusivo e estornado; fechamento após confirmação.
- Layout: desktop e tema escuro inspecionados; celular de 320px com formulário de cartão sem overflow horizontal (clientWidth/scrollWidth 286/286); celular de 390px com Pix sem overflow horizontal (364/364). A rolagem vertical permite acesso ao formulário completo.

## Limites e ativação

Consulta atual ao banco remoto confirmou ausência de `card_attempt_started_at` e ausência da migração `20260913193000_asaas_checkout_attempt` no histórico. O ambiente Asaas configurado é `production`. A validação temporária não alterou a tabela de cobrança nem o histórico real.

Antes de ativar, aplicar a migração específica usando `scripts/apply-asaas-checkout.ts --apply` e publicar o código. A homologação de uma transação real e dos webhooks continua pendente; testes locais e a prévia não comprovam liquidação financeira.

O console da prévia registrou dois erros de `MutationObserver.observe` durante navegação, sem URL de origem no diagnóstico fornecido pelo navegador. As interações acima funcionaram; a origem desses registros não foi estabelecida. Não se afirma ausência total de erros de console.

Prévia local: `http://127.0.0.1:9018`. Dados de exemplo não têm valor de pagamento. Instruções de operação e migração em `docs/asaas-billing.md`.

## Correção: escolha de plano após cancelamento

Leitura do banco confirmou o caso da Velpro Telecom: assinatura marcada como cancelada, ainda em teste até 19/09/2026, com uma fatura histórica. A condição da interface exigia ausência completa de assinatura para exibir o catálogo, e o servidor também recusava nova contratação após cancelamento.

A escolha de planos foi restaurada para assinaturas canceladas. Verificação na página autenticada `http://localhost:9002/settings/billing`: catálogo visível com os planos públicos e a oferta Parceria Velpro - Dialogy; seleção real da oferta exclusiva atualizou o resumo para R$550 e abriu Finalizar contratação com o mesmo plano/valor. A ação de contratar não foi enviada pelo agente.

65 testes passaram, incluindo sete novos testes de recontratação, preservação do acesso/histórico, ausência de novo teste gratuito, rollback e bloqueio de duplicação após timeout. TypeScript e ESLint passaram. A migração de recontratação foi executada duas vezes em tabelas temporárias; a nova assinatura foi aceita, uma segunda assinatura atual foi rejeitada e a fatura histórica foi preservada. Tudo foi revertido ao fim da validação.

Durante a validação o usuário relatou erro genérico ao contratar. A restrição real `UNIQUE(workspace_id)` continuava instalada; o registro cancelado permaneceu inalterado, sem outro contrato local. O tratamento desse conflito agora explica que a habilitação da nova contratação ainda depende da atualização do sistema. Migrações e publicação coordenada pendentes de ativação; a seleção visual, sozinha, não prova contratação concluída.

## Atualização após autorização

O usuário autorizou explicitamente a aplicação das duas migrações. `apply-asaas-checkout.ts --apply` e `apply-asaas-resubscribe.ts --apply` concluíram com sucesso no banco remoto. A primeira confirmou a coluna nullable de timestamp; a segunda confirmou o índice único de contrato atual e a remoção da restrição anterior. A publicação do código no servidor de produção não foi executada nesta tarefa. A página local usa o código atualizado. Nenhuma contratação ou transação financeira foi submetida pelo agente.
