# Flowbuilder: implementação e validação

## Arquitetura e compatibilidade

O editor continua usando React Flow 12. O catálogo auditado contém 60 operações estáveis em 11 categorias; tipos, portas, multiplicidade, configurações e inspetores estão relacionados em `workflow-builder-catalog-audit.json`. Gatilhos, interações, decisões, integrações, ações Dialogy, agentes e capacidades mantêm seus contratos e restrições por superfície.

Os novos componentes separam geometria, cards, ícones, conexões, seções, histórico, preferências e validação de rascunhos. A mesma geometria orienta renderização e layout. Operações desconhecidas continuam visíveis, com configuração preservada em leitura.

As seções são metadados opcionais em `metadata.flowBuilderUi`, versão 1, contendo `groups: [{ id, title, nodeIds }]`. As coordenadas continuam absolutas. Somente esse campo é excluído da assinatura funcional; os demais metadados continuam relevantes. Exportação e importação preservam as seções. Abrir o editor não reorganiza posições.

Histórico de até 100 transações cobre alterações no grafo, configuração, posições e seções. Arrastes viram uma transação; edição textual agrupa alterações até blur ou pausa de 600 ms. Exclusão e restauração usam as rotinas existentes de recursos privados. Favoritos, recentes, snapping e MiniMap são preferências locais por usuário/workspace.

## Mensagens e operações SGP

As quatro operações `dialogy.sgp_*` usam o mesmo asset de marca já utilizado pelo catálogo de integrações, com fallback textual SGP se a imagem estiver indisponível.

O bloco de identificação oferece mensagens e rótulos configuráveis em `config.messages`: `missingDocument`, `requestDocument`, `invalidDocument`, `invalidSavedDocument`, `noContracts`, `selectContract`, `invalidOption`, `enterDocumentLabel`, `otherDocumentLabel`, `backLabel`, `newCustomerLabel`, `previousLabel` e `nextLabel`. Valores ausentes ou vazios mantêm os textos anteriores. A seleção de contrato aceita `{{page}}` e `{{pages}}`; expressões de variáveis usam o renderizador existente.

IDs de opções, checagem de documentos, consulta, paginação, confirmação e salvamento do documento não mudaram. O adaptador de entrega recebe `invalidMessage` opcional, para usar o mesmo aviso personalizado na lista nativa e no fallback em texto.

## Interações

- Clique em uma linha para selecioná-la; use **Desconectar**, o botão da conexão ou **Delete**. **Ctrl+Z** restaura o caminho.
- O botão **+** abre operações compatíveis para continuar ou inserir entre etapas. Se houver mais de uma continuação possível, escolha as portas explicitamente. Cancelar não modifica o fluxo.
- **Shift+clique** adiciona/remove nodes da seleção; seleção por área e **Ctrl+A** também estão disponíveis. Alinhamento, distribuição e criação de seções usam a seleção atual.
- **V** seleciona, **H** navega, **Espaço** permite pan temporário, **Ctrl+F** localiza, **Ctrl+D** duplica, **Ctrl+S** salva, **Ctrl+Z** desfaz e **Ctrl+Shift+Z/Ctrl+Y** refaz. Atalhos do canvas respeitam campos em edição.
- JSON inválido permanece no formulário e bloqueia salvar/publicar; trocar de aba não perde o rascunho. Descartar restaura o conteúdo válido.

## Verificação

Os testes direcionados passaram: **261 testes em 34 arquivos**, cobrindo catálogo/runtime, contratos, validação, executor, anexos, layout, portabilidade, seções, histórico, inserção e projeção de execução. O build de produção e a checagem TypeScript passaram.

O lint completo de `src` terminou com **zero erros e 545 avisos**. Foram mantidas as alterações locais de outras tarefas. As referências visuais obsoletas, a exigência de ícones exclusivos e a referência a componente inexistente foram corrigidas nos testes do editor.

Na validação local com dados sintéticos foram exercitados: busca pelo nome exibido, inserção por Enter, favoritos, mensagens SGP com undo/redo, exclusão de linhas pelo botão e por Delete, inserção intermediária e restauração, seleção com Shift, seções e movimento conjunto por teclado. JSON inválido foi retido e o salvamento bloqueado, inclusive após troca de abas e descarte.

Os tokens de texto principal/secundário e botão primário têm testes de contraste AA nos dois temas. Isso não equivale a certificação completa de acessibilidade. Estados e caminhos de execução são projetados de eventos/resultados reais; ramos não visitados não são marcados como ignorados por inferência.

Os dois temas foram inspecionados em **1280×720, 1440×900 e 1920×1080**, sem transbordamento horizontal. As capturas do antes/depois e do inspetor SGP estão no diretório de evidências da tarefa. O console do build de produção permaneceu sem erros/avisos durante a inspeção.

Os exemplos de 300 e 500 operações abriram com virtualização (cinco cards renderizados na região inicial). Arraste, pan e zoom foram exercitados em produção. A medição via `requestAnimationFrame` ficou **inconclusiva**: o navegador automatizado limitou parte dos frames a intervalos de aproximadamente 1000 ms. Portanto, a meta de p95 ≤32 ms não foi confirmada. O harness mantém o botão de medição para repetir a avaliação em um navegador local com renderização contínua; não se deve interpretar a amostra limitada como uma medição de desempenho do editor.

Nas amostras sem limitação, pan teve p95 ativo de 7 ms (nove frames com mudança) e zoom de 12,37 ms (três frames com mudança), em 1440×900 e 300 operações. A quantidade pequena de frames ativos e a limitação recorrente no arraste impedem uma conclusão abrangente.

## Reproduzir a validação local

Execute `node scripts/preview-workflow-editor.mjs` e abra o endereço apresentado. Para o build otimizado, use `node scripts/preview-workflow-editor.mjs --production --port 9014`. A rota permanece no disco para não invalidar as leituras de conteúdo do Tailwind em outros servidores locais. Ela só é habilitada pelo script com `WORKFLOW_EDITOR_PREVIEW=1`; no servidor normal, retorna 404. O encerramento da prévia não cria nem apaga páginas em `src/app`.

O harness usa apenas dados sintéticos, sem callbacks de execução, publicação ou gravação remota. Oferece exemplos de 9, 300 e 500 nodes e medição de frames por quatro segundos. A medição usa `requestAnimationFrame` e distingue frames com mudanças de viewport/posição. Os números dependem do equipamento e da quantidade de nodes visíveis; não são uma garantia universal de desempenho.

Nenhum workflow publicado foi salvo, executado ou republicado durante esta alteração. Não houve migração de banco nem deploy.
