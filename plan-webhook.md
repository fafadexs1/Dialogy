# Webhook Meta central com roteamento exclusivo por cluster

## Resumo

A Meta usará somente:

`https://dialogy.klyraai.com.br/api/webhooks/meta/whatsapp`

O roteamento será determinístico:

```text
Meta
  → Dialogy em dois hosts
  → valida assinatura e persiste
  → identifica phone_number_id ou WABA
  → escolhe exatamente uma rota cadastrada
  → entrega idempotente ao cluster proprietário
  → Evolution processa
  → Evolution devolve evento normalizado à Dialogy
```

Regras centrais:

- Mensagens e status são roteados por `metadata.phone_number_id`.
- Eventos de template/conta sem Phone Number ID são roteados por `entry.id`/WABA.
- Nunca enviar o mesmo evento aos dois clusters.
- Rota ausente ou ambígua vai para quarentena, sem fallback ou broadcast.
- Cluster indisponível mantém o evento retido e repete somente para o cluster original.
- A garantia será “effectively once”: retries podem ocorrer no transporte, mas recibos idempotentes impedem reprocessamento e efeitos duplicados.

## Interfaces e persistência

### Endpoints

- `GET /api/webhooks/meta/whatsapp`
  - Exige `hub.mode=subscribe`, `hub.verify_token=META_WHATSAPP_VERIFY_TOKEN` e challenge.
  - Retorna challenge em texto com `200`; token inválido retorna `403`.

- `POST /api/webhooks/meta/whatsapp`
  - Lê o corpo bruto e valida `X-Hub-Signature-256` com `META_APP_SECRET`.
  - Responde `200` somente após commit no PostgreSQL.
  - JSON inválido: `400`; assinatura inválida: `401`; banco indisponível antes do commit: `503`.
  - Rota inexistente/ambígua: persiste em quarentena e responde `200`.

- `POST /internal/webhooks/dialogy/meta` em cada Evolution:
  - Recebe um único evento atômico.
  - Exige `X-Dialogy-Key-Id`, `X-Dialogy-Timestamp`, `X-Dialogy-Delivery-Id` e HMAC.
  - Assinatura: HMAC-SHA256 de `timestamp.deliveryId.rawBody`, tolerância de cinco minutos.
  - `202` para recibo novo persistido; `200` para duplicata já aceita; `401/403` para assinatura; `409` para divergência de proprietário; `422` para payload; `503` para falha de persistência.

- `POST /api/internal/webhooks/meta/evolution-result`
  - Evolution informa `processed` ou `failed`, com a mesma autenticação HMAC.
  - Atualização idempotente pelo `deliveryId`.

### Registro de rotas

Criar tabelas server-only:

- `meta_whatsapp_waba_routes`: `waba_id` único, `cluster_id`, estado e versão.
- `meta_whatsapp_phone_routes`: `phone_number_id` único, `waba_id`, `instance_id` único, workspace e estado.

Invariantes:

- Todo Phone Number ID pertence a uma única instância Cloud.
- Todos os números de uma mesma WABA ficam no mesmo cluster, permitindo rotear eventos de template/conta sem ambiguidade.
- A rota é definida no provisionamento, não no recebimento do webhook.
- `whatsapp_clusters.is_active` continua controlando novos provisionamentos; não deve redirecionar tráfego de uma rota existente.
- Cada entrega grava `cluster_id`, `instance_id` e `route_version`. Retries nunca recalculam o proprietário.
- Migrações de cluster usam estado `migrating`: novos eventos ficam retidos, entregas antigas são drenadas, a versão muda atomicamente e os retidos são liberados para o novo proprietário.

### Inbox/outbox

Na Dialogy:

- `meta_whatsapp_receipts`: hash do corpo, payload bruto criptografado, verificação da assinatura e timestamps.
- `meta_whatsapp_deliveries`: `event_key` único, payload atômico criptografado, rota congelada, estado, lease, tentativas e erros.
- Estados: `pending`, `delivering`, `retry`, `accepted`, `processed`, `quarantined`, `dead_letter`.
- PostgreSQL será a fonte de verdade; o relay não dependerá do Redis/BullMQ.
- Dois workers SQL usarão `FOR UPDATE SKIP LOCKED`, lease de dois minutos e concorrência configurável.

