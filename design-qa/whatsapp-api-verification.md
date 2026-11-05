Verificação do WhatsApp API — 26/10/2026

A página usa a paleta compartilhada das páginas de equipe: verde suave, fundo quente, superfícies claras e a versão correspondente no tema escuro. O painel reúne conexões e o Estúdio de mensagens.

A rota pública `/integrations/whatsapp-api` respondeu HTTP 200. A rota anterior `/integrations/evolution-api` respondeu HTTP 308 com redirecionamento para a nova URL. Navegação, catálogo e dados iniciais de integrações usam o novo endereço; o identificador interno do provedor continua compatível com os registros existentes.

O estúdio oferece criação em três passos, receitas iniciais, personalizações com exemplos, importação de textos com variáveis da Meta, fotos, botões, prévia interativa, biblioteca compartilhada por workspace e carrosséis de 2 a 10 cartões. Os cartões podem ser adicionados, duplicados, removidos e reordenados. O editor prepara imagens JPEG a partir de JPG/PNG de até 5 MB.

O envio por QR Code usa o endpoint nativo `message/sendCarousel` da Evolution. A integração oficial usa os componentes `CAROUSEL` dos templates da Meta e o upload retomável de imagens. Foi consultada uma Evolution ativa na versão 2.4.0. O código da Evolution disponível no workspace já implementa esses contratos.

A consulta de templates resolve a conexão pelo ID e pelo workspace. A paginação da Meta é percorrida sem usar URLs de paginação com tokens. A verificação na integração real retornou:

- Velpro: 29 templates, todos aprovados.
- Fabricio: 2 templates, ambos rejeitados.

A migração `20261026120000_whatsapp_message_studio` foi aplicada e registrada. As tabelas da biblioteca e das tentativas de envio têm RLS habilitado e acesso direto revogado para `anon` e `authenticated`. As operações passam pelas verificações de acesso do servidor. Alterações concorrentes usam revisão; envios de teste usam uma reserva persistida para impedir repetição da mesma tentativa.

As imagens são armazenadas de forma privada e apresentadas por uma rota que verifica o workspace antes de gerar o download temporário. Uma imagem sintética foi armazenada, lida, baixada e preparada com sucesso na API real de upload da Meta. O objeto temporário foi removido do armazenamento privado. Esse procedimento não publicou template e não enviou mensagem.

Validação concluída:

- TypeScript: `tsc --noEmit`, sem erros.
- ESLint dos arquivos novos e da rota de fotos: zero avisos, com `--max-warnings 0`.
- 93 testes passaram em 11 arquivos, incluindo os contratos anteriores de templates, webhook, carrosséis e entrega.
- Testes com PostgreSQL isolado exercitaram a migração, consultas reais, permissões, revisões, persistência, publicação, fotos de outro workspace, assinatura suspensa e tentativas repetidas ou de resultado incerto.
- Testes de interface com dados de demonstração cobriram conexão, biblioteca, edição, ordem e duplicação dos cartões, revisão e envio simulado.
- Verificação visual nos temas claro/escuro e em uma área de 390 px de largura. A prévia se adapta à altura disponível e tem acesso direto no celular. A navegação respeita a preferência de redução de movimento.

Os fluxos de publicação de templates e envio de mensagens foram exercitados com provedor simulado. Consultas de contas, armazenamento e upload de amostra também foram exercitados na integração real. A aprovação de conteúdo novo é feita pela Meta; a exibição dos carrosséis por QR Code depende do WhatsApp do destinatário.

As capturas `whatsapp-studio-light.png`, `whatsapp-studio-cards-light.png`, `whatsapp-studio-dark.png` e `whatsapp-connections-light.png` mostram a interface real com dados de demonstração. A prévia local pode ser aberta em `http://127.0.0.1:9052/whatsapp-api` enquanto o servidor de QA estiver em execução.
