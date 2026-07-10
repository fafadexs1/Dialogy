## 2026-07-08T13:59:19Z

You are a Worker Agent. Your working directory is c:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy\.agents\worker_e2e_tests_refactor.
Your task is to refactor the newly implemented E2E test suite to address the reviewers' and challengers' critique about facade/tautological assertions and validation conflicts:

1. In `tests/autopilot-flow-prompts.spec.ts`:
   - Replace all tautological mock assertions (where tests defined local strings inside the test blocks and asserted against themselves) with calls to the actual application services and routing helper functions from `src/services/autopilot/flow-routing.ts` (e.g. `resolveActiveFlowIntentScope`, `formatFlowFormGuidanceForPrompt`, `formatFlowReferencesForPrompt`, `formatFlowSwitchGuidanceForPrompt`) and `src/services/autopilot/flow-v2.ts` (e.g. `migrateAutopilotFlowGraphToV2`).
   - For example:
     - `F3-T1-2`: Pass a mock `AutopilotConfig` to `resolveActiveFlowIntentScope` and assert that the returned intent scope contains the correct title/sub-agent details.
     - `F3-T1-3`, `F3-T1-4`, `F3-T1-5`: Call `formatFlowFormGuidanceForPrompt` or `formatFlowSwitchGuidanceForPrompt` or `formatFlowReferencesForPrompt` on configurations to assert prompt format and guidelines are generated.
     - `F3-T2-1`, `F3-T2-2`, `F3-T2-3`: Test `resolveActiveFlowIntentScope` and/or formatting helpers with long titles, null scopes, or weird interpolation characters to verify robustness.
     - `F3-T2-4`: Verify `formatFlowFormGuidanceForPrompt(null)` is handled gracefully. Since this test already runs successfully on the current codebase, ensure it is NOT skipped (`it` instead of `it.skip`).
     - `F3-T2-5`: Run multiple consecutive resolutions using the helper functions and verify consistency (idempotency).
   - Ensure tests that depend on unimplemented features are kept as `.skip`, but ensure their assertions call actual source code functions so they are genuine.

2. In `tests/autopilot-flow-audit.spec.ts`:
   - Refactor test `F1-T2-4` ("Check if missing nested fields do not cause runtime crashes in audit") to only assert that the function does not crash (`expect(() => auditAutopilotFlowGraph(graph)).not.toThrow()`), but do NOT assert `expect(audit.status).toBe('passed')` as this will conflict with the future implementation of empty field validation.

3. Verify:
   - Run typecheck using `npx tsc --noEmit` and ensure it succeeds with exit code 0.
   - Run Vitest using `npx vitest run tests/` and ensure it runs successfully with exit code 0.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

When finished, send a message to your parent (conv ID: eaa37bd8-362b-4267-ba3b-c63dd668b506).
