# Nexus como módulo nativo da Dialogy

## Decisão

O Nexus não é mais tratado como produto externo, iframe ou integração. Ele é o módulo de autoria visual da Dialogy e vive em `src/modules/nexus`.

As superfícies têm responsabilidades distintas:

- `/nexus`: catálogo unificado de fluxos independentes e agentes.
- `/nexus/flows/[id]`: autoria de processos determinísticos, híbridos ou com IA opcional.
- `/nexus/[id]`: autoria visual de uma automação orientada a agente.
- `/autopilot`: identidade, políticas, conhecimento, ferramentas, observabilidade e operação dos agentes autônomos.

Fluxos comuns são persistidos em `nexus_workflows` e não criam um registro em `autopilot_configs`. Agentes continuam usando a configuração do Autopilot. Os dois publicam definições no mesmo Workflow Runtime V2, sem duplicar o executor.

## Estrutura

```text
src/modules/nexus/
  components/
    nexus-catalog.tsx
    nexus-flow-editor.tsx
    standalone-flow-editor.tsx
    legacy-nexus-import-dialog.tsx
  actions/
    workflows.ts
  services/
    legacy-import.ts
    standalone-workflows.ts
  index.ts

src/app/nexus/page.tsx       -> NexusCatalog
src/app/nexus/[id]/page.tsx  -> NexusFlowEditor
src/app/nexus/flows/[id]/page.tsx -> StandaloneNexusFlowEditor
```

As páginas do App Router são entradas finas. Elas não importam páginas do Autopilot e nenhum componente decide sua superfície por `pathname`.

## Blocos e execução

O canvas de um fluxo independente expõe os blocos operacionais estáveis do runtime: gatilhos de mensagem, webhook, evento interno, agendamento e execução manual; definição, transformação, extração e template de dados; IF, switch, merge, loop, paralelo e espera; resposta, transferência, fechamento, finalização e tratamento de erro.

Blocos de IA podem ser adicionados a esses fluxos, mas não são requisito. Os templates `blank`, `webhook` e `schedule` não contêm agentes.

## IA

O Flowbuilder usa exclusivamente os recursos nativos da Dialogy:

- catálogo de modelos configurados no workspace;
- adapters e credenciais de execução da Dialogy;
- memória de sessão do Workflow Runtime V2;
- RAG e coleções de conhecimento quando houver um agente;
- catálogo de ferramentas internas e MCP;
- guardrails, validação, sandbox e persistência do Runtime V2;
- publicação versionada em `workflow_definitions`.

Nenhuma chave, connection string, memória ou executor de IA do NexusFlow antigo é usado no caminho ativo.

## Importação de fluxos antigos

O editor aceita a exportação JSON antiga diretamente no navegador. O conversor:

1. valida o envelope legado;
2. converte blocos determinísticos para manifests do Workflow Runtime V2;
3. reconstrói agentes, prompts e roteadores sobre a IA da Dialogy;
4. descarta campos de segredo conhecidos;
5. cria placeholders explícitos para blocos sem equivalente seguro;
6. apresenta relatório e validação antes de aplicar ao rascunho.

O JSON original não é persistido. Somente a definição nativa sanitizada entra no rascunho.

## Componentes aposentados

Foram retirados do caminho ativo:

- `NexusEmbed` e o iframe;
- ações de provisionamento e SSO do Nexus externo;
- configuração de conta Nexus no workspace;
- variáveis `NEXUS_URL`, `NEXT_PUBLIC_NEXUS_URL` e `NEXUS_WORKSPACE_EMAIL_DOMAIN`;
- o card de NexusFlow no catálogo de integrações.

`/integrations/nexusflow` permanece apenas como redirecionamento compatível para `/nexus`. A coluna histórica `workspaces.nexus_settings` pode ser removida em migração de banco posterior, depois de confirmado que não há consumidores em versões antigas; ela não é mais lida nem gravada pela aplicação.

## Invariantes protegidas por testes

- rotas Nexus importam somente `src/modules/nexus`;
- fluxos independentes não escrevem em `autopilot_configs`;
- templates determinísticos são válidos e não contêm `ai.agent`;
- Autopilot não monta `NativeWorkflowBuilder` nem `NativeAiBuilderDialog`;
- rotas ativas não dependem de iframe ou SSO externo;
- segredos antigos não sobrevivem à conversão;
- blocos de IA importados usam o modelo fornecido pela Dialogy;
- blocos determinísticos preservam sua semântica quando há equivalente nativo.
