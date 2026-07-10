# Scope: Flow V2 Builder Enhancements E2E Testing

## Architecture
The E2E tests target Flow V2 Builder. The validation logic, prompt compilers, and routing logic are tested using Vitest (`npx vitest run tests/`). 
The tests should be independent of implementation details where possible and verify the requirements.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration & Baseline | Run Explorer to inspect tests and files, identify test files, run existing tests. | None | PLANNED |
| 2 | Feature 1 & 2 (Tiers 1-2) | Implement F1-T1, F1-T2, F2-T1, F2-T2 tests for validation & alerts. | M1 | PLANNED |
| 3 | Feature 3 & 4 (Tiers 1-2) | Implement F3-T1, F3-T2, F4-T1, F4-T2 tests for rich prompts & guidelines. | M1 | PLANNED |
| 4 | Tier 3 & 4 (Combinations & Scenarios) | Implement pairwise cross-feature tests (Tier 3) and realistic use cases (Tier 4). | M2, M3 | PLANNED |
| 5 | Verification & Release | Run complete test suite, verify types, and publish TEST_READY.md. | M4 | PLANNED |

## Interface Contracts & Test Harnesses
- Test runner: Vitest (`npx vitest run tests/`)
- Language: TypeScript with TSX/TS support
- Key files targeted:
  - `tests/autopilot-flow-audit.spec.ts`
  - `tests/autopilot-flow-routing.spec.ts`
  - New test files if appropriate
