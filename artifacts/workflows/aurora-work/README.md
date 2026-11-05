# Aurora Work · vendedora conversacional Nina

O usuário esclareceu que deseja uma IA que converse, e não uma jornada conduzida por menus. A versão atual transfere a conversa para a Nina, um agente adaptativo publicado de forma privada no IA Studio.

- Fluxo: https://dialogy.klyraai.com.br/nexus/flows/79962002-b803-4bac-b549-98fb5607f19f
- IA Studio: https://dialogy.klyraai.com.br/autopilot/bc053c26-6c89-4415-96bf-16592252afca
- Publicação privada da Nina: `7d3ea960-4f30-41ec-8e03-062b5d0fe018`, versão 1, DeepSeek.
- O workflow Nexus permanece em **rascunho**, sem publicação e sem tráfego real.

## Como funciona

O Nexus tem uma entrada e o agente do Studio. A Nina mantém a conversa em texto livre: aproveita informações já dadas, pergunta apenas o que falta, responde a dúvidas, aceita mudanças de ideia e respeita recusas. Não há menus obrigatórios nem uma coleta inicial de nome/orçamento em sequência.

O Studio contém catálogo, políticas e doze cotações calculadas em centavos, cobrindo cadeira/mesa/kit, com/sem apoio e PIX/cartão. Consulta de preço é separada de confirmação: consultar ou comparar não registra uma compra. Uma décima terceira habilidade solicita autorização apenas para uma simulação. Nenhum procedimento chama APIs, cobra, altera CRM, reserva estoque ou transfere alguém.

Produtos: Cadeira Fit R$ 699,00; Mesa Lift R$ 1.299,00; Kit Pro R$ 1.799,00; apoio opcional R$ 99,00. PIX tem 5% sobre produtos; frete R$ 49,00, grátis para subtotal a partir de R$ 1.000,00 antes do desconto; cartão em três parcelas exatas. Todas as condições são fictícias.

## Testar agora

No IA Studio, escolha **Simular ações** e escreva livremente, por exemplo:

> Já tenho uma mesa boa e quero só a cadeira, sem apoio para os pés. Tenho até dois mil reais. Quanto fica no PIX e no cartão, contando o frete? Só quero comparar, sem confirmar compra.

O DeepSeek real respondeu com os totais corretos de R$ 713,05 no PIX e R$ 748,00 no cartão. Em outra mensagem, recusou um desconto não autorizado para R$ 600,00 e manteve a conversa sem confirmar compra. Também respeitou a recusa do kit e reutilizou o contexto.

## Correção do chat de teste do Nexus

A aplicação atualmente disponibilizada não fornece o executor do Studio ao sandbox do Nexus. O botão abre o chat, mas esse tipo de bloco retorna que requer um atendimento conectado ao Studio.

A correção preparada em `workflow-sandbox.ts` usa o modelo real e a versão fixada do Studio, mantém o estado criptografado e isolado por workspace/execução/bloco, verifica a propriedade de agentes privados e intercepta todos os efeitos de negócio. Os handlers de início e retomada do teste usam o mesmo adaptador. Resolver uma dúvida não encerra a conversa.

Essa correção **ainda precisa ser disponibilizada na aplicação web**. O plano anterior excluía deploy; a autorização foi solicitada. Nenhuma migração ou publicação do workflow é necessária para a correção do sandbox.

## Evidências

- `conversa-ia-real.md` e `.json`: teste do motor Nexus com a publicação real do Studio e o DeepSeek real; persistência em memória e ações de negócio interceptadas. Duas mensagens livres, cinco chamadas ao modelo; sessão preservada e nenhuma confirmação de compra.
- 42 testes de regressão passaram, além de um teste integrado com o provedor real. Build de produção, typecheck e lint dos arquivos alterados passaram.
- `workflow-conversational.json`: definição atual do rascunho.
- `nina-studio-release.json`: versão privada fixada do agente.
- `workflow-guided-reference.json`, `README-guided-reference.md` e histórico do Nexus preservam a versão anterior com menus.

A chave do DeepSeek está na IA Global do Superadmin; ela não fica no JSON do fluxo ou nos arquivos exportados. Não envie chaves no chat.
