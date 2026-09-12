# IA central e creditos

## Ativacao

1. Aplicar `npx tsx scripts/apply-platform-ai-credits.ts`. O script aplica apenas a migracao `20260912160000_platform_ai_credits`, em transacao, verifica RLS e registra checksum no historico Prisma. Nao executa migracoes pendentes de outros recursos e nao apaga registros existentes.
2. Publicar o codigo junto da configuracao operacional. Em `/superadmin/ai-models`, cadastrar credenciais, modelos e escolher um padrao ativo. Sem esse padrao, a execucao de IA fica bloqueada; a listagem dos agentes permanece acessivel.
3. Informar custos de entrada/saida por um milhao de tokens, acrescimos percentuais independentes, moeda dos custos e valor em reais de cada credito. Em USD, informar a cotacao de conversao.
4. Provisionar saldo nas workspaces antes de ativar cobranca. A recarga via Stripe depende das credenciais e webhook existentes, incluindo `checkout.session.completed` e `checkout.session.async_payment_succeeded`. Nao ativar cobranca antes de validar o fluxo de pagamento do ambiente.

## Comportamento

- A workspace nao escolhe modelos nem fornece chaves. Modelos salvos anteriormente em agentes e versoes nao prevalecem sobre o padrao central. Configuracoes e versoes antigas nao sao apagadas.
- O modelo principal nao substitui os modelos de decisao. Tool Intent Gate, Intent Classifier, Workflow Classifier e Field Extractor usam o modelo e timeout de `ai_decision_model_config`, editaveis na aba Decisoes do Autopilot. O gateway resolve credencial e preco pelo modelo da etapa, ignorando overrides enviados pelo chamador.
- As abas Provedores e modelos, Decisoes do Autopilot e Creditos de IA separam cadastro, roteamento interno e precificacao. Enquanto nao houver configuracao nova salva, a tela carrega os registros existentes de `ai_model_catalog`, sem sobrescreve-los. O modelo principal e as tarifas continuam exigindo escolha explicita.
- Alteracoes de modelos e atribuicoes de decisao compartilham trava transacional. Nao e permitido salvar uma etapa com modelo inexistente/inativo nem desativar um modelo ainda referenciado por uma etapa.
- Cada chamada tarifada reserva saldo antes de acessar o provedor. A cobranca usa tokens efetivamente reportados e a tabela de precos congelada na reserva. O arredondamento e para cima, em seis casas decimais de credito, uma vez por chamada.
- Consumo superior a reserva pode deixar saldo devedor; chamadas seguintes ficam bloqueadas por insuficiencia. Reservas sao estimativas conservadoras, nao a cobranca final.
- Falha de rede, timeout ou ausencia de contagem deixam a reserva em revisao. O superadmin pode liquidar usando contagem comprovada ou liberar a reserva em conciliacao. A identidade do administrador fica registrada.
- Creditos comprados sao concedidos apenas apos webhook assinado com pagamento confirmado e correspondencia exata de pedido, sessao, moeda e valor. Reentrega do mesmo webhook nao duplica saldo.
- Estornos e chargebacks Stripe nao possuem conciliacao automatica nesta entrega. Exigem tratamento operacional antes de uma abertura comercial irrestrita.
- Transcricao especializada de audio (Whisper) e embeddings continuam na infraestrutura existente; nao sao precificados pela tabela de tokens de entrada/saida do modelo conversacional.

## Verificacao em 2026-09-12

- Migracao aplicada no banco configurado, sem exclusao. Contagem antes/depois: 15 agentes. Consulta de listagem: 15 agentes em 4 workspaces. Tambem consultados 146 registros de versao e 132 definicoes de workflow.
- Seis novas tabelas com RLS e sem leitura direta por `anon`/`authenticated`; operacoes privilegiadas passam por actions com autorizacao no servidor.
- Nenhum modelo, tarifa, chave nova ou saldo foi cadastrado automaticamente. Nenhuma cobranca real foi iniciada.
- Suite direcionada: 62 testes em 9 arquivos. Inclui contabilidade SQL em PGlite, rejeicao por permissao, escopo da workspace, tabela de precos, uso reportado por transporte controlado e idempotencia de webhook. Nao representa teste de provedor ou pagamento real.
- QA dos componentes reais em Playwright, 1440px e 390px, com actions substituidas por fixtures explicitamente isoladas. Evidencias em `artifacts/platform-ai-credits`. Nao representa login nem navegacao autenticada em producao.

## Correcao das decisoes em 2026-09-12

- Os quatro seletores de decisao foram restaurados no superadmin e no runtime, preservando as regras e fallbacks deterministicos. O classificador operacional do plugin SGP tambem passa pelo gateway tarifado com workspace identificado.
- Testes adicionais verificam modelos de decisao diferentes do principal, chaves de outro provedor, precos por modelo, protecao de dependencias e recuperacao do catalogo anterior. Suite direcionada ampliada: 211 testes em 13 arquivos.
- QA passou com cliques reais nas tres abas, cadastro de modelo, salvamento de decisao/timeout e de tarifas, em desktop e celular. Os testes usam banco e transporte isolados; nao acionam provedores nem cobrancas reais.
- Nesta correcao, o banco configurado foi apenas consultado: os tres modelos e as quatro configuracoes de decisao continuaram preservados. Nenhum cadastro ou preco foi alterado automaticamente.

## Regressao de listagem

A leitura da disponibilidade de IA nao deve invalidar a listagem de agentes. `listWorkspaceConfiguredAiModels` retorna vazio enquanto o superadmin nao definiu o padrao; as actions de leitura de agentes/Studio preservam os dados quando a consulta de disponibilidade falha. A execucao continua exigindo configuracao valida. O atalho `/autopilot` foi restaurado logo abaixo de `/nexus` no menu.
