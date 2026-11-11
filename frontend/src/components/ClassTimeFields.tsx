import type { useClassSlot } from "../lib/hooks";
import { Input, Label, Notice, Select } from "./ui";

export default function ClassTimeFields({ slot }: { slot: ReturnType<typeof useClassSlot> }) {
  return <>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div className="col-span-2 sm:col-span-1"><Label label="날짜"><Input type="date" value={slot.date} onChange={(e) => slot.setDate(e.target.value)} required /></Label></div>
      <Label label="시작 (선택)"><Input type="time" value={slot.start} onChange={(e) => slot.setTime("start", e.target.value)} required={!!slot.end} /></Label>
      <Label label="종료 (선택)"><Input type="time" value={slot.end} onChange={(e) => slot.setTime("end", e.target.value)} required={!!slot.start} /></Label>
    </div>
    {slot.slots.length > 1 && <Label label="시간표 수업"><Select value={slot.slotId} onChange={(e) => slot.setSlot(e.target.value)}>
      {slot.slots.map((s) => <option key={s.id} value={s.id}>{s.start} · {s.therapist}</option>)}
    </Select></Label>}
    {slot.error && <Notice>시간표를 불러오지 못했어요. 시간을 직접 입력할 수 있어요.</Notice>}
  </>;
}