Na Evolution:

- Criar `DialogyMetaReceipt` com unicidade por `deliveryId` e `eventKey`.
- Persistir antes de responder `202`.
- Worker com lease processa o recibo uma única vez e chama o callback de resultado.
- Manter paridade de schema PostgreSQL/MySQL.

Chaves de deduplicação:

- Mensagem: `appId:phone_number_id:message.id`.
- Status: `appId:phone_number_id:status.id:status.status:status.timestamp`.
- Template: `appId:waba_id:template_id:evento:hash`.
- Demais eventos: SHA-256 canônico de `appId + entry.id + field + value`.

## Implementação

### Dialogy

- Criar o ingresso em `src/app/api/webhooks/meta/whatsapp/route.ts` e serviços isolados de assinatura, atomização, resolução, inbox e relay.
- Atomizar cada `entry/change`; arrays `messages[]` e `statuses[]` geram uma entrega por item. Preservar somente o contato correspondente à mensagem.
- Eventos com Phone Number ID usam a rota do telefone; os demais usam a rota da WABA.
- Um envelope misto com números de clusters diferentes gera entregas distintas; nenhum cluster recebe dados pertencentes ao outro.
- Adicionar reconciliador SQL também ao inbox atual Evolution → Dialogy, recuperando eventos `pending/failed` que não chegaram ao BullMQ.
- Criar painel superadmin com rotas, pendências, idade da fila, quarentena, DLQ e replay auditado. Payload bruto exige acesso break-glass e nunca aparece em listagens normais.
- Substituir métricas no-op por métricas OpenTelemetry reais.

### Evolution

- Partir da versão 2.4 contendo a correção `b9c7f267`, construir uma imagem Klyra versionada e usar o mesmo digest nos dois clusters; não usar `latest`.
- Implementar o endpoint interno idempotente, autenticação HMAC, proteção contra replay e worker de receipts.
- Processar diretamente a instância indicada e conferir:
  - integração `WHATSAPP-BUSINESS`;
  - `Instance.number === phone_number_id`;
  - cluster/WABA correspondentes.
- Não reutilizar o `forEach(async)` do endpoint Meta atual. O novo fluxo recebe exatamente um átomo e aguarda corretamente cada operação.
- Emitir webhook normalizado e chatbot apenas depois de adquirir o recibo idempotente.
- Assinar também Evolution → Dialogy; o segredo presente apenas na URL deixa de ser autenticação suficiente.
- Após o cutover, fechar `/webhook/meta` público nos clusters e permitir apenas o endpoint interno assinado.

### Segurança obrigatória

- Revogar todos os grants de `anon/authenticated` em tabelas operacionais de clusters, instâncias, inbox e logs; aplicar RLS server-only/deny-by-default.
- Remover `api_key`, `webhook_key`, tokens, headers e payloads das consultas/DTOs enviados ao navegador.
- Mover credenciais de clusters e segredos HMAC para armazenamento server-only criptografado, com `key_id` atual e próximo para rotação.
- Limpar credenciais já gravadas em payloads históricos e rotacionar:
  - chaves dos clusters;
  - `webhook_key` das instâncias;
  - segredos HMAC.
- Nunca registrar conteúdo de mensagem, mídia, assinatura ou credenciais em logs comuns.
- Reter payload criptografado por 30 dias; manter metadados operacionais por 180 dias; DLQ não resolvida não é apagada automaticamente.

## Disponibilidade, retries e rollout

