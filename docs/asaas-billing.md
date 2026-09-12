# Assinaturas Dialogy no ASAAS

O catálogo `plans` alimenta a home, `/pricing`, a contratação e o superadmin. Novas assinaturas usam o preço vigente no servidor; valores já contratados ficam registrados em `asaas_subscriptions`. Alterações do catálogo não reajustam contratos existentes.

## Configuração

1. Validar a migração: `npx tsx scripts/apply-asaas-billing.ts`. O modo padrão executa a migração em transação e faz rollback. Para aplicar a migração específica com registro e verificação de RLS: acrescentar `--apply`.
2. Configurar `ASAAS_ENCRYPTION_KEY` com pelo menos 32 caracteres aleatórios no servidor. Manter essa chave estável e protegida: ela permite ler as credenciais criptografadas.
3. Em `/superadmin/billing/settings`, escolher sandbox, salvar a chave de API e conectar o webhook. Alternativamente, usar `ASAAS_ENVIRONMENT`, `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` no ambiente. Nenhuma chave deve usar o prefixo `NEXT_PUBLIC_`.
4. `NEXT_PUBLIC_APP_URL` deve ser o endereço HTTPS público que executa a versão nova. A conexão do webhook registra `/api/webhooks/asaas` no ASAAS. Não conectar antes de publicar o endpoint.
5. Validar no sandbox a contratação e os eventos de confirmação, vencimento, estorno e cancelamento antes de ativar produção. Não alternar ambientes em uma instalação com assinaturas vinculadas.

## Funcionamento

- A contratação usa o workspace ativo do usuário autenticado e exige seu proprietário. CPF/CNPJ é encaminhado ao ASAAS; dados de cartão são preenchidos na fatura hospedada pelo ASAAS.
- Assinatura mensal com `billingType=UNDEFINED`, fatura com os meios habilitados na conta e teste inicial de sete dias. PIX e boleto exigem pagamento em cada vencimento. Cartão permite recorrência conforme a configuração da fatura/conta ASAAS.
- Eventos possuem token validado em tempo constante. O processamento consulta o estado atual da cobrança no ASAAS, confere cliente, assinatura e valor, grava o estado e registra o evento em uma transação. Eventos repetidos são idempotentes.
- O bloqueio ocorre depois do fim do período pago/teste mesmo se um webhook de atraso não chegar. Cobranças futuras em aberto não bloqueiam um período já pago. Estornos retiram o período correspondente. A criação de uma assinatura não significa recebimento.
- A criação é serializada por workspace e guarda checkpoints duráveis. Em timeout incerto, novas tentativas buscam a assinatura por referência externa e não repetem um POST incerto.
- Cancelamento encerra a renovação e mantém o acesso até o fim do período pago/teste. Trocas de plano, recontratação após cancelamento e migração de assinaturas Stripe requerem atendimento; não há prorrateio automático nesta versão.
- A recarga de créditos de IA existente é um fluxo separado, mantido sem alteração de provedor.

## Referências oficiais

- [Assinaturas](https://docs.asaas.com/docs/assinaturas)
- [Criar assinatura](https://docs.asaas.com/reference/criar-nova-assinatura)
- [Eventos de cobranças](https://docs.asaas.com/docs/webhook-para-cobrancas)
- [Autenticação de webhooks](https://docs.asaas.com/docs/webhooks-3)

Testes automatizados com respostas controladas validam as regras locais; não substituem uma homologação com pagamentos no sandbox ASAAS.
