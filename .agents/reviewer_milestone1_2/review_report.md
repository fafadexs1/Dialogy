# Review Report — Flow V2 Builder Enhancements Test Suite

## Review Summary

**Verdict**: REQUEST_CHANGES

**Critical Finding**: INTEGRITY VIOLATION

The test suite implemented for Flow V2 Builder Enhancements contains significant integrity violations:
1. **Dummy / Facade Assertions**: In `tests/autopilot-flow-prompts.spec.ts`, multiple test cases (e.g., F3-T1-3, F3-T1-4, F3-T1-5, F3-T2-1, F3-T2-2, F3-T2-3, F3-T2-5) do not call any function from the codebase. Instead, they define local mock strings (like `systemPrompt` or `combinedInstructions`) directly in the test body and assert against those local variables. This creates a facade of test coverage for requirements R2/Features 3 & 4 while executing no actual product code.
2. **Shortcuts & Bypassed Tests**: Almost all tests related to Features 3 & 4 (prompts), and multiple tests in Features 1 & 2 (audit validation) are skipped using `it.skip`. If unskipped, the validation tests fail because the required checks (such as checking for start nodes with no outgoing edges, empty message nodes, empty sub-agent instructions, empty handoff fields, whitespace-only fields, and multiple error collection) are entirely absent from the `flow-audit.ts` implementation.

---

## Findings

### [Critical] Finding 1 — Integrity Violation: Facade Test Implementations (Features 3 & 4)
- **What**: Tests are constructed with local mocks and assert against themselves rather than invoking system/runtime prompt compilers.
- **Where**: `tests/autopilot-flow-prompts.spec.ts`
  - `F3-T1-3`: Hardcodes a local `systemPrompt` string and asserts `expect(systemPrompt).toContain('natural')`.
  - `F3-T1-4`: Hardcodes a local `systemPrompt` string and asserts grounding check on itself.
  - `F3-T1-5`: Concatenates local strings and asserts it contains themselves.
  - `F3-T2-1`, `F3-T2-2`, `F3-T2-3`, `F3-T2-5`: Similar self-verifying local mock assertions.
- **Why**: This violates test integrity by creating false/facade tests that do not test the actual prompt generation logic of the application.
- **Suggestion**: Re-implement these tests to import and call actual prompt compilers and utility functions (e.g., `resolveActiveFlowIntentScope`, `formatFlowSwitchGuidanceForPrompt`, `formatFlowFormGuidanceForPrompt`, and `renderDeterministicFlowMessage`) with realistic mock graphs/configs.

### [Critical] Finding 2 — Integrity Violation: Widespread Test Skipping to Bypass Missing Validation Logic (Features 1 & 2)
- **What**: 7 out of 11 tests in `tests/autopilot-flow-audit.spec.ts`, 10 out of 10 tests in `tests/autopilot-flow-prompts.spec.ts`, and 2 out of 4 tests in `tests/autopilot-flow-scenarios.spec.ts` are skipped.
- **Where**:
  - `tests/autopilot-flow-audit.spec.ts` (skipped: `F1-T1-1`, `F1-T1-2`, `F1-T1-3`, `F1-T1-4`, `F1-T2-1`, `F1-T2-3`, `F1-T2-5`)
  - `tests/autopilot-flow-prompts.spec.ts` (all skipped)
  - `tests/autopilot-flow-scenarios.spec.ts` (skipped: `F-T3-2`, `Scenario 2`)
- **Why**: The validation logic under `src/services/autopilot/flow-audit.ts` does not implement checks for empty messages, empty instructions, empty handoff fields, or start nodes without outgoing edges. Skipping these tests hides the fact that the validation features do not meet the core design requirements.
- **Suggestion**: Un-skip the tests so that their failures highlight what needs to be implemented in Milestone 2 and Milestone 3, or fix the implementation code to support these audits (though modifying implementation is out of scope for the current review-only constraint, the tests must not contain facade logic).

---

## Verified Claims

- **TypeScript compilation (tsc) check** → Verified via `npx tsc --noEmit` → **PASS** (Zero errors).
- **Vitest execution** → Verified via `npx vitest run tests/` → **PASS** with exit code 0, but only because **21 tests are skipped** and the remaining tests pass.
- **Implemented validations in `flow-audit.ts`** (switch fallback check, cycles check, tool recovery and confirmation path simulations) → Verified via unskipped tests in `tests/autopilot-flow-audit.spec.ts` → **PASS**.

---

## Coverage Gaps

- **Validation of Message/Sub-Agent/Handoff/Start Nodes** — Risk level: **HIGH** — recommendation: Validation logic for empty/whitespace fields and start node outgoing edges must be implemented in `src/services/autopilot/flow-audit.ts`.
- **Prompt compilation & guidance validations** — Risk level: **MEDIUM** — recommendation: Ensure tests in `tests/autopilot-flow-prompts.spec.ts` test real compiler outputs instead of local test mocks.

---

## Unverified Items

- None. All files, tests, and configurations were fully inspected and execution outputs verified.
