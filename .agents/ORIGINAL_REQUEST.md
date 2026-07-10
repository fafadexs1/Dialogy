# Original User Request

## 2026-07-08T13:44:31Z

O objetivo deste projeto é aprimorar de forma ampla e robusta a geração de prompts, o comportamento dos subagentes e a validação estrutural do **Flow V2 Builder** no Dialogy, tornando as diretrizes de sistema dos agentes mais ricas e diminuindo drasticamente erros de contexto.

Working directory: c:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy
Integrity mode: development

## Requirements

### R1. Validação Visual e de Completude (Frontend)
Implementar uma validação no Flow V2 Builder antes da publicação do fluxo para garantir que nenhum nó (como `collect`, `decision`, `sub_agent`, `handoff` ou `message`) seja deixado com dados cruciais vazios ou corrompidos. O editor visual deve impedir a publicação se houver problemas de completude (ex: blocos de coleta sem campos configurados, sub-agentes sem instruções, ou decisões sem rotas configuradas) e indicar de forma clara qual bloco possui o erro.

### R2. Motor de Geração de Prompts Ricos (Backend)
Melhorar a lógica em `flow-v2.ts` e `process-chat.ts` para que, ao compilar o prompt de sistema (`intentContextForAI` ou instruções de nós) enviado para o LLM, o sistema injete regras ricas de comportamento e condução de conversas. Essas regras devem instruir a IA a se comportar adequadamente de acordo com o tipo de bloco (ex: conduzir a coleta de forma natural no nó de formulário, tratar dúvidas do cliente sem desviar do objetivo principal do bloco atual e aplicar limites rígidos contra a criação de fatos não suportados na base).

### R3. Preservação de Tipagem e Testes
Todas as modificações devem passar com sucesso na verificação estática do compilador TypeScript (`npx tsc --noEmit`) e manter os testes unitários/funcionais integrados rodando sem quebras.

## Acceptance Criteria

### Frontend Completeness Validation
- [ ] O Flow V2 Builder deve bloquear a publicação do agente se houver blocos estruturalmente vazios ou sem dados cruciais.
- [ ] A interface visual do Flow V2 Builder deve exibir alertas visuais de erro nos nós inválidos específicos.

### Backend Rich Prompts & Guidance
- [ ] Os prompts padrão de novos nós compilados em `flow-v2.ts` devem ser estruturados (usando títulos e marcadores no prompt) e guiar o comportamento do agente.
- [ ] O motor no backend (`process-chat.ts` / `flow-routing.ts`) deve injetar diretrizes globais de condução de fluxo estruturadas para o LLM responder no escopo correto sem alucinar desvios.

### Code Integrity
- [ ] O comando `npx tsc --noEmit` executa e finaliza com sucesso (zero erros de tipagem).
- [ ] O sistema não deve quebrar nenhuma funcionalidade de rotas ou publicação de agentes existente.
