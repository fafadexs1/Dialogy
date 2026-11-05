# Problem Definition: Redefinição da Experiência Mobile como Chat Nativo

- **Slug**: redefinirmobile
- **Created**: 2026-09-14
- **Inputs used**: intake.md | research.md

## Problem Statement

Atendentes e gestores que precisam operar o Dialogy em smartphones enfrentam uma interface que se comporta como uma versão desktop comprimida, com botões densos, elementos fora da zona de alcance do polegar e instabilidade de viewport causada pelo teclado virtual, o que degrada a velocidade de atendimento e gera erros operacionais quando estão longe do computador.

## Affected Users & Stakeholders

- **Users**:
  - *Atendentes e Vendedores em trânsito*: Sofrem com digitação prejudicada pelo teclado virtual, dificuldade de alternar entre a lista e a conversa, e excesso de informações irrelevantes na tela do celular.
  - *Gestores e Supervisores*: Precisam monitorar a fila de atendimento, assumir conversas urgentes ou realizar transferências rápidas diretamente do smartphone com poucos toques.
- **Stakeholders**:
  - *Liderança Comercial e Suporte*: Exigem que o tempo de primeira resposta (FRT) a leads e clientes não caia drasticamente quando a equipe estiver operando fora da estação de trabalho.
  - *Equipe de Engenharia / Produto*: Precisa desvincular o layout móvel da complexidade de classes condicionais (`md:hidden`/`md:flex`) espalhadas pelo `ChatPanel` desktop, reduzindo custos de manutenção.

## Goals

- Proporcionar uma experiência de atendimento com ergonomia tátil nativa (estilo mensageiro instantâneo), utilizável com apenas uma mão.
- Garantir que o campo de digitação e as mensagens permaneçam visíveis e estáveis em 100% do tempo ao abrir ou fechar o teclado virtual no iOS Safari e Android Chrome.
- Estabelecer uma navegação limpa e focada exclusivamente em duas telas: Lista de Conversas simplificada e Conversa Ativa em tela cheia.
- Centralizar ações secundárias (dados do lead, tags, notas internas, transferência e encerramento) em uma gaveta inferior deslizante (*bottom sheet*) acessada ao tocar no cabeçalho do chat.

## Non-Goals

- Não abrange a compilação ou distribuição de aplicativos nativos nas lojas (App Store / Google Play via Expo) neste escopo — o foco é o modo mobile do web app/PWA existente.
- Não levar para a tela do celular funcionalidades pesadas de desktop que não fazem sentido em atendimento móvel (ex: construtor visual de automações/Agent Studio, relatórios analíticos em gráficos densos, configurações avançadas do workspace).
- Não alterar regras de negócio, tabelas do banco de dados ou contratos de backend da API.

## Success Metrics

- **Estabilidade de Viewport**: 0% de ocorrência de teclado virtual cobrindo o input de texto ou distorcendo o scroll das mensagens em dispositivos iOS e Android testados (baseline: instabilidade recorrente).
- **Agilidade de Interação**: Redução perceptível de toques necessários para abrir uma conversa, responder e encerrar/transferir no celular (métrica qualitativa).
- **Adoção Móvel**: Aumento na quantidade de atendimentos realizados e concluídos satisfatoriamente via navegadores móveis (baseline: uso evitado pelos operadores).

## Cost of Inaction

Se nada for feito, os operadores continuarão evitando o uso do Dialogy no celular ou recorrerão a alternativas não integradas (como WhatsApp pessoal no aparelho próprio), provocando atraso nas respostas a clientes em horários flexíveis e quebrando a rastreabilidade e centralização dos atendimentos da empresa.

## Open Questions

- [NEEDS CLARIFICATION: A barra de navegação inferior (com abas secundárias estáticas como 'CRM' e 'Ajustes') deve ser removida por completo para dedicar 100% da altura da tela à lista de conversas e ao chat?]
- [NEEDS CLARIFICATION: Todas as ações de gestão do atendimento (encerrar conversa, transferir atendente, ver telefone e notas) devem ficar exclusivamente dentro do toque no cabeçalho do contato via gaveta inferior (*bottom sheet*)?]
- [NEEDS CLARIFICATION: Há necessidade de gestos táteis avançados (swipe horizontal na mensagem para responder diretamente) já nesta primeira fase?]
