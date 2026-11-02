import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { CLASS_PAY, type Extra, type Pay } from "../lib/extraClass";
import { Button, Input, Label, Notice, Select } from "./ui";

type Cls = { id: string; date: string; start: string; end: string; extra?: Extra | null; pay?: Pay | null; note?: string | null };

/** Edit one dated class without changing the fixed weekly timetable. */
export default function EditClassForm({ c, onDone, onCancel }: { c: Cls; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ date: c.date, start: c.start, end: c.end, pay: c.pay ?? (c.extra === "paid" ? "private" : "voucher"), note: c.note ?? "" });
  const save = useMutation({
    mutationFn: () => api(`/schedules/${c.id}`, { method: "PUT", json: { date: f.date, start: f.start, end: f.end || null, pay: f.pay,
      ...(f.note !== (c.note ?? "") && { note: f.note.trim() || null }) } }),
    onSuccess: onDone,
  });
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Label label="날짜"><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Label>
      <Label label="시작"><Input type="time" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Label>
      <Label label="종료"><Input type="time" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Label>
      <Label label="수업 구분"><Select value={f.pay} onChange={(e) => {
        const pay = e.target.value;
        if (pay === "voucher" || pay === "private" || pay === "cognitive") setF({ ...f, pay });
      }}>
        {Object.entries(CLASS_PAY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        {c.pay === "cognitive" && <option value="cognitive">인지</option>}
      </Select></Label>
      <Label label="메모"><Input value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} /></Label>
      <Button disabled={save.isPending}>저장</Button>
      <Button type="button" variant="ghost" onClick={onCancel}>취소</Button>
      {save.error && <div className="w-full"><Notice tone="red">{errText(save.error)}</Notice></div>}
    </form>
  );
}
