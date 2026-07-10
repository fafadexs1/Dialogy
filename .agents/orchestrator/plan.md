# Plan: Flow V2 Builder Enhancements

## Steps
1. **Initial Exploration**: Dispatch an Explorer agent to analyze frontend code (`src/components/autopilot/autopilot-flow-builder.tsx`), backend prompt compiler (`src/services/autopilot/flow-v2.ts`, `src/services/autopilot/runtime/process-chat.ts`), and existing tests to understand the structure, state shape, publish mechanisms, and compilation flow.
2. **Setup Project Scope**: Create `PROJECT.md` and `TEST_INFRA.md` at project root with detailed milestones, interface contracts, layout, and test inventory.
3. **E2E Testing Track**: Dispatch E2E Testing sub-orchestrator to design and implement tests verifying node validations (Tiers 1-4).
4. **Implementation Track**:
   - Milestone 1: Frontend visual validation & blocking invalid publish (R1).
   - Milestone 2: Backend rich prompts compilation and global guidelines injection (R2).
   - Milestone 3: Compile-time check & testing verification (R3).
5. **Adversarial & Hardening (Tier 5)**: White-box analysis and coverage hardening.
6. **Victory Forensic Audit**: Run Forensic Auditor to guarantee zero integrity violations.
7. **Report Completion**: Relay results to the user.
