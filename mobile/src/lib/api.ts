import { getToken } from "./auth";
import { API_DIRECT_URL, API_URL } from "./config";

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const detail = async (res: Response) => {
  let msg = res.statusText || `HTTP ${res.status}`;
  try { const d = await res.json(); msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail); } catch { /* keep statusText */ }
  if (res.status === 504) msg = "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
  return msg;
};

/** Same contract as the web client: JSON in/out, Firebase ID token, `long` requests go straight to Cloud Run. */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; long?: boolean } = {}): Promise<T> {
  const token = await getToken();
  const isFormData = init.body instanceof FormData;
  const { long, json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${long ? API_DIRECT_URL : API_URL}${path}`, {
      ...rest,
      headers: { Accept: "application/json", ...(!isFormData ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string>) },
      body: json !== undefined ? JSON.stringify(json) : init.body,
    });
  } catch {
    throw new ApiError(0, "인터넷 연결을 확인해 주세요.");
  }
  if (!res.ok) throw new ApiError(res.status, await detail(res));
  const text = await res.text(); // 204 (e.g. DELETE) has no body
  return (text ? JSON.parse(text) : undefined) as T;
}

export type Child = { id: string; alias: string; display_name: string; birth_date: string; sex?: string | null; age_months?: number;
  therapist?: string | null; voucher_grade?: string | null; disability_registered?: boolean | null };
export const ageLabel = (m?: number) => (m == null ? "" : `${Math.floor(m / 12)}세 ${m % 12}개월`);
export const errText = (e: unknown) => (e instanceof Error ? e.message : e ? String(e) : "");
