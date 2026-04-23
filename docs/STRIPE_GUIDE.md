# Guia de Configuracao Stripe para Dialogy

Este guia explica como configurar o Stripe para o sistema Dialogy.

## Modelo de Pricing

A Dialogy usa um **plano unico com pricing por volume de chats**. Nao existem planos separados
como Starter/Pro/Business — todos os clientes escolhem apenas o volume de chats mensal.

Os precos sao definidos no codigo (`src/lib/plans-types.ts`) e passados ao Stripe via `price_data`
inline no checkout. Nao e necessario criar precos fixos no Dashboard do Stripe.

### Tabela de Precos (BRL/mes)

| Chats/mes | Preco    |
|-----------|----------|
| 500       | R$ 95    |
| 2.000     | R$ 170   |
| 5.000     | R$ 380   |
| 10.000    | R$ 600   |
| 15.000    | R$ 780   |
| 20.000    | R$ 950   |
| 30.000    | R$ 1.280 |
| 40.000    | R$ 1.740 |
| 50.000    | R$ 2.090 |
| 70.000    | R$ 2.490 |
| 100.000   | R$ 2.920 |

### Addons

- Pacote extra de 500 chats: R$ 99/mensal
- Canal WhatsApp extra: R$ 39/mensal
- IA Copilot por workspace: R$ 149/mensal

Custos oficiais da Meta ou do BSP continuam fora do plano principal.

## Parte 1: Configuracao no painel da Stripe

1. Acesse [dashboard.stripe.com](https://dashboard.stripe.com).
2. Para testes, use o modo de teste. Para producao, use as chaves Live.

### Produtos

Crie tres produtos no Stripe para referencia/organizacao (o checkout usa `price_data` inline):

- **Dialogy Starter** — slug tecnico: `starter`
- **Dialogy Pro** — slug tecnico: `pro`
- **Dialogy Business** — slug tecnico: `business`
- **Enterprise** — slug tecnico: `enterprise` (tratado comercialmente, sem checkout self-serve)

> **Nota:** Os precos fixos dos produtos no Dashboard nao sao usados pelo fluxo de checkout.
> O codigo gera precos dinamicos via `price_data` com base na tabela de volume acima.

## Parte 2: Configuracao no Dialogy

### Variaveis de ambiente

Adicione as chaves no `.env` (ou configure via SuperAdmin > Billing Settings):

```env
# Para PRODUCAO use chaves Live (pk_live_... / sk_live_...)
# Para TESTES use chaves Test (pk_test_... / sk_test_...)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

> **IMPORTANTE:** As chaves tambem podem ser configuradas via banco de dados
> no painel SuperAdmin > Billing Settings (`system_settings` table).
> O sistema prioriza valores do banco sobre o `.env`.

### Webhook

#### Em producao

1. No Dashboard Stripe, va em **Developers > Webhooks**
2. Crie um endpoint apontando para `https://dialogy.klyraai.com.br/api/webhooks/stripe`
3. Selecione os eventos:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copie o **Signing Secret** (`whsec_...`) gerado pelo Dashboard
5. Atualize o `.env` ou `system_settings` com o valor

#### Em desenvolvimento local

1. Rode `npm run dev` (o script `dev-with-stripe.cjs` inicia o Stripe CLI automaticamente)
2. O listener encaminha webhooks para `http://localhost:9002/api/webhooks/stripe`
3. O webhook secret do CLI e injetado automaticamente no processo Next

Fallback manual:

1. Rode `npm run dev:next`
2. Rode `stripe listen --skip-update --forward-to http://localhost:9002/api/webhooks/stripe`

### Checklist Go-Live

- [ ] Chaves Live (`pk_live_` / `sk_live_`) configuradas no `.env` ou `system_settings`
- [ ] Endpoint webhook criado no Dashboard Stripe (nao usar secret do CLI)
- [ ] Webhook Secret do Dashboard configurado no `.env` ou `system_settings`
- [ ] Customer Portal configurado no Dashboard Stripe
- [ ] Teste de pagamento real validado (tier minimo R$ 95)
- [ ] Stripe Radar (deteccao de fraude) ativo (padrao em contas Live)

## Arquitetura do Fluxo de Pagamento

```
Cliente seleciona volume de chats
       |
       v
createCheckoutSessionAction()
  - Cria/reutiliza Stripe Customer
  - Se ja tem subscription ativa: atualiza com proration
  - Se nao: cria Checkout Session com price_data inline
       |
       v
Stripe Checkout (hosted page)
       |
       v
Webhook: checkout.session.completed
  - Insere/atualiza billing_info (plan, status, subscription_id)
  - Atualiza custom_limits no workspace
       |
       v
Webhooks recorrentes:
  - invoice.payment_succeeded -> status = active
  - invoice.payment_failed -> status = past_due
  - customer.subscription.updated -> sincroniza status
  - customer.subscription.deleted -> sincroniza status
```
