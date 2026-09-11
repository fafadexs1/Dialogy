# Landing Dialogy — 5 de setembro de 2026

Nova página inicial implementada com a logo oficial em `public/logo.png`, tema escuro, verde luminoso, ilustrações em CSS e demonstração interativa. O arquivo da logo permanece intacto; o Next Image entrega uma versão dimensionada para o navegador.

## Conteúdo e interação

- Abertura com CTA para cadastro e exploração da plataforma.
- Demonstração identificada como ilustrativa: três contatos fictícios, abas de inbox, IA e CRM, com navegação por teclado.
- Canais, automações, organização da equipe, CRM, analytics, IA, primeiros passos, planos e perguntas frequentes.
- Links existentes de cadastro, login, preços, contato, documentação e páginas legais.
- FAQ usa os mesmos dados que o JSON-LD existente da página inicial.
- Valores de mensalidade não foram duplicados. A comparação permanece na página de preços; o período de teste vem da configuração existente.
- Ícones flutuantes, órbitas, gradientes, transições de entrada, efeitos de hover e preferência de movimento reduzido.

## Verificação local

- `npm run typecheck`: aprovado.
- ESLint do componente: aprovado.
- `node design-qa/check-landing-2026-09.cjs`: aprovado.
- 18 combinações de viewport/aba: 1440, 1024, 768, 390, 360 e 320 px, sem overflow horizontal do documento.
- Cliques reais: seleção de contatos, abas, navegação mobile, expansão do FAQ e destinos `/register`, `/login` e `/pricing`, com conteúdo visível.
- Navegação por setas nas abas e preferência `prefers-reduced-motion` verificadas.
- Logo carregada; navegador desktop observado usando a imagem otimizada com largura de 256 px para exibição de 135 px.
- Link de exploração posiciona a seção abaixo do cabeçalho fixo.
- Zero exceções JavaScript capturadas durante o roteiro.
- Capturas revisadas em desktop e mobile, incluindo a página completa.

Resultados detalhados: `dialogy-september-checks.json`. Capturas: `dialogy-september-desktop.png`, `dialogy-september-mobile.png` e versões `-full.png`.

Validação feita no servidor Next de desenvolvimento em `http://localhost:9002`. Não foi executado build de produção nem realizado deploy. As demonstrações são apresentações locais do produto, não conversas reais ou testes das integrações de atendimento.
