# Dialogy Mobile

Expo universal app for the Dialogy operational mobile experience.

This app is intentionally isolated from the current Next.js desktop/web app. The Next.js app remains responsible for landing pages, SEO, pricing, documentation and the current desktop inbox. This Expo app targets:

- Android
- iOS
- Expo Web for mobile browser experience

## Run

Start the Next.js API in the repository root first:

```bash
npm run dev:next
```

```bash
cd mobile
npm install
npm run start
```

Web:

```bash
npm run web
```

Android dev build:

```bash
npm run android
```

iOS dev build:

```bash
npm run ios
```

## Modes

By default the app runs against the real mobile API and Supabase Auth.

Create `.env` from `.env.example`:

```bash
EXPO_PUBLIC_DIALOGY_API_URL=http://192.168.0.164:9002
EXPO_PUBLIC_DIALOGY_MOBILE_API_MODE=api
EXPO_PUBLIC_SUPABASE_URL=https://supabase.vps1.klyraai.com.br
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_public_anon_key
```

When using Expo Go on a physical phone, `EXPO_PUBLIC_DIALOGY_API_URL` must use your computer LAN IP, not `localhost`.

For local demo fallback:

```bash
EXPO_PUBLIC_DIALOGY_MOBILE_API_MODE=demo
```

Expected endpoints:

- `GET /api/mobile/inbox/bootstrap`
- `GET /api/mobile/chats/:chatId/messages`
- `POST /api/mobile/chats/:chatId/messages`

The service layer is in `src/services/mobileApi.ts`.

## Build

Install EAS CLI:

```bash
npm i -g eas-cli
```

Android APK preview:

```bash
eas build -p android --profile preview
```

Android production AAB:

```bash
eas build -p android --profile production
```

iOS:

```bash
eas build -p ios --profile production
```

iOS distribution requires an Apple Developer account.

## Production routing recommendation

Keep current Next.js desktop routes intact. After this Expo app is deployed for web, route mobile users to the Expo web app only for the operational app experience:

- Desktop `/inbox`: current Next.js inbox
- Mobile `/inbox`: redirect to Expo Web or native app deep link
- Landing/pricing/docs: current Next.js
