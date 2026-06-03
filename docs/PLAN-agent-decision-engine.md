# Plano: Motor de Decisao Auditavel e Auto-Evolutivo para Ferramentas

## Objetivo

Criar um motor de atendimento onde a IA consiga explicar, de forma concreta e auditavel, por que decidiu responder, perguntar, usar uma ferramenta, bloquear uma ferramenta, transferir ou encerrar.

O problema central nao e "qual prompt faz o modelo usar a ferramenta certa". O problema e construir uma arquitetura onde o modelo nao tenha liberdade para alucinar que precisa de uma ferramenta. A ferramenta so pode ser usada quando existir evidencia suficiente, etapa correta, politica permitindo, dados obrigatorios preenchidos e objetivo operacional claro.

Este documento define a base do novo motor:

- como o agente chega a conclusao de usar ferramenta X ou Y;
- como evitar tool use alucinado;
- como registrar o raciocinio operacional sem depender de texto livre do modelo;
- como transformar fluxo visual em procedimento executavel;
- como gerar auditoria automatica para cada fluxo e cada conversa;
- como o motor aprende com os resultados das suas proprias decisoes;
- como padroes de falha sao detectados e corrigidos automaticamente;
- como aprendizados de um workspace podem beneficiar o ecossistema.

## Principio Central

Nenhuma ferramenta e escolhida diretamente pelo LLM.

O LLM pode propor uma intencao, interpretar linguagem, resumir contexto e sugerir proximos passos. Mas a decisao final de ferramenta passa por um motor deterministico/probabilistico auditavel chamado `AgentDecisionEngine`.

Regra:

```txt
Ferramenta so executa quando:
objetivo do cliente + procedimento aplicavel + etapa ativa + slots obrigatorios + politica da ferramenta + confirmacao requerida + escopo do fluxo
estiverem satisfeitos.
```

Se qualquer parte faltar, o motor deve perguntar, responder sem ferramenta, bloquear ou transferir.

## Definicoes

### Customer Goal

O objetivo real do cliente no turno atual.

Exemplos genericos:

- `change_wifi_credentials`
- `check_connection_status`
- `schedule_appointment`
- `request_invoice`
- `track_order`
- `cancel_subscription`
- `update_registration_data`
- `ask_policy_question`
- `compare_products`
- `talk_to_human`

O goal nao deve ser apenas uma intencao ampla como `support_request`. Ele precisa apontar para o trabalho que o agente deve realizar.

### Procedure

Um procedimento e uma sequencia executavel de etapas.

Exemplo:

```json
{
  "id": "change_wifi_credentials",
  "title": "Alterar credenciais de Wi-Fi",
  "goal": "change_wifi_credentials",
  "steps": [
    "identify_customer",
    "collect_new_credentials",
    "confirm_change",
    "execute_change",
    "respond_result"
  ]
}
```

O procedimento nao e prompt. Ele e uma maquina de estados.

### Step

Uma etapa do procedimento.

Tipos principais:

- `classify`: decidir rota ou subobjetivo;
- `retrieve_knowledge`: buscar base interna;
- `collect_slots`: coletar dados faltantes;
- `confirm`: pedir confirmacao explicita;
- `call_tool`: executar ferramenta;
- `validate_tool_result`: interpretar retorno;
- `respond`: responder ao cliente;
- `handoff`: transferir;
- `close`: encerrar.

### Slot

Dado estruturado necessario para executar uma etapa.

Exemplos:

- `customer_identifier`
- `phone`
- `email`
- `address`
- `order_id`
- `appointment_date`
- `wifi_ssid`
- `wifi_password`
- `contract_id`
- `product_or_service_preference`

Slots devem ter fonte e confianca:

```json
{
  "name": "customer_identifier",
  "value": "52998224725",
  "source": "message",
  "confidence": 0.99,
  "verified": false
}
```

### Tool Capability

Descricao formal do que uma ferramenta faz, quando pode ser usada e quais riscos existem.

```json
{
  "name": "update_router_wifi_credentials",
  "capability": "change_wifi_credentials",
  "risk_level": "high",
  "required_slots": ["contract_id", "wifi_ssid", "wifi_password"],
  "requires_confirmation": true,
  "allowed_step_types": ["call_tool"],
  "allowed_goals": ["change_wifi_credentials"],
  "forbidden_goals": ["ask_policy_question", "compare_products"],
  "success_schema": {
    "status": "success",
    "changed": true
  }
}
```

### Resource Mapper

O `Resource Mapper` e a camada que transforma dados entendidos pelo agente em payload operacional valido para qualquer recurso do sistema.

Ele existe para remover da IA a responsabilidade de montar JSON de ferramenta, atualizar CRM, criar pedido, agendar horario, abrir ticket, preencher contrato ou atualizar qualquer entidade sensivel.

Regra:

```txt
LLM interpreta linguagem.
Slot Extractor estrutura dados.
Resource Mapper encaixa os dados no recurso correto.
Tool Policy Gate valida permissao.
Execution Runtime executa.
```

O modelo pode sugerir que o cliente informou um dado. O motor decide onde esse dado entra.

Exemplo:

Cliente:

```txt
Meu telefone e o mesmo que estou falando contigo.
```

Slot extraido:

```json
{
  "name": "phone",
  "value": "5561995215930",
  "source": "contact",
  "confidence": 0.9
}
```

