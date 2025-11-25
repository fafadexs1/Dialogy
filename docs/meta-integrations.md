# Dialogy – Integrações Meta (Instagram Direct + Messenger)

## Estrutura de banco
- `meta_channels` (id, workspace_id, type, external_page_id, ig_business_id, access_token, app_secret, verify_token, name, status, settings, timestamps)
- `meta_contacts` (id, channel_id, contact_id, external_id, username, name, profile_pic, timestamps)
- `meta_conversations` (id, channel_id, meta_contact_id, chat_id, external_thread_id, platform, last_message_at, status, timestamps)
- `webhook_logs` (id, channel_id, source, direction, event, status_code, payload, headers, response_body, created_at)
- Novas colunas em `messages`: platform, external_message_id, external_sender_id, external_channel_id, direction, media_url

## Endpoints externos (Webhooks)
- GET `/api/webhooks/meta/instagram` e `/api/webhooks/meta/messenger`  
  - valida `hub.verify_token` e retorna `hub.challenge`.
- POST `/api/webhooks/meta/instagram` e `/api/webhooks/meta/messenger`  
  - valida assinatura `X-Hub-Signature-256` (se `app_secret` informado no canal).  
  - persiste log em `webhook_logs`.  
  - normaliza evento (texto, imagem, vídeo, áudio ou arquivo), garante contato/conversa e salva na tabela `messages` com `platform` + `direction`.

## Endpoint interno de envio
- POST `/internal/channels/:channelId/messages/send`
  ```json
  {
    "externalContactId": "PSID_or_IGSID",
    "threadId": "opcional",
    "type": "text|image|video|audio|file",
    "text": "conteudo opcional",
    "mediaUrl": "https://...",
    "senderUserId": "opcional",
    "senderSystemAgentId": "opcional",
    "profile": { "name": "opcional", "username": "opcional", "avatarUrl": "opcional" }
  }
  ```
  - Escolhe serviço conforme `meta_channels.type` (Instagram ou Messenger).
  - Envia via Graph API, salva em `messages` com `direction=outgoing` e registra log em `webhook_logs`.

## Passos mínimos para habilitar um canal
1. Criar registro em `meta_channels` com: `workspace_id`, `type` (`instagram` ou `messenger`), `verify_token`, `access_token`, `app_secret`, `ig_business_id` (IG) ou `external_page_id` (Messenger).
2. Configurar Webhook no App Meta apontando para o endpoint correspondente e informar o `verify_token`.
3. Assinar o tópico `messages` e associar a Página/IG Business.
4. Testar recebendo mensagem; validar entrada em `webhook_logs` e `messages`.
5. Para envio, chamar `/internal/channels/:channelId/messages/send` com `externalContactId` do remetente.

## Serviços principais
- `meta-channel.service.ts`: resolve canal, contato e conversa, grava mensagens normalizadas, envia webhook interno (`dispatchMessageToWebhooks`).
- `instagram-webhook-service.ts` e `messenger-webhook-service.ts`: parsing/normalização.
- `instagram-messaging-service.ts` e `messenger-messaging-service.ts`: envio via Graph API + ações `typing_on/off` e `mark_seen`.
- `meta-signature.ts`: validação HMAC `X-Hub-Signature-256`.

## Integrações na UI
- Novos cards em `/integrations` para Instagram Direct e Facebook Messenger com páginas de instruções:  
  - `/integrations/meta-instagram`  
  - `/integrations/meta-messenger`
