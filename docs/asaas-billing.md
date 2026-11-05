# Assinaturas Dialogy no ASAAS

O catálogo `plans` alimenta a home, `/pricing`, a contratação e o superadmin. Novas assinaturas usam o preço vigente no servidor; valores já contratados ficam registrados em `asaas_subscriptions`. Alterações do catálogo não reajustam contratos existentes.

## Configuração

1. Validar a migração: `npx tsx scripts/apply-asaas-billing.ts`. O modo padrão executa a migração em transação e faz rollback. Para aplicar a migração específica com registro e verificação de RLS: acrescentar `--apply`.
2. Configurar `ASAAS_ENCRYPTION_KEY` com pelo menos 32 caracteres aleatórios no servidor. Manter essa chave estável e protegida: ela permite ler as credenciais criptografadas.
3. Em `/superadmin/billing/settings`, escolher sandbox, salvar a chave de API e conectar o webhook. Alternativamente, usar `ASAAS_ENVIRONMENT`, `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` no ambiente. Nenhuma chave deve usar o prefixo `NEXT_PUBLIC_`.
4. `NEXT_PUBLIC_APP_URL` deve ser o endereço HTTPS público que executa a versão nova. A conexão do webhook registra `/api/webhooks/asaas` no ASAAS. Não conectar antes de publicar o endpoint.
5. Validar no sandbox a contratação e os eventos de confirmação, vencimento, estorno e cancelamento antes de ativar produção. Não alternar ambientes em uma instalação com assinaturas vinculadas.

## Funcionamento

- A contratação usa o workspace ativo do usuário autenticado e exige seu proprietário. O checkout abre dentro do Dialogy com Pix, boleto e cartão, usando a cobrança existente no Asaas.
- Assinatura mensal com `billingType=UNDEFINED` e teste inicial conforme o plano. O checkout paga cada fatura separadamente, inclusive no cartão; não configura débito recorrente nem salva um cartão para futuras mensalidades.
- Eventos possuem token validado em tempo constante. O processamento consulta o estado atual da cobrança no ASAAS, confere cliente, assinatura e valor, grava o estado e registra o evento em uma transação. Eventos repetidos são idempotentes.
- O bloqueio ocorre depois do fim do período pago/teste mesmo se um webhook de atraso não chegar. Cobranças futuras em aberto não bloqueiam um período já pago. Estornos retiram o período correspondente. A criação de uma assinatura não significa recebimento.
- A criação é serializada por workspace e guarda checkpoints duráveis. Em timeout incerto, novas tentativas buscam a assinatura por referência externa e não repetem um POST incerto.
- Cancelamento encerra a renovação e mantém o acesso até o fim do período pago/teste. Depois do cancelamento, o proprietário pode escolher novamente um plano e iniciar outra contratação. Trocas durante uma assinatura ativa e migração de assinaturas Stripe requerem atendimento; não há prorrateio automático nesta versão.
- A recarga de créditos de IA existente é um fluxo separado, mantido sem alteração de provedor.

## Referências oficiais

- [Assinaturas](https://docs.asaas.com/docs/assinaturas)
- [Criar assinatura](https://docs.asaas.com/reference/criar-nova-assinatura)
- [Eventos de cobranças](https://docs.asaas.com/docs/webhook-para-cobrancas)
- [Autenticação de webhooks](https://docs.asaas.com/docs/webhooks-3)
- [Pagamento de fatura existente com cartão](https://docs.asaas.com/reference/pagar-uma-cobranca-com-cartao-de-credito)

## Checkout dentro do Dialogy

Antes de publicar o checkout, aplicar a migração específica `20260913193000_asaas_checkout_attempt`. Ela adiciona somente `asaas_payments.card_attempt_started_at`, uma coluna nullable de data/hora. O comando `npx tsx scripts/apply-asaas-checkout.ts` valida a migração duas vezes numa tabela temporária e faz rollback, sem alterar a tabela real. Após autorização para o banco de destino, `npx tsx scripts/apply-asaas-checkout.ts --apply` aplica somente essa migração, confere a coluna e registra o checksum no histórico Prisma. Não executa outras migrações pendentes.

Pix mostra QR Code e copia e cola retornados pelo provedor. Boleto mostra linha digitável e acesso ao PDF quando disponível. Cartão exige dados do titular, validação no servidor e pagamento à vista. Número e CVV não são persistidos, retornados ou registrados pela integração; o formulário é limpo ao enviar. O ambiente que recebe cartão deve usar HTTPS e evitar captura de corpos de requisição ou gravação de campos sensíveis por ferramentas externas.

Cada ação exige login, propriedade do workspace ativo e associação da fatura ao mesmo workspace. O servidor confere ambiente, cliente, assinatura e valor antes de preparar ou pagar. Um lock por workspace serializa operações, e o checkpoint é salvo antes da chamada de cartão. Timeouts, erros de rede, respostas 5xx e falhas de persistência mantêm o bloqueio de nova tentativa. O suporte deve verificar o resultado no Asaas antes de qualquer liberação manual; não há expiração automática desse bloqueio.

A confirmação vem do estado consultado no Asaas e dos webhooks existentes. A tela consulta a cada dez segundos enquanto visível, por até cinco minutos, e oferece atualização manual. Estorno e contestação aparecem como estados finais mesmo após uma tentativa inconclusiva.

Para revisar apenas a interface: `npx tsx scripts/preview-asaas-checkout.ts` e abrir `http://127.0.0.1:9018`. A prévia usa o componente real com ações fictícias, inclui desktop, celular e estados de pagamento e não envia cobranças. Testes: `npx vitest run tests/asaas-checkout.spec.ts tests/asaas-billing.spec.ts tests/asaas-access.spec.ts`.

Testes automatizados com respostas controladas validam as regras locais; não substituem uma homologação com pagamentos no sandbox ASAAS.

## Nova contratação após cancelamento

A migração `20260913201000_asaas_resubscribe` substitui a unicidade absoluta por workspace por um índice único parcial, que admite apenas uma assinatura cujo status não seja `superseded`. Os contratos anteriores ficam preservados com seus IDs, cliente, preço, plano e faturas. A troca de contrato local acontece em uma transação; falhas revertem a operação antes de qualquer criação no Asaas.

O servidor confirma a remoção da recorrência anterior no provedor, usa uma referência externa nova e mantém a proteção contra repetição após timeout. O período de teste não reinicia. Havendo acesso vigente, o primeiro vencimento fica para o dia seguinte ao fim desse acesso. Os direitos do plano anterior permanecem até a confirmação do novo pagamento. Webhooks de contratos históricos recalculam o acesso da assinatura atual sem reativar contratos antigos.

Validação sem alterar dados reais: `npx tsx scripts/apply-asaas-resubscribe.ts`. O script usa tabelas temporárias e verifica a preservação da fatura histórica, a nova contratação e a rejeição de duas assinaturas atuais. Com autorização para o banco de destino, `--apply` aplica somente esta migração e registra o checksum no histórico Prisma.

Publicação coordenada: o código que seleciona a assinatura atual e processa webhooks deve ser atualizado junto com essa migração. Não executar versões antigas de cobrança após a substituição da restrição: o código anterior usa `ON CONFLICT(workspace_id)` e não compreende múltiplos contratos históricos. Antes de liberar o novo checkout em produção, aplicar também `20260913193000_asaas_checkout_attempt`. A migração não cria uma assinatura nem realiza um pagamento.