O Resource Mapper resolve:

```json
{
  "resource": "crm.contact",
  "operation": "update",
  "slot": "phone",
  "matchedField": {
    "fieldId": "field_phone_123",
    "label": "Telefone",
    "type": "phone"
  },
  "payload": {
    "fieldValues": [
      {
        "fieldId": "field_phone_123",
        "value": "5561995215930"
      }
    ]
  }
}
```

A IA nao inventa `fieldId`, nao escolhe nome interno e nao decide formato final.

## Arquitetura Alvo

### Pipeline

1. `Message Normalizer`
2. `Goal Resolver`
3. `Procedure Matcher`
4. `State Loader`
5. `Slot Extractor`
6. `Knowledge Resolver`
7. `Decision Engine`
8. `Resource Mapper`
9. `Tool Policy Gate`
10. `Execution Runtime`
11. `Response Composer`
12. `Response Validator`
13. `Decision Ledger`

O LLM participa em pontos especificos, mas nao governa tudo sozinho.

## AgentDecisionEngine

Entrada:

```ts
type AgentDecisionInput = {
  workspaceId: string;
  chatId: string;
  customerMessage: string;
  chatHistory: string;
  activeFlow: FlowDefinition | null;
  activeProcedureSession: ProcedureSession | null;
  candidateProcedures: ProcedureDefinition[];
  availableTools: ToolCapability[];
  knowledgeResults: KnowledgeResult[];
  slots: SlotMemory;
  recentToolResults: ToolExecutionResult[];
  policyContext: PolicyContext;
};
```

Saida:

```ts
type AgentDecision = {
  decision:
    | "answer"
    | "ask_slot"
    | "retrieve_knowledge"
    | "call_tool"
    | "wait_confirmation"
    | "handoff"
    | "close"
    | "fallback";
  goal: string;
  procedureId?: string;
  stepId?: string;
  requiredSlots?: string[];
  toolCall?: {
    toolName: string;
    arguments: Record<string, unknown>;
  };
  responseInstruction?: string;
  confidence: number;
  evidence: DecisionEvidence[];
  blockedTools: BlockedToolDecision[];
  audit: DecisionLedgerEntry;
};
```

## Resource Mapper

O `Resource Mapper` e uma das camadas mais importantes do motor. Ele faz a ponte entre dados universais do atendimento e recursos reais da plataforma.

Sem ele, toda ferramenta de escrita fica fragil, porque o LLM precisa acertar:

- nome exato do campo;
- estrutura do payload;
- tipo esperado;
- formato aceito;
- entidade correta;
- permissao correta;
- momento correto da execucao.

Com ele, a IA deixa de "montar payload" e passa a fornecer apenas interpretacao. O motor monta o payload de forma verificavel.

### Objetivo

Responder de forma deterministica:

```txt
Tenho estes slots. Qual recurso devo atualizar/criar/consultar? Em quais campos? Com quais valores? Esse payload e valido?
```

### Recursos Suportados

O mapper precisa ser generico para qualquer entidade futura.

Exemplos:

- `crm.contact`
- `crm.deal`
- `crm.company`
- `support.ticket`
- `appointment.booking`
- `order`
- `invoice`
- `contract`
- `subscription`
- `delivery.address`
- `lead`
- `case_memory`
- `external_tool_payload`

### Resource Contract

Todo recurso manipulavel pelo agente deve expor um contrato.

```ts
type ResourceContract = {
  resource: string;
  operations: Array<"create" | "update" | "read" | "append" | "delete">;
  identity: {
    required: string[];
    alternatives?: string[][];
  };
  fields: ResourceField[];
  policies: ResourcePolicy[];
};

type ResourceField = {
  id: string;
  key: string;
  label: string;
  type:
    | "string"
    | "text"
    | "number"
    | "currency"
    | "date"
    | "datetime"
    | "time"
    | "email"
    | "phone"
    | "document"
    | "address"
    | "enum"
    | "boolean"
    | "json";
  aliases: string[];
  required?: boolean;
  writable: boolean;
  pii?: boolean;
  allowedValues?: string[];
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };
};
```

Exemplo para CRM:

```json
{
  "resource": "crm.contact",
  "operations": ["update"],
  "identity": {
    "required": ["contact_id"]
  },
  "fields": [
    {
      "id": "field_nome",
      "key": "nome_completo",
      "label": "Nome completo",
      "type": "string",
      "aliases": ["nome", "nome do cliente", "full name"],
      "writable": true,
      "pii": true
    },
    {
      "id": "field_cpf",
      "key": "cpf",
      "label": "CPF",
      "type": "document",
      "aliases": ["documento", "cpf/cnpj", "identificador cadastral"],
      "writable": true,
      "pii": true
    }
  ],
  "policies": [
    {
      "operation": "update",
      "requiresCurrentChatContact": true,
      "denyIfNoWritableFields": true
    }
  ]
}
```

### Slot To Resource Mapping

O mapper recebe:

```ts
type ResourceMappingInput = {
  workspaceId: string;
  agentId: string;
  chatId: string;
  procedureId?: string;
  stepId?: string;
  resource: string;
  operation: "create" | "update" | "read" | "append" | "delete";
  slots: SlotMemory;
  resourceContract: ResourceContract;
  existingEntity?: Record<string, unknown>;
  intentGoal: string;
  policyContext: PolicyContext;
};
```

