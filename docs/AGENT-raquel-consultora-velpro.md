# Raquel | Consultora Velpro

## Estado da entrega

- ID do agente: `0a952e14-2fdc-47eb-99d6-733a2d4868a5`
- Workspace: Velpro Telecom
- Tipo: Vendas e Comercial
- Estado: publicado e ativo
- Modelo da publicação: `deepseek/deepseek-v4-flash`
- Versão publicada: 19
- Revisão do documento: 4

Esta configuração reaproveita a Raquel existente e preserva seu vínculo com o agente inteligente do workspace. Ela está disponível para ser selecionada pelo fluxo padrão. Nenhum componente visual ou encadeamento desse fluxo foi alterado.

## Objetivo

Transformar dúvidas sobre internet em recomendações claras, qualificar o interesse, coletar apenas os dados necessários e entregar oportunidades prontas para a equipe Comercial.

## Experiência do cliente

1. A Raquel recebe a pessoa e identifica o que ela quer fazer.
2. Para dúvidas simples, apresenta preços, velocidades, TV e Wi-Fi sem esconder o valor normal.
3. Para recomendação, faz quatro perguntas curtas: quantidade de pessoas, perfil de uso, interesse em TV e prioridade por Wi-Fi 6.
4. Para contratação, confirma o plano e coleta nome, telefone, CEP, endereço e período preferido para contato.
5. Antes de encaminhar os dados, pede consentimento para o contato comercial.
6. Para cobertura, coleta somente CEP e endereço e transfere a análise ao Comercial.
7. Cliente atual com problema é transferido ao Suporte; fatura, boleto ou pagamento é transferido ao Financeiro.

## Catálogo configurado

| Plano | Inclui | Wi-Fi | Com pontualidade | Valor normal |
|---|---|---|---:|---:|
| 500 Mega | Somente internet | Wi-Fi 5 | R$ 99,90 | R$ 109,90 |
| 600 Mega | Internet + 60 canais | Wi-Fi 5 | R$ 109,90 | R$ 119,90 |
| 800 Mega | Internet + 75 canais | Wi-Fi 5 | R$ 125,90 | R$ 135,90 |
| 1000 Mega | Internet + 100 canais | Wi-Fi 6 | R$ 149,90 | R$ 159,90 |

Grade de canais: https://velpro.net.br/tv

## Lógica de recomendação

- Wi-Fi 6 como prioridade ou uso de máxima performance: 1000 Mega.
- Streaming 4K com muitos dispositivos ou mais de quatro usuários: 800 Mega.
- Interesse em TV com perfil residencial equilibrado: 600 Mega.
- Uso leve ou cotidiano sem interesse em TV: 500 Mega.

A resposta sempre explica brevemente por que o plano combina com o perfil e informa tanto o preço com pontualidade quanto o preço normal.

## Procedimentos

1. Conhecer planos e preços.
2. Descobrir o plano ideal.
3. Iniciar contratação.
4. Consultar cobertura.
5. Conhecer canais de TV.
6. Suporte para cliente atual.
7. Financeiro e faturas.

## Dados e segurança

Na pré-venda, o agente pode coletar:

- plano escolhido;
- nome;
- telefone, com confirmação;
- CEP e endereço de instalação;
- período preferido para contato;
- autorização para contato comercial.

O agente não deve solicitar CPF, documentos pessoais, senha, token, código de autenticação, CVV ou dados de pagamento. Essas restrições estão configuradas como barreiras do motor, além de constarem na base de conhecimento.

Também é proibido inventar taxa de instalação, fidelidade, prazo, cobertura, equipamento adicional, promoção ou condição comercial não informada. Cobertura sempre depende de análise da equipe.

## Integrações

Este primeiro agente não precisa de API, MCP ou ação nativa para cumprir a jornada atual. A recomendação é determinística e as oportunidades são transferidas às equipes existentes com o contexto coletado na conversa. Isso reduz risco e dependências na primeira homologação.

Quando houver uma fonte oficial de cobertura ou um CRM definido para gravação automática, eles podem ser adicionados como procedimentos genéricos de API, MCP ou ação nativa sem alterar o construtor para um caso específico de telecom.

## Evidência de homologação automatizada

O arquivo `tests/velpro-sales-agent.spec.ts` cobre:

- validade do documento e prontidão para publicação;
- catálogo e preços exatos;
- recomendação dos quatro planos;
- contratação completa em nove mensagens do cliente;
- consulta de cobertura em três mensagens;
- transferência para Comercial, Suporte e Financeiro;
- ausência de coleta de CPF e pagamento.

## Checklist para ligar no fluxo padrão

1. No fluxo padrão, adicionar ou abrir o bloco de agente de IA.
2. Selecionar `Raquel`, versão 19.
3. Conectar entradas e saídas conforme a jornada desejada.
4. Publicar inicialmente em um canal ou público controlado.
5. Acompanhar conversão, transferências, abandono e motivos de falha antes de ampliar.
