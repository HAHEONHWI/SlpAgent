import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { errText } from "../lib/hooks";
import { useMe } from "../lib/me";
import { Button, Notice } from "./ui";

type Setting = { same_as_actual: boolean; revision: string | null; therapist: string };

export default function PaymentSettings({ onEditingChange }: { onEditingChange?: (editing: boolean) => void }) {
  const qc = useQueryClient();
  const me = useMe().data;
  const enabled = !!me?.therapist_name && (me.role === "therapist" || me.role === "admin");
  const key = ["payment-settings", me?.org_id, me?.uid];
  const q = useQuery({ queryKey: key, queryFn: () => api<Setting>("/me/payment-settings"), enabled });
  const [draft, setDraft] = useState<Setting | null>(null);
  const edit = (value: Setting | null) => { setDraft(value); onEditingChange?.(value !== null); };
  const save = useMutation({
    mutationFn: (value: Setting) => api<Setting>("/me/payment-settings", { method: "PUT", json: { same_as_actual: value.same_as_actual, expected_revision: value.revision } }),
    onSuccess: async (saved) => {
      qc.setQueryData(key, saved);
      await Promise.all(["month-sheet", "schedules", "attendance", "settlement", "voucher-visits", "class-records"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      edit(null);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) { await q.refetch(); edit(null); }
    },
  });
  if (!enabled) return null;
  return <section className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm print:hidden" aria-label="내 결제 설정">
    <h3 className="font-semibold">내 결제 설정</h3>
    <p className="text-slate-600">저장한 달부터 매달 담당 아동에게 적용돼요. 아동별로 입력한 결제 일정이 있으면 그 날짜를 사용해요.</p>
    {q.data && <>
      <label className="flex items-center gap-2"><input type="checkbox" disabled={!draft || save.isPending}
        checked={(draft ?? q.data).same_as_actual} onChange={(e) => draft && setDraft({ ...draft, same_as_actual: e.target.checked })} />
        실제 일정과 동일 · 아동별 월 첫 5회만 바우처</label>
      {draft ? <div className="flex gap-2">
        <Button disabled={save.isPending || draft.same_as_actual === q.data.same_as_actual} onClick={() => save.mutate(draft)}>내 설정 저장</Button>
        <Button variant="ghost" disabled={save.isPending} onClick={() => edit(null)}>취소</Button>
      </div> : <Button variant="outline" onClick={() => { save.reset(); edit(q.data); }}>내 설정 변경</Button>}
    </>}
    {save.isSuccess && !draft && <p role="status" className="text-green-700">내 결제 설정을 저장했어요.</p>}
    {(q.error || save.error) && <Notice tone="red">{errText(q.error ?? save.error)}</Notice>}
  </section>;
}