E retorna:

```ts
type ResourceMappingResult = {
  status: "ready" | "missing_identity" | "missing_required_fields" | "invalid" | "blocked" | "empty";
  resource: string;
  operation: string;
  payload: Record<string, unknown> | null;
  mappedFields: MappedResourceField[];
  rejectedFields: RejectedResourceField[];
  confidence: number;
  evidence: string[];
  warnings: string[];
};

type MappedResourceField = {
  slotName: string;
  slotValue: unknown;
  fieldId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: string;
  normalizedValue: unknown;
  confidence: number;
  matchReasons: string[];
};
```

### Estrategia De Match

O match de slot para campo nao deve depender de uma unica tecnica.

Usar score composto:

```txt
score =
  exact_key_match * 0.30 +
  alias_match * 0.25 +
  type_compatibility * 0.20 +
  semantic_similarity * 0.15 +
  workspace_history * 0.05 +
  procedure_context * 0.05
```

Regras duras:

- campo precisa ser `writable`;
- tipo precisa ser compativel;
- PII precisa de permissao do recurso;
- score abaixo de `0.70` nao escreve automaticamente;
- empate entre campos sensiveis exige bloqueio ou revisao;
- valor invalido bloqueia payload;
- payload vazio nao executa ferramenta.

### Normalizacao De Valores

Cada tipo tem normalizador.

Exemplos:

- `phone`: remover caracteres, preservar DDI/DDDs quando disponivel;
- `document`: normalizar CPF/CNPJ ou documento local;
- `email`: lowercase e validacao basica;
- `date`: converter para ISO;
- `currency`: converter para decimal;
- `address`: preservar texto completo e, quando possivel, dividir rua/numero/bairro/cidade;
- `enum`: mapear sinonimos para valor permitido;
- `boolean`: mapear sim/nao, true/false.

### Payload Builder

O `Payload Builder` e especifico por recurso, mas acionado pelo mapper.

Exemplo CRM:

```ts
type CrmUpdateContactPayload = {
  fieldValues: Array<{
    fieldId: string;
    value: string | number | boolean | null;
  }>;
};
```

Exemplo ticket:

```ts
type SupportTicketPayload = {
  subject: string;
  description: string;
  priority?: "low" | "normal" | "high" | "urgent";
  tags?: string[];
  contactId: string;
};
```

Exemplo agendamento:

```ts
type AppointmentPayload = {
  contactId: string;
  serviceId?: string;
  date: string;
  time: string;
  notes?: string;
};
```

### Validacao De Schema

Antes de executar ferramenta:

1. validar contrato do recurso;
2. validar identidade da entidade;
3. validar campos obrigatorios;
4. validar tipos;
5. validar permissoes;
6. validar payload final com schema;
7. registrar evidencias.

Se falhar, o motor nao chama ferramenta. Ele pergunta o dado faltante, registra nota interna ou responde com limite claro.

### CRM Autonomo

Para `crm_update_contact_custom_fields`, o motor deve:

1. carregar campos customizados do workspace;
2. construir `ResourceContract` dinamico;
3. ler slots coletados no chat;
4. mapear slots para campos por chave, label, alias, tipo e contexto;
5. ignorar campos sem match confiavel;
6. montar payload apenas com campos validos;
7. bloquear se payload ficar vazio;
8. executar ferramenta;
9. registrar ledger com campos atualizados e campos ignorados.

Exemplo:

```json
{
  "slots": {
    "name": "Fabricio de Sousa Soares",
    "customer_identifier": "06620072127",
    "address": "Quadra 12, Lote 13, Morada das Garcas, Cidade Ocidental",
    "phone": "5561995215930",
    "product_or_service_preference": "1000 MEGA"
  },
  "mappedFields": [
    {
      "slotName": "name",
      "fieldLabel": "Nome completo",
      "confidence": 0.96
    },
    {
      "slotName": "customer_identifier",
      "fieldLabel": "CPF",
      "confidence": 0.94
    },
    {
      "slotName": "address",
      "fieldLabel": "Endereco",
      "confidence": 0.88
    }
  ],
  "payload": {
    "fieldValues": [
      { "fieldId": "field_nome", "value": "Fabricio de Sousa Soares" },
      { "fieldId": "field_cpf", "value": "06620072127" },
      { "fieldId": "field_endereco", "value": "Quadra 12, Lote 13, Morada das Garcas, Cidade Ocidental" }
    ]
  }
}
```

### Resource Mapper Ledger

Todo mapeamento deve ser auditavel.

```json
{
  "resource": "crm.contact",
  "operation": "update",
  "status": "ready",
  "confidence": 0.91,
  "mappedFields": [
    {
      "slot": "customer_identifier",
      "field": "CPF",
      "reason": ["alias_match", "type_compatibility"],
      "confidence": 0.94
    }
  ],
  "rejectedFields": [
    {
      "slot": "product_or_service_preference",
      "reason": "Nenhum campo CRM compativel com confianca suficiente."
    }
  ],
  "payloadHash": "sha256:...",
  "piiRedacted": true
}
```

### Aprendizado Sem Alucinar

O mapper pode aprender com uso real, mas sem perder controle.

Fontes de aprendizado:

- mapeamentos aprovados manualmente;
- campos escolhidos pelo usuario no construtor;
- historico de execucoes bem-sucedidas;
- aliases adicionados por workspace;
- schema oficial de integracoes.

