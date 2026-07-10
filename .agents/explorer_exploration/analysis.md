# Flow V2 Builder & Test Infrastructure Analysis Report

## 1. Executive Summary
This report analyzes the completeness validation, visual alert, and prompt compilation logic of the Flow V2 Builder and backend runtime, identifies key implementation gaps, and details a strategy for implementing Tiers 1-4 test suites using Vitest.

---

## 2. Codebase Investigation Findings

### 2.1 Frontend Completeness Validation Logic
**File Location**: `src/services/autopilot/flow-audit.ts`
- **Current State**:
  - The entrypoint is `auditAutopilotFlowGraph(graph)`.
  - It runs a set of validations: `auditSwitchNode` (checking for route count, fallbacks, route IDs, route labels, route descriptions, targetNodeId completeness, route signatures), `auditCollectNode` (checking for typed required fields/slots), `auditDisconnectedNodes` (disconnected blocks check), and `auditUnboundedCycles` (recursively detecting cycles lacking limits).
- **Missing Validations (Gaps)**:
  - **Start node validation**: There is no check to verify if the `start` (or legacy `trigger`) node is connected to anything (i.e. has at least one outgoing edge).
  - **Message node validation**: No check verifying if `node.config.message` is populated (i.e., non-empty, non-whitespace).
  - **Sub-Agent node validation**: No check verifying if `node.config.instructions` is populated.
  - **Handoff node validation**: No check verifying if `node.config.message` and `node.config.destination` are populated.

### 2.2 Visual Alerts Logic for Invalid Nodes
**File Location**: `src/components/autopilot/autopilot-flow-builder.tsx`
- **Current State**:
  - The component runs `auditAutopilotFlowGraph(currentFlowGraph)` and saves it in `publishAudit` state.
  - `publishAudit.status` determines if the "Publicar" (Publish) button is disabled (`hasPublishGateBlockers`).
  - Validation issues are rendered textually inside a collapsible `<PublishGatePanel>` at the bottom of the editor.
- **Visual Node Gaps**:
  - **No Node Highlights**: The nodes in the React Flow canvas do not render any error borders or warning alerts. Even though the audit results provide `nodeId` in the issues, the nodes list (`nodes` state) is not populated with these issue properties, meaning `AttendantNodeCard` does not know whether it contains errors.

### 2.3 Backend Prompt Compilation & Guidance
**File Locations**: `src/services/autopilot/runtime/process-chat.ts`, `src/services/autopilot/flow-routing.ts`, `src/ai/flows/auto-responder.ts`
- **Compilation Chain**:
  1. `process-chat.ts` receives messages and resolves the active flow state, active node, and active intent scope (`resolveActiveFlowIntentScopeByNodeId` or `resolveActiveFlowIntentScope`).
  2. It compiles a structured metadata string `intentContextForAI` containing slots, RAG status, intent confidence, current sub-agent (`flowSubAgent`), and appends formatted references (`flowReferencesForPrompt`), switch routes (`flowSwitchGuidanceForPrompt`), and form fields (`flowFormGuidanceForPrompt`).
  3. `intentContextForAI` is passed to the Genkit flow `generateAgentResponse` (or local LLM provider).
  4. In `auto-responder.ts`, Genkit prompt templates format the final prompt.
     - For standard requests (`promptConfig`), it appends `intentContext` under `**ROTEAMENTO DETERMINISTICO DO SERVIDOR**`.
     - Factual grounding guidelines, natural behavior rules (no user name spamming, emoji budget, no false system claims), and procedural mappings are hardcoded in the system instruction template.

---

## 3. Test Baseline & Current spec Files

### 3.1 Test Suite Baseline Results
Running the command `npx vitest run tests/` returns:
- **Total Test Files**: 146 passed / 1 failed
- **Total Tests**: 928 passed / 2 failed
- **Execution Time**: ~17.68 seconds
- **Failures Details** (in `tests/autopilot-causal-pattern-apply.spec.ts`):
  1. *reverts a drafted knowledge-only application back to the previous snapshot*:
     `AssertionError: expected { success: false, ... } to match object { success: true, ... }`
  2. *reverts switch graph patches plus their learning document*:
     `AssertionError: expected 'O rascunho mudou depois da aplicacao. Reversao bloqueada...' to be undefined`
  *Note: These baseline failures are in causal pattern updates, not visual flow audit or routing.*

