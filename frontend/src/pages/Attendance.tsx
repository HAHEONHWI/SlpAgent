import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import { Badge, Button, Card, Empty, Input, Notice, PageTitle, Table, Td } from "../components/ui";

type Mark = { status: string; minutes_late?: number | null; note?: string | null };
type Row = { schedule_id: string; child_id: string; start: string; end: string; therapist: string; attendance: Mark | null };
type Summary = { child_id: string; scheduled: number; present: number; late: number; absent: number; excused: number; makeup: number; marked: number; rate_pct: number | null };

const ST: Record<string, [string, "green" | "amber" | "red" | "slate" | "indigo"]> = {
  present: ["출석", "green"], late: ["지각", "amber"], absent: ["결석", "red"], excused: ["사유결석", "slate"], makeup: ["보강", "indigo"],
};
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function Attendance() {
  const { children } = useChild();
  const qc = useQueryClient();
  const [day, setDay] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [late, setLate] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const roll = useQuery({ queryKey: ["attendance", "day", day], queryFn: () => api<Row[]>(`/attendance/day?on=${day}`) });
  const summary = useQuery({ queryKey: ["attendance", "summary", month], queryFn: () => api<Summary[]>(`/attendance/summary?month=${month}`) });
  const mark = useMutation({
    mutationFn: ({ sid, status }: { sid: string; status: string }) => api(`/schedules/${sid}/attendance`, { method: "PUT", json: {
      status, minutes_late: status === "late" && late[sid] ? Number(late[sid]) : null, note: note[sid]?.trim() || null } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
  const who = (id: string) => { const c = children.find((x) => x.id === id); return c ? `${c.alias} · ${c.display_name}` : "–"; };
  return (
    <>
      <PageTitle title="출결 관리" sub="일정에 등록된 회기별로 출결을 기록합니다. 사유결석은 출석률 계산에서 제외되고, 보강은 출석으로 셉니다." />
      <div className="space-y-4">
        <Card title="일별 출석 체크" action={<div className="w-44 shrink-0"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="날짜" /></div>}>
          {roll.isLoading ? <p className="text-sm text-slate-400">불러오는 중…</p> : !roll.data?.length ? <Empty>이 날짜에 예정된 회기가 없습니다. 일정 관리에서 먼저 일정을 등록하세요.</Empty> : (
            <Table head={["시간", "아동", "치료사", "현재", "출결 기록", "지각(분)·메모"]}>
              {roll.data.map((r) => {
                const cur = r.attendance?.status;
                return (
                  <tr key={r.schedule_id}>
                    <Td className="whitespace-nowrap">{r.start}–{r.end}</Td><Td className="font-medium">{who(r.child_id)}</Td><Td>{r.therapist}</Td>
                    <Td>{cur ? <Badge tone={ST[cur][1]}>{ST[cur][0]}{cur === "late" && r.attendance?.minutes_late ? ` ${r.attendance.minutes_late}분` : ""}</Badge> : <span className="text-xs text-slate-400">미기록</span>}
                      {r.attendance?.note && <p className="mt-1 text-xs text-slate-500">{r.attendance.note}</p>}</Td>
                    <Td><div className="flex flex-wrap gap-1" role="group" aria-label="출결 선택">
                      {Object.entries(ST).map(([k, [l]]) => (
                        <Button key={k} variant={cur === k ? "primary" : "outline"} aria-pressed={cur === k} disabled={mark.isPending}
                          onClick={() => mark.mutate({ sid: r.schedule_id, status: k })}>{l}</Button>))}
                    </div></Td>
                    <Td><div className="flex gap-1">
                      <Input className="w-16" type="number" min={0} max={240} placeholder="분" value={late[r.schedule_id] ?? ""} onChange={(e) => setLate({ ...late, [r.schedule_id]: e.target.value })} aria-label="지각 분" />
                      <Input className="w-40" placeholder="메모 (예: 감기)" maxLength={500} value={note[r.schedule_id] ?? ""} onChange={(e) => setNote({ ...note, [r.schedule_id]: e.target.value })} aria-label="메모" />
                    </div></Td>
                  </tr>);
              })}
            </Table>)}
          <p className="mt-2 text-xs text-slate-500">지각 분·메모를 먼저 적고 출결 버튼을 누르면 함께 저장됩니다. 다시 누르면 기존 기록을 바꿉니다.</p>
          {mark.error && <div className="mt-2"><Notice tone="red">{errText(mark.error)}</Notice></div>}
        </Card>

        <Card title="월별 출석 현황" action={<div className="w-44 shrink-0"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="월" /></div>}>
          {!summary.data?.length ? <Empty>이 달의 일정이 없습니다.</Empty> : (
            <Table head={["아동", "예정 회기", "출석", "지각", "보강", "결석", "사유결석", "미기록", "출석률"]}>
              {summary.data.map((s) => (
                <tr key={s.child_id}>
                  <Td className="font-medium">{who(s.child_id)}</Td><Td>{s.scheduled}</Td><Td>{s.present}</Td><Td>{s.late}</Td><Td>{s.makeup}</Td>
                  <Td className={s.absent ? "font-semibold text-red-700" : ""}>{s.absent}</Td><Td>{s.excused}</Td><Td>{Math.max(0, s.scheduled - s.marked)}</Td>
                  <Td>{s.rate_pct == null ? "–" : <Badge tone={s.rate_pct >= 90 ? "green" : s.rate_pct >= 75 ? "amber" : "red"}>{s.rate_pct}%</Badge>}</Td>
                </tr>))}
            </Table>)}
          <p className="mt-2 text-xs text-slate-500">출석률 = (출석+지각+보강) ÷ (출석+지각+보강+결석). 서버에서 계산합니다.</p>
        </Card>
      </div>
    </>
  );
}