O aprendizado nao deve criar execucao automatica sem passar por score, tipo e politica.

### Papel Da IA No Resource Mapper

A IA pode ajudar em tres pontos:

1. sugerir aliases para campos;
2. explicar por que um slot pode corresponder a um campo;
3. gerar proposta de mapeamento para revisao.

A IA nao pode:

- inventar `fieldId`;
- inventar entidade;
- ignorar schema;
- executar payload com score baixo;
- sobrescrever campo sensivel sem politica;
- transformar dado ambiguo em valor definitivo.

### Resultado Esperado

Quando o agente coletar dados, o motor deve conseguir dizer:

```txt
Tenho nome, documento, telefone, endereco e preferencia.
O fluxo chegou na etapa de salvar dados.
O recurso CRM contato aceita esses campos.
Mapeei 4 de 5 slots com confianca alta.
O payload e valido.
Executarei crm_update_contact_custom_fields.
```

Se nao conseguir:

```txt
Tenho dados coletados, mas nenhum campo CRM compativel foi encontrado.
Nao executarei a ferramenta.
Vou registrar no ledger e seguir para a proxima etapa segura.
```

## Como Escolher Ferramenta Sem Alucinar

### 1. Resolver objetivo primeiro

Antes de olhar ferramentas, o motor resolve o objetivo do cliente.

Exemplo:

Cliente:

```txt
Quero trocar o nome e a senha do Wi-Fi.
```

Goal resolver:

```json
{
  "goal": "change_wifi_credentials",
  "confidence": 0.94,
  "evidence": [
    "Cliente mencionou trocar nome do Wi-Fi",
    "Cliente mencionou trocar senha do Wi-Fi"
  ]
}
```

Se a confianca for baixa, nao usa ferramenta. Pergunta ou responde genericamente.

### 2. Encontrar procedimento aplicavel

O motor procura procedimento que aceite esse goal.

```json
{
  "procedure_id": "change_wifi_credentials",
  "match_score": 0.91,
  "matched_by": ["goal", "keywords", "configured_flow_block"]
}
```

Se nao houver procedimento, ferramenta de alto risco nao executa.

### 3. Descobrir etapa ativa

Se existe sessao em andamento, continuar do passo atual.

Se nao existe, iniciar na primeira etapa aplicavel.

```json
{
  "current_step": "collect_new_credentials",
  "reason": "Cliente ja identificado; faltam novo nome e senha"
}
```

### 4. Validar slots obrigatorios

Antes de tool:

```json
{
  "tool": "update_router_wifi_credentials",
  "required_slots": ["contract_id", "wifi_ssid", "wifi_password"],
  "present_slots": ["contract_id"],
  "missing_slots": ["wifi_ssid", "wifi_password"],
  "decision": "ask_slot"
}
```

Resultado:

```txt
Qual nome da rede e qual senha voce deseja configurar?
```

### 5. Validar politica da ferramenta

Mesmo com slots, a politica pode bloquear.

Exemplo:

```json
{
  "tool": "reboot_router",
  "blocked": true,
  "reason": "requires_explicit_confirmation",
  "required_confirmation": "Cliente deve confirmar reinicio no turno atual ou em contexto ativo"
}
```

### 6. Exigir confirmacao quando houver risco

Ferramentas sensiveis precisam de confirmacao explicita.

Confirmacao valida:

```txt
Sim, pode reiniciar agora.
```

Confirmacao invalida:

```txt
Sim.
```

Se o contexto nao estiver ativo ou o "sim" for ambiguo, o motor pergunta de novo:

```txt
So para confirmar: posso reiniciar o roteador agora? A conexao pode cair por alguns minutos.
```

### 7. Gerar argumentos pela memoria, nao por improviso

Argumentos da ferramenta devem vir de slots verificados, resultado de ferramenta anterior ou configuracao do fluxo.

Nao permitido:

```json
{
  "contract_id": "inventado"
}
```

Permitido:

```json
{
  "contract_id": "{{slots.contract_id.value}}",
  "ssid": "{{slots.wifi_ssid.value}}",
  "password": "{{slots.wifi_password.value}}"
}
```

### 8. Executar e validar retorno

Depois da ferramenta, o motor valida o retorno antes de deixar a IA falar.

```json
{
  "tool": "update_router_wifi_credentials",
  "status": "success",
  "validated": true,
  "next_step": "respond_result"
}
```

Se falhar:

```json
{
  "tool": "update_router_wifi_credentials",
  "status": "error",
  "validated": false,
  "next_step": "fallback_or_handoff"
}
```

A IA nunca pode dizer "alterei" se o retorno nao confirmar sucesso.

## Decision Ledger

Cada turno deve gerar um ledger.

```json
{
  "chat_id": "chat-123",
  "turn_id": "turn-456",
  "goal": {
    "id": "change_wifi_credentials",
    "confidence": 0.94,
    "evidence": [
      "Mensagem contem pedido para trocar nome do Wi-Fi",
      "Mensagem contem pedido para trocar senha"
    ]
  },
  "procedure": {
    "id": "change_wifi_credentials",
    "step": "collect_new_credentials",
    "state": "active"
  },
  "decision": {
    "type": "ask_slot",
    "reason": "Faltam wifi_ssid e wifi_password",
    "confidence": 0.88
  },
  "tools": {
    "allowed": [],
    "blocked": [
      {
        "name": "update_router_wifi_credentials",
        "reason": "missing_required_slots",
        "missing_slots": ["wifi_ssid", "wifi_password"]
      }
    ]
  },
  "response_instruction": "Perguntar novo nome da rede e nova senha."
}
```

