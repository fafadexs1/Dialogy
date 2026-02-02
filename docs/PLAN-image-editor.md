Po# PLAN-image-editor

> **Document Status:** DRAFT
> **Mode:** PLANNING
> **Task:** Implement In-App Image Editor

## 1. Context & Objective
The user wants to edit images directly within the application's Media Viewer (`MediaViewer.tsx`). The editing features should include cropping, rotating, and basic adjustments. 
**Crucial Requirement:** The original file must NOT be modified. The edited version should be downloadable by the user (client-side only initially).

## 2. Technical Strategy

### 2.1. Library Selection
We will use **`react-cropper`** (backed by `cropperjs`).
- **Pros:** Robust, supports rotation, scaling, flipping, and advanced cropping. Lightweight enough for this use case.
- **Alternative:** `react-easy-crop` (Simpler, but `cropperjs` is more "editor-like" for desktop/web apps).

### 2.2. Architecture
The `MediaViewer` component is currently a `Dialog`. we will add a new state `isEditing` to toggle between the "View Mode" (current) and "Edit Mode".

**Flow:**
1.  **View Mode:** Shows Image + Pencil Icon (`Edit`).
2.  **User Clicks Pencil:**
    -   State `isEditing` becomes `true`.
    -   Dialog displays `ImageEditor` component instead of `<img />`.
    -   Control bar changes to "Editor Controls" (Save, Cancel, Rotate Left/Right, Reset).
3.  **Edit Mode:**
    -   User adjusts image (Crop, Rotate).
4.  **User Clicks Save:**
    -   Generate blob from canvas.
    -   Trigger download of the new file (e.g., `image_edited.png`).
    -   Exit Edit Mode (optional) or stay.
5.  **User Clicks Cancel:**
    -   Discard changes.
    -   Return to View Mode.

### 2.3. Component Structure
-   **`MediaViewer` (src/components/chat/media-viewer.tsx)**
    -   *State:* `isEditing` (boolean)
    -   *Render:* Conditionally render `ImageView` or `ImageEditor`.
-   **`ImageEditor` (NEW: src/components/chat/image-editor.tsx)**
    -   Wraps `Cropper` component.
    -   Exposes methods: `getEditedBlob()`, `rotate()`, `reset()`.

## 3. Implementation Steps

### Phase 1: Dependencies & Setup
- [ ] Install dependencies: `npm install react-cropper cropperjs`
- [ ] Add types if needed: `npm install --save-dev @types/cropperjs` (usually included or not needed for wrapper).

### Phase 2: Create Editor Component
- [ ] Create `src/components/chat/image-editor.tsx`.
- [ ] Implement `Cropper` with distinct styling (dark mode compatible).
- [ ] Create toolbar with Icons:
    -   `RotateCcw`, `RotateCw` (Rotation)
    -   `FlipHorizontal`, `FlipVertical` (Mirroring - optional but good)
    -   `Check` (Save/Download)
    -   `X` (Cancel)

### Phase 3: Integrate into MediaViewer
- [ ] Add "Edit" button (Pencil) to `MediaViewer` control bar.
- [ ] Handle state transition `isEditing`.
- [ ] Pass `src` to `ImageEditor`.
- [ ] Implement `handleSave`:
    -   Get canvas data.
    -   `canvas.toBlob(...)`.
    -   Trigger `saveAs` / anchor download.

### Phase 4: Verification & Polish
- [ ] Verify Mobile responsiveness (CropperJS handles touch, but UI buttons need to be tappable).
- [ ] Verify "Download only" behavior (ensure original src is untouched).
- [ ] Ensure double-click/long-press behavior doesn't conflict (should probably be disabled in Edit Mode).

## 4. Open Questions / Trade-offs (Socratic Gate)
> **Please review these before we code:**

1.  **Download vs. Send:** You requested "edit and download". Do you *also* want a button to "Send to Chat" (forward the edited image) immediately, or is download-only sufficient for now?
2.  **Filters:** Do you need color adjustments (brightness/contrast) now, or just geometry (crop/rotate)? (Sticking to geometry keeps it simple).

## 5. Agent Verification Checklist
- [ ] `npm run build` passes.
- [ ] Image opens in editor.
- [ ] Rotation works.
- [ ] Cropping works.
- [ ] Download produces a valid image file.
- [ ] Original image in chat remains unchanged.
