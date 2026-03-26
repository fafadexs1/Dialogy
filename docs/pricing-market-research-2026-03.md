# Pricing Research - 2026-03-20

## Goal

Migrate Dialogy from seat-based pricing to chat-volume pricing, keep users unlimited on every plan, and launch a 7-day free trial for self-serve subscriptions.

## Official Market References

- Respond.io pricing: Starter at $79/month, Growth at $159/month, Advanced at $279/month, and a 7-day free trial. Source: https://respond.io/pricing
- Intercom pricing: Essential at $29/seat/month, Advanced at $85/seat/month, Expert at $132/seat/month, and a 14-day free trial. Source: https://www.intercom.com/pricing
- Kommo pricing: Base at $15/user/month, Advanced at $25/user/month, Enterprise at $45/user/month, with a 14-day trial. Source: https://www.kommo.com/pricing
- Tidio pricing: Growth starts at $49.17/month with 250 billable conversations and Plus starts at 1,000 billable conversations, with a 7-day free trial. Source: https://www.tidio.com/pricing/
- Huggy pricing: Free up to 100 monthly contacts, Scale from $9 per agent/month and 500 monthly contacts, Custom from $39 per agent/month and 2,000 monthly contacts. Source: https://www.huggy.io/en/pricing
- Blip Go pricing: R$299/month, positioned for WhatsApp-first operations, with 15 days free. Source: https://www.blip.ai/blip-go/

## Market Reading

- The market is split between seat-based pricing and usage-based pricing.
- International support platforms still anchor price per seat.
- Messaging-first platforms increasingly anchor price on contacts, conversations, or billable conversations.
- In Brazil, low-friction entry points around R$249 to R$349 remain competitive for SMB adoption.
- A 7-day free trial is common enough to reduce friction without overstretching qualification.

## Recommended Dialogy Ladder

- Essencial: R$249/month, 500 chats/month, 2 connected channels, unlimited users, 7-day free trial.
- Profissional: R$499/month, 2,000 chats/month, 5 connected channels, unlimited users, 7-day free trial.
- Operacao: R$999/month, 7,500 chats/month, 12 connected channels, unlimited users, 7-day free trial.
- Enterprise: custom proposal, negotiated chat volume, custom architecture and onboarding.

## Add-ons

- Chat pack: +500 chats/month for R$99/month.
- Extra channel: R$39/month.
- IA Copilot per workspace: R$149/month.
- Official WhatsApp and BSP costs stay outside software pricing.

## Product Rules

- Users are unlimited across every plan.
- Primary commercial metric is monthly chats.
- Current app UI should present usage as chats in the current month.
- Legacy user-limit enforcement should no longer drive plan positioning.

## Operational Follow-up

- Update the Stripe price IDs in the superadmin billing settings so checkout matches the new public prices.
- Backfill database plan rows if you want persisted plan data to mirror the new ladder immediately.
- If you want hard enforcement later, define whether "chat" means per conversation row, per opened contact thread, or billing-cycle scoped conversations.
