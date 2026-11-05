# Gatilhos por opção do CRM

No Nexus, “Novo” → “Gatilhos do CRM” permite escolher um campo de seleção da workspace e uma opção exata. O editor convencional abre com esse ponto de entrada; conecte as ações desejadas e publique. O bloco inicial permite alterar campo e opção.

Ao salvar o contato, o CRM envia os valores que mudaram depois de confirmar a transação. “Não assinou” → “Assinou” executa o gatilho de “Assinou”. Salvar novamente sem alteração não o executa. Criar um contato já com a opção também o executa. A escolha do campo, por si só, não define se alguém é lead ou cliente: isso depende do significado do campo e das ações configuradas.

A implementação usa `trigger.internal_event` com `crmOption`, os eventos `contact.created`/`contact.updated`, a fila e o histórico existentes do Nexus. Somente versões publicadas da mesma workspace são candidatas. Criação e publicação validam a existência do campo de seleção e da opção naquela workspace. A ação de atualizar CRM aceita o contato do evento sem exigir chat e confirma a propriedade do contato no banco.

O template inicial termina sem alterar dados: é necessário configurar as ações. Envio ou transferência que dependam de atendimento continuam exigindo contexto de conversa. Os testes automatizados usam o executor real com persistência em memória e SQL real em PostgreSQL isolado via PGlite. Não equivalem a uma execução publicada em produção nem a uma revisão visual autenticada.

## Ação explícita do Google Ads

Adicione “Enviar lead para o Google Ads” na categoria Integrações do Nexus. Selecione a conta conectada à workspace e uma das conversões configuradas na integração. Conecte a saída de sucesso e o tratamento de erro, depois publique o fluxo.

Exemplo: opção “Assinou” salva no CRM → Enviar lead para o Google Ads → Finalizar. O campo sozinho não envia o lead. O disparo automático de lead qualificado que existia no salvamento do CRM foi removido. A fila já existente continua processando seus registros; esta alteração não cancela envios anteriores nem altera as rotinas independentes de venda e atribuição do WhatsApp.

A ação usa o contato do evento, ou o contato da conversa quando houver atendimento. O servidor valida a propriedade do contato, a integração ativa, a conta e a conversão na publicação e na execução. O formulário recebe somente os destinos configurados, sem credenciais. Se o destino mudar entre a validação e o INSERT, a condição no SQL impede enviar para uma conta diferente.

O sucesso do bloco indica enfileiramento (`queued`), não entrega ao Google (`delivered: false`). Uma conversão já enfileirada retorna `already_queued`. A combinação workspace, evento e contato evita envio duplicado. Contatos sem atribuição de anúncio elegível seguem para erro. O histórico do fluxo e a fila `conversion_exports` permitem acompanhar cada etapa.

A entrega reaproveita o worker existente da integração, que usa a [Google Data Manager API](https://developers.google.com/data-manager/api/devguides/events). Nenhuma nova conexão PostgreSQL externa, role ou credencial de importação foi criada: o pedido é atendido pelo bloco Google Ads.

Validação local: testes executam o fluxo com o executor real e persistência de execução em memória, e gravam a fila em PostgreSQL isolado via PGlite. Não foi enviado um lead real ao Google nem realizada uma revisão visual autenticada.
