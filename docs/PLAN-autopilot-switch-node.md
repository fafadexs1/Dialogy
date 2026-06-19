# Plano: Switch Node para Rotas Inteligentes no Autopilot

## Objetivo

Criar um bloco visual de decisao chamado `switch` para que o fluxo do Autopilot siga caminhos diferentes conforme a necessidade do cliente.

Exemplo:

- cliente quer alterar nome e senha do Wi-Fi -> caminho `alterar_wifi`;
- cliente reclama de lentidao no Wi-Fi -> caminho `lentidao_wifi`;
- cliente esta sem conexao -> caminho `sem_conexao`;
- cliente pede humano -> caminho `humano`;
- IA nao tem certeza -> caminho `fallback`.

O Switch nao deve ser apenas uma instrucao no prompt. Ele precisa ser um bloco executavel, auditavel e testavel que recebe uma mensagem/contexto, escolhe uma rota configurada e registra evidencia da decisao.

## Principio

O Switch guia a IA, mas nao entrega liberdade total para ela.

Regra:

```txt
Switch escolhe uma saida somente quando a mensagem do cliente combina com uma rota configurada, tem confianca suficiente e consegue justificar a escolha.
```

Se a confianca for baixa, o fluxo deve seguir para fallback, pergunta de esclarecimento ou humano.

## Modelo mental

Um Switch responde:

1. Para que este decisor existe?
2. Quais caminhos ele pode escolher?
3. Como reconhecer cada caminho?
4. Quais exemplos positivos e negativos existem?
5. Qual confianca minima e necessaria?
6. Quais dados precisam ser coletados em cada caminho?
7. O que fazer quando nao ficar claro?

## Configuracao do node

Cada `switch` deve ter:

- `instructions`: descricao do objetivo do decisor.
- `switchMode`: modo de decisao.
  - `ai`: IA escolhe entre rotas configuradas.
  - `rules`: regras deterministicas primeiro, IA apenas se ambiguo.
- `confidenceThreshold`: confianca minima para aceitar uma rota.
- `fallbackRouteId`: rota padrao quando a confianca for baixa.
- `routes`: lista de caminhos possiveis.

Cada rota deve ter:

- `id`: identificador estavel.
- `label`: nome legivel.
- `description`: quando usar.
- `examples`: frases que devem cair nessa rota.
- `intent`: intencao universal opcional.
- `requiredSlots`: dados obrigatorios para avancar.
- `targetNodeId`: proximo node esperado.

## Exemplo de configuracao

```json
{
  "kind": "switch",
  "title": "Tipo de problema Wi-Fi",
  "config": {
    "instructions": "Classifique a necessidade do cliente quando ele falar sobre Wi-Fi.",
    "switchMode": "ai",
    "confidenceThreshold": 0.75,
    "fallbackRouteId": "outro",
    "routes": [
      {
        "id": "alterar_wifi",
        "label": "Alterar nome/senha",
        "description": "Cliente quer trocar SSID, nome da rede ou senha do Wi-Fi.",
        "examples": ["Quero trocar a senha do Wi-Fi", "Mudar nome da rede"],
        "requiredSlots": ["wifi_ssid", "wifi_password"],
        "targetNodeId": "coletar-novo-wifi"
      },
      {
        "id": "lentidao_wifi",
        "label": "Lentidao no Wi-Fi",
        "description": "Cliente relata lentidao, travamento, oscilacao ou sinal fraco.",
        "examples": ["Meu Wi-Fi esta lento", "A internet fica travando"],
        "requiredSlots": ["customer_identifier"],
        "targetNodeId": "diagnosticar-lentidao"
      },
      {
        "id": "humano",
        "label": "Atendimento humano",
        "description": "Cliente pede atendente ou demonstra irritacao forte.",
        "examples": ["Quero falar com humano", "Estou cansado disso"],
        "targetNodeId": "transferir-humano"
      },
      {
        "id": "outro",
        "label": "Outro",
        "description": "Use quando nao houver evidencias suficientes.",
        "targetNodeId": "perguntar-melhor"
      }
    ]
  }
}
```

## Runtime alvo

O runtime deve produzir uma decisao estruturada:

```json
{
  "switchNodeId": "wifi-switch",
  "routeId": "alterar_wifi",
  "confidence": 0.94,
  "evidence": ["Cliente pediu trocar nome e senha do Wi-Fi"],
  "missingSlots": ["wifi_ssid", "wifi_password"],
  "targetNodeId": "coletar-novo-wifi"
}
```