Esse ledger deve aparecer no debug da IA e alimentar auditoria do fluxo.

### Outcome Tracking

O ledger registra a decisao. O outcome tracking registra o que aconteceu **depois** da decisao.

Quando a conversa encerra (close, handoff ou timeout), o sistema calcula o outcome e vincula ao ledger:

```json
{
  "chat_id": "chat-123",
  "outcome": {
    "resolved": true,
    "resolution_type": "automated",
    "turns_to_resolve": 4,
    "time_to_resolution_seconds": 180,
    "customer_asked_for_human": false,
    "customer_sentiment_final": "positive",
    "tools_executed": ["update_router_wifi_credentials"],
    "tools_failed": [],
    "escalation_needed": false,
    "closed_by": "agent"
  },
  "step_outcomes": [
    {
      "step_id": "collect_new_credentials",
      "turns_on_step": 1,
      "customer_confused": false
    },
    {
      "step_id": "confirm_change",
      "turns_on_step": 1,
      "customer_confirmed": true
    }
  ]
}
```

O outcome e calculado por heuristicas simples, nao por LLM:

- `resolved` = conversa fechou com tag de sucesso;
- `turns_to_resolve` = contagem de mensagens;
- `customer_asked_for_human` = intent `human_handoff` apareceu;
- `customer_sentiment_final` = analise simples do ultimo turno;
- `step_outcomes` = quantos turnos cada etapa consumiu e se houve confusao.

Esses dados alimentam o Causal Decision Memory (CDM) descrito na secao de auto-otimizacao.

## Tool Selection Score

Ferramenta candidata recebe score por criterios objetivos:

```txt
score =
  goal_match * 0.30 +
  procedure_step_match * 0.25 +
  required_slots_present * 0.20 +
  policy_allowed * 0.15 +
  knowledge_or_tool_evidence * 0.10
```

Regras:

- `policy_allowed = 0` bloqueia execucao.
- `required_slots_present < 1` bloqueia execucao para tool operacional.
- `procedure_step_match = 0` bloqueia tool sensivel.
- score abaixo de `0.75` nao executa; pergunta ou responde.

Exemplo:

```json
{
  "tool": "get_router_wifi_networks",
  "score": 0.87,
  "decision": "call_tool",
  "why": [
    "Goal check_connection_status exige consulta tecnica",
    "Procedimento esta na etapa inspect_environment",
    "Tool e read_only",
    "Contrato foi identificado",
    "Nao exige confirmacao"
  ]
}
```

## Tipos De Ferramenta

### Read-only

Consulta sem alterar estado.

Exemplos:

- consultar cadastro;
- consultar pedidos;
- consultar contratos;
- consultar redes Wi-Fi ao redor;
- consultar disponibilidade.

Pode exigir menos confirmacao, mas ainda exige escopo e slots.

### Write/action

Altera algo.

Exemplos:

- alterar senha;
- reiniciar equipamento;
- cancelar pedido;
- transferir atendimento;
- encerrar conversa;
- atualizar contato.

Sempre exige politica mais forte.

### High-risk

Pode causar impacto relevante ao cliente.

Exemplos:

- reiniciar roteador;
- cancelar assinatura;
- executar cobranca;
- mudar dados sensiveis;
- deletar recurso.

Exige confirmacao explicita e ledger forte.

## Anti-Alucinacao De Ferramenta

### O modelo nao pode inventar ferramenta

Se o LLM responder:

```json
{
  "tool": "reset_customer_router"
}
```

Mas a tool nao existe no catalogo ativo, o motor bloqueia.

### O modelo nao pode inventar permissao

Se a tool existe, mas nao esta vinculada ao fluxo/etapa, bloqueia.

### O modelo nao pode inventar dado

Se argumento nao veio de slot, contato, ferramenta anterior ou config, bloqueia.

### O modelo nao pode inventar sucesso

Se ferramenta falhou ou nao rodou, resposta dizendo "feito" vira reparo/fallback.

### O modelo nao pode pular etapa

Se procedimento exige coleta -> confirmacao -> execucao, ele nao pode ir direto para execucao.

## Auditoria Automatica De Fluxo

Antes de publicar um fluxo, rodar auditoria:

```json
{
  "flow_id": "flow-123",
  "status": "failed",
  "issues": [
    {
      "severity": "critical",
      "code": "high_risk_tool_without_confirmation",
      "node": "execute_reboot",
      "message": "Tool reboot_router exige etapa confirm antes da execucao."
    },
    {
      "severity": "warning",
      "code": "knowledge_node_disconnected",
      "node": "knowledge_plans",
      "message": "Base de conhecimento nao esta conectada ao agente principal nem a procedimento."
    }
  ]
}
```

Checks obrigatorios:

- todo bloco tem entrada e saida validas;
- todo procedimento tem estado final;
- toda ferramenta sensivel tem confirmacao;
- toda ferramenta tem slots obrigatorios mapeados;
- nenhum bloco de IA esta sem prompt/instrucao;
- prompts de blocos nao sao todos iguais;
- base de conhecimento esta conectada ao agente principal ou procedimento;
- nao ha ferramenta fora do escopo do fluxo;
- nao ha ciclo sem condicao de parada;
- sim de cliente nao executa acao fora de contexto;
- falha de ferramenta tem resposta segura;
- RAG sem cobertura nao vira resposta inventada.

