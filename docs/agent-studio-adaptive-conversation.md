# Conversa adaptativa no Agent Studio

Implementação local em 05/09/2026. Sem deploy, publicação de agente, migração ou alteração de atendimento real.

## O que mudou

O modo adaptativo interpreta o ato comunicativo antes de coletar um campo ou executar uma etapa. O modelo recebe o objetivo ativo, a pergunta pendente, as opções oferecidas, a última resposta e, no runtime compartilhado, o histórico delimitado da própria conversa. Ele escolhe somente entre decisões permitidas para o estado atual.

- Dúvida: consulta fontes autorizadas sem consumir a tentativa de preenchimento.
- Informação desconhecida: registra o campo como não informado, preserva o pedido e segue para a próxima pergunta no mesmo turno, mesmo se o campo for obrigatório. Não consome tentativa nem transfere apenas por desconhecer um dado.
- Referência ao próprio contato: o servidor lê e valida somente telefone ou e-mail compatível. Isso não comprova identidade nem concede autorização.
- Confirmação: refere-se exclusivamente à pergunta pendente; não confirma uma operação posterior no mesmo turno. Expiração e validação de dados continuam obrigatórias.
- Correção: invalida o dado e os fatos afetados antes de solicitar novamente a informação. Não repete operações já executadas.
- Cancelamento e mudança de objetivo: usam os controles de interrupção existentes; desconhecer um dado não significa cancelar.
- Pedido ou aceitação de transferência: passa pelo executor, checkpoint e proteção contra duplicação. Falha de transferência não é anunciada como sucesso.
- Interpretação indisponível: preserva o estado e pede nova tentativa, sem substituir a decisão por um classificador legado.

No modo adaptativo, palavras-chave legadas não sobrepõem a decisão semântica de confirmação, cancelamento ou transferência. Validação de formatos, política de dados, permissões, dependências operacionais e idempotência continuam no código.

## Configuração no Studio

Em **Escopo e limites → Como conduzir a conversa**, selecione **Adaptativo · interpretar intenção e manter o objetivo**. A resposta de desconhecimento avança a coleta automaticamente; as antigas opções `onUnavailable`/`unavailableMessage` são mantidas apenas para compatibilidade de leitura e não bloqueiam mais essa progressão.

O estado persistido guarda `unavailableFields` por etapa, separado de valores válidos. A frase de desconhecimento nunca preenche o campo seguinte. O cliente pode oferecer o dado depois pelo caminho de correção. Uma integração que depende explicitamente de um dado não informado não é enviada com valor inventado; a equipe recebe o contexto para obter uma alternativa sem repetir a cobrança. Campos desconhecidos sem dependência operacional não impedem o avanço.

Teste no rascunho antes de publicar. Documentos sem `resolveStage.conversationMode` continuam no modo guiado. Esta implementação não modifica snapshots já publicados nem ativa silenciosamente o novo modo em agentes existentes. Após deploy, a ativação requer uma nova publicação pelo fluxo normal do Studio.

## Arquitetura e limites

`turn-interpreter.ts` interpreta significado; `engine.ts` valida e executa; `runtime.ts` conecta ambos ao modelo publicado e aos adaptadores. Preview e atendimento publicado usam esse mesmo caminho quando o snapshot seleciona o modo adaptativo.

É uma evolução do motor de procedimentos, não uma AGI nem um planejador totalmente livre. A sequência operacional continua definida no Studio; a mudança permite pausas, correções e mudanças de intenção, mas não inventa ações, não reordena livremente integrações e não infere valores arbitrários para todos os campos. Referências a opções passam também pelo interpretador de coleta e pela confirmação da proposta.

Há normalmente uma chamada adicional de interpretação por turno ativo. Uma escolha contextual ou uma consulta de conhecimento pode exigir outra chamada. As rotas legadas de classificação duplicada são desativadas onde a interpretação do turno já decidiu o significado. Os limites de histórico e catálogo continuam por tamanho; isto não é um orçamento exato de tokens.

O modelo continua probabilístico. Condições, ambiguidades e qualidade de instrução exigem avaliações; passar um corpus não prova ausência de erros em todos os nichos. A política global de resposta agora oferece ajuda humana quando necessário, sem instruir o gerador a prometer uma transferência que o sistema ainda não executou.

## Evidências e reprodução

Testes controlados cobrem referência de contato, confirmação contextual, isolamento da autorização entre etapas, expiração, dado desconhecido, correção, cancelamento, indisponibilidade, transferência, replay e equivalência entre preview e adaptador de atendimento. Não equivalem a uma entrega no WhatsApp real.

```powershell
npx vitest run tests/agent-studio tests/procedure-runtime.spec.ts tests/conversation-memory-isolation.spec.ts tests/rag-memory-policy.spec.ts tests/rag-hybrid-retrieval-scope.spec.ts
npx tsc --noEmit --incremental false
npm run worker:ai:build
node scripts/evaluate-studio-model.cjs --agent UUID --workspace UUID
```

A avaliação opcional usa o modelo efetivamente publicado, mantendo as conversas sintéticas e os efeitos externos desativados. Credenciais e configuração são consultadas; o gravador de uso é substituído para não escrever no banco. Há também uma consulta delimitada de histórico real, sem imprimir seu conteúdo. O estado `transferred` em preview é simulado e não representa transferência real de cliente.

As primeiras rodadas desta implementação detectaram erros de referência de contato, consentimento condicional, incerteza sobre um dado, confirmação curta e escolha por benefício. Foram corrigidos o contexto de catálogo, as instruções semânticas e as decisões disponíveis durante uma confirmação. Essas falhas anteriores não devem ser omitidas ao avaliar robustez.

Resultados da rodada original, anteriores à mudança de avanço automático por dado desconhecido:

- Suíte controlada: 455 testes aprovados em 29 arquivos. Os 25 testes conectados ficam desabilitados nessa execução padrão e foram executados separadamente.
- Avaliação conectada: 25/25 aprovados, incluindo interpretação com `deepseek/deepseek-v4-flash`, uma consulta de histórico e o fluxo compartilhado de oito mensagens em preview. Modelo lido da release `26fde51c-827e-4e76-b7e2-a85ee791b084`; não foi substituído para obter aprovação.
- TypeScript sem erros (`--noEmit --incremental false`) e compilação do worker de IA aprovados.
- Sem validação de entrega real, sem teste visual interativo da nova configuração e sem publicação. Aprovação nessa amostra não é uma taxa garantida para conversas futuras.

Antes da liberação ampla: homologar o rascunho, publicar inicialmente para um grupo controlado e correlacionar mensagens, sessões, eventos de transferência e confirmação de entrega. Eventos úteis: `turn_interpreted`, `turn_paused`, `turn_unavailable`, `intent_cancelled`, além dos eventos de coleta, operação e transferência existentes.

## Validação do avanço por dado desconhecido

Após a alteração solicitada para tratar desconhecimento como resposta: 460 testes controlados aprovados em 29 arquivos, TypeScript sem erros e compilação do worker de IA aprovada. Cobertura inclui campos obrigatórios, desconhecimento consecutivo, campos iniciais, recarga de sessão, dado oferecido posteriormente e bloqueio de integração dependente sem repetir a pergunta. Os 25 testes conectados não foram reexecutados nesta alteração; não há nova evidência de modelo real nem entrega em produção. Nenhum deploy ou publicação foi realizado.
