# Correção de continuidade conversacional — 06/09/2026

## Resultado

Implementação local concluída para manter a escolha do cliente, ligar a pergunta ao estado da coleta e retomar contribuições que já constam no histórico do mesmo atendimento.

- Escolha explícita de opção tem precedência sobre a justificativa de uso ao selecionar o próximo procedimento. Escolher 1000 MEGA para home office não reinicia recomendação.
- Confirmação de resolução não consome uma nova solicitação. Uma dúvida posterior invalida a confirmação de resolução antiga.
- A entrada em um procedimento executa suas etapas registradas, sem uma resposta livre antecipar uma coleta não registrada.
- Recuperação de fatos usa mensagens do cliente com papéis provenientes das linhas do banco, sem interpretar rótulos de papel escritos no texto. Mantém o escopo de workspace, chat e mensagem de origem.
- Opções explícitas e inequívocas são recuperadas deterministicamente mesmo se o modelo omitir a observação. Outros fatos precisam de evidência literal e validação do campo.
- Fatos sensíveis e consentimentos não são recuperados automaticamente. Não há memória compartilhada entre clientes nem autorização de ações a partir de histórico.
- Informar outro campo durante uma confirmação guarda a contribuição e mantém a confirmação pendente, sem apagar o dado que estava sendo confirmado.
- Uma retomada sem fatos recuperáveis mantém a pergunta sem consumir tentativa inválida.

## Validação final

- 471 testes passaram; nenhuma falha na suíte Agent Studio e isolamento de memória. Os testes que exigem ambiente externo e não foram selecionados permanecem explicitamente ignorados no relatório.
- Dois testes com `deepseek/deepseek-v4-flash`, modelo efetivamente publicado na versão 21 da Raquel, release `056a4d09-bbed-4615-85e2-754c7e27d6e4`.
- Caso novo: catálogo → dúvida sobre 500 → comparação com 1000 → escolha de 1000 para home office → nome. O runtime salvou o plano, pediu o nome e avançou para confirmação do telefone, preservando ambos após serialização e recarga.
- Caso antigo: estado já aguardando plano, apesar de plano e nome estarem no histórico. “Vamos continuar” recuperou ambos e perguntou o CEP.
- `node scripts/build-worker-ai.mjs`: passou.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: passou.
- `git diff --check` nos arquivos acompanhados desta correção: passou.

Os testes com modelo real usaram o runtime compartilhado, a publicação e as fontes reais, com conversa sintética e checkpoint local serializado. Escritas de telemetria de uso/recuperação foram substituídas no teste. Não houve envio de WhatsApp, execução de ações comerciais, alteração do atendimento investigado ou teste de entrega externa. Não equivalem a validação ponta a ponta em produção.

## Evidências

- `agent-studio-continuity-tests-2026-09-06.json`: resultados da suíte.
- `agent-studio-continuity-model-results-2026-09-06.json`: resultados com modelo real.
- `agent-studio-continuity-2026-09-06-fresh.json`: decisões, respostas e estado final do caso novo.
- `agent-studio-continuity-2026-09-06-legacy.json`: recuperação do estado antigo.
- `investigacao-raquel-conducao-2026-09-06.md`: incidente original correlacionado com os registros de produção.

## Entrega e limites

A correção está no checkout local e no worker compilado. Não houve deploy, publicação de agente ou alteração de banco. A ativação no WhatsApp depende da implantação do runtime corrigido e da validação de um atendimento real após essa implantação. O checkout já continha alterações de outros trabalhos, que foram preservadas; não foi criado commit agregando essas alterações.

A recuperação é delimitada ao histórico disponível do mesmo atendimento (até 80 mensagens de banco; até 40 contribuições e 24 mil caracteres por chamada de recuperação). Informação ausente, ambígua ou fora desses limites pode continuar exigindo esclarecimento. Isso corrige os mecanismos reproduzidos, sem prometer memória ilimitada ou equivalência integral com outro produto de IA.
