# Criação de workspace

Implementação local de 12/09/2026 em `/settings/workspace/new`.

## Experiência entregue

- Ocupa toda a área disponível ao lado do menu lateral principal. A rota não renderiza o cabeçalho nem o submenu de Configurações; as demais rotas de ajustes preservam o layout existente.
- Três etapas: identidade, segmento opcional e revisão editável.
- Prévia do nome e iniciais, objeto com profundidade, órbitas, transições direcionais e progresso de etapas.
- Temas claro/escuro, adaptação pela largura real do contêiner, teclado, foco e movimento reduzido.
- Tela de celebração e confetes somente depois de `createWorkspaceAction` retornar sucesso.
- Entrada no Inbox com nova navegação para carregar o workspace ativo nos provedores da aplicação.

## Contrato preservado

`createWorkspaceAction` não foi alterada. A tela envia `workspaceName` sem espaços nas extremidades e `vertical` com os valores já usados pela aplicação. Nome vazio ou só com espaços é bloqueado; nenhuma ação é disparada antes da revisão. Durante a criação, as ações ficam desabilitadas. Erros preservam os dados, e falhas de transporte pedem conferência dos workspaces antes de uma nova tentativa.

## Evidência

- `npm run typecheck`: aprovado.
- ESLint dos três arquivos TSX alterados: aprovado sem erros ou avisos.
- `git diff --check` nos arquivos alterados: aprovado.
- `npx tsx scripts/verify-workspace-launch.ts`: 27 verificações responsivas, zero erros de execução.
- Larguras 1440, 1100, 900, 768, 600, 390 e 320 px: sem overflow horizontal e sem sobreposição do indicador de etapas.
- O contêiner de criação preenche integralmente a largura e a altura do host de teste.
- Nome vazio/espaços, avanço por Enter, seleção por teclado, revisão, edição, preservação de valores, segmento opcional, envio único enquanto pendente, erros e sucesso foram exercitados por cliques reais.
- Nomes longos, temas claro/escuro, transições ativas e movimento reduzido conferidos.
- Capturas de identidade, segmento, revisão e celebração revisadas visualmente.

O roteiro renderiza os componentes reais de criação e de Configurações, com respostas controladas para autenticação e ação de servidor. Não houve escrita no banco nem criação de workspace real. A rota local respondeu HTTP 200, mas a sessão isolada não estava autenticada; portanto, não foi homologada uma criação persistida através da página autenticada. O controle do navegador da sessão do usuário expirou durante a conexão.

Artefatos: `checks.json` e capturas PNG nesta pasta. Nenhum deploy foi executado.