Essa decisao precisa ser registrada em trace/orchestrator event e, futuramente, no Decision Ledger.

## Comportamento visual

No builder:

- O Switch deve aparecer como bloco de roteamento.
- Cada rota deve ser editavel no inspetor lateral.
- O usuario deve poder adicionar/remover rotas.
- Cada edge saindo do Switch deve poder representar uma rota.
- O label da rota deve aparecer como contexto do caminho.
- O Switch deve funcionar entre `understand`, `assistant`, `form`, `tool`, `handoff`, `send_message` e outros blocos.

## Integracao com IA Builder

O construtor com IA deve poder criar Switch quando o usuario pedir caminhos condicionais.

Exemplo de pedido:

```txt
Se o cliente quiser mudar nome/senha do Wi-Fi, siga um caminho.
Se estiver com lentidao, siga outro.
Se pedir humano, transfira.
```

A proposta gerada deve:

- criar um node `switch`;
- criar rotas configuradas;
- criar nodes de destino;
- conectar cada rota ao destino;
- preencher instrucoes e exemplos;
- nunca inventar ferramenta fora do catalogo.

## Auditoria antes de publicar

Checks minimos:

- Switch precisa ter ao menos 2 rotas.
- Cada rota precisa de `label` e `description`.
- Toda rota sem `targetNodeId` precisa ter edge correspondente.
- Deve existir fallback quando a confianca minima for maior que zero.
- Rotas sensiveis que levam a ferramenta de alto risco precisam passar por confirmacao.
- Rotas duplicadas ou ambiguas devem gerar aviso.

## Autoevolucao

O Switch e uma das melhores fontes para autoevolucao.

Metrica por rota:

- quantas vezes foi escolhida;
- confianca media;
- taxa de fallback;
- taxa de transferencia humana;
- quantos turnos ate resolver;
- quantas vezes humano corrigiu caminho;
- rotas que quase nunca sao usadas;
- mensagens frequentes que cairam em fallback.

Sugestoes futuras:

- adicionar nova rota a partir de mensagens recorrentes em fallback;
- melhorar descricao/exemplos de rota com baixa confianca;
- fundir rotas que confundem o classificador;
- criar slot obrigatorio quando a rota sempre precisa de um dado.

## Fases de implementacao

### Fase 1: Contrato e UI inicial

- Adicionar `switch` em `AutopilotFlowNodeKind`.
- Adicionar `AutopilotFlowSwitchRoute`.
- Adicionar campos de config do Switch.
- Renderizar card do Switch no canvas.
- Adicionar bloco Switch na sidebar.
- Editar rotas no inspector.
- Preservar rotas ao salvar/restaurar grafo.

### Fase 2: Sanitizacao e IA Builder

- Permitir `switch` no schema de geracao por IA.
- Sanitizar rotas: ids unicos, labels curtos, threshold valido.
- Corrigir edges invalidas sem remover o Switch.
- Criar testes para propostas com Switch.

### Fase 3: Roteamento offline

- Criar resolvedor deterministico de Switch com keywords/exemplos.
- Retornar rota, target, confianca e evidencia.
- Registrar trace no playground.

### Fase 4: Runtime em producao

- Integrar resolucao do Switch no `process-chat`.
- Atualizar active node conforme a rota escolhida.
- Aplicar form/tool/handoff do caminho escolhido.
- Registrar `switch_resolution` em `orchestrator_events`.

### Fase 5: Auditoria e publicacao

- Criar auditor de Switch antes de publicar.
- Bloquear publicacao de Switch sem fallback ou sem rotas suficientes.
- Mostrar simulacoes por rota.

### Fase 6: Learning Loop

- Registrar outcomes por rota.
- Detectar rotas confusas, rotas mortas e mensagens recorrentes em fallback.
- Sugerir novas rotas ou melhorias de exemplos.

## Criterio de sucesso

O recurso estara maduro quando um usuario conseguir desenhar:

```txt
Mensagem recebida
-> Switch: Tipo de problema Wi-Fi
   -> Alterar nome/senha
   -> Lentidao no Wi-Fi
   -> Sem conexao
   -> Humano
   -> Outro
```

E o sistema conseguir provar, em cada atendimento:

- qual rota foi escolhida;
- por que foi escolhida;
- qual rota foi rejeitada;
- qual era a confianca;
- qual node recebeu o controle;
- se a escolha resolveu ou precisou de humano.
