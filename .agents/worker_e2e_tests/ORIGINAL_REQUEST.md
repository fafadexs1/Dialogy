## 2026-07-08T13:52:00Z
You are a Worker Agent. Your working directory is c:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy\.agents\worker_e2e_tests.
Your mission is to implement a comprehensive test suite (Tiers 1-4) for the Flow V2 Builder Enhancements, targeting:
1. Feature 1 & 2: Flow Audit Validation and Alerts (Tier 1 & 2) in `tests/autopilot-flow-audit.spec.ts`
2. Feature 3 & 4: Backend Prompt Generation & Guidance (Tier 1 & 2) in a new file `tests/autopilot-flow-prompts.spec.ts`
3. Tier 3 (Cross-feature combinations) and Tier 4 (Real-world scenarios) in a new file `tests/autopilot-flow-scenarios.spec.ts`

Follow the E2E Testing Track requirements from c:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy\TEST_INFRA.md and c:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy\.agents\ORIGINAL_REQUEST.md.

Specifically:
- Implement tests verifying all the test cases described in TEST_INFRA.md.
- Keep tests independent of implementation details where possible.
- IMPORTANT: Since the product feature code is not yet implemented (no validations exist yet for start, message, sub_agent, and handoff nodes, and no visual alerting updates are present), write the tests fully with assertions, but mark those tests that would fail on the current codebase as `.skip` (or `it.skip` / `describe.skip`) so that `npx vitest run tests/` executes successfully with exit code 0.
- Verify that the test files typecheck successfully with `npx tsc --noEmit`.
- Run the test suite using `npx vitest run tests/` and document the results.
- Write your final handoff as handoff.md inside your folder, referencing the files written/modified, typecheck outputs, and test suite execution logs.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

When finished, send a message to your parent (conv ID: eaa37bd8-362b-4267-ba3b-c63dd668b506).
