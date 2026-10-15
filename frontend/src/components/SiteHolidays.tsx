import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { Button, Card, Empty, Input, Label, Notice } from "./ui";

type Holiday = { date: string; name: string };

/** Site admin › 휴무일: 전체 휴무일, closed in every organization (no timetable classes that day). */
export default function SiteHolidays() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["platform", "holidays"], queryFn: () => api<Holiday[]>("/platform/holidays") });
  const [f, setF] = useState({ date: "", name: "" });
  const save = useMutation({
    mutationFn: (rows: Holiday[]) => api<Holiday[]>("/platform/holidays", { method: "PUT", json: { holidays: rows } }),
    onSuccess: () => { setF({ date: "", name: "" }); qc.invalidateQueries({ queryKey: ["platform", "holidays"] }); },
  });
  const rows = list.data ?? [];
  const year = new Date().getFullYear().toString();
  const shown = rows.filter((h) => h.date >= year);
  return (
    <Card title="전체 휴무일">
      <p className="mb-3 text-sm text-slate-600">여기 정한 날은 모든 기관의 휴무일이 돼요. 그날은 주간 시간표 수업이 생기지 않고, 이미 생긴 수업 중 출결을 기록하지 않은 것은 지워져요.</p>
      <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate([...rows, { date: f.date, name: f.name.trim() || "휴무" }]); }}>
        <Label label="날짜"><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Label>
        <Label label="이름"><Input maxLength={40} placeholder="예: 설날, 추석" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Label>
        <Button disabled={save.isPending}>추가</Button>
      </form>
      {!shown.length ? <Empty>등록된 전체 휴무일이 없습니다.</Empty> : (
        <div className="flex flex-wrap gap-2">
          {shown.map((h) => (
            <span key={h.date} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1.5 text-sm">
              <b className="tabular-nums">{h.date}</b>{h.name}
              <button className="rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`${h.name} 삭제`} onClick={() => save.mutate(rows.filter((x) => x.date !== h.date))}><Trash2 size={13} /></button>
            </span>))}
        </div>)}
      {save.error && <div className="mt-2"><Notice tone="red">{errText(save.error)}</Notice></div>}
    </Card>
  );
}
