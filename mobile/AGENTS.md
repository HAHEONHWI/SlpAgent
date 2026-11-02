# Mobile app instructions (`mobile/`)

Expo SDK 58 / React Native 0.88 Android app for SLP AI. It talks to the same FastAPI backend as `frontend/` (no backend changes needed).

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. Before writing code that touches an Expo, EAS, or React Native API, check the installed type definitions in `node_modules` or the versioned docs at `https://docs.expo.dev/versions/v58.0.0/`.

## Structure

- `src/app/` — Expo Router routes only. `(tabs)/index.tsx` is the 녹음 tab (child → record → upload → AI draft review), `schedule`, `attendance`, `records`, `ai` are the other tabs; `children`, `account`, `login`, `signup` are stack screens. `_layout.tsx` guards login / signup gate / app with `Stack.Protected`.
- `src/lib/` — API client (`api.ts`), Firebase auth with AsyncStorage persistence (`auth.tsx`), resumable recording upload (`upload.ts`, `recordings.ts`), `.xlsx` read/write on fflate's sync zip (`xlsx.ts`; React Native has no Web Workers).
- `src/components/` — shared UI (`ui.tsx`, colors match `frontend/src/index.css`).
- Screens mirror the web pages in `frontend/src/pages/` (same endpoints, query keys and Korean wording). When a web screen in the 매일 or AI menu changes behavior, update the matching mobile screen.

## Rules

- Use `npx expo install <package>` (SDK-compatible versions). Pin plain JS libraries to exact versions.
- `android/` and `ios/` are generated (`npx expo prebuild`) and gitignored. Configure native behavior in `app.json` and config plugins only.
- `.env.production` (tracked, loaded by release/EAS builds; copy to `.env.local` for dev) holds only public client config (Firebase web config, API URLs), the same values as `frontend/.env.production`. Never put secrets, keystores or the Play service account key in the repo.
- Recordings stay on the phone (`pendingRecordings` in AsyncStorage + document directory) until the upload completes; never delete them on a failed upload.
- AI output is a draft: the app shows drafts and the therapist approves through `/proposals/*`, like the web.

## Commands

```sh
npm run typecheck            # tsc --noEmit
npx expo-doctor              # dependency/config checks
npx expo start               # dev server (needs a development build: npx expo run:android)
npm run build:android        # EAS production build (.aab)
npm run submit:android       # upload to Play Console (internal track, draft)
```
