import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
export const errText = (e: unknown) => (e instanceof Error ? e.message : "");

type Slot = { id: string; date: string; status: string; start: string; recording_end?: string | null; therapist: string };
type Selection = { date: string; slotId?: string; times?: { start: string; end: string }; counselor?: string };

export function useClassSlot(childId: string) {
  const [selection, setSelection] = useState<Selection>(() => {
    const now = new Date();
    return { date: new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10) };
  });
  const { date } = selection;
  const month = date.slice(0, 7);
  const q = useQuery({
    queryKey: ["schedules", month, childId],
    queryFn: () => api<Slot[]>(`/schedules?month=${month}&child_id=${encodeURIComponent(childId)}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
  const slots = q.data?.filter((s) => s.date === date && s.status === "scheduled") ?? [];
  const slot = slots.find((s) => s.id === selection.slotId) ?? slots[0];
  const times = selection.times ?? { start: slot?.recording_end ? slot.start : "", end: slot?.recording_end ?? "" };
  return {
    date, ...times, counselor: selection.counselor ?? slot?.therapist ?? "",
    slots, slotId: slot?.id, error: q.error,
    setDate: (date: string) => setSelection({ date }),
    setSlot: (slotId: string) => setSelection({ date, slotId }),
    setTime: (field: "start" | "end", value: string) =>
      setSelection((prev) => ({ ...prev, times: { ...(prev.times ?? times), [field]: value } })),
    setCounselor: (counselor: string) => setSelection((prev) => ({ ...prev, counselor })),
  };
}
