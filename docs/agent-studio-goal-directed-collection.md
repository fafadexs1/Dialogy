# Coleta orientada ao objetivo — 2026-09-06

Evolução posterior: [decisão por capacidades](./agent-studio-adaptive-capabilities.md) acrescenta consultas antecipadas e propostas de ações; este documento registra a etapa anterior de coleta.

## Mudança implementada

No modo adaptativo, o modelo publicado propõe um plano estruturado de coleta a partir do objetivo, histórico, dados conhecidos, campos desconhecidos e pergunta pendente. Ele pode aproveitar vários fatos da mesma mensagem, reconhecer um dado desconhecido mesmo fora da pergunta atual, escolher a próxima pergunta útil e dispensar perguntas sem dependência operacional identificada.

O executor valida o plano antes de aplicar fatos: campo autorizado, evidência literal na mensagem atual, tipo válido, ausência de valores inventados e confirmação quando configurada. Informações desconhecidas e perguntas dispensadas são estados distintos, sem fabricar valores para CRM ou ferramentas. Uma declaração do cliente prevalece sobre uma sugestão redundante de dispensa.

Isso não é AGI nem um planejador irrestrito de ferramentas. A flexibilidade está na qualificação inicial elegível e em blocos contíguos de coleta independentes. Operações, mensagens configuradas, decisões e ligações explícitas do fluxo permanecem como barreiras de execução. Catálogos de opções mantêm o interpretador semântico e a confirmação de propostas; anexos e opções dinâmicas mantêm seus mecanismos próprios. Um bloco inicial com esses campos usa o caminho de coleta existente.

## Segurança e continuidade

- O modelo não fornece identificadores de contato, código executável ou argumentos arbitrários de ferramentas.
- Referências ao telefone/e-mail usam apenas o contato recebido pelo runtime; dispensa de outra pergunta não suprime essa interpretação.
- Confirmação de campo ou proposta não autoriza uma ação posterior nem é tratada como nova resposta de coleta.
- Confirmar um campo perguntado fora de ordem retorna aos dados ainda ausentes; não salta etapas por posição do array.
- Fatos confirmados não sensíveis coletados fora de ordem sobrevivem à suspensão e retomada pré-operação, respeitando a versão e o prazo existentes.
- Respostas configuradas não são reescritas pelo planejador.
- Plano inválido ou provedor indisponível preserva o pedido e pede esclarecimento, sem executar efeitos a partir de uma suposição.
- No máximo duas chamadas de planejamento por avanço do executor. Outros classificadores/roteamento podem gerar chamadas adicionais; não é uma garantia de duas chamadas totais por mensagem.

## Integração

`runtime.ts` injeta o mesmo planejador no Studio e no atendimento, somente para releases adaptativas e com o modelo publicado fixado. `procedure-runtime.ts` transporta `collectionPlan`; OpenAI-compatible e LM Studio têm contrato próprio para essa saída, sem substituir o contrato anterior de decisões/respostas.

O contrato JSON segue campos obrigatórios, nulabilidade explícita e objetos fechados. Referência técnica: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). O teste de provedor real desta alteração utiliza DeepSeek; não comprova execução real em OpenAI, Gemini ou LM Studio.

## Validação e limites

Testes controlados cobrem múltiplos fatos, desconhecidos, reordenação, recarga de estado, dispensa, confirmação fora de ordem, retomada, referência ao contato, propostas de escolha, escopo, planos inválidos, duplicidade e paridade do runtime entre preview e atendimento.

A avaliação conectada usa mensagens sintéticas e o modelo publicado `deepseek/deepseek-v4-flash`, release `056a4d09-bbed-4615-85e2-754c7e27d6e4`. Não envia mensagens a clientes nem executa operações comerciais. A gravação de consumo é substituída no teste; chamadas ao provedor são reais e podem consumir créditos. Foram também feitas consultas de leitura para identificar a publicação e testar o carregamento limitado de histórico, sem expor seu conteúdo.

As rodadas iniciais revelaram falhas reais: contrato descartando o novo plano, sobreposição de desconhecido/dispensa, confirmação de proposta classificada como resposta genérica e dispensa ocultando referência ao contato. Foram corrigidas e ganharam cobertura. O teste conversacional agora aceita ordens diferentes de perguntas independentes, mantendo as exigências de confirmação, dados corretos e ausência de efeitos.

Resultados da rodada final:

- 275 testes controlados aprovados em 11 arquivos (runtime, planejamento, interpretação, engine, workflow, retomada, coleta, CRM e adaptadores).
- 27 testes conectados aprovados em 48,84 segundos, incluindo 15 casos de interpretação em múltiplos setores, dois de coleta de vários fatos e uma conversa completa de oito turnos no runtime compartilhado. A transferência final foi em preview, sem atribuição real.
- Builds dos workers principal, IA e Nexus aprovados.
- TypeScript (`tsc --noEmit --incremental false`) aprovado após as alterações finais.

A conversa completa aceitou a escolha por benefício, confirmou a proposta, resolveu a referência ao telefone do contato sintético, confirmou o número, registrou o código postal desconhecido sem repetir a pergunta e reconheceu o pedido de transferência na conclusão. Rodadas anteriores oscilaram; a aprovação final não é uma medida estatística de acurácia. Uma bateria sintética aprovada não garante desempenho perfeito em qualquer conversa, nem substitui observação do caminho WhatsApp, filas e persistência após deploy.

## Publicação

Código local: não foi feito deploy, publicação de release ou alteração de configuração de workspace nesta tarefa. Depois de implantar aplicação e workers, releases já adaptativas usam o novo caminho. Releases guiadas continuam guiadas; para migrá-las, selecionar Adaptativo no Studio e publicar. Nenhuma migração de banco é necessária para o estado JSON adicional.
