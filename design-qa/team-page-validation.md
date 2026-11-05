# Equipes: visual acolhedor e histórico de feriados

Verificação em 26/10/2026.

A página `/team` recebeu uma paleta de verde e tons quentes nos temas claro e escuro, navegação por equipe, abas para pessoas, horários e roteamento, e adaptação ao espaço disponível no layout.

O histórico estava oculto por `se.date >= CURRENT_DATE` na consulta de equipes. O filtro foi removido; os registros continuam limitados à equipe e ao workspace autorizado. A interface separa próximas datas (incluindo hoje) do histórico, ordena o histórico do mais recente ao mais antigo e permite filtrar por ano. Datas são tratadas como datas de calendário, sem conversão para UTC na gravação ou na apresentação.

## Verificações

- `npx tsc --noEmit --pretty false`: passou.
- ESLint da página, helper e novos testes: passou sem avisos.
- `npx vitest run tests/command-item-state.spec.ts tests/team-members.spec.ts tests/team-calendar.spec.ts tests/team-calendar-query.spec.ts tests/team-availability.spec.ts`: 27 testes passaram.
- O teste de integração executa a consulta real de `getTeams` em PostgreSQL embarcado (PGlite), com datas relativas a `CURRENT_DATE`, e verifica retenção de histórico, isolamento entre workspaces e bloqueio por autenticação/permissão.
- Prévia do componente real no navegador: temas claro/escuro e largura de 390 px, seleção das abas, filtro do histórico por 2025 e cadastro de uma data sem expediente. Ao salvar, o diálogo fechou, a contagem foi atualizada e a aba/filtro em uso permaneceram abertos.
- `git diff --check` nos arquivos existentes alterados: passou.

## Limite da verificação visual

O `/team` no servidor Next local ficou no carregamento de autenticação. A verificação visual utilizou o mesmo componente e seus componentes de UI com dados fictícios em memória, sem acessar nem modificar dados reais. Não foi validada uma sessão autenticada real, nem houve publicação.

## Reproduzir a prévia

Execute `node --experimental-strip-types design-qa/team-preview.mjs`.

- Claro: `http://127.0.0.1:9051/`
- Escuro: `http://127.0.0.1:9051/?dark`
- Celular (iframe de 390 px): `http://127.0.0.1:9051/mobile`
- Membros: `http://127.0.0.1:9051/members` (adicione `?dark` para o tema escuro).
- Membros no celular: `http://127.0.0.1:9051/mobile?members`

Capturas: [visual claro](team-desktop.png), [histórico](team-holiday-history.png).

## Página de membros

`/team/members` usa a mesma paleta e hierarquia, com busca por nome, e-mail, função e equipe; busca sem acentos; filtros combináveis de presença e função; contagens de pessoas únicas e identificação de todas as equipes de cada pessoa. Em telas estreitas, a tabela se transforma em cartões com rótulos. Os controles para editar a função, remover o acesso e copiar o ID continuam disponíveis no menu de cada pessoa. Links levam às rotas existentes de convite, equipes e permissões.

A antiga coluna de uso monetário foi retirada da interface porque a origem fornece `Math.random()`, não consumo real. O backend de membros não foi alterado.

Verificado no navegador com dados fictícios: filtro online (3/6), busca `joao` combinada com offline (1/6), filtro de administrador (1/6) e edição de função. A edição fechou o diálogo, atualizou os dados e preservou os filtros. A adaptação para 390 px foi inspecionada visualmente. A checagem identificou e corrigiu nomes de containers CSS isolados entre módulos; ambos usam agora consultas ao container mais próximo.

## Seletor de pessoas na equipe

O seletor “Escolha alguém para somar” foi substituído por um combobox pesquisável com foto, nome e e-mail. A foto continua no campo após a seleção; quando ausente, aparecem iniciais. A lista exclui membros existentes e deduplica pessoas presentes em mais de uma equipe.

Verificado no navegador: foto carregada a partir de um asset local de exemplo, filtro `rafael@example`, seleção por Enter e inclusão na equipe. A contagem passou de 3 para 4, a nova pessoa apareceu com foto e o campo voltou ao estado inicial. Nenhum dado real foi modificado. Captura: [busca com foto](team-member-picker.png).
