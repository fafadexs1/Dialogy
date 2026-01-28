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

We will use `@ducanh2912/next-pwa` (a modern fork of `next-pwa`) or standard `next-pwa` depending on compatibility with Next.js 16 + Turbopack. Given Next.js 16, manual SW setup or a lighter wrapper might be safer, but `@ducanh2912/next-pwa` is the current standard for App Router.

### Tech Stack Additions
- `manifest.json`: Web App Manifest standard.
- Service Worker: For caching static assets and API responses.
- `viewport` & `theme-color`: Meta tag optimization.

---

## 3. Task Breakdown (Phase-by-Phase)

### Phase 1: Assets & Manifest
**Goal**: Make the browser recognize the app as installable.

- [ ] **Generate Icons**:
  - `public/icons/icon-192x192.png`
  - `public/icons/icon-512x512.png`
  - `public/apple-icon.png` (for iOS)
- [ ] **Create Manifest**:
  - `public/manifest.json` with name, colors, and display modes.
- [ ] **Update Metadata**:
  - Add `viewport` (disable zoom on inputs for iOS) and `theme-color` in `layout.tsx` or `manifest`.

### Phase 2: Service Worker Configuration
**Goal**: Enable caching and offline capabilities.

- [ ] **Install Dependency**: `npm install @ducanh2912/next-pwa`
- [ ] **Configure Next.js**:
  - Update `next.config.js` to wrap the config with `withPWA`.
  - Exclude admin/API routes from aggressive caching to prevent stale data issues.
- [ ] **Git Ignore**: Add `public/sw.js` and `public/workbox-*.js` to `.gitignore`.

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
| **Stale Data** | Configure SW `runtimeCaching` to `NetworkFirst` for API routes (`/api/*`). |
| **Next.js 16 Limits** | If `next-pwa` fails with Turbopack, implement a simple custom `sw.js` using Workbox CDN. |
| **iOS Caching** | iOS usually has stricter PWA limits; ensure `apple-mobile-web-app-capable` meta tags are present. |

---

## 5. Next Steps for Implementation

1. **Approve Plan**: Confirm this structure implies the scope you want.
2. **Execute**: Run `/create` or start with Phase 1 (Assets).

**Files to be created:**
- `public/manifest.json`
- `public/icons/*`
- `next.config.js` (modified)
