# Catálogo em carrossel no WhatsApp

## Na conversa

Em um atendimento WhatsApp aberto, clique no ícone de sacola ao lado do anexo.
Preencha a apresentação e adicione até 10 produtos. Cada produto precisa de
nome, descrição, foto HTTPS e ao menos um botão. É possível carregar JPG/PNG de
até 5 MB, informar o link de compra e personalizar o botão de resposta.
Confira a prévia e clique em **Enviar catálogo**.

## No fluxo automático

Adicione o bloco **Enviar catálogo no WhatsApp** em **Interação com Cliente**.
Configure os cartões e o atendente remetente do fluxo. O destinatário e a conexão
vêm da conversa em execução. Os textos, URLs e identificadores aceitam variáveis,
como `{{variables.produto.foto}}`. As fotos do fluxo devem usar URLs HTTPS
duráveis. O resultado do envio é salvo em `whatsappCatalog` por padrão.

Para continuar após uma resposta, conecte uma pergunta ou menu. Cada botão de
resposta tem um identificador configurável, que permite identificar o produto.
O catálogo sozinho não pausa o fluxo.

## Compatibilidade e confirmação

O envio usa `/message/sendCarousel/:instanceName` da Evolution API com Baileys
(conexão por QR Code). A Evolution em execução precisa conter esse endpoint.
Conexões oficiais da Meta são bloqueadas nesse compositor: o transporte atual
da integração oficial não implementa esse endpoint e exige outro caminho,
com template de carrossel aprovado.

O histórico armazena os cartões e o identificador devolvido pelo provedor.
Uploads são arquivados no storage privado para preservar a foto no histórico.
O identificador da tentativa é reservado antes do envio para impedir duplicação
em caso de repetição da mesma solicitação. Respostas sem confirmação ficam com
status `UNKNOWN`; é necessário conferir a entrega antes de iniciar outro envio.
Testes automatizados usam provedores simulados e não enviam mensagens reais.
