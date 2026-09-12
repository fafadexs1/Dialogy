# Página pública de IA — Dialogy

Validada localmente em 12/09/2026, em `http://localhost:9002/ia`.

## Entrega

Página dedicada com 12 seções: abertura, canais, apresentação, exemplos de atendimento, personalidade, conhecimento, mídia, jornada de automação, transferência para pessoas, controle do agente, perguntas frequentes e chamada final. Identidade clara em verde e lavanda, logo oficial, personagem em CSS, movimento ligado à rolagem, cartões flutuantes, revelações e estados interativos.

A navegação principal, a chamada da seção de IA e o rodapé da home apontam para `/ia`. Metadados, canonical, FAQ estruturado, breadcrumb e registro no sitemap usam a infraestrutura de SEO existente.

## Base das afirmações

- Conhecimento, ações de CRM/etiquetas, integrações publicadas e transferência: `src/services/agent-studio/runtime.ts` e `docs/STATUS-estudio-agentes-ia.md`.
- Transcrição e interpretação de mídia: `src/ai/flows/analyze-media.ts` e `src/ai/flows/transcribe-audio.ts`.
- Resumo de conversa: `src/ai/flows/chat-summarization.ts`.
- Planos e consumo: encaminhamento para `/pricing`, sem duplicar preços ou prometer consumo ilimitado.

Os exemplos interativos estão identificados como ilustrativos. Não chamam modelos nem executam ações externas. Recursos de mídia, integrações e ações são descritos com suas dependências de configuração. A conferência de capacidades foi feita no código local; esta tarefa não homologou fornecedores em produção.

## Validação

- `npm run typecheck`: aprovado.
- ESLint dos arquivos TypeScript envolvidos: aprovado.
- `npx vitest run tests/seo-registry.spec.ts`: 6 testes aprovados.
- `node design-qa/check-ai-page.cjs`: aprovado, zero erros de execução capturados.
- 21 combinações de largura/cenário: 1440, 1024, 768, 600, 390, 360 e 320 px, sem rolagem horizontal.
- Cliques reais: 3 cenários, 3 tons de voz, transcrição, 4 etapas da jornada, transferência e reinício, 6 perguntas frequentes, menu mobile, links para cadastro e planos e acesso pela home.
- Teclado e preferência de movimento reduzido conferidos.
- Capturas de desktop, mobile e seções revisadas visualmente.
- `git diff --check`: sem erros de whitespace; avisos de normalização LF/CRLF do repositório.

Na primeira execução, o indicador de desenvolvimento do Next interceptou o botão do menu da home. O roteiro de QA oculta esse indicador nas páginas avaliadas e nas capturas; a segunda execução passou. Isso não altera o código do produto.

Evidências: `ai-page-checks.json`, `ai-desktop.png`, `ai-mobile.png`, `ai-full-1440.png`, `ai-full-390.png` e capturas de possibilidades, personalidade e funcionamento.

Não foi feito build de produção nem deploy. As alterações preexistentes de outras funcionalidades foram preservadas.
