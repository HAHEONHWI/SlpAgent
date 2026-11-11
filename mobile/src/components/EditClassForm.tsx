import { useState } from "react";
import { Alert, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { ApiError, api, errText } from "@/lib/api";
import { CLASS_PAY, type EffectivePay, type Extra, type Pay } from "@/lib/extraClass";
import { Button, DateField, Notice, Row, Select, Sheet, TextField } from "./ui";

export type Cls = { id: string; date: string; start: string; end: string; extra?: Extra | null; pay?: EffectivePay | null; note?: string | null; revision?: string };

/** Edit one dated class without changing the fixed weekly timetable (bottom sheet). */
export default function EditClassSheet({ c, onDone, onClose, monthly = false }: { c: Cls | null; onDone: () => void; onClose: () => void; monthly?: boolean }) {
  return <Sheet visible={!!c} onClose={onClose} title="수업 수정">{c && <Form key={c.id} c={c} onDone={onDone} onClose={onClose} monthly={monthly} />}</Sheet>;
}

function Form({ c, onDone, onClose, monthly }: { c: Cls; onDone: () => void; onClose: () => void; monthly: boolean }) {
  const initialPay = c.pay === "pending" ? "" : c.pay ?? (c.extra === "paid" ? "private" : "voucher");
  const [f, setF] = useState({ date: c.date, start: c.start, end: c.end, pay: initialPay as Pay | "", note: c.note ?? "" });
  const save = useMutation({
    mutationFn: () => api(`/schedules/${c.id}${monthly ? "/month-sheet" : ""}`, { method: "PUT", json: { date: f.date, start: f.start, end: f.end || null,
      ...(monthly ? { expected_revision: c.revision } : f.pay && f.pay !== initialPay && { pay: f.pay }),
      ...(f.note !== (c.note ?? "") && { note: f.note.trim() || null }) } }),
    onSuccess: () => { onDone(); onClose(); },
    onError: (error) => {
      if (monthly && error instanceof ApiError && error.status === 409 && !error.message.startsWith("시간 충돌")) {
        onDone();
        onClose();
        Alert.alert("수업을 다시 열어 주세요", error.message);
      }
    },
  });
  const options: [Pay, string][] = [...(Object.entries(CLASS_PAY) as [Pay, string][]), ...(c.pay === "cognitive" ? [["cognitive", "인지"] as [Pay, string]] : [])];
  return (
    <>
      <DateField label="날짜" value={f.date} onChange={(date) => setF({ ...f, date })} />
      <Row style={{ flexWrap: "nowrap" }}>
        <View style={{ flex: 1 }}><DateField label="시작" mode="time" value={f.start} onChange={(start) => setF({ ...f, start })} /></View>
        <View style={{ flex: 1 }}><DateField label="종료" mode="time" value={f.end} onChange={(end) => setF({ ...f, end })} /></View>
      </Row>
      {!monthly && <Select label="수업 구분" placeholder="결제 미설정" value={f.pay} options={options} onChange={(pay) => setF({ ...f, pay })} />}
      <TextField label="메모" value={f.note} maxLength={500} onChangeText={(note) => setF({ ...f, note })} />
      {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
      <Button title="저장" loading={save.isPending} disabled={!f.date || !f.start || (monthly && !c.revision)} onPress={() => save.mutate()} />
    </>
  );
}
