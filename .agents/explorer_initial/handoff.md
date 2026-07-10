# Handoff Report: Autopilot Flow-Builder & Backend Prompt Engine Investigation

## 1. Observation

### A. Frontend Publish Gate & Blocking Logic
In `src/components/autopilot/autopilot-flow-builder.tsx`, the visual builder blocks publishing via the `hasPublishGateBlockers` boolean, which disables the Publish button in the footer:
- **Line 2306-2307**:
  ```typescript
  const hasPublishGateBlockers = publishAudit.status === 'failed'
    || isAutopilotToolCoveragePublishBlocked(toolCoverage);
  ```
- **Line 3187-3189**:
  ```typescript
  disabled={isPublishing || hasVariableConflicts || hasReferenceConflicts || hasPublishGateBlockers || (!hasDraft && !isDirty)}
  onClick={onPublish}
  title={hasPublishGateBlockers ? 'Resolva o gate de publicacao antes de publicar' : 'Publicar rascunho'}
  ```
The `publishAudit` state is evaluated asynchronously with a 500ms debounce on every change to `currentFlowGraph` (Lines 2300-2305):
  ```typescript
  useEffect(() => {
    const timer = setTimeout(() => {
      setPublishAudit(auditAutopilotFlowGraph(currentFlowGraph));
    }, 500);
    return () => clearTimeout(timer);
  }, [currentFlowGraph]);
  ```

### B. Custom Node Card Rendering
In `src/components/autopilot/autopilot-flow-builder.tsx`, the nodes are rendered in React Flow using custom `nodeTypes` mapped to `AttendantNodeCard` (Lines 367, 2989-2992):
  ```typescript
  const nodeTypes = { attendant: AttendantNodeCard };
  ```
The custom component `AttendantNodeCard` (Lines 277-365) receives only `id`, `data`, and `selected` from React Flow:
  ```typescript
  function AttendantNodeCard({ id, data, selected }: NodeProps<AttendantNode>) {
  ```
It currently renders risk badges (`high` risk) and operational status, but has no styling or warning badge for validation issues/errors.

### C. Node Audit & Simulation Rules
In `src/services/autopilot/flow-audit.ts`, the shared library audits the flow graph structure and runs mock simulations:
- Node field validations are restricted to `collect` (required slots or formFields must be configured, required fields must have `type`) and `switch` (at least 2 routes, fallback presence, route validity).
- Dead ends/unconnected nodes are checked in `auditDisconnectedNodes`, but `start` nodes are ignored:
  ```typescript
  if (!hasIncoming && !hasOutgoing && node.kind !== 'start' && node.kind !== 'trigger')
  ```
- Unbounded cycles are validated in `auditUnboundedCycles`.
- Simulations like `rag_no_coverage_guard`, `tool_failure_recovery`, `topic_shift_guard`, etc., fail if nodes do not follow safety constraints.

### D. System Prompt Compilation
In `src/services/autopilot/runtime/process-chat.ts`, the server compiles the prompt context for the LLM when executing a turn:
- **Active scope**: It resolves the current specialized node scope using `resolveActiveFlowIntentScope` or `resolveActiveFlowIntentScopeByNodeId` (defined in `src/services/autopilot/flow-routing.ts`).
- **Context assembly** (Lines 2256-2283):
  ```typescript
  const intentContextForAI = [
      `intent=${intentResolution.intent}`,
      ...
      `flowSubAgent=${activeFlowIntentScope?.title || 'main_agent'}`,
      ...
      flowReferencesForPrompt,
      flowSwitchGuidanceForPrompt,
      flowFormGuidanceForPrompt,
  ].join('\n');
  ```
- **Prompt call**: It calls `generateAgentResponse` (from `src/ai/flows/auto-responder.ts`), passing `intentContext` and `knowledgeBase` (scoped via `buildIntentScopedKnowledgeBase`).
- **Prompt template**: In `src/ai/flows/auto-responder.ts`, the system prompt is assembled using `promptConfig.prompt`, placing the persona instruction (`knowledgeBase`) and server routing (`intentContext`) into structured slots alongside RAG documents, procedures, and global guidelines.

### E. Node Migration & Defaults
In `src/services/autopilot/flow-v2.ts`, default values and instructions are generated when legacy nodes are migrated or default-configured:
- For `sub_agent` (Lines 100-110):
  ```typescript
  config.instructions = config.instructions || [
    node.title,
    node.subtitle,
    'Atue como sub-agente V2 desta etapa, usando apenas slots confirmados, ferramentas executadas e knowledge recuperado.',
  ].filter(Boolean).join('\n');
  config.message = config.message || 'Componha a resposta desta etapa seguindo o contexto permitido.';
  ```

