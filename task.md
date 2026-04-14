# Task: Implement Optimistic UI for Chat

- [x] Analyze existing frontend chat architecture <!-- id: 0 -->
    - [x] Create Playwright SEO audit script (`tests/seo-audit.spec.ts`) (Converted to Browser Subagent Audit)
- [x] Attempt to start the development server
- [/] Run Browser SEO audit (Crawl localhost)
- [x] Implement Optimistic Logic in `MessageInput` <!-- id: 4 -->
    - [x] Generate UUID v4 <!-- id: 5 -->
    - [x] Add message to store immediately <!-- id: 6 -->
    - [x] Call Server Action with UUID <!-- id: 7 -->
- [x] Implement Optimistic Support in Store <!-- id: 8 -->
    - [x] Handle deduplication (merge optimistic vs realtime) <!-- id: 9 -->
- [x] Update `MessageItem` Visuals <!-- id: 10 -->
    - [x] Handle "sending" state (no icon) <!-- id: 11 -->
    - [x] Handle "sent"/"delivered"/"read" states <!-- id: 12 -->
- [x] Verify implementation <!-- id: 13 -->
- [x] Fix MinIO URL extraction <!-- id: 14 -->
- [x] Simplify audio sending (remove conversion) <!-- id: 15 -->
