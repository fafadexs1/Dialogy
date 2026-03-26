# Guia de Configuracao Stripe para Dialogy

Este guia explica como cadastrar os produtos da Dialogy no Stripe mantendo os slugs tecnicos atuais do sistema.

## Parte 1: Configuracao no painel da Stripe

1. Acesse [dashboard.stripe.com](https://dashboard.stripe.com).
2. Ative o modo de teste enquanto estiver configurando.

### Produtos publicos

Crie tres produtos recorrentes mensais com estes nomes e valores:

#### 1. Plano Essencial
- Nome: `Dialogy Essencial`
- Descricao: `Organize seu atendimento em um so lugar.`
- Preco: `197,00`
- Moeda: `BRL`
- Periodo: `Mensal`
- Slug tecnico no sistema: `starter`

#### 2. Plano Profissional
- Nome: `Dialogy Profissional`
- Descricao: `Estruture sua operacao e responda mais rapido.`
- Preco: `397,00`
- Moeda: `BRL`
- Periodo: `Mensal`
- Slug tecnico no sistema: `pro`

#### 3. Plano Operacao
- Nome: `Dialogy Operacao`
- Descricao: `Escalone com automacoes, permissoes e integracoes.`
- Preco: `897,00`
- Moeda: `BRL`
- Periodo: `Mensal`
- Slug tecnico no sistema: `business`

### Obter os Price IDs

Depois de salvar cada produto:

1. Abra a secao `Precos`.
2. Copie o ID `price_...`.
3. Guarde esse valor para mapear no painel interno.

## Parte 2: Configuracao no Dialogy

### Mapeamento no codigo

Os slugs tecnicos continuam estes:

- `starter` -> Dialogy Essencial
- `pro` -> Dialogy Profissional
- `business` -> Dialogy Operacao
- `enterprise` -> Enterprise

### Variaveis de ambiente

Adicione as chaves no `.env.local`:

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Webhook

Para ambiente local:

1. Rode `stripe login` ou configure `STRIPE_SECRET_KEY` valida no ambiente.
2. Rode `npm run dev`.
3. O runner local inicia `stripe listen --forward-to http://localhost:9002/api/webhooks/stripe` automaticamente.
4. Quando o Stripe CLI retorna um `whsec_...` a tempo, o valor e injetado no processo Next para sincronizar a verificacao do webhook.

Fallback manual:

1. Rode `npm run dev:next`
2. Rode `stripe listen --skip-update --forward-to http://localhost:9002/api/webhooks/stripe`

Em producao:

1. Crie o endpoint `https://sua-url.com/api/webhooks/stripe`
2. Ouça estes eventos:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

## Extras publicos

- Pacote extra de 500 chats: `R$ 99/mensal`
- Canal extra: `R$ 39/mensal`
- IA Copilot por workspace: `R$ 149/mensal`

Custos oficiais da Meta ou do BSP continuam fora do plano principal.
