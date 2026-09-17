# BSUID: Evolution e Dialogy

O suporte mantém o fluxo atual de telefones e adiciona identidades opacas para clientes da API oficial da Meta que não fornecem um número. Não reserva nomes de usuário nem libera o recurso na conta Meta.

## Comportamento

- A Evolution recebe `from_user_id`, preserva o BSUID completo e usa `recipient` ao enviar pela Meta. Telefones continuam usando `to`.
- Identidades confirmadas pela Meta ficam associadas ao histórico existente na Evolution, dentro da instância. Mudanças de BSUID usam a relação explícita informada pela Meta, sem adivinhar contatos.
- O relay do Dialogy preserva os contatos correspondentes ao BSUID, inclusive nome de usuário e ID principal.
- Para um contato sem telefone, o Dialogy guarda `bsuid:<instancia-codificada>:<BSUID>` em `phone_number_jid`. O valor de `phone` fica vazio; o prefixo interno não é enviado à Meta.
- Buscas, travas de transação e resolução de chats preservam essa identidade exata, dentro do workspace. O mesmo BSUID em outra instância não é mesclado automaticamente.
- O cliente HTTP verifica a instância antes de remover o escopo interno e enviar à Evolution. Não aplica memória de nono dígito nem tentativas com telefone alternativo a BSUIDs.
- Texto, listas, botões, templates e o transporte compartilhado de mídia preservam o destino. `whatsappUserId`, `whatsappParentUserId` e `whatsappUsername` são metadados adicionais da mensagem recebida.

## Migrações e publicação

1. Preparar uma janela de transição que permita drenar ou pausar os workers Meta. Não misturar workers antigos e novos processando a mesma fila: as chaves de ordenação passam a reconhecer BSUIDs.
2. No banco da Evolution, aplicar a migração `20260913010000_add_meta_business_identity` correspondente a PostgreSQL ou MySQL e gerar o Prisma Client do provedor correto. Ela adiciona uma tabela e amplia os campos de identidade; não remove contatos.
3. No banco do Dialogy, aplicar `20260913020000_preserve_bsuid_contact_identity`. O gatilho adicional impede que o gatilho atual de telefones transforme dígitos do BSUID em `phone_canonical`/`phone_digits`. Foi verificado que esses campos e o gatilho anterior existem no banco configurado; a consulta foi somente leitura.
4. Publicar a Evolution e o Dialogy, incluindo os workers geral e Meta relay. Retomar o processamento após todos usarem a versão compatível.
5. Validar com uma conta de teste habilitada pela Meta: mensagem sem telefone → um contato/chat → resposta aceita e entregue → atualização de status na mesma conversa. Repetir com telefone conhecido e com telefone + BSUID.

As migrações e a publicação **não foram executadas em produção** nesta implementação. Os campos novos não exigem backfill automático. Reverter para a aplicação antiga exige interromper tráfego somente com BSUID, pois a versão antiga não entende essas identidades. Não remover a tabela de associações nem reduzir campos após armazenar IDs longos.

## Evidências locais

`tests/whatsapp-bsuid.spec.ts` verifica o seguinte:

- preservação de BSUIDs e IDs principais com até 128 caracteres alfanuméricos após o prefixo;
- ausência de telefone inventado, de variações de nono dígito e de envio por outra instância;
- serviços reais de envio de texto, lista, botões e template;
- SQL real de criação de contato, resolução de chat e bloqueio transacional em PostgreSQL embarcado;
- migração executada junto da definição real do gatilho legado, inspecionada somente para leitura e retida em `tests/fixtures/contact-phone-digits-legacy.sql`;
- caminho integrado Meta → adaptador real da Evolution → handler real de inbox do Dialogy → contato/mensagem persistidos → ponto de acionamento do Nexus → resposta com BSUID pela Evolution.

O teste entre repositórios requer a pasta irmã `evolution-api-main` e seu helper de teste; é ignorado quando essa pasta não está disponível. Na validação deste workspace, ele foi executado e passou. Banco e rede externos são substituídos por limites controlados; isso comprova os caminhos locais e os contratos, não uma entrega real pela Meta nem a execução de um fluxo publicado do Nexus.

Comandos principais:

```powershell
npx vitest run tests/whatsapp-bsuid.spec.ts tests/whatsapp-contact-identity.spec.ts tests/meta-evolution-contract.spec.ts tests/meta-whatsapp-route.spec.ts tests/evolution-inbound-message.spec.ts tests/evolution-api-client-timeout.spec.ts tests/send-list-message.spec.ts tests/send-document-message.spec.ts tests/template-send-contract.spec.ts tests/chat-platform.spec.ts tests/nexus-multichannel-dispatch.spec.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run worker:build
npm run worker:meta-relay:build
```

O build completo da Evolution, os testes de BSUID, os testes anteriores de contato/worker e o SQL da fila foram verificados separadamente no repositório da Evolution. Os schemas Prisma de PostgreSQL e MySQL foram validados; a migração MySQL não foi executada em um servidor MySQL nesta sessão.

## Limites

A compatibilidade aqui cobre os adaptadores da Evolution e o caminho do atendimento no Dialogy. Integrações terceiras como Chatwoot, automações que exigem explicitamente telefone, campanhas e serviços de autenticação por telefone precisam respeitar a ausência desse dado. Templates de autenticação têm restrições próprias da Meta. Não foi feita reserva de username, alteração de assinatura de webhook ou mudança de configuração da conta Meta.

Contrato verificado na [documentação oficial de BSUID da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids).
