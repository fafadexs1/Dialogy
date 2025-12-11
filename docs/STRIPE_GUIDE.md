# Guia de Configuração Stripe para Dialogy

Este guia passo a passo explica como configurar seus produtos no Stripe e integrar com o Dialogy.

## Parte 1: Configuração no Painel da Stripe

1.  **Acesse o Dashboard**: Vá para [dashboard.stripe.com](https://dashboard.stripe.com) e faça login.
2.  **Modo de Teste**: Certifique-se de que o "Modo de teste" (Test Mode) está ativado no canto superior direito (para desenvolvimento).

### Criando os Produtos (Planos)

### Criando os Produtos (Planos)

Você precisa criar 3 produtos separadamente. Use **exatamente** os dados abaixo para cada um:

#### 1. Plano Starter
*   **Nome**: `Dialogy Starter`
*   **Descrição**: `Ideal para quem está começando.`
*   **Modelo de preço**: `Padrão`
*   **Preço**: `97,00`
*   **Moeda**: `BRL`
*   **Período de faturamento**: `Mensal`
*   *(Clique em "Salvar produto" e copie o ID do preço `price_...`)*

#### 2. Plano Pro
*   **Nome**: `Dialogy Pro`
*   **Descrição**: `Para empresas em crescimento.`
*   **Modelo de preço**: `Padrão`
*   **Preço**: `297,00`
*   **Moeda**: `BRL`
*   **Período de faturamento**: `Mensal`
*   *(Clique em "Salvar produto" e copie o ID do preço `price_...`)*

#### 3. Plano Business
*   **Nome**: `Dialogy Business`
*   **Descrição**: `Para operações robustas.`
*   **Modelo de preço**: `Padrão`
*   **Preço**: `697,00`
*   **Moeda**: `BRL`
*   **Período de faturamento**: `Mensal`
*   *(Clique em "Salvar produto" e copie o ID do preço `price_...`)*

### Obtendo os IDs de Preço (Price IDs)

Após salvar, você verá a página de detalhes do produto.
1.  Role até a seção **Preços**.
2.  Você verá um ID que começa com `price_...` (ex: `price_1Pxyz...`).
3.  **Copie este ID**. Este é o `stripePriceId` que usaremos no código.

**Repita para os planos Pro e Business.**

## Parte 2: Configuração no Código (Dialogy)

Agora vamos conectar esses IDs ao nosso sistema.

### 1. Atualizar `src/lib/plans.ts`

Abra o arquivo `src/lib/plans.ts` e cole os IDs que você copiou nos campos `stripePriceId` correspondentes.

```typescript
export const PLANS: Record<PlanType, PlanDetails> = {
    starter: {
        id: 'starter',
        // ...
        stripePriceId: 'price_1Pxyz...', // COLE AQUI O ID DO STARTER
    },
    pro: {
        id: 'pro',
        // ...
        stripePriceId: 'price_1Pzyx...', // COLE AQUI O ID DO PRO
    },
    business: {
        id: 'business',
        // ...
        stripePriceId: 'price_1Pyzx...', // COLE AQUI O ID DO BUSINESS
    },
    // ...
};
```

### 2. Variáveis de Ambiente (`.env.local`)

Você precisa adicionar as chaves da Stripe ao seu arquivo `.env.local`. Pegue essas chaves em **Desenvolvedores > Chaves de API** no dashboard da Stripe.

```env
# Stripe (Mode Teste)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

*   `STRIPE_WEBHOOK_SECRET`: Você obterá este valor ao configurar o webhook (veja abaixo).

### 3. Configurar Webhook (Para atualizações automáticas)

Para que o Dialogy saiba quando um pagamento foi feito, precisamos ouvir eventos da Stripe.

1.  Se estiver rodando localhost, use o **Stripe CLI** para testar webhooks:
    *   Instale o Stripe CLI.
    *   Rode: `stripe login`
    *   Rode: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
    *   Ele te dará um segredo de webhook (`whsec_...`). Coloque no `.env.local`.

2.  Em **Produção** (Vercel/Deploy):
    *   Vá em **Desenvolvedores > Webhooks** no Stripe.
    *   Adicione um endpoint: `https://sua-url.com/api/webhooks/stripe`.
    *   Eventos para ouvir:
        *   `checkout.session.completed`
        *   `invoice.payment_succeeded`
        *   `customer.subscription.updated`
        *   `customer.subscription.deleted`

## Próximos Passos Sugeridos

Eu posso implementar a infraestrutura necessária para você agora se desejar:

1.  Criar `src/lib/stripe.ts` (Cliente Stripe).
2.  Criar `src/app/api/webhooks/stripe/route.ts` (Ouvinte de eventos).
3.  Criar uma Server Action para criar sessões de checkout (`createCheckoutSession`).
