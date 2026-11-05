# Divergência de valores em templates de fatura — 30/10/2026

## Evidências verificadas

- Consulta ao banco real do Dialogy: mensagem `3bb6db76-b6b7-4932-aa01-af3052851ed7`, criada em 29/10/2026 às 08:45 (São Paulo), corpo com 79.99 e total/subtotal/item do pedido com 9990 e offset 100. A resposta que abriu o atendimento informado referencia essa mensagem.
- Consulta autenticada à Evolution de produção, `chat/findMessages/zap1`, por WAMID: confirmou a mensagem antiga e a nova (30/10 às 08:06), ambas com estados SENT, DELIVERED e READ. Os destinatários são diferentes.
- A Evolution guarda nesse histórico somente o marcador com o nome do template. Não preserva os componentes enviados à Meta nesse registro. Não foi possível recuperar a requisição HTTP original.
- Consulta autenticada `template/find/zap1`: o template aprovado `fatura_velpro_clientes_2026_maio` tem valor do corpo em {{4}} e botão ORDER_DETAILS; não tem preço fixo aprovado na Meta.
- Auditoria no mesmo workspace/template, intervalo UTC [2026-10-29T00:00:00Z,2026-10-30T00:00:00Z): 744 registros comparáveis; 704 com total 9990; 660 divergentes entre corpo e total. A consulta teve limite 3000 e retornou 744; não houve truncamento. Estes são registros de mensagem, não pagamentos confirmados.
- Busca nos caminhos de envio dos dois repositórios não encontrou fallback literal 9990. O exemplo de documentação contém 9990 desde o commit b91f8b6bc (26/05/2026). A cópia desse exemplo pela integração é hipótese; não foi possível provar a origem exata do campo de entrada sem a requisição/configuração da integração.

## Falhas verificadas no código e correção

Os dois sistemas normalizavam valores sem exigir consistência entre corpo e pedido. Ambos também tinham rotina que reescrevia o campo nominal do Pix e recalculava seu CRC para acompanhar o total, o que não consulta nem atualiza a cobrança bancária dinâmica.

Correção aplicada nos códigos locais dos dois projetos: bloquear divergência identificável entre valor monetário único no corpo e total, entre Pix EMV legível e total, entre itens e subtotal e entre subtotal/ajustes e total; preservar o Pix; manter conversão de decimais para centavos; exigir offset 100 quando explicitado. No Dialogy, erros na normalização entram no fluxo de validação FAILED/HTTP 422, sem chamada ao provedor. Na Evolution, erros são convertidos em BadRequest antes de sendMessageWithTyping.

O comparador genérico do corpo exige um único valor monetário explícito para evitar escolher entre preços múltiplos. O Pix é comparado quando possui campo nominal 54 legível; essa validação não consulta o valor da cobrança no banco nem atesta o conteúdo bancário de uma URL Pix.

## Verificação e publicação

- Dialogy: 29 testes de contrato/falhas de template passaram; TypeScript sem erros.
- Evolution: reprodução do incidente, conversão, preservação do input, idempotência, Pix divergente e soma dos itens passaram; TypeScript sem erros.
- Nenhuma mensagem de teste foi enviada a clientes. Nenhum registro histórico foi alterado.
- Correções ainda locais. API Evolution acessível; banco interno Evolution usa hostname Docker e não é acessível diretamente daqui. Tentativa com chave SSH disponível recusada pelo servidor; nenhum contexto Docker remoto configurado. Publicação não efetuada.

## Verificação adicional do valor final

- Replay somente leitura dos 744 registros pelas funções atuais de Dialogy e Evolution: 660 bloqueados, 84 aceitos, zero divergências entre as camadas; os aceitos também permaneceram iguais após normalização consecutiva Dialogy → Evolution.
- Ampliada a verificação para R$ 79,99, R$ 81,99 e R$ 100,00, em representações decimais, centavos inteiros e strings. O payload capturado no mock da chamada à Evolution conserva texto, total, subtotal, item e Pix.
- Removidas inferência de unidade em inteiros e substituição de valores inválidos pelo corpo. Inteiros representam centavos; strings inteiras também. Valores negativos, vazios, não numéricos, com precisão monetária excessiva ou fora dos limites seguros são rejeitados. Valores inteiros em reais devem ser convertidos para centavos na origem, conforme contrato da API.
- Dialogy: 44 testes passaram. Evolution: reprodução e verificações específicas passaram. Publicação continua pendente; não houve teste com envio a clientes nem consulta ao valor bancário da cobrança dinâmica.
