# Design QA — Inbox Focus

## Comparison target

- Source visual truth: `C:\Users\fabri\.codex\generated_images\019f4f0c-e713-70e1-bad6-e2018be00090\exec-8e084d0d-cc19-4a34-978e-e892932f4934.png`
- Implementation screenshot: `C:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy\design-qa\inbox-focus-production-1440x900.png`
- Full comparison: `C:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy\design-qa\inbox-focus-comparison.png`
- Viewport: 1440 × 900. The 1586 × 992 source was normalized to the same 1.6:1 frame for comparison.
- State: light theme, desktop Inbox, `Atendendo` selected, active WhatsApp conversation, context canvas closed.

## Findings

- No actionable P0, P1, or P2 findings remain.
- The compact global rail is an intentional product deviation from the source: the user explicitly removed `Atendidos` and `Encerrados` from global navigation and requested intuitive submenus. Those conversation states now live in the Inbox tabs.
- The source uses photo avatars and a denser message history. The QA workspace intentionally uses synthetic contacts without image URLs and a shorter history, so the implementation correctly exercises its production fallback-avatar and sparse-thread states.
- The source shows a send CTA while its composer is empty. The production Inbox preserves its existing channel-safe behavior: an empty composer exposes audio input and changes to send behavior when text is entered.

## Required fidelity surfaces

- Fonts and typography: passed. The implementation uses the product's Inter body/heading tokens, with comparable weights, hierarchy, line height, compact metadata, and deliberate truncation at constrained widths.
- Spacing and layout rhythm: passed. Rail, clamped conversation list, chat header, message canvas, bubbles, and composer preserve the source's three-region composition and white-space rhythm. At 1024 px, the context panel remains an overlay instead of shrinking the conversation.
- Colors and visual tokens: passed. White surfaces, `#F8F9FB` conversation canvas, slate borders/text, blue outgoing messages, and semantic red/amber/green states match the source direction and retain accessible contrast.
- Image quality and asset fidelity: passed. The real Dialogy logo is retained; dynamic contact avatars use the product's existing image/fallback component. UI icons use the established Lucide/React Icons families; no placeholder illustration, CSS art, emoji, or handcrafted SVG replaces a target asset.
- Copy and content: passed. Labels are concise and product-specific (`Robô`, `Fila`, `Atendendo`, `Encerrados`, `Transferir`, `Ver contexto`), with coherent Portuguese and correct empty/error messaging.
- Icons and controls: passed. Stroke weight and size are consistent, narrow-width icon buttons have accessible names, closed-chat transfer is disabled, and primary controls remain visible.
- Responsiveness: passed at 1024 × 600, 1280 × 720, 1366 × 768, 1440 × 900, and 1920 × 1080. No persistent control overlaps, clips, or disappears.
- Accessibility and interaction states: passed. Sidebar flyouts expose menu/menuitem semantics, support arrow keys and Escape, restore trigger focus, and preserve visible focus states. Tabs, dialogs, canvas close, filters, search, and disabled states expose semantic labels.

## Focused region comparison evidence

- Navigation and conversation list: `C:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy\design-qa\inbox-focus-comparison-list.png`
  - Confirms hierarchy, status groups, row density, selected state, counters, search, filters, and rail alignment.
- Chat header, messages, and composer: `C:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy\design-qa\inbox-focus-comparison-chat.png`
  - Confirms header actions, metadata hierarchy, bubble shape/color, canvas spacing, timestamps, and composer treatment.

## Primary interactions tested

- Switch between `Robô`, `Fila`, `Atendendo`, and `Encerrados`.
- Search and clear a conversation query; open advanced filters.
- Select conversations and load their message windows.
- Open `Nova conversa`; verify text flow and conditional Cloud API template flow without sending.
- Open and close the context canvas; switch `Info`, `CRM`, and `SGP`.
- Open the nested transfer dialog, load team destinations, and close without mutating data.
- Verify transfer is unavailable for an ended conversation.
- Open sidebar flyouts at 1024 × 600; verify keyboard navigation and focus restoration.
- Verify production browser console after the final build: zero errors.

