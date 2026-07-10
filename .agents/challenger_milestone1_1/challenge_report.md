# Challenge Report — Flow V2 Builder Enhancements

## Challenge Summary

**Overall risk assessment**: HIGH

Empirical testing confirmed that the Vitest test suite runs successfully with exit code 0, executing 933 passing tests (with 21 skipped tests across the entire workspace). The loop-testing check (5 iterations of the new spec files) showed no race conditions, flaky behavior, or hanging promises in the active tests.

However, the adversarial review identified critical design flaws, tautological assertions, and architecture conflicts that could mask bugs and cause future test suites to break once the features are implemented in Milestones 2 and 3.

---

## Challenges

### [High] Challenge 1: Mock/Tautological Assertions in Prompt Spec
- **Assumption challenged**: That the prompt generation tests actually verify the behavior of the application's runtime compilation services.
- **Attack scenario**: A developer breaks the prompt compiler or changes system guidelines in `process-chat.ts` or `flow-v2.ts`. The prompt test suite (`tests/autopilot-flow-prompts.spec.ts`) is unskipped.
- **Blast radius**: The tests pass successfully because they do not call the actual services. Instead, they define mock strings locally inside the test body and assert against them.
- **Evidence**:
  In `tests/autopilot-flow-prompts.spec.ts` (lines 87-97):
  ```typescript
  it.skip('F3-T1-3: Runtime process-chat prompt injection incorporates natural behavior guidance', () => {
    const systemPrompt = `
      [SYSTEM GUIDE]
      - Conduza a conversa de forma natural.
      - Não repita perguntas já respondidas.
      - Trate dúvidas sem desviar do objetivo.
    `;
    expect(systemPrompt).toContain('natural');
    expect(systemPrompt).toContain('sem desviar');
  });
  ```
  Similar local string mocks are used in `F3-T1-2`, `F3-T1-4`, `F3-T1-5`, `F3-T2-1`, `F3-T2-2`, `F3-T2-3`, and `F3-T2-5`.
- **Mitigation**: Once implemented, rewrite these tests to import and invoke `processChat` or the prompt building functions, passing mock graphs/states and inspecting the actual returned prompts.

### [High] Challenge 2: V2 Migration Defaults Masking Validation Failures
- **Assumption challenged**: That validation checks for empty/whitespace fields on message, sub_agent, knowledge, and handoff nodes will work on the audit graph.
- **Attack scenario**: A user publishes a flow graph with empty sub_agent instructions or empty message nodes. The validator is expected to block publishing and return a validation error.
- **Blast radius**: The validator silently succeeds and publishing is allowed. This happens because `auditAutopilotFlowGraph` calls `migrateAutopilotFlowGraphToV2` at the very beginning. The migration automatically populates empty/whitespace strings with default fallback values (e.g., node titles or generic instructions).
- **Evidence**:
  In `src/services/autopilot/flow-v2.ts` (lines 100-110):
  ```typescript
  if (kind === 'sub_agent') {
    config.instructions = config.instructions || [
      node.title,
      node.subtitle,
      'Atue como sub-agente V2 desta etapa...',
    ].filter(Boolean).join('\n');
  }
  ```
  Since the audit operates on the migrated graph, any field that was empty is already populated by the migration, bypassing any checks for empty inputs.
- **Mitigation**: The audit should run validation checks on the raw/unmigrated graph first, or the migration logic should be adjusted not to overwrite explicit empty/whitespace fields when validation is intended.

### [Medium] Challenge 3: Active Test F1-T2-4 Conflicting with Planned Validations
- **Assumption challenged**: That a message node missing its `config` block is a valid node and should pass the audit.
- **Attack scenario**: Future implementation adds empty message validation.
- **Blast radius**: Active test `F1-T2-4` will fail because it asserts `expect(audit.status).toBe('passed')` for a graph with a message node that lacks a config block.
- **Evidence**:
  In `tests/autopilot-flow-audit.spec.ts` (lines 724-727):
  ```typescript
  expect(() => auditAutopilotFlowGraph(graph)).not.toThrow();
  const audit = auditAutopilotFlowGraph(graph);
  expect(audit.status).toBe('passed');
  ```
- **Mitigation**: Refactor `F1-T2-4` to assert only that the audit does not crash (`not.toThrow()`), but do not assert that it passes validation.

### [Medium] Challenge 4: Missing Audit Validations (Coverage Gaps)
- **Assumption challenged**: That all invalid configurations are checked during audit.
- **Attack scenario**:
  1. A user configures a `knowledge` node without any selected knowledge documents or collections.
  2. A user attaches outgoing edges to a terminal `handoff` node.
  3. A user creates multiple `start` or `trigger` nodes.
- **Blast radius**: The audit passes successfully, allowing deployment of non-functional knowledge blocks, dead-end paths, or ambiguous start entry points.
- **Mitigation**: Add the following validations to `flow-audit.ts`:
  - `knowledge_node_missing_sources`: Fail if a knowledge node has empty collections and empty documents.
  - `handoff_node_has_outgoing_edges`: Warning/error if a handoff node has outgoing connections.
  - `multiple_start_nodes`: Fail if there is more than one `start` or `trigger` node in the graph.

---

## Stress Test Results

- **Run complete test suite** → Executed 954 tests → 933 passed, 21 skipped (1 skipped file, 20 skipped individual tests) → **PASS**
- **Verify execution stability (5x loop check)** → No timeouts, race conditions, or failures → **PASS**
- **Inspect empty assertions** → Identified 8 skipped tests containing tautological assertions on local mock strings → **FAIL**

---

## Unchallenged Areas

- **Frontend Component Rendering & Visual Alert tooltips**: The React component visual rendering and CSS styling (`autopilot-flow-builder.tsx`) was not stress-tested because rendering tests are out of scope for the node environment unit tests.
