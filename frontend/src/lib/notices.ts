import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useMe } from "./me";

export type Notice = { id: string; title: string; body: string; pinned: boolean; created_at: string; updated_at?: string; author_name?: string | null; scope: "site" | "org" };

const key = (uid?: string) => `noticesSeen:${uid ?? ""}`;
/** Newest notice time this person has already seen (per browser; only used for the unread count). */
export const seenAt = (uid?: string) => { try { return localStorage.getItem(key(uid)) ?? ""; } catch { return ""; } };
export const markSeen = (uid: string | undefined, notices: Notice[]) => {
  const newest = notices.reduce((m, n) => (n.created_at > m ? n.created_at : m), "");
  try { if (newest) localStorage.setItem(key(uid), newest); } catch { /* storage off: badge just stays */ }
};

export function useNotices() {
  const me = useMe().data;
  return useQuery({ queryKey: ["notices"], queryFn: () => api<Notice[]>("/notices"), enabled: me?.status === "active", refetchInterval: 5 * 60_000 });
}
