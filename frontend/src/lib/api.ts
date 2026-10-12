import { getToken } from "./auth";

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const d = await res.json(); msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail); } catch { /* keep statusText */ }
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export type Child = { id: string; alias: string; display_name: string; birth_date: string; sex?: string; age_months?: number };
export const ageLabel = (m?: number) => (m == null ? "" : `${Math.floor(m / 12)}세 ${m % 12}개월`);
