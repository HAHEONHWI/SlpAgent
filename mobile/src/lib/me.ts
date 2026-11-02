import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth } from "./auth";

export type Me = {
  uid: string; email: string | null; name?: string | null; therapist_name?: string | null; org_id: string | null; role: string | null; site_admin: boolean; org_name?: string | null; can_settle?: boolean;
  status: "site_admin" | "active" | "pending" | "approved" | "rejected" | "none";
  signup: { status: string; org_name: string; therapist_name: string; reason: string | null; created_at: string; org_id?: string | null } | null;
};

/** Account routing state: site admin, active org member, or a signup that is pending/rejected. */
export function useMe() {
  const { signedIn, label } = useAuth();
  return useQuery({ queryKey: ["me", label], queryFn: () => api<Me>("/me"), enabled: signedIn });
}
export const canWrite = (me: Me | undefined) => me?.role === "admin" || me?.role === "therapist";
export const roleLabel = (me: Me | undefined) => !me?.role ? "" : me.role === "admin" ? "기관 관리자"
  : me.role === "therapist" ? (me.can_settle ? "치료사 · 회계 담당" : "치료사") : me.role === "assistant" ? "보조 (읽기 전용)" : me.role;
