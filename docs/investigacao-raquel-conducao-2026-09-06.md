# Investigação de condução — Raquel / Velpro

Data: 06/09/2026, atendimento entre 21:54 e 21:57 (America/Sao_Paulo).
Contato investigado: final 5930. Chat: `31bad27e-4a18-4ed1-8dbc-2971bb35e6af`.
Consultas PostgreSQL com `default_transaction_read_only=on`. Nenhuma mensagem enviada, configuração alterada ou implantação executada.

## Resultado confirmado

A condução falhou na ligação entre interpretação, resposta textual e estado persistido. O histórico existe e foi usado para mencionar o plano 1000 MEGA, mas plano e nome não foram registrados como dados da contratação.

Publicação: versão 21, release `056a4d09-bbed-4615-85e2-754c7e27d6e4`, modo adaptive. Modelo no snapshot: `deepseek/deepseek-v4-flash`. Não foi inspecionado o payload bruto enviado ao provedor nem identificado o artefato do worker em produção; referências de código abaixo são do checkout local e corroboram a sequência observada, sem provar identidade binária com produção.

## Evidência correlacionada

- 21:55:35: procedimento Conhecer planos e preços registrado como concluído após apresentação do catálogo. A configuração pergunta: “Essas informações ajudaram? Se quiser contratar ou consultar cobertura, pode me dizer agora.”
- 21:56:35: cliente: “Acho que fico com o de 1000 que eu trabalho home office.”
- 21:56:38: sessão `bccc742d-f6ac-489b-bf8d-54821622ae9f` registra `turn_interpreted=confirm`, status `resolved`.
- 21:56:40: resposta enviada e marcada READ: “Perfeito! Quando precisar, estou por aqui. Obrigado por falar com a Velpro”. A sessão do agente foi resolvida; isso não equivale ao encerramento do chat, que permanece em atendimentos.
- 21:57:03: cliente: “Então, não vamos fechar?”
- 21:57:07–10: nova sessão `bb5baf14-21f8-4db7-980f-b06684276d0f`, classificação question, seleção Iniciar contratação, evento adaptive_answered.
- 21:57:13: resposta enviada e READ menciona contratação do 1000 MEGA e pergunta o nome completo.
- 21:57:22: cliente fornece o nome completo.
- 21:57:25: runtime registra conclusão de contract_intro e aguarda contract_plan.
- 21:57:28: resposta enviada e READ pergunta novamente o plano e apresenta as quatro opções.
- Inspeção do estado cifrado, restrita ao chat/workspace: phase=resolve; stepIndex=1; pendingField=selected_plan; values sem chaves; sessionFacts sem chaves. O nome informado não foi capturado e a escolha anterior não foi convertida em selected_plan.
- Não há registros em agent_decision_ledger para esse chat. A atribuição acima usa mensagens, eventos de sessões e estado salvo.

## Mecanismos encontrados no código local

1. `src/services/agent-studio/turn-interpreter.ts`: phase=conclude oferece confirm/reject e remove answer/continue. Isso restringe a representação de uma escolha ou continuação nessa fase, embora change/question continuem disponíveis. O evento real confirma a classificação errada como confirm.
2. `src/services/agent-studio/engine.ts:327`: confirm converte a mensagem de trabalho para “sim”. Em `:1008`, affirmative na fase conclude resolve a sessão e emite a despedida. Uma aceitação de produto acabou consumida como aceitação de encerramento.
3. `src/services/agent-studio/engine.ts:650`: caminho adaptive_answered entrega resposta de conhecimento e retorna aguardando entrada; não estabelece um pendingField correspondente a uma pergunta eventualmente gerada no texto. A sequência real mostra exatamente resposta pedindo nome seguida de execução da introdução e pergunta do plano.
4. `src/services/agent-studio/runtime.ts:57`: sessão concluída normalmente origina nova sessão. Histórico textual permanece disponível, mas isso não significa que escolhas estejam presentes em values/sessionFacts.
5. `src/services/agent-studio/collection-planner.ts`: a janela adaptativa só atua sobre campos contíguos elegíveis de coleta; não começa em uma introdução do tipo message e exclui single_select. Portanto não resolve por si só a divergência observada antes de contract_plan.

## Correção necessária

- Interpretar aceitação de oferta, continuidade e novo objetivo antes de considerar resolução. Não consumir a escolha do produto como confirmação da pergunta de encerramento.
- Fazer toda pergunta operacional corresponder a uma pendência persistida. O texto da resposta deve refletir a decisão estruturada de próxima ação/coleta.
- Extrair e validar fatos já fornecidos no histórico do mesmo atendimento ao entrar em um procedimento; preservar a escolha e o nome sem inferir dados ausentes ou autorizações.
- Separar conclusão de um procedimento informativo da conclusão do objetivo do cliente; evitar que uma resposta contextual preserve uma confirmação de encerramento obsoleta.
- Validar a sequência real completa: catálogo → dúvida 500 → comparação 1000 → escolha para home office → contratação → nome → próxima informação pendente. Asserções devem cobrir resposta, estado salvo/recarregado e ausência de despedida/repetição.

A investigação comprova a falha em produção. Não foi aplicada correção nem realizado replay ou teste com envio ao cliente. Trocar o modelo pode alterar classificações, mas não substitui corrigir o vínculo entre decisão, coleta e estado.
