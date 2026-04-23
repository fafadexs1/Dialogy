# Roteiro: Permissao `whatsapp_business_management`

> **Objetivo da permissao:** demonstrar que a Dialogy usa `whatsapp_business_management` para **conectar e gerenciar ativos do WhatsApp Business** de uma empresa, como conta comercial, numero e templates.

> **O que a Meta quer ver:** um fluxo de **gestao de ativos** do WhatsApp Business, nao apenas envio de mensagem. O foco aqui e mostrar que o app ajuda a empresa a ligar sua conta do WhatsApp Business a Dialogy e a gerenciar recursos operacionais necessarios para o canal.

---

## 1. Descricao do negocio

### Frase curta para o formulario
`Dialogy is an omnichannel CRM and customer communication platform that helps businesses connect and manage WhatsApp, Instagram, and Facebook channels in one operational workspace.`

---

## 2. Texto pronto para colar no formulario da Meta

### Como esse app usara o `whatsapp_business_management`?
`Our app uses whatsapp_business_management so a business can connect and manage its WhatsApp Business Account assets inside Dialogy, including linking the account to the correct workspace and managing message templates used for compliant business messaging.`

### Descreva como seu aplicativo usa esta permissao ou recurso
`Dialogy uses whatsapp_business_management to support business onboarding and asset management for WhatsApp Business Platform. This includes connecting a business's WhatsApp assets to the correct workspace, identifying the WhatsApp Business Account and phone number used by the business, and managing message templates that are required for compliant outbound business messaging. This permission is not used for unrelated personal messaging; it is used strictly for business asset management on behalf of the business that connected the account.`

### Texto de conformidade
`We confirm that our use of whatsapp_business_management complies with Meta's permitted use requirements. We use it only to manage WhatsApp Business assets belonging to the business that authorized our app, including account linking and template management needed for business operations.`

---

## 3. Melhor estrutura de video

Para `whatsapp_business_management`, o video ideal tem duas partes:

1. **Conexao da conta WhatsApp Business** com a Dialogy.
2. **Gerenciamento de template** dentro da Dialogy.

Isso mostra claramente que a permissao e usada para gestao de ativos comerciais do WhatsApp.

---

## 4. Preparacao do video

Voce vai precisar de:

1. Uma conta comercial com WhatsApp Business Platform.
2. A Dialogy aberta na pagina de Integracoes.
3. Uma instancia oficial do WhatsApp pronta para ser conectada, ou ja conectada se o Embedded Signup ainda nao estiver liberado para o seu app.
4. Um nome de template simples para criar durante a demonstracao.

### Importante

Se o **Embedded Signup** ainda estiver bloqueado para o seu app, grave o fluxo usando a **conexao manual** de uma conta ja existente e depois mostre o **gerenciamento de templates**. O ponto principal da revisao e provar o uso de gestao de ativos do WhatsApp Business, nao necessariamente um fluxo especifico de onboarding.

---

## 5. Roteiro do screencast

## Opcao A: Video ideal com conexao e template

### Cena 1: Mostrar o contexto

1. Comece em Integracoes > Evolution API na Dialogy.
2. Clique em `Criar Instancia`.
3. Mostre a opcao `WhatsApp Cloud API (Oficial)`.

### Narracao sugerida
`This is Dialogy, our business communication platform. Businesses use it to connect and manage official WhatsApp Business assets inside a shared operational workspace.`

---

### Cena 2: Iniciar a conexao do WhatsApp Business

1. Clique em `Conectar com Facebook`.
2. Se o popup da Meta abrir normalmente, siga o fluxo de autorizacao.
3. Mostre a selecao da conta comercial e do numero, se essas etapas aparecerem.
4. Finalize a conexao.

### Narracao sugerida
`The business connects its WhatsApp Business assets to Dialogy. We use whatsapp_business_management as part of this account linking and asset management workflow.`

---

### Cena 3: Mostrar a instancia conectada

1. De volta a Dialogy, mostre a instancia criada.
2. Se houver dados visiveis como nome da conta, numero ou metadata da Meta, destaque-os.

### Narracao sugerida
`After authorization, the business's WhatsApp account is linked to the correct workspace in Dialogy, allowing the company to manage its official WhatsApp channel from our platform.`

---

### Cena 4: Mostrar gerenciamento de templates

1. Role a pagina ate `Gerenciador de Templates`.
2. Selecione a instancia conectada.
3. Clique em `Criar Template`.
4. Preencha um template simples, por exemplo:
   - Nome: `order_update_demo`
   - Categoria: `UTILITY`
   - Corpo: `Hello {{1}}, your order has been updated.`
5. Envie o template.
6. Mostre o template aparecendo com status `PENDING` ou `APPROVED`.

### Narracao sugerida
`Dialogy also uses whatsapp_business_management to help businesses manage message templates associated with their WhatsApp Business Account. These templates are required for compliant outbound business messaging in specific cases defined by WhatsApp policies.`

---

### Cena 5: Fechamento

1. Mostre novamente a instancia e o template.

### Narracao sugerida
`This permission is used for WhatsApp Business asset management, including account linking and template management, always on behalf of the business that authorized our app.`

---

## Opcao B: Fallback se o Embedded Signup nao estiver disponivel

Use esta versao se o popup da Meta ainda estiver bloqueado para seu app.

### Cena 1

1. Abra Integracoes > Evolution API.
2. Clique em `Criar Instancia`.
3. Entre no modo manual de conexao oficial.
4. Mostre os campos da conta oficial do WhatsApp Business ja preenchidos com os dados da empresa.
5. Conclua a conexao.

### Narracao sugerida
`Dialogy connects a business's existing WhatsApp Business assets to the correct workspace. We use whatsapp_business_management for this business asset management workflow.`

### Cena 2

1. Mostre a instancia oficial conectada.
2. Abra `Gerenciador de Templates`.
3. Crie ou visualize um template associado a essa instancia.

### Narracao sugerida
`After the business assets are connected, Dialogy manages WhatsApp Business resources such as message templates needed for compliant business operations.`

---

## 6. Checklist antes de enviar

- O video mostra um ativo oficial do WhatsApp Business sendo conectado ou gerenciado.
- O video mostra a Dialogy vinculando esse ativo ao workspace da empresa.
- O video mostra criacao ou visualizacao de template na instancia oficial.
- A narracao deixa claro que a permissao e para **gestao de ativos comerciais**, nao para conversa pessoal.

---

## 7. Frases curtas extras para usar na narracao

- `We use this permission to manage WhatsApp Business assets on behalf of the authorized business.`
- `This includes linking the correct WhatsApp Business Account to the correct business workspace in our app.`
- `This also includes managing message templates required for compliant business messaging workflows.`

---

## 8. Dica final

Para a Meta, `whatsapp_business_management` fica muito mais forte quando o video mostra:

1. uma conta oficial sendo conectada ao produto
2. um ativo gerenciavel do WhatsApp Business sendo manipulado no app

Na Dialogy, o melhor ativo para demonstrar isso e o **template manager**, porque ele e visual, claro e diretamente ligado a operacao da conta oficial.
