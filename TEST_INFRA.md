# E2E Test Infra: Flow V2 Builder Enhancements

## Test Philosophy
- Opaque-box, requirement-driven testing.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise + Workload Testing.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | Frontend Completeness Validation | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 2 | Visual Error Alerts | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 3 | Backend Rich Node Prompts | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 4 | Global Runtime Guidelines | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |

## Test Architecture
- **Test Runner**: Vitest (`npx vitest`)
- **Location**: `tests/` directory (e.g. `tests/autopilot-flow-audit.spec.ts` for validation; new spec for prompts verification if needed)
- **Execution Command**: `npx vitest run tests/`

## Feature Test Cases
### Feature 1 & 2: Flow Audit Validation and Alerts
- **Tier 1 (Feature Coverage)**:
  - F1-T1-1: Start node with no outgoing edges fails validation.
  - F1-T1-2: Message node with empty/whitespace message fails validation.
  - F1-T1-3: Sub-Agent node with empty/whitespace instructions fails validation.
  - F1-T1-4: Handoff node with empty/whitespace message or destination fails validation.
  - F1-T1-5: Valid flow graph passes validation with zero issues.
- **Tier 2 (Boundary & Corner Cases)**:
  - F1-T2-1: Node containing whitespace-only text is correctly treated as empty and fails.
  - F1-T2-2: Large text values in configuration fields compile and pass without truncation or errors.
  - F1-T2-3: Graph with multiple errors collects and returns all errors in a single run.
  - F1-T2-4: Check if missing nested fields do not cause runtime crashes in audit.
  - F1-T2-5: Graph with circular dependencies mixed with empty fields returns both cycle errors and empty field errors.

### Feature 3 & 4: Backend Prompt Generation & Guidance
- **Tier 1 (Feature Coverage)**:
  - F3-T1-1: New/migrated sub-agent default instructions contain structured layout (títulos/marcadores).
  - F3-T1-2: Compiled intentContextForAI includes flowSubAgent field.
  - F3-T1-3: Runtime process-chat prompt injection incorporates natural behavior guidance.
  - F3-T1-4: System instructions limit client queries from creating unsupported facts.
  - F3-T1-5: Node-level custom instructions are combined correctly with system guidelines.
- **Tier 2 (Boundary & Corner Cases)**:
  - F3-T2-1: Intent context compiled with very long flow title.
  - F3-T2-2: Processing chat when there is no active flow/intent scope.
  - F3-T2-3: Checking template interpolation security (weird characters in title/instructions).
  - F3-T2-4: Prompt compiler handles empty optional parameters gracefully.
  - F3-T2-5: Multiple consecutive user chat prompts maintain system instructions correctly.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Full Agent Publishing Lifecycle: Validation, Visual indicators, backend compilation, and run | F1, F2, F3, F4 | High |
| 2 | Invalid Draft to Clean Publish: Correcting empty fields updates frontend publish state | F1, F2 | Medium |

## Coverage Thresholds
- Tier 1: ≥5 per feature
- Tier 2: ≥5 per feature
- Tier 3: pairwise coverage of major interactions
- Tier 4: ≥2 realistic application scenarios