## Comparison history

### Iteration 0 — implementation and browser pre-gate

- Earlier P1: the dev-only sound tester covered Inbox controls. Fixed by requiring explicit `NEXT_PUBLIC_INBOX_DEBUG=true`.
- Earlier P1: priority grouping could misclassify outgoing messages and did not advance at the SLA threshold without a data mutation. Fixed with shared direction semantics and a 30-second/focus/visibility clock.
- Earlier P1: Framer Motion replaced the flyout centering transform at shorter desktop heights. Fixed by moving the `-50%` offset into every motion state.
- Earlier P2: permanent context content could compress the conversation at 1024 px. Fixed with a closed-by-default Sheet canvas that overlays the Inbox.
- Earlier P2: nested transfer/dialog layers could fall below the context canvas. Fixed with aligned portal stacking; nested dialogs were browser-verified above the canvas.
- Earlier P2: hidden row actions reserved horizontal space. Fixed by making them an absolute hover/focus overlay.
- Earlier P2: status tabs and contact names truncated awkwardly at minimum desktop width. Fixed with intentional short tab labels below 1400 px, hidden duplicate row status below 1280 px, and a wider name allocation.
- Earlier P2: closed conversations could still expose the custom transfer trigger. Fixed by guarding the dialog state and disabling the trigger itself.
- Earlier P2: the audio-unlock prompt could cover header actions and appear after a failed proactive unlock. Fixed by positioning it below the header and showing it only after an actual blocked notification request.
- Post-fix evidence: `design-qa/inbox-focus-production-1024x600.png`, `design-qa/inbox-focus-production-1440x900.png`, and `design-qa/inbox-focus-production-1920x1080.png`.

### Iteration 1 — final normalized visual comparison

- Full-view and focused comparisons found no remaining actionable P0/P1/P2 mismatch.
- No visual fix was made after this comparison pass.

### Iteration 2 — message wrapping and chat-header refinement

- Follow-up P1: short incoming messages could wrap their final character because a percentage-based bubble width was resolved inside a shrink-to-fit flex wrapper. Fixed by making the message column consume the remaining row width, giving the bubble row a stable full-width containing block, and retaining safe wrapping for long links/identifiers.
- Follow-up P2: the wide chat header repeated the service status and expanded into separate metadata columns plus five loose action icons. Fixed with one status badge, compact inline channel/team/assignee metadata, and a single adaptive action island containing `Transferir`, `Contexto`, and `Mais`.
- `Mais` now groups technical details, export, training, AI executions/configuration modes, and the destructive close action. Transfer, contact context, technical details, keyboard dismissal, and focus-safe overlays were rechecked without mutation.
- Synthetic browser cases `Pode sim`, `Somente w`, and `Obrigada` remained single-line at every tested desktop width; a long unbroken URL wrapped inside the bubble with `scrollWidth === clientWidth`.
- Follow-up browser matrix: 1024 × 600, 1280 × 720, 1440 × 900, 1586 × 756, and 1920 × 1080. Header and document horizontal overflow remained zero, exactly one visible status was rendered, and the production console reported zero errors.

## Validation

- `npm test`: 174 files, 1038 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; only the existing BullMQ dynamic-dependency warning remains.
- Production URL checked in the in-app browser: `http://localhost:9002/inbox`.
- Final production console errors: none.

## Follow-up polish

- P3: future visual regression fixtures could include authorized real avatar URLs and a longer thread so screenshot density more closely mirrors the source, without changing production behavior.

## Implementation checklist

- [x] Source and production capture normalized and compared together.
- [x] Focused list and chat regions reviewed.
- [x] All P0/P1/P2 findings fixed and recaptured.
- [x] Core interactions and responsive breakpoints verified.
- [x] Automated tests, types, build, and browser console passed.

final result: passed
