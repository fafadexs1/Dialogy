# Permissões — reformulação e validação

Data: 26/10/2026.

## Implementação

A página `/team/permissions` reutiliza a paleta, os tokens e os componentes das páginas de equipes e membros. Tem navegação por função, permissões agrupadas em áreas expansíveis, pesquisa, filtros por área e estado do acesso, comparação de funções e formulários de criação/edição. As ações de remover funções permanecem protegidas; a interface permite apenas consulta quando o servidor não concede `permissions:edit`.

Cada alteração tem atualização otimista e indicação de salvamento. Durante a requisição, o controle correspondente fica desabilitado. Em caso de falha, somente aquela permissão é revertida, preservando outras alterações. As ações de criar/editar/remover ficam indisponíveis enquanto há permissões sendo salvas.

O backend reaplicava as permissões iniciais de `Membro` em toda consulta. Agora essas permissões são adicionadas somente ao criar as funções iniciais de um workspace. A função Administrador continua recebendo o catálogo completo e suas permissões continuam protegidas. A resposta de consulta informa `canEdit` a partir da verificação real de acesso no servidor. A criação retorna o ID para selecionar imediatamente a nova função.

## Verificação automatizada

- TypeScript: `npx tsc --noEmit --pretty false` passou.
- ESLint da página, actions, helper e novos testes: passou sem avisos.
- 36 testes passaram em `permission-editor`, `role-permissions-database`, `workspace-permissions`, `team-members`, `team-calendar`, `team-calendar-query` e `team-availability`.
- Os testes de banco executam as consultas reais das actions e a verificação real de autorização em PostgreSQL embarcado (PGlite), com autenticação simulada. Cobrem inicialização, persistência de permissões removidas/concedidas após leituras, criação, edição, remoção, isolamento de workspace, acesso de consulta e proteções de funções administrativas/padrão/vinculadas.
- Os testes de estado cobrem filtragem sem acentos, alteração imutável, prevenção de duplicatas e reversão de uma alteração sem sobrescrever outra.

## Verificação no navegador

Na prévia local do componente real, com dados fictícios:

- Criação de `Relacionamento`, selecionada automaticamente com zero permissões.
- Ativação de `crm:view`, indicação de salvamento e confirmação da contagem em 1/19.
- Comparação entre funções, incluindo a permissão recém-ativada e os controles do Administrador desabilitados.
- Renomeação da função, com manutenção do acesso configurado, e remoção da função sem vínculos.
- Filtros combinados CRM + Não permitidos: exibiram somente Excluir contatos.
- Falha de salvamento simulada: mensagem de erro e reversão da permissão para o estado anterior.
- Modo de consulta: criação e edição ocultas, switches desabilitados, aviso de somente consulta.
- Administrador: aviso de proteção e controles desabilitados.
- Inspeção visual dos temas claro/escuro e da largura de 390 px; ajuste dos filtros para evitar textos cortados no celular.

A página remota fornecida permaneceu em carregamento durante a tentativa de inspeção. A verificação visual usou a prévia do componente do repositório, sem sessão autenticada real e sem alterar permissões reais. Nenhuma publicação foi realizada.

## Prévia

Execute `node --experimental-strip-types design-qa/team-preview.mjs` e abra:

- `http://127.0.0.1:9051/permissions`
- `http://127.0.0.1:9051/permissions?dark`
- `http://127.0.0.1:9051/mobile?permissions`
- `http://127.0.0.1:9051/permissions?readonly` para simular consulta.
- `http://127.0.0.1:9051/permissions?fail-save` para simular falha no salvamento.

Capturas: [claro](team-permissions-desktop.png), [escuro](team-permissions-dark.png), [celular](team-permissions-mobile.png).
