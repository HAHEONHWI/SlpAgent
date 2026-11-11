import { getToken } from "./auth";

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

// Firebase Hosting cuts off requests it forwards to Cloud Run after 60 s (HTTP 504). Long AI requests
// (analysis, transcription, AI dialogue) go straight to the Cloud Run URL, which allows 300 s.
const DIRECT_API = (import.meta.env.VITE_API_DIRECT_URL as string | undefined)?.replace(/\/$/, "");

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; long?: boolean } = {}): Promise<T> {
  const token = await getToken();
  const isFormData = init.body instanceof FormData;
  const { long, json, ...rest } = init;
  const base = long && DIRECT_API ? DIRECT_API : "/api";
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: { ...(!isFormData ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    body: json !== undefined ? JSON.stringify(json) : init.body,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const d = await res.json(); msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail); } catch { /* keep statusText */ }
    if (res.status === 504) msg = "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
    throw new ApiError(res.status, msg);
  }
  const text = await res.text();  // 204 (e.g. DELETE) has no body
  return (text ? JSON.parse(text) : undefined) as T;
}

/** POST that returns a file; saves it with the server's file name (Content-Disposition, UTF-8 aware). */
export async function download(path: string, json: unknown, fallbackName: string): Promise<string> {
  const token = await getToken();
  const res = await fetch(`/api${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(json) });
  if (!res.ok) {
    let msg = res.statusText;
    try { const d = await res.json(); msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail); } catch { /* keep statusText */ }
    throw new ApiError(res.status, msg);
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const name = star ? decodeURIComponent(star[1]) : /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

export type Child = { id: string; alias: string; display_name: string; birth_date: string; sex?: string; age_months?: number; voucher_grade?: string | null; disability_registered?: boolean | null };
export const ageLabel = (m?: number) => (m == null ? "" : `${Math.floor(m / 12)}세 ${m % 12}개월`);
