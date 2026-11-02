import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "./api";

export const useRecords = <T = any>(childId: string, kind: string) =>
  useQuery({ queryKey: [kind, childId], queryFn: () => api<T[]>(`/children/${childId}/${kind}`) });

export function useCreate(childId: string, kind: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: unknown) => api(`/children/${childId}/${kind}`, { method: "POST", json }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [kind, childId] }),
  });
}
export const useTherapists = () => useQuery({ queryKey: ["org", "therapists"], queryFn: () => api<string[]>("/org/therapists") }).data ?? [];

/** Invalidate the screens a schedule change shows up on (same set as the web app). */
export const refreshSchedules = (qc: QueryClient, extra: string[] = []) =>
  ["schedules", "attendance", "settlement", "voucher-visits", "class-records", "month-sheet", ...extra].forEach((key) => qc.invalidateQueries({ queryKey: [key] }));

type Slot = { start: string; end: string; therapist: string };
/** The child's class on that date from the timetable-driven schedule (a 보강 counts; a moved/cancelled one doesn't).
 *  Calls onSlot whenever the child or date changes, with the class or null when there is none. */
export function useClassSlot(childId: string | null, date: string, onSlot: (s: Slot | null) => void) {
  const month = date.slice(0, 7);
  const q = useQuery({
    queryKey: ["schedules", month, childId],
    queryFn: () => api<(Slot & { date: string; status: string })[]>(`/schedules?month=${month}&child_id=${childId}`),
    enabled: !!childId && /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
  const cb = useRef(onSlot);
  cb.current = onSlot;
  const seen = useRef("");
  useEffect(() => {
    if (!q.data) return;
    const key = `${childId}|${date}`;
    if (seen.current === key) return;
    seen.current = key;
    const s = q.data.find((r) => r.date === date && r.status === "scheduled");
    cb.current(s ? { start: s.start, end: s.end, therapist: s.therapist } : null);
  }, [q.data, childId, date]);
}
