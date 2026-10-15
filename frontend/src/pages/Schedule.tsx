import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import Timetable from "../components/Timetable";
import ChildPicker from "../components/ChildPicker";
import { EXTRA } from "../lib/extraClass";
import { Badge, Button, Card, Empty, Input, Label, Notice, PageTitle, Select, Table, Td } from "../components/ui";

export default function Schedule() {
  const [view, setView] = useState<"week" | "dated">("week");
  return (
    <>
      <div className="print:hidden"><PageTitle title="일정 관리" sub="주간 시간표대로 날짜별 일정이 자동으로 채워져요. 출결과 바우처 서류는 날짜별 일정을 씁니다." /></div>
      <div className="mb-4 inline-grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm print:hidden">
        {(["week", "dated"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-md px-4 py-1.5 ${view === v ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}>{v === "week" ? "주간 시간표" : "날짜별 일정"}</button>)}
      </div>
      {view === "week" ? <Timetable /> : <DatedSchedule />}
    </>
  );
}

function DatedSchedule() {
  const { children, childId } = useChild();
  const qc = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [f, setF] = useState({ child_id: childId ?? "", date: "", start: "", end: "", therapist: "", note: "", extra: "" });
  const list = useQuery({ queryKey: ["schedules", month], queryFn: () => api<any[]>(`/schedules?month=${month}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["schedules"] });
  const create = useMutation({ mutationFn: () => api("/schedules", { method: "POST", json: { ...f, end: f.end || null, therapist: f.therapist.trim() || null, note: f.note || null } }), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/schedules/${id}/cancel`, { method: "POST" }), onSuccess: refresh });
  const alias = (id: string) => children.find((c) => c.id === id)?.alias ?? "-";
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">주간 시간표에 있는 수업은 자동으로 들어와 있어요. 여기서는 추가(바우처 5회)·추가(유료) 수업을 넣거나 수업을 취소할 수 있어요. 유료 수업은 바우처 서류에서 빠집니다. 같은 치료사 또는 같은 아동의 겹치는 시간은 등록되지 않습니다.</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="수업 추가">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Label label="종류"><Select value={f.extra} onChange={set("extra")} required><option value="" disabled>고르세요</option>{Object.entries(EXTRA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Label>
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
            <Table head={["날짜", "시간", "아동", "치료사", "상태", ""]}>
              {list.data.map((s) => (
                <tr key={s.id}><Td>{s.date}</Td><Td>{s.start}–{s.end}</Td><Td>{alias(s.child_id)}{s.extra && <span className="ml-1.5"><Badge tone={s.extra === "paid" ? "amber" : "indigo"}>{EXTRA[s.extra as keyof typeof EXTRA]}</Badge></span>}</Td><Td>{s.therapist}</Td>
                  <Td><Badge tone={s.status === "scheduled" ? "indigo" : "slate"}>{s.status === "scheduled" ? "예정" : "취소"}</Badge></Td>
                  <Td>{s.status === "scheduled" && <Button variant="ghost" onClick={() => cancel.mutate(s.id)}>취소</Button>}</Td></tr>))}
            </Table>)}
          {cancel.error && <div className="mt-2"><Notice tone="red">{errText(cancel.error)}</Notice></div>}
        </Card>
      </div>
    </>
  );
}