## Simulacoes Antes De Publicar

Cada fluxo deve gerar casos de teste automaticos:

1. cliente direto;
2. cliente com dado parcial;
3. cliente responde apenas "sim";
4. cliente muda de assunto;
5. cliente pede humano;
6. ferramenta read-only falha;
7. ferramenta write falha;
8. cliente tenta pular confirmacao;
9. RAG sem documento suficiente;
10. pergunta generica fora do procedimento.

Exemplo:

```json
{
  "case": "cliente_responde_sim_ambiguo",
  "input": "Sim",
  "expected_decision": "wait_confirmation",
  "expected_no_tool": ["reboot_router"]
}
```

## Papel Do LLM

O LLM continua importante, mas no lugar certo.

Ele pode:

- interpretar linguagem natural;
- sugerir goal;
- extrair slots com baixa ambiguidade;
- escrever resposta humana;
- resumir resultado de ferramenta;
- reescrever procedimento para melhor clareza;
- ajudar a construir fluxo.

Ele nao pode sozinho:

- escolher ferramenta final;
- liberar ferramenta sensivel;
- criar argumento operacional;
- afirmar sucesso de tool;
- pular confirmacao;
- ignorar etapa ativa;
- transferir sem politica;
- encerrar sem pedido/contexto.

## Exemplo Completo: Trocar Nome E Senha Do Wi-Fi

Cliente:

```txt
Quero trocar o usuario e senha do Wi-Fi.
```

Decisao:

```json
{
  "decision": "ask_slot",
  "goal": "change_wifi_credentials",
  "procedureId": "change_wifi_credentials",
  "stepId": "collect_new_credentials",
  "requiredSlots": ["wifi_ssid", "wifi_password"],
  "blockedTools": [
    {
      "tool": "update_router_wifi_credentials",
      "reason": "missing_required_slots"
    }
  ],
  "responseInstruction": "Pedir novo nome da rede e nova senha."
}
```

Resposta:

```txt
Claro. Qual nome voce quer colocar na rede Wi-Fi e qual senha deseja usar?
```

Cliente:

```txt
Nome Casa Nova e senha teste12345
```

Decisao:

```json
{
  "decision": "wait_confirmation",
  "goal": "change_wifi_credentials",
  "stepId": "confirm_change",
  "requiredConfirmation": true,
  "responseInstruction": "Confirmar alteracao antes de executar."
}
```

Resposta:

```txt
So para confirmar: posso alterar sua rede Wi-Fi para "Casa Nova" usando a senha informada?
```

Cliente:

```txt
Sim, pode alterar.
```

Decisao:

```json
{
  "decision": "call_tool",
  "toolCall": {
    "toolName": "update_router_wifi_credentials",
    "arguments": {
      "contract_id": "{{slots.contract_id.value}}",
      "ssid": "Casa Nova",
      "password": "teste12345"
    }
  },
  "evidence": [
    "Goal change_wifi_credentials",
    "Procedimento na etapa execute_change",
    "Slots obrigatorios presentes",
    "Confirmacao explicita recebida",
    "Tool permitida nesta etapa"
  ]
}
```

## Exemplo Completo: Verificar Conexao

Cliente:

```txt
Minha internet esta ruim, consegue verificar?
```

Decisao:

```json
{
  "decision": "call_tool",
  "goal": "check_connection_status",
  "procedureId": "diagnose_connection",
  "stepId": "inspect_connection",
  "toolCall": {
    "toolName": "get_router_wifi_networks",
    "arguments": {
      "contract_id": "{{slots.contract_id.value}}"
    }
  },
  "evidence": [
    "Cliente pediu verificacao operacional",
    "Procedimento de diagnostico permite tool read-only",
    "Contrato identificado",
    "Tool nao altera estado"
  ]
}
```

Se contrato nao estiver identificado:

```json
{
  "decision": "ask_slot",
  "requiredSlots": ["customer_identifier"],
  "blockedTools": [
    {
      "tool": "get_router_wifi_networks",
      "reason": "missing_customer_identifier"
    }
  ]
}
```

## Modelo De Dados Inicial

### `agent_procedure_definitions`

- `id`
- `workspace_id`
- `agent_id`
- `name`
- `goal`
- `definition_json`
- `version`
- `status`
- `created_at`
- `updated_at`

### `agent_procedure_sessions`

- `id`
- `workspace_id`
- `chat_id`
- `agent_id`
- `procedure_id`
- `current_step_id`
- `slots_json`
- `confirmations_json`
- `tool_results_json`
- `status`
- `created_at`
- `updated_at`

### `agent_decision_ledger`

- `id`
- `workspace_id`
- `chat_id`
- `message_id`
- `procedure_session_id`
- `decision_type`
- `goal`
- `procedure_id`
- `step_id`
- `selected_tool`
- `blocked_tools_json`
- `evidence_json`
- `policy_result_json`
- `latency_ms`
- `outcome_json`
- `outcome_recorded_at`
- `created_at`

### `agent_causal_patterns`

Padroes detectados pelo CDM a partir da analise de decisoes + outcomes.

