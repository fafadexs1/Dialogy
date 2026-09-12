# Planos e ASAAS — verificação de 12/09/2026

## Evidências verificadas

- Catálogo consultado no banco: Essencial R$249, Profissional R$499, Operacao R$999 e Enterprise sob consulta. Nenhum preço foi alterado.
- Migração `20260912210000_asaas_billing`: ensaiada com rollback, depois aplicada e registrada em `_prisma_migrations`. Verificação confirmou RLS e ausência de leitura para `anon`/`authenticated` nas três novas tabelas. O servidor tem acesso às tabelas.
- `npx tsc --noEmit --incremental`: passou.
- `npx vitest run tests/asaas-access.spec.ts tests/asaas-billing.spec.ts tests/billing-access.spec.ts`: 34 testes passaram.
- ESLint nos módulos de cobrança, catálogo, páginas e componentes alterados: sem erros ou avisos.
- `git diff --check` no escopo alterado: passou.
- Navegador Chrome, aplicação real em localhost:9002: superadmin autenticado carregou o catálogo, os totais ASAAS zerados e a indicação de configuração pendente. A página de configurações carregou os campos e o endereço do webhook.
- Home: cartões dos três planos e Enterprise renderizados; seção aberta pelo menu móvel. Na largura de 390px, document/body mediram 382px, sem overflow horizontal. Desktop e celular inspecionados por screenshots no navegador.
- Clique em Começar com Profissional abriu `/register?next=%2Fsettings%2Fbilling%3Fplan%3Dpro`; o link de login preservou o mesmo destino.
- A página de cobrança autenticada carregou o catálogo real e o estado indisponível para contratação sem credenciais.

## Limites desta validação

Não havia chave ASAAS configurada. Não houve criação de cliente, assinatura ou pagamento em uma conta ASAAS, nem validação bancária de PIX, boleto ou cartão. Os testes de provedor usam respostas controladas e não comprovam homologação no ASAAS.

A aplicação foi validada no servidor local. Não foi feito deploy nem build de produção nesta tarefa. `ASAAS_ENCRYPTION_KEY` foi configurada no `.env` local, sem expor seu valor. A variável também deve existir no ambiente que hospedar a aplicação e precisa ser preservada ao transportar credenciais criptografadas.

Troca de plano, recontratação após cancelamento, migração de assinaturas Stripe e recargas de créditos de IA seguem os limites documentados em `docs/asaas-billing.md`.
