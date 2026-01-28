# RAG Implementation Plan: Local Embeddings & Supabase pgvector

## Overview
Implement a Retrieval-Augmented Generation (RAG) system using **local embeddings** running on the Node.js server. This system will index both **knowledge base documents** and **chat history**, enabling the AI agent to perform semantic searches for relevant context. We will use `transformers.js` (or `onnxruntime`) for generating embeddings (likely `all-MiniLM-L6-v2` or `multilingual-e5`) and Supabase's `pgvector` for storage and similarity search.

## Project Type
**BACKEND / WEB** (Server-side implementation in Next.js)

## Success Criteria
- [ ] `pgvector` extension enabled and configured in Supabase.
- [ ] Server-side embedding generation works (input text → vector) without external APIs.
- [ ] Knowledge Base documents are chunked, embedded, and stored.
- [ ] Chat messages are asynchronously embedded and stored.
- [ ] Semantic search returns relevant results for user queries.
- [ ] Agent context window includes retrieved information.

## Tech Stack
-   **Embedding Models:** 
    -   *Docs:* `Xenova/multilingual-e5-base` (better semantic recall).
    -   *Chat:* `Xenova/all-MiniLM-L6-v2` (fast, efficient for real-time).
-   **Database:** Supabase (PostgreSQL) + `pgvector` extension.
-   **Vector Storage:** Custom tables (`document_embeddings`, `message_embeddings`).
-   **Runtime:** Node.js (Next.js Server Actions/API Routes). *Warning: Watch out for Vercel/Serverless cold starts and memory limits.*
-   **Querying:** Raw SQL via `src/lib/db.ts` (pg).

## File Structure
```
src/
├── lib/
│   ├── embeddings.ts       # [NEW] Service to generate embeddings (singleton, multi-model support)
│   ├── vector-store.ts     # [NEW] DB operations for vectors (save, search)
│   └── text-splitter.ts    # [NEW] Utility to chunk long text (recursive)
├── actions/
│   ├── knowledge.ts        # [UPDATE] Trigger embedding on doc upload
│   └── ai.ts               # [UPDATE] Inject retrieved context into generation
└── sql/
    └── init_vectors.sql    # [NEW] DDL for extension and tables
```

## Task Breakdown

### Phase 1: Foundation & Setup
- [ ] **Task 1: Install Dependencies** <!-- id: 1 -->
    -   `npm install @xenova/transformers`
    -   *Agent:* `backend-specialist`

- [ ] **Task 2: Database Schema (pgvector)** <!-- id: 2 -->
    -   Create SQL migration to enable `vector` extension (schema: `extensions`).
    -   Create tables with **Metadata**: 
        -   `embeddings_documents` (cols: `id`, `content`, `vector`, `document_id`, `created_at`)
        -   `embeddings_messages` (cols: `id`, `content`, `vector`, `message_id`, `chat_id`, `role`, `created_at`)
    -   Add HNSW indexes for performance.
    -   *Agent:* `database-architect`

- [ ] **Task 3: Embedding Service (Server-Side)** <!-- id: 3 -->
    -   Create `src/lib/embeddings.ts`.
    -   Implement singleton pattern to load the models.
    -   Support switching models: `generateEmbedding(text, modelType: 'doc' | 'chat')`.
    -   *Note:* Ensure Singleton persists across hot-reloads in dev if possible.
    -   *Agent:* `backend-specialist`

### Phase 2: Ingestion Pipelines
- [ ] **Task 4: Knowledge Base Ingestion** <!-- id: 4 -->
    -   Create `src/lib/text-splitter.ts` (recursive character splitter).
    -   **Strategy:** Chunk Size ~800 chars, Overlap ~100 chars.
    -   Update KB upload action to:
        1. Save file.
        2. Chunk text.
        3. Generate embeddings (E5).
        4. Save to `embeddings_documents`.
    -   *Agent:* `backend-specialist`

- [ ] **Task 5: Chat History Ingestion (Async)** <!-- id: 5 -->
    -   Update `sendMessageAction`.
    -   When user/agent sends a message -> generate embedding (MiniLM) -> save to `embeddings_messages`.
    -   Include metadata: `chat_id`, `role`.
    -   *Agent:* `backend-specialist`

### Phase 3: Retrieval & Integration
- [ ] **Task 6: Semantic Search Implementation** <!-- id: 6 -->
    -   Implement `searchSimilarDocuments(queryVector, limit)` in `src/lib/vector-store.ts`.
    -   Implement `searchSimilarMessages(queryVector, limit)` in `src/lib/vector-store.ts`.
    -   Use cosine distance operator (`<=>`).
    -   *Agent:* `database-architect`
    -   *Verify:* Search for "refund" returns relevant docs/msgs.

- [ ] **Task 7: Agent Context Injection** <!-- id: 7 -->
    -   Update `src/actions/ai.ts` (or `genkit.ts`).
    -   Before generating response:
        1. Embed user query.
        2. Retrieve top-k chunks.
        3. Append to system prompt as "Context Information".
    -   *Agent:* `orchestrator`
    -   *Verify:* Ask question about uploaded doc, Agent answers correctly.

## Phase X: Verification Checklist
- [ ] **Dependency Check:** Transformers.js installed and running.
- [ ] **Schema Check:** `vector` extension active in `extensions` schema.
- [ ] **Performance:** Embedding generation < 500ms on server.
- [ ] **Accuracy:** Semantic search returns relevant results.
- [ ] **Regression:** Existing chat flows still work.