### 3.2 Current Flow Specs Analysis
- `tests/autopilot-flow-audit.spec.ts` (8 tests):
  - Tests switch routing missing fallbacks, safe/unsafe tool paths confirmations, RAG gaps, typed required fields on V2 collect nodes, and cycles without limit.
- `tests/autopilot-flow-routing.spec.ts` (15 tests):
  - Tests deterministic messages resolution, AI-guided form formats, prompt references serialization, switch routing from message evidence, and legacy wrapper compatibility.

---

## 4. Implementation Recommendations for Tiers 1-4 Tests

We recommend implementing the tests and codebase extensions in the following manner:

### Tier 1 & 2: Audit Logic Extensions & Validation Tests
To implement Tier 1 & 2 tests (F1-T1-1 through F1-T1-5 and F1-T2-1 through F1-T2-5) from `TEST_INFRA.md`, the audit logic must first be expanded.

#### 1. Modify `src/services/autopilot/flow-audit.ts`
Add validations for the remaining Flow V2 node kinds:
```typescript
function auditStartNode(graph: AutopilotFlowGraph, node: AutopilotFlowNode, issues: AutopilotFlowAuditIssue[]) {
  const outgoing = graph.edges.filter(edge => edge.source === node.id);
  if (outgoing.length === 0) {
    issues.push({
      severity: 'critical',
      code: 'start_node_missing_outgoing',
      nodeId: node.id,
      message: `Bloco de Início "${node.title}" precisa de pelo menos uma conexão de saída.`
    });
  }
}

function auditMessageNode(node: AutopilotFlowNode, issues: AutopilotFlowAuditIssue[]) {
  const message = node.config?.message?.trim() || '';
  if (!message) {
    issues.push({
      severity: 'critical',
      code: 'message_node_empty_message',
      nodeId: node.id,
      message: `Bloco de Mensagem "${node.title}" possui mensagem vazia.`
    });
  }
}

function auditSubAgentNode(node: AutopilotFlowNode, issues: AutopilotFlowAuditIssue[]) {
  const instructions = node.config?.instructions?.trim() || '';
  if (!instructions) {
    issues.push({
      severity: 'critical',
      code: 'sub_agent_node_empty_instructions',
      nodeId: node.id,
      message: `Bloco de Sub-Agente "${node.title}" precisa de instruções de atendimento.`
    });
  }
}

function auditHandoffNode(node: AutopilotFlowNode, issues: AutopilotFlowAuditIssue[]) {
  const message = node.config?.message?.trim() || '';
  const destination = node.config?.destination?.trim() || '';
  if (!message || !destination) {
    issues.push({
      severity: 'critical',
      code: 'handoff_node_invalid_config',
      nodeId: node.id,
      message: `Bloco de Transbordo "${node.title}" precisa ter mensagem e destino definidos.`
    });
  }
}
```
Register these checks inside the node loop in `auditAutopilotFlowGraph(graph)`:
```typescript
  for (const node of normalizedGraph.nodes) {
    if (node.kind === 'switch' || node.kind === 'decision') {
      auditSwitchNode(normalizedGraph, node, nodeIds, issues);
    }
    if (node.kind === 'start') {
      auditStartNode(normalizedGraph, node, issues);
    }
    if (node.kind === 'message') {
      auditMessageNode(node, issues);
    }
    if (node.kind === 'sub_agent') {
      auditSubAgentNode(node, issues);
    }
    if (node.kind === 'handoff') {
      auditHandoffNode(node, issues);
    }
    auditCollectNode(node, issues);
  }
```

