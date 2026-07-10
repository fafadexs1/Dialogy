# Explorer Exploration Handoff Report

## 1. Observation
- **Frontend Validation Gaps**: In `src/services/autopilot/flow-audit.ts`, the validation loop in `auditAutopilotFlowGraph` only calls validations for switch/decision nodes, collect nodes, disconnected nodes, and cycles:
  ```typescript
  930:   for (const node of normalizedGraph.nodes) {
  931:     if (node.kind === 'switch' || node.kind === 'decision') {
  932:       auditSwitchNode(normalizedGraph, node, nodeIds, issues);
  933:     }
  934:     auditCollectNode(node, issues);
  935:   }
  936:   auditDisconnectedNodes(normalizedGraph, issues);
  937:   repairToolNodeCycleBounds(normalizedGraph);
  938:   auditUnboundedCycles(normalizedGraph, issues);
  ```
  It does not validate Start, Message, Sub-Agent, or Handoff nodes.
- **Visual Alert Gaps**: In `src/components/autopilot/autopilot-flow-builder.tsx`, the nodes state is initialized without audit issue awareness:
  ```typescript
  2267:   const [nodes, setNodes, onNodesChange] = useNodesState<AttendantNode>(initialGraph.nodes);
  ```
  `publishAudit` is stored as local state (Line 2299), but it is never mapped back to decorate the `nodes` elements. Inside `AttendantNodeCard` (Line 277), it only has access to `id, data, selected` and cannot style borders or render error flags based on the audit results.
- **Backend Prompt Generation**: In `src/services/autopilot/runtime/process-chat.ts`, `intentContextForAI` compiles active node data, flow sub-agent scopes, and prompt guidelines:
  ```typescript
  2256:     const intentContextForAI = [
  2257:         `intent=${intentResolution.intent}`,
  2273:         `flowSubAgent=${activeFlowIntentScope?.title || 'main_agent'}`,
  2280:         flowReferencesForPrompt,
  2281:         flowSwitchGuidanceForPrompt,
  2282:         flowFormGuidanceForPrompt,
  2283:     ].join('\n');
  ```
  This is processed in `src/ai/flows/auto-responder.ts` within the Handlebars template:
  ```handlebars
  440: {{#if intentContext}}
  441: {{{intentContext}}}
  ```
- **Test Baseline**: Running the test suite command `npx vitest run tests/` returned 928 passed and 2 failed out of 930 total tests. The failures occurred in `tests/autopilot-causal-pattern-apply.spec.ts`:
  ```
  AssertionError: expected { success: false, …(2) } to match object { success: true, …(1) }
  AssertionError: expected 'O rascunho mudou depois da aplicacao.…' to be undefined
  ```

## 2. Logic Chain
1. Since `flow-audit.ts` only executes validation for decision, collect, disconnected, and cycle rules (Observation 1), any start node without outgoing edges, message nodes with empty strings, or unconfigured sub-agent instructions will pass validation silently, causing runtime issues.
2. Because the `publishAudit` issues are never mapped onto React Flow's `nodes` state or passed to `AttendantNodeCard` (Observation 2), the editor cannot display node-level warnings or red error highlights directly on the canvas.
3. Therefore, implementing F1-T1-1 through F1-T1-5 and F1-T2-1 through F1-T2-5 requires:
   - Defining validation helper functions for Start, Message, Sub-Agent, and Handoff nodes in `flow-audit.ts`.
   - Modifying the builder's state to map issues onto React Flow nodes, updating `AttendantNodeCard` to highlight these nodes.
   - Expanding `tests/autopilot-flow-audit.spec.ts` to cover these new checks and edge cases.
4. Implementing prompt behavior tests (Tier 3) requires verifying how `intentContextForAI` compiles sub-agent scopes, natural behavior guidelines, and RAG boundaries (Observation 3), which can be implemented in a new spec file `tests/autopilot-prompt-compilation.spec.ts`.
5. Tier 4 scenarios can be executed as modular Vitest integration tests in `tests/autopilot-e2e-scenarios.spec.ts` using mock configurations and state checks.

## 3. Caveats
- Playwright is present in `package.json` but has no root config file or existing spec files in the codebase (Vitest is the sole established E2E/integration runner). Therefore, Tier 4 scenarios should be implemented using Vitest integration tests rather than browser-driven E2E tests.

## 4. Conclusion
The validation and visual alerts framework is functional but lacks support for basic node types (Start, Message, Sub-Agent, Handoff) and direct canvas alerts. By extending `flow-audit.ts`, mapping issues to node components in `autopilot-flow-builder.tsx`, and adding three targeted test specs in `tests/`, we can fully implement all Tiers 1-4 validation and prompt compilation requirements.

## 5. Verification Method
1. Run the existing test suite:
   ```bash
   npx vitest run tests/
   ```
2. Verify implementation:
   - Check `tests/autopilot-flow-audit.spec.ts` for Tier 1 & 2 validation test cases.
   - Inspect `tests/autopilot-prompt-compilation.spec.ts` for Tier 3 prompt compilation tests.
   - Inspect `tests/autopilot-e2e-scenarios.spec.ts` for Tier 4 scenarios.
