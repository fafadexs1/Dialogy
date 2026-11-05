# Leitura visual dos fluxos

O canvas apresenta cada etapa como parte de uma história: o título identifica a operação, o conteúdo configurado aparece dentro do cartão e as ramificações principais mostram seus nomes diretamente sobre as conexões. Assim, é possível acompanhar escolhas como “Planos”, “Suporte” e “Financeiro” sem selecionar cada linha. Os nomes vêm das portas reais do fluxo; não representam execuções simuladas.

Quando não há conteúdo textual para pré-visualizar, o rodapé mostra a descrição da operação no catálogo. O texto pode ser abreviado no cartão; a descrição completa aparece ao passar o ponteiro. Para mensagens e prompts, o conteúdo completo continua disponível no tooltip. Uma pendência de validação substitui o texto do rodapé pela quantidade a revisar. O indicador não garante que integrações externas funcionarão.

Os rótulos permanentes aparecem apenas em conexões principais de etapas com mais de uma saída principal. Nas demais conexões, o rótulo continua aparecendo ao selecionar ou passar o ponteiro. A execução continua usando seus estados e eventos reais; os novos rótulos não indicam que um caminho foi percorrido.

A geometria dos cartões, os contratos das portas e os dados persistidos não mudam. O fluxo pode continuar sendo editado, salvo e testado da mesma forma. A descrição do catálogo é geral: para entender parâmetros específicos, abra o inspetor da etapa. Fluxos densos podem exigir zoom ou seleção de uma rota para ler todas as conexões.

## Verificação

A prévia local com nove etapas e dados sintéticos exibiu as três rotas do menu sem interação e não apresentou erros de JavaScript durante a abertura. Os testes direcionados de contrato visual, organização automática e núcleo do editor passaram (24 testes). A prévia não executa nem publica fluxos reais.
