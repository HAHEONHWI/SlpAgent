import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api";
import { today } from "./dates";

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

type Slot = { id: string; date: string; status: string; start: string; recording_end?: string | null; therapist: string };
type SlotForm = { childId: string | null; date: string; slotId?: string; start?: string; end?: string; counselor?: string };

/** Resolve the selected day's schedule while keeping manual edits scoped to the current child, date and class. */
export function useClassSlot(childId: string | null, defaultCounselor = "") {
  const [form, setForm] = useState<SlotForm>(() => ({ childId, date: today() }));
  const { date } = form;
  if (form.childId !== childId) setForm({ childId, date });
  const month = date.slice(0, 7);
  const q = useQuery({
    queryKey: ["schedules", month, childId],
    queryFn: () => api<Slot[]>(`/schedules?month=${month}&child_id=${childId}`),
    enabled: !!childId && /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
  const slots = q.data?.filter((s) => s.date === date && s.status === "scheduled") ?? [];
  const slot = slots.find((s) => s.id === form.slotId) ?? slots[0];
  const start = form.start ?? (slot?.recording_end ? slot.start : "");
  const end = form.end ?? slot?.recording_end ?? "";
  let timeError = "";
  if (!!start !== !!end) timeError = "시작과 종료 시간을 모두 입력하거나 모두 비워 주세요.";
  else if (start && end <= start) timeError = "종료 시간은 시작 시간보다 늦어야 해요.";
  return {
    date, slots, slot, start, end, timeError, loading: q.isLoading, error: q.isError && !q.data,
    counselor: form.counselor ?? (slot?.therapist || defaultCounselor),
    setDate: (next: string) => { if (date !== next) setForm({ childId, date: next }); },
    selectSlot: (slotId: string) => setForm({ childId, date, slotId }),
    edit: (field: "start" | "end" | "counselor", value: string) => setForm((f) =>
      field === "counselor" ? { ...f, counselor: value } : { ...f, start: f.start ?? start, end: f.end ?? end, [field]: value }),
  };
}