- Executar duas réplicas stateless da Dialogy e dois relay workers em hosts distintos, atrás do mesmo balanceador.
- Usar PostgreSQL compartilhado com backup/failover; Redis não participa do ACK crítico.
- Health check específico verifica processo, versão de migration e conexão com o PostgreSQL. Load balancer não usa sticky session.
- Retry para timeout, rede, `408`, `425`, `429` e `5xx`, com backoff exponencial e jitter, máximo de 20 tentativas em 24 horas.
- `401/403`, ownership inválido e payload incompatível vão diretamente para quarentena.
- Após esgotar retries, mover para DLQ, alertar e permitir replay manual; nunca tentar outro cluster.

Sequência de implantação:

1. Corrigir RLS/grants e preparar DTOs seguros.
2. Fazer backup e backfill dos IDs ausentes de `zap7` usando `/instance/fetchInstances`, validando-os também na Meta.
3. Validar `zap3`; exigir zero Phone Number IDs nulos/duplicados e zero WABAs divididas entre clusters.
4. Criar constraints e bloquear novos cadastros Cloud incompletos.
5. Corrigir o Embedded Signup para exigir seleção inequívoca quando uma empresa tiver várias WABAs/números.
6. Implantar a imagem Evolution customizada nos dois clusters, um por vez, mantendo o callback atual.
7. Implantar as duas réplicas da Dialogy, workers, tabelas, painel, métricas e alertas.
8. Durante 24 horas, os endpoints Meta atuais enviam uma cópia interna assinada para o modo shadow da Dialogy; shadow apenas valida a rota e não retransmite.
9. Exigir no shadow: 100% dos eventos com exatamente um proprietário e nenhuma divergência entre cluster real e rota calculada.
10. Alterar na Meta a única callback URL para a Dialogy e manter os campos assinados atuais.
11. Monitorar continuamente por duas horas e intensivamente por 48 horas.
12. Depois de 48 horas estáveis, desativar o webhook Meta público nos clusters e remover o shadow.
13. Rollback, se necessário, é restaurar temporariamente a URL anterior. A idempotência por `eventKey` impede duplicação entre eventos pendentes e retries da Meta.

## Testes e critérios de aceite

- Challenge válido/inválido e assinatura Meta correta, ausente ou adulterada.
- Payloads com várias entries, changes, mensagens, status e clusters misturados.
- Mensagem/status roteado somente pelo Phone Number ID empresarial, nunca pelo telefone do cliente.
- Eventos de template/conta roteados pela WABA.
- Zero/múltiplas rotas sempre em quarentena e nunca em broadcast.
- Reenvio idêntico da Meta produz um único efeito na Evolution e um único webhook normalizado.
- Timeout após persistência na Evolution seguido de retry não repete bot, contato ou mensagem.
- Queda do Redis não impede ACK nem entrega posterior.
- Queda de worker após claim é recuperada pelo lease.
- Cluster fora do ar retém eventos apenas para o proprietário original.
- Alteração de rota não muda o destino de entregas já persistidas.
- Duas réplicas/workers concorrendo não processam a mesma entrega.
- HMAC interno inválido, timestamp expirado e replay são recusados.
- Usuários `anon/authenticated` não conseguem ler ou modificar segredos, inboxes ou payloads de outros workspaces.
- Teste de concorrência com milhares de remetentes confirma que `remoteJid` sempre vem do `messages[].from`.
- SLO de aceite: p95 abaixo de 300 ms e p99 abaixo de 1 s.
- Com clusters saudáveis, p95 Meta → recibo Evolution abaixo de 2 s e 99,9% abaixo de 30 s.
- Cutover só é aprovado com zero fanout, zero duplicação de efeitos, zero evento perdido e zero rota ambígua no shadow.

## Premissas adotadas

- Um único app Meta atende as WABAs atuais e possui um único App Secret.
- Todos os eventos Meta serão suportados; mensagens/status usam Phone Number ID e demais eventos usam WABA.
- Não haverá failover automático entre clusters. Failover exige migração explícita da WABA/instâncias e mudança versionada da rota.
- A Dialogy será o único endpoint público da Meta; clusters Evolution serão consumidores internos.
- Os dois hosts da Dialogy compartilham PostgreSQL e configuração de segredos, mas possuem processos e rede independentes.
