# Contato, CRM e envio fiel do Studio — 05/09/2026

## Correções locais

- O worker carrega `contacts.phone` e vincula a consulta ao workspace do job e ao contato da conversa. Um job não pode carregar um chat de outro workspace.
- O Studio aceita como fallback apenas JIDs diretos de usuário WhatsApp (`s.whatsapp.net` ou `c.us`), removendo o sufixo antes de validar o telefone. Webchat, grupos e identificadores LID não viram números.
- Leitura de campos personalizados no caminho do fluxo usa o contato resolvido pelo chat e filtra também o workspace da definição do campo. O carregamento do autopilot recebeu o mesmo reforço de isolamento.
- A ação **Salvar dado no CRM** aceita campos personalizados e nome, e-mail, telefone e endereço do contato atual. O destino é resolvido no banco pelo par workspace/conversa, não por um ID sugerido pelo modelo. IDs de roteamento, propriedade e permissões não são editáveis por essa ação. Alterar o telefone de contato não troca o JID de entrega.
- O editor permite reaproveitar endereço e campos personalizados ao coletar dados. Atualizações continuam exigindo mapeamentos no procedimento publicado e confirmação; dados coletados não são gravados silenciosamente nem há SQL livre para a IA.
- Respostas do Studio enviadas pelo autopilot não passam mais pelo formatador genérico de IA nem pelo seu divisor de blocos. Texto, quebras de linha e preços configurados são preservados. A assinatura do atendente e os controles de origem, autorização, checkpoint, replay e aceitação pelo provedor continuam ativos.

## Evidência do incidente

A versão 21 da Raquel contém os quatro planos em linhas normais, sem as quebras observadas nas mensagens. O formatador posterior possuía regras específicas para velocidades e preços, alterando o texto já estruturado do Studio. A correção é no caminho de envio, sem modificar planos, valores ou publicação no banco.

## Validação

Testes com PostgreSQL isolado (PGlite) verificam leitura e escrita somente no contato atual, rejeição de definição de campo externa, relação chat/contato inconsistente, dado inválido e escrita sem confirmação. Testes de transporte verificam igualdade exata do catálogo entregue ao adaptador e preservação da confirmação de entrega. Testes de runtime cobrem referência ao telefone com apenas JID disponível, tanto em preview quanto no adaptador de atendimento.

A suíte dirigida passou com 432 testes, 29 arquivos; os 25 testes conectados ficaram desabilitados. Compilação do worker aprovada. Não houve escrita no CRM real, envio a clientes, migração, deploy ou publicação. As novas opções de CRM precisam ser configuradas no Studio e publicadas após deploy. Não foi feita homologação visual interativa da tela nem entrega ponta a ponta no WhatsApp nesta rodada.