### F. Existing Test Suites
- `tests/autopilot-flow-routing.spec.ts` verifies deterministic flow message resolutions, switch routing, near switch lookup, and legacy wrappers.
- `tests/autopilot-flow-state.spec.ts` verifies confirmation state persistence, fingerprints, and cancellation.
- `tests/autopilot-flow-audit.spec.ts` verifies critical switch/collect failures and mock simulations (RAG gaps, tool confirmation/recovery).

---

## 2. Logic Chain

### A. Blocking Publishing of Empty/Corrupted Crucial Fields
1. **Define Node-Level Validation Errors**: The current `flow-audit.ts` does not check if crucial text fields like `config.message` (in `message`, `handoff`, `end`, `collect`) or `config.instructions` (in `sub_agent`, `decision`, `tool`) are empty/whitespace, nor does it verify if the `start` node actually connects to any next node.
2. **Propagate Issues to Publish Blockers**: `auditAutopilotFlowGraph` returns `status: 'failed'` if there are any issues with `severity: 'critical'`. This directly sets `hasPublishGateBlockers = true`, which disables the frontend footer's Publish button.
3. **Conclusion**: Adding checks for empty crucial fields in `flow-audit.ts` with `severity: 'critical'` will seamlessly block publishing.

### B. Displaying Visual Alerts on Nodes
1. **Incorporate Issues into Node State**: React Flow receives a flat array of nodes. We can map `nodes` in `autopilot-flow-builder.tsx` before passing them to `<ReactFlow>` and inject their node-specific issues from `publishAudit.issues` directly into `node.data.issues`.
2. **Access and Style in Card Component**: `AttendantNodeCard` reads `data.issues` and checks if there are any critical errors or warnings. It can then conditionally render a badge (e.g. using Lucide's `AlertTriangle` or `XCircle`) and override borders/glow styles (e.g. adding a red border and shadow).
3. **Conclusion**: Mapping issues to the React Flow node data enables real-time visual styling and alerts per node.

---

## 3. Caveats
- Node validation is debounced by 500ms; there might be a minor delay between editing a field and the alert appearing/disappearing.
- We assume that "Save" should NOT be blocked by validation issues (only "Publish" is blocked), allowing users to save work-in-progress drafts.

---

## 4. Conclusion

### Frontend Validation & Alert Strategy
1. **Backend Auditing (`flow-audit.ts`)**:
   - Add checks inside `auditAutopilotFlowGraph`:
     - **Start node**: Ensure it has at least one outgoing edge.
     - **Message / Collect / Handoff / End**: Verify `config.message` is not empty.
     - **Sub-Agent / Decision / Tool**: Verify `config.instructions` is not empty.
     - **Handoff**: Verify `config.destination` is not empty.
   - Use new issue codes: `start_missing_outgoing_edge`, `node_missing_required_message`, `node_missing_required_instructions`, `handoff_missing_destination`.
2. **React Flow Node Enrichment**:
   - Map `nodes` state in `src/components/autopilot/autopilot-flow-builder.tsx` to add `issues`:
     ```typescript
     const nodesWithIssues = useMemo(() => {
       return nodes.map(node => ({
         ...node,
         data: {
           ...node.data,
           issues: publishAudit.issues.filter(issue => issue.nodeId === node.id)
         }
       }));
     }, [nodes, publishAudit.issues]);
     ```
   - Provide `nodesWithIssues` to `<ReactFlow nodes={nodesWithIssues} ... />`.
3. **Card Alerts (`AttendantNodeCard`)**:
   - Add warning/error indicators in `AttendantNodeCard` based on `data.issues` (color-coded borders, Lucide alert icons in the top-right corner, and tooltips detailing the problems).

### Backend Prompt Engine Strategy
- The current implementation is highly modular: `process-chat.ts` resolves the intent scope, compiles the `intentContext`, and passes it to the Genkit-run `autoResponderFlow` in `auto-responder.ts`.
- **Global Guidelines**: Keep them in `promptConfig.prompt` inside `auto-responder.ts` to ensure safety constraints apply universally.
- **Node Defaults**: Maintain the V2 default structures inside `flow-v2.ts` to guarantee that new/migrated nodes have safe default instructions.

---

## 5. Verification Method

### Test Layout & Key Edge Cases
Run the Vitest tests:
```powershell
npx vitest run tests/autopilot-flow-audit.spec.ts
```

#### New Test Cases to Add:
1. **Dead-End Start Node**: Verify a graph with a `start` node and no outgoing edges results in `status: 'failed'` and issue `start_missing_outgoing_edge`.
2. **Empty Message Node**: Verify a `message` node with an empty string in `config.message` results in `status: 'failed'` and issue `node_missing_required_message`.
3. **Empty Sub-Agent Instructions**: Verify a `sub_agent` node with empty `config.instructions` results in `status: 'failed'` and issue `node_missing_required_instructions`.
4. **Empty Handoff Destination**: Verify a `handoff` node with empty `config.destination` results in `status: 'failed'` and issue `handoff_missing_destination`.
5. **Successful Audit**: Verify a valid flow graph containing all required fields passes without errors.
