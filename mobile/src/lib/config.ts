// Public client configuration, inlined at build time from EXPO_PUBLIC_* (see .env.production). None of these are secrets.
const trim = (s: string | undefined) => (s ?? "").replace(/\/$/, "");

export const FIREBASE = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
};
/** Firebase Hosting `/api` (60 s limit). */
export const API_URL = trim(process.env.EXPO_PUBLIC_API_URL);
/** Cloud Run directly (300 s): long AI requests and recording uploads. Falls back to API_URL. */
export const API_DIRECT_URL = trim(process.env.EXPO_PUBLIC_API_DIRECT_URL) || API_URL;
export const WEB_URL = trim(process.env.EXPO_PUBLIC_WEB_URL);
/** Same version string as frontend/src/lib/privacy.ts; signups record it. */
export const PRIVACY_POLICY_VERSION = "2026-10-15.1";
