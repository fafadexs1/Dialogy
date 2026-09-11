# Modo adaptativo: decisão por capacidades — 2026-09-06

## O que evoluiu

O modo adaptativo deixou de decidir apenas a ordem de perguntas. O runtime agora oferece ao modelo um catálogo de capacidades prontas do procedimento publicado. O modelo pode escolher uma consulta antes de perguntar, propor uma escrita já configurada, responder com resultados verificados ou continuar a coleta. Depois de executar uma capacidade, o executor retorna ao ponto de trabalho e reavalia a situação.

Exemplo validado: cliente informa endereço e diz não saber o código postal; o modelo escolhe a consulta configurada, o executor recebe o código, remove o estado de desconhecido somente se o resultado passar na validação do campo, e segue sem exigir que o cliente saiba esse dado.

## Limites deliberados

Não é controle irrestrito de todas as ferramentas do workspace. São capacidades do procedimento ativo, no trecho alcançável sem atravessar mensagens, condições, validações ou ligações explícitas. Consultas prontas podem ser antecipadas. Escritas não passam à frente de operações anteriores ainda pendentes nem de dados prévios ainda necessários. Ações com dependências em payloads livres mantêm sua posição configurada.

Conexões, endpoints, argumentos e mapeamentos vêm da publicação, não do modelo. Para permitir uma consulta alternativa, configure-a no procedimento, com entradas e saídas mapeadas. Se o resultado deve suprir um dado desconhecido, a saída precisa usar a chave desse campo. O sistema não inventa uma integração que não existe.

`continue` preserva a execução autorizada já existente; esta implementação não converte automaticamente o fluxo inteiro em um grafo livre nem transforma ações obrigatórias em opcionais. Mensagens configuradas continuam literais. Correções, troca de objetivo e transferência continuam usando os controles semânticos existentes.

## Controles

- O servidor compila as capacidades com entradas disponíveis e revalida o identificador escolhido após a chamada ao modelo.
- Um plano sem próxima pergunta só pode continuar com dados ainda ausentes se os fatos validados tornarem uma consulta publicada disponível. Não é permissão para encerrar ou saltar uma escrita.
- Dados aguardando confirmação não podem alimentar uma ferramenta. Escritas passam pela confirmação do executor; uma pergunta disponibiliza somente consultas.
- O executor MCP ainda consulta o risco real da ferramenta antes da execução; a classificação publicada não substitui esse controle.
- CRM continua resolvido pela conversa e workspace atuais. O planejador não recebe poder para escolher outro contato.
- Resultado divergente não sobrescreve silenciosamente um dado fornecido pelo cliente: preserva o dado e solicita conferência.
- Respostas geradas recebem apenas saídas publicadas, não sensíveis, da operação de origem correta. Há limite de tamanho; conteúdo excessivo é omitido, não truncado para aparentar evidência completa.
- A geração de texto baseada em evidências reduz risco, mas não garante ausência absoluta de alucinação; exige avaliação continuada.
- `adaptiveOperation` guarda o ponto de retorno durante a confirmação. `adaptiveCompletedSteps` impede repetir a operação antecipada quando a sequência original a alcançar.
- Após uma confirmação já processada, a continuação pede ao modelo apenas a próxima informação útil entre opções permitidas; não reclassifica uma mensagem vazia como intenção do cliente.
- A reserva e o checkpoint anteriores ao dispatch permanecem. Timeout/resultado desconhecido não gera repetição cega nem mensagem de sucesso.
- Limite de quatro decisões de capacidade e até quatro planos de coleta por turno com essa integração, além do limite de ferramentas por sessão existente. Não são quatro chamadas totais: interpretação, respostas e roteamento também podem consumir tokens.

O desenho segue a separação entre seleção pelo modelo, execução pela aplicação e devolução dos resultados descrita na [documentação oficial de function calling](https://developers.openai.com/api/docs/guides/function-calling). Reutiliza o contrato de decisão já existente para funcionar com os provedores atuais, sem migrar modelos ou SDKs.

## Verificação

Testes dedicados cobrem antecipação de consulta, obtenção de dado desconhecido, resposta a dúvida com resultado, retomada serializada, duplicidade, confirmação de escrita, capacidade inexistente, conflito de dados, saída sensível, falta de entrada, confirmação pendente, condições e mensagens obrigatórias.

O runtime é exercitado em preview e no caminho de atendimento com adaptadores controlados. No teste conectado, o modelo e o planejamento são reais (`deepseek/deepseek-v4-flash`, publicação `056a4d09-bbed-4615-85e2-754c7e27d6e4`), mas a consulta usa a amostra explícita do preview. Isso comprova a escolha do modelo e a integração do executor, não uma chamada de localização externa nem entrega WhatsApp.

A primeira rodada conectada não coletou o endereço; o diagnóstico identificou que o coletor rejeitava ausência de próxima pergunta mesmo havendo consulta pronta. A validação agora aceita essa transição somente após verificar a disponibilidade real de leitura. Também foi separada a continuação interna após confirmação, e os cenários de texto/data passaram a fornecer suas perguntas pendentes corretas (antes recebiam erroneamente uma pergunta de múltipla escolha).

Resultados finais desta evolução:

- 293 testes controlados aprovados em 12 arquivos, com dois workers de teste para evitar saturação local.
- Builds dos workers principal, IA e Nexus aprovados.
- TypeScript (`tsc --noEmit --incremental false`) aprovado após as alterações finais.
- Bateria conectada: 27 de 28 testes aprovados. A consulta antecipada no runtime e a conversa completa de oito turnos passaram, incluindo referência ao contato, confirmação, dado desconhecido e transferência em preview.
- O caso restante, `not-consent`, retornou `question` em vez de `unclear` para uma declaração de indecisão. Não propôs opção nem autorizou ação, mas a classificação ainda oscila. A bateria conectada não está integralmente verde; não confundir aprovação dos novos caminhos com perfeição conversacional.

Não se deve interpretar uma aprovação isolada como acurácia perfeita. As chamadas de localização e transferência do preview não alteraram sistemas externos nem clientes reais.

## Implantação

Alteração local, sem deploy, publicação de agente, migração ou alteração de dados de clientes. Aplicação e workers precisam ser implantados. Releases adaptativas passam a usar esse caminho; releases guiadas mantêm o comportamento anterior. Os campos adicionais ficam no estado JSON de sessão existente.
