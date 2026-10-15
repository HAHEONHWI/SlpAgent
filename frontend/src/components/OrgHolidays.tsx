import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { useMe } from "../lib/me";
import { Badge, Button, Card, Empty, Input, Label, Notice } from "./ui";

type Holiday = { date: string; name: string; scope?: "site" | "org" };
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/** 일정 관리 › 기관 휴무일: the organization admin sets them; everyone else sees them. 전체 휴무일 come from the site admin. */
export default function OrgHolidays() {
  const isAdmin = useMe().data?.role === "admin";
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["holidays"], queryFn: () => api<Holiday[]>("/org/holidays") });
  const [f, setF] = useState({ date: "", name: "" });
  const save = useMutation({
    mutationFn: (rows: Holiday[]) => api<Holiday[]>("/org/holidays", { method: "PUT", json: { holidays: rows } }),
    onSuccess: () => { setF({ date: "", name: "" }); ["holidays", "timetable", "schedules", "attendance", "settlement", "voucher-visits"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });
  const all = list.data ?? [];
  const rows = all.filter((h) => h.scope !== "site").map(({ date, name }) => ({ date, name }));  // only the organization's own ones are saved here
  const upcoming = all.filter((h) => h.date >= today().slice(0, 7));
  return (
    <Card title="기관 휴무일" className="mt-4">
      {isAdmin && (
        <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate([...rows, { date: f.date, name: f.name.trim() || "휴무" }]); }}>
          <Label label="날짜"><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Label>
          <Label label="이름"><Input maxLength={40} placeholder="예: 한글날, 원내 행사" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Label>
          <Button disabled={save.isPending}>추가</Button>
        </form>)}
      {!upcoming.length ? <Empty>등록된 휴무일이 없습니다.</Empty> : (
        <div className="flex flex-wrap gap-2">
          {upcoming.map((h) => (
            <span key={h.date} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1.5 text-sm">
              <b className="tabular-nums">{md(h.date)}</b>{h.name}
              {h.scope === "site" ? <Badge tone="indigo">전체</Badge> : isAdmin && <button className="rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`${h.name} 삭제`} onClick={() => save.mutate(rows.filter((x) => x.date !== h.date))}><Trash2 size={13} /></button>}
            </span>))}
        </div>)}
      <p className="mt-2 text-xs text-slate-500">휴무일에는 주간 시간표 수업이 생기지 않고, 이미 생긴 수업 중 출결을 기록하지 않은 것은 빠져요. ‘전체’ 휴무일은 사이트 관리자가 모든 기관에 정한 날이에요. {isAdmin ? "" : "기관 휴무일은 기관 관리자가 정해요."}</p>
      {save.error && <div className="mt-2"><Notice tone="red">{errText(save.error)}</Notice></div>}
    </Card>
  );
}
