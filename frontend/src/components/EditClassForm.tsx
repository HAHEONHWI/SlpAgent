import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { errText } from "../lib/hooks";
import { CLASS_PAY, type Extra, type Pay } from "../lib/extraClass";
import { Button, Input, Label, Notice, Select } from "./ui";

type Cls = { id: string; date: string; start: string; end: string; extra?: Extra | null; pay?: Pay | null; note?: string | null };

/** Edit one dated class without changing the fixed weekly timetable. */
export default function EditClassForm({ c, monthly, onDone, onCancel }: { c: Cls; monthly?: { revision: string; onStale: () => Promise<void> }; onDone: () => void; onCancel: () => void }) {
  const originalPay = c.pay ?? (c.extra === "paid" ? "private" : "voucher");
  const [f, setF] = useState({ date: c.date, start: c.start, end: c.end, pay: originalPay, note: c.note ?? "" });
  const save = useMutation({
    mutationFn: () => api(`/schedules/${c.id}${monthly ? "/month-sheet" : ""}`, { method: "PUT", json: { date: f.date, start: f.start, end: f.end || null,
      ...(monthly && { expected_revision: monthly.revision }), ...(!monthly && f.pay !== originalPay && f.pay !== "pending" && { pay: f.pay }),
      ...(f.note !== (c.note ?? "") && { note: f.note.trim() || null }) } }),
    onSuccess: onDone,
    onError: async (error) => {
      if (monthly && error instanceof ApiError && ([403, 404].includes(error.status) || (error.status === 409 && !error.message.startsWith("시간 충돌")))) await monthly.onStale();
    },
  });
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Label label="날짜"><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Label>
      <Label label="시작"><Input type="time" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Label>
      <Label label="종료"><Input type="time" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Label>
      {!monthly && <Label label="수업 구분"><Select value={f.pay} onChange={(e) => {
        const pay = e.target.value;
        if (pay === "voucher" || pay === "private" || pay === "cognitive") setF({ ...f, pay });
      }}>
        {c.pay === "pending" && <option disabled value="pending">결제 미설정</option>}
        {Object.entries(CLASS_PAY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        {c.pay === "cognitive" && <option value="cognitive">인지</option>}
      </Select></Label>}
      <Label label="메모"><Input value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} /></Label>
      <Button disabled={save.isPending}>저장</Button>
      <Button type="button" variant="ghost" disabled={save.isPending} onClick={onCancel}>취소</Button>
      {save.error && <div className="w-full"><Notice tone="red">{errText(save.error)}</Notice></div>}
    </form>
  );
}
