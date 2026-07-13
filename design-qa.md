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

---

# Design QA — Chat header and composer redesign (2026-07-13)

## Evidence

- Source visual truth:
  - `C:\Users\fabri\AppData\Local\Temp\codex-clipboard-b8f7cbdc-ea7b-41ed-9557-adf7facc9baf.png`
  - `C:\Users\fabri\AppData\Local\Temp\codex-clipboard-0be8405f-d163-4eef-9c13-abd5af29d2a7.png`
  - `C:\Users\fabri\AppData\Local\Temp\codex-clipboard-b5078957-b2ab-4e72-8a2c-0f7a050438ab.png`
- Implementation target: `http://localhost:9002/inbox`
- Implementation screenshot: unavailable; local URL access was blocked by the active browser security policy.
- Intended viewport/state: authenticated desktop Inbox, selected open conversation, light and dark themes, composer idle and “Próxima mensagem” menu open.
- Full-view comparison: blocked because no browser-rendered implementation capture could be produced.
- Focused comparison: blocked for the chat header, composer, options menu, and responsive toolbar for the same reason.

## Findings

- [P1] Visual fidelity cannot be verified against the supplied references.
  - Location: Inbox chat header and composer.
  - Evidence: all three source screenshots were opened, but the local implementation could not be captured in the permitted browser surface.
  - Impact: typography, spacing, responsive wrapping, light/dark contrast, menu placement, and border-radius fidelity remain visually unverified.
  - Fix: capture the authenticated Inbox at matching desktop viewports in both themes and compare the full screen plus focused header/composer regions against the references.

## Comparison history

- Iteration 0: source references inspected and implementation completed in `src/components/chat/chat-panel.tsx`.
- Automated validation: `npm run typecheck` passed; `git diff --check` reported no whitespace errors.
- Post-fix visual evidence: unavailable due to browser security policy; no visual comparison iteration can be claimed.

## Implementation checklist

- [x] Composer options consolidated into a one-shot selector.
- [x] Compatible selection model represented; mutually exclusive options are guarded.
- [x] Attachments remain an immediate action outside the selector.
- [x] One-shot options reset only after an actual send.
- [x] Header enriched with channel, team, service start, status, and assignee while preserving action placement.
- [x] TypeScript validation passed.
- [ ] Capture and compare authenticated light and dark implementations.
- [ ] Verify desktop breakpoints, menu placement, and horizontal overflow visually.
- [ ] Check browser console during the interaction pass.

final result: blocked

---

# Design QA — Nova conversa, opção 2 (2026-07-13)

## Evidence

- Source visual truth: `design-qa/sources/new-conversation-option-2.png`.
- Implementation target: `src/components/chat/chat-list.tsx`, component `NewConversationDialog` at `http://localhost:9002/inbox`.
- Implementation screenshot: unavailable. The permitted browser surface blocked access to the local Inbox under the active network security policy.
- Intended viewport: 1440 × 1024 desktop, with responsive behavior down to narrow desktop/mobile widths.
- Intended state: authenticated Inbox, modal open, WhatsApp Cloud API instance selected, valid recipient, approved template selected, template variables populated.
- Full-view comparison: blocked because a browser-rendered implementation capture could not be produced.
- Focused comparison: blocked for destination validation, template selection, preview, variables, footer readiness, light theme, dark theme, and responsive stacking.

## Findings

- [P1] Rendered fidelity and interaction polish cannot be verified.
  - Location: Inbox > Nova conversa.
  - Evidence: the selected visual source is available and was inspected, but there is no permitted browser capture of the implementation.
  - Impact: typography, grid proportions, scrolling, radii, theme contrast, animation timing, focus states, and footer visibility remain visually unverified.
  - Fix: capture the modal in the Cloud API state at 1440 × 1024, then repeat in dark mode and a narrow viewport; compare the full frame and focused modal regions against the selected source.

## Fidelity surfaces

- Fonts and typography: implemented with the existing application typography and source-like weights/sizes; rendered comparison blocked.
- Spacing and layout rhythm: implemented as a 300px destination rail plus responsive template/preview workspace, 12–22px radii and restrained elevation; rendered comparison blocked.
- Colors and tokens: implemented with slate, blue, emerald and existing dark-mode tokens; rendered contrast comparison blocked.
- Image and icon fidelity: the source contains no custom raster assets; production icon libraries are used for all channel and UI icons.
- Copy and content: real channel, template, variable and recipient data are preserved; fictional recent contacts from the concept were intentionally omitted.

## Interaction coverage

- Implemented: instance switching, country code selection, digit normalization, recipient validation, free-message validation, template loading/search/selection, variable completion, live preview, reduced-motion support, tactile button/template feedback, submit loading state and success reset.
- Browser interactions tested: unavailable.
- Browser console checked: unavailable.
- Automated checks: `npm run typecheck` passed; `git diff --check` found no whitespace errors; the local Inbox returned HTTP 200.

## Comparison history

- Iteration 0: selected option 2 was opened and mapped to the existing production workflow.
- Implementation preserved WhatsApp, Cloud API and Telegram submission behavior while replacing the long form with a split workspace.
- Post-fix visual evidence: unavailable due to the browser security-policy blocker.

## Implementation checklist

- [x] Selected source preserved in the project QA folder.
- [x] Split destination/template/preview layout implemented.
- [x] Real template search, variables and live preview wired.
- [x] Click, selection, content-change and reduced-motion states implemented.
- [x] Light and dark style variants authored.
- [x] TypeScript validation passed.
- [ ] Capture authenticated implementation in matching light and dark states.
- [ ] Verify responsive stacking, modal scrolling, animation timing and console output.
- [ ] Run normalized side-by-side design comparison and fix any P1/P2 drift.

final result: blocked
