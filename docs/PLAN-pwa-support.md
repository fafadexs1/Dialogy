# Project Plan: PWA & Offline Support

> **Status**: APPROVED
> **Target**: `Dialogy (`nextn`)
> **Goal**: Convert the web application into a Progressive Web App (PWA) installable on desktop and mobile with offline capabilities.

---

## 1. Context & Objectives

The user wants to enable PWA capabilities for the Dialogy chat application. This improves user retention and provides a native-app-like experience.

### Key Objectives
- **Installability**: App can be installed to Home Screen (iOS/Android) and Desktop (Chrome/Edge).
- **Offline Support**: Basic functioning (viewing cached structure) when network is lost.
- **Assets**: Application icons and splash screens.

## 2. Technical Strategy

The PWA uses the Web App Manifest plus a small static service worker. This keeps the app compatible with Next.js 16/Turbopack and deliberately leaves authenticated navigation, RSC payloads, API calls, and Next build assets network-only.

### Tech Stack Additions
- `manifest.json`: Web App Manifest standard.
- Service Worker: For caching static assets and API responses.
- `viewport` & `theme-color`: Meta tag optimization.

---

## 3. Task Breakdown (Phase-by-Phase)

### Phase 1: Assets & Manifest
**Goal**: Make the browser recognize the app as installable.

- [x] **Generate Icons**:
  - `public/icons/icon-192x192.png`
  - `public/icons/icon-512x512.png`
  - `public/apple-icon.png` (for iOS)
- [x] **Create Manifest**:
  - `public/manifest.json` with name, colors, and display modes.
- [x] **Update Metadata**:
  - Add `viewport` (disable zoom on inputs for iOS) and `theme-color` in `layout.tsx` or `manifest`.

### Phase 2: Service Worker Configuration
**Goal**: Enable caching and offline capabilities.

- [x] **Configure Service Worker**:
  - Keep the worker in `public/sw.js` so it is served unchanged by Next.js and Turbopack.
  - Cache only the manifest, icons, and same-origin static media; leave authenticated/API/Next routes network-only.
- [x] **Register in the App**: `src/components/pwa/service-worker-registration.tsx` registers production workers and can enable local verification with `npm run dev:pwa`.
- [x] **Git Ignore**: Generated Workbox assets remain ignored; the checked-in worker is the maintained source.

### Phase 3: Registration & UX
**Goal**: Handle usage experience.

- [ ] **PWA Install Button** (Optional but recommended):
  - A UI component usually in the sidebar or settings to prompt installation if `beforeinstallprompt` fires.
- [ ] **Offline Indicator**:
  - A subtle toast/banner showing "Você está offline" when connection drops (using `navigator.onLine`).

### Phase 4: Verification
**Goal**: Ensure quality using Lighthouse.

- [ ] **Lighthouse Audit**: Run PWA check. Goal is to hit all PWA badges (Installable, Optimized).
- [ ] **Manual Test**: Install on mobile simulator or actual device.

---

## 4. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Stale Data** | API, RSC, navigation, and Next build assets are deliberately network-only. |
| **Next.js 16 Limits** | The worker is static and does not add a Webpack plugin to the Next.js configuration. |
| **iOS Caching** | iOS usually has stricter PWA limits; ensure `apple-mobile-web-app-capable` meta tags are present. |

---

## 5. Next Steps for Implementation

1. **Verify**: Run the production build and a Lighthouse PWA audit.
2. **Manual Test**: Install on a mobile simulator or actual device.

**Files to be created:**
- `public/manifest.json`
- `public/icons/*`
- `next.config.js` (modified)