- `id`
- `workspace_id`
- `agent_id`
- `pattern_type` (ex: `unnecessary_confirmation`, `confusing_step`, `unnecessary_slot`, `score_drift`, `dead_end_step`)
- `procedure_id`
- `step_id`
- `tool_name`
- `insight` (descricao legivel do padrao)
- `evidence_json` (dados estatisticos que sustentam o padrao)
- `suggested_fix_json` (correcao sugerida: tipo, campo, valor anterior, valor novo)
- `impact_json` (conversas afetadas, turnos desperdicados, escalacoes causadas)
- `confidence`
- `scope` (`local` ou `ecosystem`)
- `vertical` (ex: `isp`, `clinic`, `ecommerce` — null se universal)
- `status` (`pending`, `approved`, `applied`, `dismissed`, `conflicted`)
- `created_at`
- `reviewed_at`
- `applied_at`

### `agent_score_history`

Historico de alteracoes nos pesos do Tool Selection Score.

- `id`
- `workspace_id`
- `agent_id`
- `weights_json` (snapshot dos pesos no momento da alteracao)
- `source` (`manual`, `auto_tune`, `suggestion`)
- `evidence_pattern_id` (referencia ao `agent_causal_patterns` que motivou a mudanca)
- `applied_at`

### `agent_ecosystem_patterns`

Padroes promovidos para o ecossistema apos validacao cross-workspace.

- `id`
- `pattern_type`
- `vertical`
- `insight`
- `evidence_json` (dados agregados de multiplos workspaces)
- `suggested_fix_json`
- `source_workspace_count` (quantos workspaces contribuiram)
- `confidence`
- `status` (`candidate`, `validated`, `active`, `deprecated`)
- `created_at`
- `validated_at`

### `resource_mapping_profiles`

- `id`
- `workspace_id`
- `resource`
- `field_aliases_json`
- `mapping_preferences_json`
- `created_at`
- `updated_at`

### `resource_mapping_ledger`

- `id`
- `workspace_id`
- `chat_id`
- `message_id`
- `procedure_session_id`
- `resource`
- `operation`
- `status`
- `confidence`
- `mapped_fields_json`
- `rejected_fields_json`
- `payload_hash`
- `policy_result_json`
- `created_at`

## Roadmap De Implementacao

### Fase 1: Decision Ledger

Registrar decisao atual do runtime mesmo antes do motor novo estar completo.

Entregas:

- tipo `DecisionLedgerEntry`;
- persistencia em banco;
- exibicao basica no painel de execucoes da IA;
- logs com goal, decision, tool, blocked tools e reason.

### Fase 2: Tool Capability Registry

Criar catalogo formal de ferramentas.

Entregas:

- `ToolCapability`;
- risk level;
- required slots;
- allowed goals;
- confirmation policy;
- schema de argumentos;
- policy gate central.

### Fase 3: Resource Mapper

Criar a camada universal que transforma slots em payloads validos para recursos internos e externos.

Entregas:

- `ResourceContract`;
- `ResourceField`;
- `ResourceMappingInput`;
- `ResourceMappingResult`;
- normalizadores por tipo;
- score de match de campo;
- payload builders por recurso;
- ledger de mapeamento;
- primeiro recurso completo: `crm.contact`;
- suporte a aliases por workspace.

### Fase 4: Procedure DSL

Transformar fluxo visual em procedimento executavel.

Entregas:

- `ProcedureDefinition`;
- `ProcedureStep`;
- estado persistente por chat;
- mapeamento de node visual para step.

### Fase 5: AgentDecisionEngine

Centralizar a decisao.

Entregas:

- `resolveGoal`;
- `matchProcedure`;
- `resolveCurrentStep`;
- `resolveResourceMappings`;
- `scoreToolCandidates`;
- `decideNextAction`;
- `writeDecisionLedger`.

### Fase 6: Auditoria Antes De Publicar

Auditar fluxo gerado por IA e fluxo editado manualmente.

Entregas:

- validacao de conexoes;
- validacao de prompts;
- validacao de tool bindings;
- validacao de resource mappings;
- validacao de knowledge bindings;
- validacao de confirmacao;
- simulacoes automaticas.

### Fase 7: Construtor IA 2.0

O construtor com IA deve gerar fluxo + procedimento + testes + auditoria.

Entregas:

- pipeline de tasks obrigatorias;
- selecao de ferramentas por capability;
- mapeamento de recursos por schema;
- prompts individuais por bloco;
- conhecimento conectado corretamente;
- simular antes de publicar.

### Fase 8: Causal Decision Memory — Outcome Tracking

Registrar o resultado de cada decisao para criar a base de dados que alimenta a auto-otimizacao.

Entregas:

- campo `outcome_json` no `agent_decision_ledger`;
- calculo automatico de outcome quando conversa encerra (close, handoff, timeout);
- heuristicas de outcome: `resolved`, `turns_to_resolve`, `customer_sentiment`, `escalation_needed`;
- `step_outcomes` por etapa do procedimento (turnos consumidos, confusao detectada);
- dashboard basico de outcomes por agente e por procedimento.

Nota: nao usa LLM. Sao heuristicas deterministicas sobre dados ja coletados.

### Fase 9: Causal Decision Memory — Pattern Detection

Analisar decisoes + outcomes para detectar padroes de falha e oportunidades de otimizacao.

Entregas:

