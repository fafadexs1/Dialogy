<!--
Sync Impact Report
- Version change: Initial template -> 1.0.0
- Ratification: 2026-09-14
- Modified principles: N/A (Initial ratification)
- Added sections:
  * Core Principles (Multi-Tenant Isolation, Type & Schema Integrity, Channel & Provider Resiliency, Test-First Verification, Observability & Graceful Degradation)
  * Technology Stack & Architectural Standards
  * Development Workflow & Quality Gates
  * Governance
- Follow-up TODOs: None
-->

# Dialogy Constitution

## Core Principles

### I. Multi-Tenant & Workspace Isolation First
Every database query, cache key, asynchronous queue job, AI prompt context, and webhook processing pipeline MUST be strictly isolated by `workspaceId` (and where applicable, `instanceName` or `tenantId`). Data leakage between workspaces is treated as a critical security defect. Tenant authentication and workspace membership MUST be asserted at the boundary before executing business logic.

### II. Type Safety & Schema Integrity (Strict TypeScript & Prisma)
Code MUST adhere to TypeScript strict mode with full type coverage. Implicit `any` is prohibited. All database access MUST be conducted through Prisma ORM with reconciled, audited migrations (`npm run db:migrations:audit`). Contract schemas at API routes, webhooks, and worker events MUST be validated upon entry before reaching domain services.

### III. Resilient Channel & Provider Decoupling
Integrations with external channels and third-party APIs (WhatsApp via Evolution API, Meta Cloud API, Asaas Billing, LLM providers) MUST be treated as fallible external dependencies. System interactions MUST implement timeouts, circuit breakers, idempotent deduplication, and retry policies via background queues. Identity resolution (such as phone digits and BSUID) MUST be deterministic and protected against concurrent race conditions.

### IV. Test-First & Quality Gate Enforcement
Critical business capabilities—including Autopilot flow execution, billing/subscription gates, webhook ingest, and message routing—MUST have automated regression test suites executed via Vitest. Code changes MUST NOT break existing test contracts (`npm test`). Features altering runtime behavior require test coverage encompassing happy paths, edge cases, and failure recovery.

### V. Observability & Graceful Degradation
All asynchronous workers, AI generation turns, and webhook lifecycle events MUST emit structured telemetry and correlation logs. Unhandled exceptions or external service timeouts MUST degrade gracefully (e.g., initiating human agent handoff or queue retries) without causing uncaught process crashes. Diagnostic endpoints and scripts MUST be maintained to evaluate connectivity and runtime health.

## Technology Stack & Architectural Standards

Dialogy is built on Next.js App Router (TypeScript), Prisma ORM with PostgreSQL, Redis-backed workers, and a multi-provider AI runtime (Google GenAI, Genkit, OpenAI, and LM Studio).
- **Presentation Layer**: React Server Components by default; Client Components used selectively for interactive states (e.g., chat inboxes, visual flow builders).
- **Worker Daemons**: Dedicated background worker processes (`worker.ts`, `worker-ai.ts`, `worker-meta-relay.ts`, etc.) consume asynchronous jobs, isolating heavy compute from the user-facing web tier.
- **AI Agent Runtime**: AI procedures and flow graphs MUST validate node inputs, circuit breakers, and tool claims before invoking provider models.

## Development Workflow & Quality Gates

Prior to merging or deploying changes, implementations MUST pass the mandatory verification pipeline:
1. **Static Analysis**: `npm run lint` MUST pass without blocking errors.
2. **Type Verification**: `npm run typecheck` (`next typegen && tsc --noEmit`) MUST succeed with 0 errors.
3. **Automated Verification**: Vitest unit/integration test suites for affected modules MUST pass.
4. **Database Safety**: Schema updates MUST include reversible, tested Prisma migrations.

## Governance

This Constitution supersedes all informal practices. AI coding agents and human contributors MUST audit proposals against these core principles during specification (`/speckit-specify`), planning (`/speckit-plan`), and convergence (`/speckit-converge`).
- **Amendments**: Amendments require documented justification, semantic version increments, and team consensus.
- **Versioning**: 
  * MAJOR: Incompatible governance or architectural principle changes.
  * MINOR: Addition of new principles, sections, or workflow policies.
  * PATCH: Non-semantic clarifications, typo corrections, or link updates.
- **Compliance**: Code reviews and implementation plans that violate core principles MUST be blocked until justified or brought into compliance.

**Version**: 1.0.0 | **Ratified**: 2026-09-14 | **Last Amended**: 2026-09-14
