# Project: Flow V2 Builder Enhancements

## Architecture
- **Frontend Editor**: `src/components/autopilot/autopilot-flow-builder.tsx` - renders nodes, triggers audit before publish, handles visual state.
- **Shared Validation Library**: `src/services/autopilot/flow-audit.ts` - exposes `auditAutopilotFlowGraph`, checking node configurations and cycle/reachability rules.
- **Backend Flow Compiler**: `src/services/autopilot/flow-v2.ts` - manages default prompts, node migrations, and metadata defaults.
- **Backend Runtime Execution**: `src/services/autopilot/runtime/process-chat.ts` - routes active flow scope, constructs `intentContextForAI` for the LLM, and resolves prompt instructions.

## Code Layout
- Frontend Component: `src/components/autopilot/autopilot-flow-builder.tsx`
- Audit System: `src/services/autopilot/flow-audit.ts`
- Compiler System: `src/services/autopilot/flow-v2.ts`
- Runtime Execution: `src/services/autopilot/runtime/process-chat.ts`
- Tests: `tests/` (e.g. `tests/autopilot-flow-audit.spec.ts`)

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | E2E Test Suite Setup | Set up comprehensive test suite (Tiers 1-4) in `TEST_INFRA.md` | None | IN_PROGRESS (eaa37bd8-362b-4267-ba3b-c63dd668b506) |
| 2 | Frontend Visual Validation & Publish Block | Implement validation in `flow-audit.ts`, propagate issues to frontend, disable publishing and style card errors | M1 | PLANNED |
| 3 | Backend Rich Prompts & Guidance | Enhance prompt structure in `flow-v2.ts` and guidelines in `process-chat.ts` / `auto-responder.ts` | M1 | PLANNED |
| 4 | Type Integrity & Verification | Verify using `npx tsc --noEmit` and run all tests (including adversarial coverage hardening Tier 5) | M2, M3 | PLANNED |

## Interface Contracts
### `flow-audit` ↔ `autopilot-flow-builder`
- Validation logic resides in `auditAutopilotFlowGraph(graph: AutopilotFlowGraph): AutopilotFlowAuditResult`
- Returns status `failed` if there are critical errors.
- Return issues list: `issues: Array<{ nodeId?: string; code: string; message: string; severity: 'critical' | 'warning' }>`
- Frontend node cards display warning icons and tooltips based on matching `nodeId`.
