import { View } from "react-native";
import type { useClassSlot } from "@/lib/hooks";
import { DateField, Row, Select, T } from "./ui";

export function ClassTimeFields({ form }: { form: ReturnType<typeof useClassSlot> }) {
  return (
    <>
      <DateField label="날짜" value={form.date} onChange={form.setDate} />
      {form.loading && <T small muted>시간표를 불러오는 중…</T>}
      {form.slots.length > 1 && (
        <Select label="시간표 수업" value={form.slot?.id ?? ""} onChange={form.selectSlot}
          options={form.slots.map((s) => [s.id, [s.start, s.therapist].filter(Boolean).join(" · ")])} />)}
      {form.error && <T small muted>시간표를 불러오지 못했어요. 시간을 직접 입력할 수 있어요.</T>}
      <Row style={{ flexWrap: "nowrap" }}>
        <View style={{ flex: 1 }}><DateField label="시작 (선택)" mode="time" optional value={form.start} onChange={(v) => form.edit("start", v)} /></View>
        <View style={{ flex: 1 }}><DateField label="종료 (선택)" mode="time" optional value={form.end} onChange={(v) => form.edit("end", v)} /></View>
      </Row>
    </>
  );
}
