import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import Timetable from "../components/Timetable";
import MonthSheet from "../components/MonthSheet";
import OrgHolidays from "../components/OrgHolidays";
import ChildPicker from "../components/ChildPicker";
import EditClassForm from "../components/EditClassForm";
import { EXTRA, PAY, type Extra, type Pay } from "../lib/extraClass";
import { Badge, Button, Card, Empty, Input, Label, Notice, PageTitle, Select, Table, Tabs, Td } from "../components/ui";

type ScheduleRow = { id: string; child_id: string; date: string; start: string; end: string; therapist: string; status: string;
  pay: Pay; extra?: Extra | null; timetable_entry_id?: string | null; timetable_date?: string | null; note?: string | null };

export default function Schedule() {
  const [view, setView] = useState<"week" | "month" | "dated">("week");
  return (
    <>
      <div className="print:hidden"><PageTitle title="일정 관리" sub="주간 시간표대로 날짜별 일정이 자동으로 채워져요. 출결과 바우처 서류는 날짜별 일정을 씁니다. 기관 휴무일도 여기서 정해요." /></div>
      <Tabs className="print:hidden" value={view} onChange={setView} items={[["week", "주간 시간표"], ["month", "월간 일정표"], ["dated", "날짜별 일정"]]} />
      {view === "week" ? <Timetable /> : view === "month" ? <MonthSheet /> : <DatedSchedule />}
      <div className="print:hidden"><OrgHolidays /></div>
    </>
  );
}

function DatedSchedule() {
  const { children, childId } = useChild();
  const qc = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [f, setF] = useState({ child_id: childId ?? "", date: "", start: "", end: "", therapist: "", note: "", extra: "voucher" });
  const list = useQuery({ queryKey: ["schedules", month], queryFn: () => api<ScheduleRow[]>(`/schedules?month=${month}`) });
  const refresh = () => ["schedules", "attendance", "settlement", "voucher-visits", "class-records"].forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
  const create = useMutation({ mutationFn: () => api("/schedules", { method: "POST", json: { ...f, end: f.end || null, therapist: f.therapist.trim() || null, note: f.note || null } }), onSuccess: refresh });
  const [editing, setEditing] = useState<string | null>(null);
  const cancel = useMutation({ mutationFn: (id: string) => api(`/schedules/${id}/cancel`, { method: "POST" }), onSuccess: refresh });
  const childLabel = (id: string) => {
    const child = children.find((c) => c.id === id);
    return child ? [child.display_name, child.alias].filter(Boolean).join(" · ") : "-";
  };
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">주간 시간표의 수업이 자동으로 들어와요. 여기서 수정한 날짜·시간·메모는 해당 수업에만 적용되며, 고정 주간 시간표는 유지됩니다. 바우처 서류에는 월간 일정표의 결제 일정이 올라가요(실제와 동일이면 처음 5회). 사비 수업은 바우처 서류에서 빠집니다. 같은 치료사 또는 같은 아동의 겹치는 시간은 등록되지 않습니다.</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="수업 추가">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Label label="수업 구분"><Select value={f.extra} onChange={set("extra")} required>{Object.entries(EXTRA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Label>
            <Label label="아동"><ChildPicker value={f.child_id || null} onChange={(id) => setF({ ...f, child_id: id ?? "" })} /></Label>
            <Label label="날짜"><Input type="date" value={f.date} onChange={set("date")} required /></Label>
            <div className="grid grid-cols-2 gap-2"><Label label="시작"><Input type="time" value={f.start} onChange={set("start")} required /></Label><Label label="종료 (선택)"><Input type="time" value={f.end} onChange={set("end")} /></Label></div>
            <Label label="치료사 (비우면 담당)"><Input value={f.therapist} onChange={set("therapist")} /></Label>
            <Label label="메모"><Input value={f.note} onChange={set("note")} /></Label>
            {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
            <Button disabled={create.isPending || !f.child_id || !f.extra}>추가</Button>
          </form>
        </Card>
        <Card title="일정 목록" className="lg:col-span-2" action={<div className="w-44 shrink-0"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="월" /></div>}>
          {!list.data?.length ? <Empty>이 달에 등록된 일정이 없습니다.</Empty> : (
            <Table head={["날짜", "시간", "아동", "수업 구분", "치료사", "상태", ""]}>
              {list.data.map((s) => editing === s.id ? (
                <tr key={s.id}><td colSpan={7} className="px-2"><EditClassForm c={s} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} /></td></tr>
              ) : (
                <tr key={s.id}><Td>{s.date}{s.timetable_date && <div className="text-xs text-indigo-600">개별 수정</div>}</Td><Td>{s.start}–{s.end}</Td><Td>{childLabel(s.child_id)}{s.note && <div className="text-xs text-slate-500">{s.note}</div>}</Td><Td><Badge tone={s.pay === "voucher" ? "indigo" : s.pay === "cognitive" ? "green" : "amber"}>{PAY[s.pay]}</Badge></Td><Td>{s.therapist}</Td>
                  <Td><Badge tone={s.status === "scheduled" ? "indigo" : "slate"}>{s.status === "scheduled" ? "예정" : "취소"}</Badge></Td>
                  <Td>{s.status === "scheduled" && <div className="flex flex-col items-start">
                    <Button variant="ghost" className="px-2 py-1" onClick={() => setEditing(s.id)}>수정</Button>
                    <Button variant="ghost" className="px-2 py-1" onClick={() => cancel.mutate(s.id)}>취소</Button></div>}</Td></tr>))}
            </Table>)}
          {cancel.error && <div className="mt-2"><Notice tone="red">{errText(cancel.error)}</Notice></div>}
        </Card>
      </div>
    </>
  );
}
