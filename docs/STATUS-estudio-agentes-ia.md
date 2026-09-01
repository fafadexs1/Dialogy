# Estado final da implementação — Estúdio de Agentes de IA

Atualizado em 27/08/2026. A implementação local do novo Estúdio foi concluída e sua migration foi aplicada ao banco configurado do projeto. Este documento não autoriza publicar agentes, chamar integrações reais ou liberar produção.

## Resultado entregue

- O agente de IA deixou de usar canvas. Sua edição agora é uma jornada vertical em três estágios: entender, resolver e concluir.
- O fluxo normal conserva seu editor visual. A única extensão é o bloco `ai.published_agent`, que escolhe um agente publicado, fixa a versão e mapeia somente entradas e saídas explícitas.
- Procedimentos internos suportam mensagem, coleta tipada, decisão, API, ferramenta MCP, conhecimento, transferência e conclusão.
- Coleta suporta obrigatoriedade, sensibilidade, confirmação, correção, aliases, origem e disponibilidade por caminho. Senhas, tokens, chaves, códigos de autenticação e CVV são bloqueados.
- API e MCP usam conexões protegidas, contratos tipados, mapeamentos explícitos, confirmação por risco, limites de rede e tratamento conservador de resultado incerto.
- A prévia é local e não executa integrações reais. O runtime executa somente o documento imutável de uma versão publicada.
- Conhecimento aceita PDF, TXT, MD, CSV e JSON, com limite de 2 MB, validação de formato, extração no servidor e hash SHA-256 por revisão. Fontes e versões podem ser revogadas sem apagar histórico.
- Aparência, regras e resultados estão separados da jornada. Avatar por URL HTTPS é exibido apenas nos canais compatíveis; canais controlados pela plataforma são explicados na interface.
- Autosave usa revisão otimista. Publicações são imutáveis, podem ser comparadas e restauradas como novo rascunho.
- Sessões iniciadas permanecem fixadas na versão original. Novas conversas usam a publicação mais recente; rollback para o runtime anterior não rompe sessões já iniciadas.
- Histórico e métricas omitem mensagens, valores pessoais e credenciais. Resultados externos incertos exigem conferência humana e nunca são repetidos automaticamente.
- Retenção é opt-in, usa advisory lock e não remove sessões ativas ou incertas.

## Migração e transição

A migração `prisma/migrations/20260827130000_agent_studio_session_history/migration.sql` cria sessões, histórico, referências do fluxo normal e revogações, com RLS, grants, índices e triggers. Em 27/08/2026 ela foi aplicada isoladamente ao banco configurado do projeto e registrada no ledger do Prisma com checksum conferido. As demais migrações antigas sem registro não foram executadas.

A transição preserva um backup sem credenciais, calcula inventário de consumidores e canais e cria um rascunho revisável; não converte silenciosamente o grafo antigo. A reversão operacional cria uma nova versão legado auditável, preservando releases e rascunhos do Estúdio.

## Evidências de aceite local

- Suíte completa do Estúdio: **20 arquivos, 210 testes aprovados**.
- Regressão Autopilot: **32 arquivos, 230 testes aprovados**.
- Nexus/modelo: **2 arquivos, 7 testes aprovados**.
- TypeScript: `npx tsc --noEmit --incremental false` aprovado.
- ESLint do novo Estúdio, serviços e inspetor do bloco publicado: zero erros e zero avisos.
- Build Next.js 16.3.0: compilação, tipos, coleta de páginas e 115 páginas estáticas concluídos com exit 0.
- PostgreSQL isolado: concorrência otimista, publicação/checkpoint atômicos, RLS, isolamento de workspace, espera/retomada, cancelamento, rollback, revogação e imutabilidade aprovados.
- Navegador isolado em HTTP: jornada renderizada, procedimento iniciado, CPF coletado e resposta produzida com `crypto.randomUUID` indisponível; nova sessão de console sem erros.
- Inspeção visual: desktop em `artifacts/design-qa/agent-studio-desktop-current.png` e mobile em `artifacts/design-qa/agent-studio-mobile-current.png`.
- O diff do fluxo normal adiciona somente reconhecimento do novo tipo e seu inspetor; não altera classes, estrutura do canvas ou tokens visuais do editor normal.

O build mantém um aviso preexistente do Turbopack sobre tracing dinâmico em `src/services/media/ffmpeg.ts`. Ele não é causado pelo Estúdio e não impediu o build.

## O que deliberadamente não foi executado

- Nenhuma outra migration pendente foi executada; somente `20260827130000_agent_studio_session_history` foi aplicada.
- Nenhuma publicação ou ativação de agente real.
- Nenhuma mensagem a cliente e nenhuma chamada API/MCP com efeitos externos.
- Nenhuma exclusão ou conversão automática de agente antigo.
- Nenhuma alteração visual no fluxo normal.

## Próxima etapa operacional

Seguir `docs/AGENT-STUDIO-ROLLOUT.md` a partir do aceite humano com dados fictícios: validar um agente não ativo, executar o canário por workspace/agente, acompanhar métricas e somente então fazer a ativação gradual. A liberação permanece uma decisão operacional explícita.
