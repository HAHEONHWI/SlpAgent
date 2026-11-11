# Mobile app instructions (`mobile/`)

Expo SDK 58 / React Native 0.88 Android app for SLP AI. It talks to the same FastAPI backend as `frontend/` (no backend changes needed).

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. Before writing code that touches an Expo, EAS, or React Native API, check the installed type definitions in `node_modules` or the versioned docs at `https://docs.expo.dev/versions/v58.0.0/`.

## Structure

- `src/app/` — Expo Router routes only. `(tabs)/index.tsx` is the 녹음 tab (child → record → upload → AI draft review), `schedule`, `attendance`, `records`, `ai` are the other tabs; `children`, `account`, `login`, `signup` are stack screens. `_layout.tsx` guards login / signup gate / app with `Stack.Protected`.
- `src/lib/` — API client (`api.ts`), Firebase auth with AsyncStorage persistence (`auth.tsx`), resumable recording upload (`upload.ts`, `recordings.ts`), `.xlsx` read/write on fflate's sync zip (`xlsx.ts`; React Native has no Web Workers).
- `src/components/` — shared UI (`ui.tsx`, colors match `frontend/src/index.css`).
- `index.ts` registers the Android widget headless handler before Expo Router; `src/widgets/` contains the 4×2 next-class and 4×4 daily-agenda widgets. Preserve the custom entry when changing Router configuration.
- Screens mirror the web pages in `frontend/src/pages/` (same endpoints, query keys and Korean wording). When a web screen in the 매일 or AI menu changes behavior, update the matching mobile screen.

## Rules

- Use `npx expo install <package>` (SDK-compatible versions). Pin plain JS libraries to exact versions.
- `android/` and `ios/` are generated (`npx expo prebuild`) and gitignored. Configure native behavior in `app.json` and config plugins only.
- For every new Android release, increment the user-visible version's patch number by one (1.0.3, then 1.0.4, 1.0.5, etc.) as well as using the next unused `android.versionCode`. Keep `app.json`'s `expo.version`, `package.json`'s version and both root package versions in `package-lock.json` synchronized. Increasing only `versionCode` does not satisfy the owner's release-version rule.
- Expo 58 prebuild recreates native folders by default. For incremental config/plugin changes use `npx expo prebuild --platform android --no-install --no-clean`; keep generated native edits out of source.
- Keep `orientation: default` and support rotation and resizable windows. Do not reintroduce fixed orientations, aspect ratios, resize restrictions or Android large-screen opt-outs. Keep edge-to-edge enabled, handle safe-area insets, and verify portrait and landscape layouts. Play warnings originating in React Native or Material must be traced to their native call sites; do not claim they are cleared without checking the new uploaded bundle.
- `plugins/with-system-bars.js` installs inset-based system bar protection and AGP instrumentation for React Native/Material's legacy color/cutout calls, including precompiled AARs. Keep it reproducible through prebuild; do not edit `node_modules` or generated native files as the fix. After SDK upgrades run `./gradlew :app:checkSystemBarMigration`, inspect the final DEX for deprecated calls and legacy cutout assignments, and test Android 14/16 rotation, keyboard and dialogs before removing or changing the migration. Android 9/10 keep their safe default cutout placement; API 30+ uses `ALWAYS`.
- `.env.production` (tracked, loaded by release/EAS builds; copy to `.env.local` for dev) holds only public client config (Firebase web config, API URLs), the same values as `frontend/.env.production`. Never put secrets, keystores or the Play service account key in the repo.
- Local `android/` Gradle release outputs use the generated debug signing configuration. Never upload them directly to Play. Use the dedicated upload key outside the repository (`~/.android/slpai-upload/upload.p12`); keep the same upload certificate for future local/EAS releases. Validate the final signed AAB with `bundletool` and `jarsigner`, including target API and 16KB alignment.
- The product is a speech-language therapist's work assistant; use the Productivity store category. Evaluate Google Play's separate Health apps declaration against actual features and data access, including health data used for non-health features. Do not assume a medical-app classification or a mandatory organization account from the audience or clinical wording alone; document uncertainty and any actual Google review outcome. Do not hide data collection or features. Keep closed-test publication, Google review submission and LuneTest application status distinct. Never confirm that a test track is published before it is available.
- For the current release, the owner explicitly confirmed no health features and the saved Play declaration is `앱에 건강 기능이 없음`. Keep medical categories and `기타` unchecked for this release. Do not change that declaration merely because therapists use the app or records may contain sensitive information; keep the actual data handling disclosed separately and reassess when functionality changes.
- Recordings stay on the phone (`pendingRecordings` in AsyncStorage + document directory) until the upload completes; never delete them on a failed upload.
- Schedule widgets read authenticated dated schedules and include only the linked therapist's scheduled classes and accessible children. Per the owner's 2026-11-11 request, display the child's complete `display_name` in both sizes; do not mask it. Never add a separate persistent widget data cache or include aliases, notes or clinical content. Refresh on app resume/schedule changes and Android's roughly 30-minute update; show the update time, not a stale countdown. Clear both sizes on logout/account or organization changes and reject late responses from the previous session. Widget taps open the dated schedule through `slpai://schedule`; do not add inline editing/deletion to home-screen widgets.
- Open the recording tab with 보호자 상담 selected. Web and mobile new-record forms use `recording_end` from the dated schedule (start + 40 minutes). Preserve the schedule's actual end and allow manual time edits.
- AI output is a draft: the app shows drafts and the therapist approves through `/proposals/*`, like the web.

## Commands

```sh
npm run typecheck            # tsc --noEmit
npm run test:widgets         # filtering, full names, time boundaries, session isolation and widget deep links
npx expo-doctor              # dependency/config checks
node --test plugins/with-system-bars.test.js
(cd android && ./gradlew :app:checkSystemBarMigration) # after prebuild
npx expo start               # dev server (needs a development build: npx expo run:android)
npm run build:android        # EAS production build (.aab)
npm run submit:android       # upload to Play Console (internal track, draft)
```