#### 2. Implement Visual Alert Mapping in `src/components/autopilot/autopilot-flow-builder.tsx`
Update the `nodes` React Flow state to include active audit issues, and style `AttendantNodeCard` accordingly:
- **Map issues to node data**:
  ```typescript
  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const nodeIssues = publishAudit.issues.filter((issue) => issue.nodeId === node.id);
        return {
          ...node,
          data: {
            ...node.data,
            issues: nodeIssues,
          },
        };
      })
    );
  }, [publishAudit, setNodes]);
  ```
- **AttendantNodeCard CSS highlight**:
  ```typescript
  const hasCriticalIssue = data.issues?.some((i) => i.severity === 'critical');
  const hasWarningIssue = data.issues?.some((i) => i.severity === 'warning');
  
  // Append error classes to card wrapper:
  hasCriticalIssue && 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.2)] bg-red-950/20'
  hasWarningIssue && !hasCriticalIssue && 'border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
  ```
- **Visual Alert badge on card**:
  ```typescript
  {hasCriticalIssue && (
    <span className="absolute -top-2.5 -left-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white shadow" title={data.issues?.find(i => i.severity === 'critical')?.message}>
      <XCircle className="h-3.5 w-3.5" />
    </span>
  )}
  ```

#### 3. Update unit tests in `tests/autopilot-flow-audit.spec.ts`
Write the validation unit tests for Tier 1 & Tier 2:
- F1-T1-1 to F1-T1-5: Validate start node edges, message node empty texts, sub-agent empty instructions, handoff missing fields, and valid graphs.
- F1-T2-1 to F1-T2-5: Test boundary values (whitespace-only checks), large text values, multi-error aggregation, non-crashing behavior on missing nested config fields, and cycles mixed with empty fields.

---

### Tier 3: Prompt Compilation & Behavior Tests
Write a new unit test suite: `tests/autopilot-prompt-compilation.spec.ts`.

#### Test Cases Structure
- **F3-T1-1**: Verify `migrateNodeToV2` formats sub-agents default instructions with standard layout markdown headers (`### Contexto`, `### Diretrizes`).
- **F3-T1-2**: Mock intent classification results and check if `flowSubAgent` gets injected into the compiled `intentContextForAI`.
- **F3-T1-3**: Mock `generateAgentResponse` calls and check system instruction templates for natural behavior parameters (limit name repetition, emoji limit).
- **F3-T1-4**: Verify prompts prevent hallucinating facts when tools are unavailable or base documents lack coverage.
- **F3-T1-5**: Assert node-level custom instructions combine correctly with global policies.
- **F3-T2-1**: Verify compilation safety and structure with extremely long flow titles.
- **F3-T2-2**: Verify prompt behavior handles empty active flow/intent scopes safely without crashing.
- **F3-T2-3**: Test interpolation escaping for titles/instructions containing unsafe regex/weird characters.
- **F3-T2-4**: Check compiler behavior with empty optional parameters.
- **F3-T2-5**: Test that consecutive user prompts do not prune or corrupt system instructions.

---

### Tier 4: Real-World Application Scenarios (Integration)
Write a new integration test suite: `tests/autopilot-e2e-scenarios.spec.ts`.

#### Scenario 1: Full Agent Publishing Lifecycle
- **Steps**:
  1. Build a mock `AutopilotFlowGraph` with a Start Node, Switch Node, Sub-Agent Node, and Handoff Node.
  2. Run `auditAutopilotFlowGraph` and verify it passes.
  3. Map the graph to React Flow nodes and assert error/warning flags are absent.
  4. Build active intent scope and run prompt compilation.
  5. Call `generateAgentResponse` (mocking the LLM client) and assert natural responses are generated.
  6. Trigger a transition that concludes in a handoff and verify the handoff payload.

#### Scenario 2: Invalid Draft to Clean Publish
- **Steps**:
  1. Build an invalid `AutopilotFlowGraph` (e.g. empty sub-agent instruction).
  2. Run `auditAutopilotFlowGraph` and verify it fails with the specific issue code.
  3. Assert node states map the error issues.
  4. Programmatically correct the invalid node's instruction field in the config.
  5. Run `auditAutopilotFlowGraph` again and verify status changes to `passed`.
  6. Verify the publish blocker is successfully removed.