- tabela `agent_causal_patterns`;
- job periodico (noturno ou configuravel) que roda analises;
- detectores de padroes:
  - `unnecessary_confirmation`: tool com 100% de confirmacao — confirmacao nao agrega valor;
  - `confusing_step`: etapa com turnos medios > 2 e alta taxa de confusao;
  - `unnecessary_slot`: slot que pode ser inferido automaticamente do canal ou contexto;
  - `dead_end_step`: etapa que causa escalacao ou abandono desproporcional;
  - `score_drift`: pesos do Tool Selection Score que causam fallbacks frequentes;
- UI no painel do agente mostrando patterns com botoes `Aplicar`, `Ignorar`, `Ver detalhes`;
- cada pattern inclui: insight legivel, evidencia estatistica, impacto estimado, correcao sugerida.

Nota: detectores sao queries SQL + logica de negocio. Nao usa LLM.

### Fase 10: Causal Decision Memory — Auto-Otimizacao

Fechar o ciclo: padroes detectados viram correcoes aplicadas.

Entregas:

Tres modos de operacao:

1. **Observe**: so registra e mostra insights. Nenhuma mudanca automatica.
2. **Suggest**: detecta e cria sugestoes para o usuario aprovar no painel.
3. **Auto-tune**: aplica automaticamente mudancas de risco zero (ex: remover confirmacao de tool read-only com 100% de aprovacao).

Tipos de correcao aplicavel:

- alterar `requires_confirmation` de uma tool (UPDATE na config);
- adicionar condicao de skip em step de procedimento (UPDATE no procedure graph JSON);
- reescrever prompt de etapa (UPDATE no texto da instrucao);
- ajustar pesos do Tool Selection Score (UPDATE na config de scoring);
- adicionar regex de intent (INSERT no pattern de intent);
- adicionar regra de auto-fill de slot por canal (INSERT na config de slots).

Todas as correcoes sao:

- mudancas de configuracao (banco de dados), nunca retreinamento de modelo;
- reversiveis a qualquer momento;
- versionadas (snapshot antes e depois);
- vinculadas ao pattern que as motivou.

Tabela `agent_score_history` registra evolucao dos pesos ao longo do tempo.

### Fase 11: Cross-Workspace Pattern Sharing

Permitir que padroes validados em um workspace beneficiem outros do mesmo vertical.

Entregas:

- tabela `agent_ecosystem_patterns`;
- classificacao de vertical por workspace (isp, clinic, ecommerce, etc.);
- regras de promocao de pattern local para ecossistema:
  - detectado em >= 3 workspaces do mesmo vertical;
  - confianca media >= 90%;
  - nenhum workspace com evidencia contraria forte;
  - amostra minima: 100+ conversas agregadas;
- deteccao de conflitos (workspaces onde o padrao inverso funciona);
- padroes do ecossistema aparecem como sugestoes nos workspaces que ainda nao aplicaram;
- novos workspaces recebem padroes do vertical como onboarding inteligente;
- soberania total do workspace: sugestoes sao ignoraveis, nunca forcadas;
- nenhum dado pessoal cruza workspaces — apenas padroes abstratos.

Regras de isolamento:

```txt
Hierarquia de prioridade:
  1. Configuracao manual do workspace (sempre ganha)
  2. Padroes locais do proprio workspace
  3. Padroes do ecossistema (so sugestao, nunca forcados)

Segmentacao:
  - Padroes de ISP so vao para ISPs
  - Padroes de clinica so vao para clinicas
  - Padroes universais (cross-vertical) exigem quorum mais alto

Conflitos:
  - Se workspace A diz "pular" e workspace B diz "nao pular",
    o padrao NAO sobe para ecossistema.
  - Ambos ficam como opcoes contextualizadas com dados locais.
```

## Criterio De Sucesso

O motor sera considerado maduro quando conseguirmos responder, para qualquer mensagem:

1. Qual objetivo o agente detectou?
2. Qual procedimento foi escolhido?
3. Qual etapa estava ativa?
4. Quais dados estavam presentes?
5. Quais dados faltavam?
6. Quais ferramentas eram candidatas?
7. Por que a ferramenta escolhida foi permitida?
8. Por que as outras foram bloqueadas?
9. Que confirmacao foi exigida?
10. Quais recursos foram mapeados?
11. Quais campos foram preenchidos e por que?
12. Qual payload foi validado antes da ferramenta?
13. O que garante que a resposta enviada avancou o atendimento?

Se nao conseguimos responder essas perguntas, ainda estamos em chatbot com ferramentas. Se conseguimos, temos um agente operacional auditavel.

O motor sera considerado **auto-evolutivo** quando tambem conseguirmos responder:

14. Qual foi o resultado concreto desta decisao? (resolveu? quantos turnos? escalou?)
15. Que padroes de falha foram detectados nos ultimos 30 dias?
16. Quais correcoes foram sugeridas e quantas foram aplicadas?
17. Como os indicadores (turnos por resolucao, taxa de escalacao, satisfacao) mudaram ao longo do tempo?
18. Que aprendizados deste workspace podem beneficiar outros do mesmo vertical?
19. O agente de hoje e melhor que o agente de 30 dias atras? Por quanto?

Se nao conseguimos responder essas perguntas, temos um agente auditavel mas estatico. Se conseguimos, temos um agente operacional auditavel **que melhora sozinho**.
