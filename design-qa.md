# Design QA — múltiplas tags no Inbox

Reference: `C:\Users\fabri\AppData\Local\Temp\codex-clipboard-760c45f2-ed9d-461a-a5c9-4e22ae19cc97.png`

Implementation capture: `C:\Users\fabri\Desktop\Dialogy-apps\Conexão\Dialogy\design-qa\inbox-multiple-tags-final.png`

## Comparison

- Tags are rendered as rounded colored chips directly below the conversation header.
- The text label “Classificação” and the textual “Adicionar” action were removed.
- The add action is a compact outlined square `+` button placed immediately after the chips.
- The popover matches the reference hierarchy: “Adicionar tags”, search field, uppercase recent-tags label, checkbox rows with color dots, and “Criar nova tag” footer.
- Selected tags are ordered before unselected tags.
- The current production conversation used for QA has no classifications, so the runtime capture correctly starts with the `+` button instead of fabricating the three demo tags present in the reference.
- Tags linked to the team currently handling the chat are excluded from the chip bar, the conversation-list summary, the picker, and server hydration.

## Verification

- Responsive viewport checked at 1440 × 900.
- Popover opens, loads the real workspace tags, and remains keyboard accessible.
- Browser console has no new implementation errors after the checkbox nesting fix.
- TypeScript typecheck passes.
- ESLint reports no errors in changed files; only pre-existing warnings remain.
- Inbox regression suite: 45 tests passed.
- Team-tag exclusion SQL was executed against the configured database successfully.

final result: passed
