# Inbox — revisão visual

Implementado na rota existente `/inbox`, com os mesmos componentes de conversa, lista, contexto e composição de mensagens.

- Paleta sálvia e verde profundo para temas claro e escuro; estilos limitados ao Inbox.
- Filas em grade com todos os nomes visíveis, contagens carregadas preservadas, seleção estável e navegação por teclado.
- Filtros rápidos com botões nativos e estado acessível; seleção de conversa, não lidas e rascunhos preservados.
- Abertura com ilustração em CSS, movimento reduzido respeitado e busca funcional.
- Cabeçalho adaptado à largura da conversa; mensagens e compositor com superfícies e contraste refinados.
- Notas internas, mídia, mensagens apagadas e eventos de ferramentas mantêm sua apresentação específica.

## Verificações

`npx tsx scripts/verify-inbox-premium.ts` passou em 10 combinações: 1440, 1024, 768, 390 e 320 px, nos dois temas. O teste renderiza ChatList, ChatPanel, ContactPanel, MessageItem e o store reais, com respostas controladas nas fronteiras de sessão e rede. Verifica filas pelo teclado, filtro de não lidas, busca, abertura de conversa, mensagens visíveis, rascunho persistido no store, alternância da nota interna, contexto, retorno no celular e ausência de rolagem da página além da viewport. Capturas ao lado deste arquivo.

`npx vitest run tests/inbox-pagination.spec.ts tests/inbox-ownership.spec.ts tests/chat-list-visibility.spec.ts`: 24 testes aprovados.

`npm run typecheck`: aprovado. ESLint dos arquivos novos: sem erros ou avisos. Os componentes antigos já possuem avisos de lint, sem erros impeditivos.

## Limite da evidência

As imagens usam contatos e mensagens de teste. A montagem do teste usa uma área de conteúdo sem o menu global, e exibe o contexto lado a lado para inspecionar seu componente. O aplicativo mantém seu menu global e o painel de contexto existente. Os testes não enviam mensagens nem validam entrega, banco de dados, autenticação ou integrações reais.

A navegação direta a `http://localhost:9002/inbox` em um navegador novo terminou em `/login`. O navegador conectado não respondeu. Portanto, a sessão autenticada do aplicativo ainda não foi validada visualmente. `runtime-1440.png` registra a tela de login encontrada, não o Inbox.
