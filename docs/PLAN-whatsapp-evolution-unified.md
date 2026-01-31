# IMPL-whatsapp-evolution-unified.md

## Goal
Unify the WhatsApp connection flow by integrating the Meta Embedded Signup directly into the Evolution API instance creation process. The objective is to create a seamless "Zero-Touch" experience where logging in via Facebook automatically creates the Evolution instance, while preserving a manual fallback for advanced users.

## User Review Required
> [!NOTE]
> **Architecture Decision**: We are NOT merging database tables. We are streamlining the *input flow*. The Meta Login will directly feed the `evolution_api_instances` table via the existing Evolution API creation logic. Legacy channels remain untouched.

## Proposed Changes

### Frontend Logic & UI (`src/app/integrations/evolution-api/page.tsx`)
- **Refactor `AddInstanceForm`**:
    - **Default State**: Show a prominent, high-design "Connect with WhatsApp" card/button.
    - **Hidden State**: Hide manual fields (WABA ID, Token, Phone ID) by default.
    - **Toggle**: Add a discreet "Or connect manually" button that reveals the traditional form.
- **Automate Creation Flow**:
    - Intercept the `WA_EMBEDDED_SIGNUP` -> `FINISH` event.
    - Perform Token Exchange (existing `meta-auth.ts`).
    - **AUTOMATION**: Instead of just pre-filling the form, **automatically trigger** `createEvolutionApiInstance` with:
        - `integration: "WHATSAPP-BUSINESS"`
        - `token`: Exchanged Long-lived Token
        - `businessId`, `number`: From Meta payload
        - `displayName`: Auto-generated from Meta User Name or "WhatsApp Business" (allow edit if needed, or prompt briefly).
    - Show a "Provisioning your WhatsApp..." loading state during this process.

### Backend Actions (`src/actions/evolution-api.ts`)
- No structural changes required to the DB.
- Ensure validation logic accepts the direct payload from the automated flow.

### Backend Actions (`src/actions/meta-auth.ts`)
- Ensure token exchange returns the required expiration info if needed for intelligent refreshing (though Evolution handles this mostly).

## Detailed UX Flow
1. User clicks **"Create Instance"**.
2. Modal shows **"Connect with WhatsApp"** (Primary) and *"Manual Setup"* (Discreet Link).
3. User clicks "Connect":
   - Popup opens (Meta Embedded Signup).
   - User grants permissions and selects number.
   - Popup closes.
4. **Dialogy UI**:
   - "Authenticating..." -> "Creating Instance..."
   - **Success**: Modal closes, list refreshes with new instance "Connected".

## Verification Plan

### Automated Checks
- `npm run typecheck` to ensure no props breakage in `AddInstanceForm`.

### Manual Verification
1. **Happy Path**:
   - Use a test Facebook account.
   - Run the flow.
   - Verify `evolution_api_instances` table has new entry.
   - Verify Evolution API (service) received the request.
2. **Manual Fallback**:
   - Click "Manual Setup".
   - Verify old form inputs appear.
   - Create instance manually (Baileys/Token) to ensure no regression.
3. **Legacy Check**:
   - Verify existing instances in the list still load and function 100%.
