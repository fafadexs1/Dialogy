## 2026-07-08T13:45:22Z

Analyze the following files:
1. `src/components/autopilot/autopilot-flow-builder.tsx` - look at node definitions (collect, decision, sub_agent, handoff, message), state structures, validation/publish triggers, and save logic. Identify how we can block publishing if nodes have empty/corrupted crucial fields and display visual alerts.
2. `src/services/autopilot/flow-v2.ts` and `src/services/autopilot/runtime/process-chat.ts` (and any related files like `flow-routing.ts`) - examine how system prompts are generated/compiled (intentContextForAI, etc.). Look for how default prompts of new nodes are structured, and how global guidelines are injected.
3. Check existing tests under `tests/` that cover flow routing, flow state, or flow compiler to see how flow behaviors are verified.

Create a handoff report in `c:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy\.agents\explorer_initial\handoff.md` with:
- Summary of your findings
- File paths and lines of interest
- Recommended implementation strategy for frontend validation and backend prompt engine
- Suggestion for test layout and key edge cases to cover
Remember, do not edit or create code files.
