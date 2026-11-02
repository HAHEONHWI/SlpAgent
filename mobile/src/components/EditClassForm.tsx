import { useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { api, errText } from "@/lib/api";
import { CLASS_PAY, type Extra, type Pay } from "@/lib/extraClass";
import { Button, DateField, Notice, Row, Select, Sheet, TextField } from "./ui";

export type Cls = { id: string; date: string; start: string; end: string; extra?: Extra | null; pay?: Pay | null; note?: string | null };

/** Edit one dated class without changing the fixed weekly timetable (bottom sheet). */
export default function EditClassSheet({ c, onDone, onClose }: { c: Cls | null; onDone: () => void; onClose: () => void }) {
  return <Sheet visible={!!c} onClose={onClose} title="수업 수정">{c && <Form key={c.id} c={c} onDone={onDone} onClose={onClose} />}</Sheet>;
}

function Form({ c, onDone, onClose }: { c: Cls; onDone: () => void; onClose: () => void }) {
  const [f, setF] = useState({ date: c.date, start: c.start, end: c.end, pay: (c.pay ?? (c.extra === "paid" ? "private" : "voucher")) as Pay, note: c.note ?? "" });
  const save = useMutation({
    mutationFn: () => api(`/schedules/${c.id}`, { method: "PUT", json: { date: f.date, start: f.start, end: f.end || null, pay: f.pay,
      ...(f.note !== (c.note ?? "") && { note: f.note.trim() || null }) } }),
    onSuccess: () => { onDone(); onClose(); },
  });
  const options: [Pay, string][] = [...(Object.entries(CLASS_PAY) as [Pay, string][]), ...(c.pay === "cognitive" ? [["cognitive", "인지"] as [Pay, string]] : [])];
  return (
    <>
      <DateField label="날짜" value={f.date} onChange={(date) => setF({ ...f, date })} />
      <Row style={{ flexWrap: "nowrap" }}>
        <View style={{ flex: 1 }}><DateField label="시작" mode="time" value={f.start} onChange={(start) => setF({ ...f, start })} /></View>
        <View style={{ flex: 1 }}><DateField label="종료" mode="time" value={f.end} onChange={(end) => setF({ ...f, end })} /></View>
      </Row>
      <Select label="수업 구분" value={f.pay} options={options} onChange={(pay) => setF({ ...f, pay })} />
      <TextField label="메모" value={f.note} maxLength={500} onChangeText={(note) => setF({ ...f, note })} />
      {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
      <Button title="저장" loading={save.isPending} disabled={!f.date || !f.start} onPress={() => save.mutate()} />
    </>
  );
}
