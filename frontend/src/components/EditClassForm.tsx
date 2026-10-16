import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { EXTRA, type Extra } from "../lib/extraClass";
import { Button, Input, Label, Notice, Select } from "./ui";

type Cls = { id: string; date: string; start: string; end: string; extra?: Extra | null };

/** Fix an added class (수업 추가·보강) entered with the wrong day, time or kind. */
export default function EditClassForm({ c, onDone, onCancel }: { c: Cls; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ date: c.date, start: c.start, end: c.end, extra: c.extra ?? "" });
  const save = useMutation({
    mutationFn: () => api(`/schedules/${c.id}`, { method: "PUT", json: { date: f.date, start: f.start, end: f.end || null, extra: f.extra || null } }),
    onSuccess: onDone,
  });
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Label label="날짜"><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Label>
      <Label label="시작"><Input type="time" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Label>
      <Label label="종료"><Input type="time" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Label>
      {c.extra && <Label label="종류"><Select value={f.extra} onChange={(e) => setF({ ...f, extra: e.target.value as Extra })}>
        {(Object.keys(EXTRA) as Extra[]).map((k) => <option key={k} value={k}>{EXTRA[k]}</option>)}</Select></Label>}
      <Button disabled={save.isPending}>저장</Button>
      <Button type="button" variant="ghost" onClick={onCancel}>취소</Button>
      {save.error && <div className="w-full"><Notice tone="red">{errText(save.error)}</Notice></div>}
    </form>
  );
}
