import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2, Undo2 } from "lucide-react";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import { EXTRA, PAY, type Extra, type Pay } from "../lib/extraClass";
import ChildPicker from "../components/ChildPicker";
import EditClassForm from "../components/EditClassForm";
import { Badge, Button, Empty, Input, Label, Notice, PageTitle, Segmented, Table, Tabs, Td } from "../components/ui";

type State = { status: string | null; auto: boolean; reason: string | null };
type Mark = { status: string; minutes_late?: number | null; note?: string | null };
type Row = { schedule_id: string; child_id: string; date: string; start: string; end: string; therapist: string; attendance: Mark | null; state: State;
  moved_to: { date: string; start: string } | null; moved_from: string | null; extra?: Extra | null; source?: string | null;
  pay?: Pay | null; pay_auto?: boolean };
type Summary = { child_id: string; scheduled: number; present: number; late: number; absent: number; excused: number; makeup: number;
  auto: number; upcoming: number; moved: number; rate_pct: number | null };
type Absence = { id: string; child_id: string; start: string; end: string; reason: string | null };
type Rec = { date: string; start: string; end: string; status: string | null; auto: boolean; reason: string | null; extra?: Extra | null; pay?: Pay | null };

const ST: Record<string, [string, "green" | "amber" | "red" | "slate" | "indigo"]> = {
  present: ["출석", "green"], late: ["지각", "amber"], absent: ["결석", "red"], excused: ["사유결석", "slate"], makeup: ["보강", "indigo"],
  moved: ["옮김", "slate"], cancelled: ["취소", "slate"],
};
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

export default function Attendance() {
  const { children } = useChild();
  const qc = useQueryClient();
  const [day, setDay] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [tab, setTab] = useState<"day" | "month" | "long">("day");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["attendance"] }); qc.invalidateQueries({ queryKey: ["schedules"] }); qc.invalidateQueries({ queryKey: ["voucher-visits"] }); };
  const who = (id: string) => { const c = children.find((x) => x.id === id); return c ? `${c.display_name} · ${c.alias}` : "–"; };
  const roll = useQuery({ queryKey: ["attendance", "day", day], queryFn: () => api<Row[]>(`/attendance/day?on=${day}`) });
  const summary = useQuery({ queryKey: ["attendance", "summary", month], queryFn: () => api<Summary[]>(`/attendance/summary?month=${month}`) });
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState("");
  const exportXlsx = async () => {
    setExporting(true); setExportError("");
    try {
      const rows = summary.data ?? [];
      const recs = await Promise.all(rows.map((s) => api<{ records: Rec[] }>(`/children/${s.child_id}/attendance?month=${month}`)));
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const b = (value: string) => ({ value, fontWeight: "bold" as const });
      const totals = [["아동", "수업", "출석", "(자동)", "지각", "결석", "사유결석", "옮김", "남은 수업", "출석률(%)"].map(b),
        ...rows.map((s) => [who(s.child_id), s.scheduled, s.present + s.makeup, s.auto, s.late, s.absent, s.excused, s.moved, s.upcoming, s.rate_pct])];
      const classes = [["날짜", "시간", "아동", "구분", "결제", "출결", "사유"].map(b),
        ...rows.flatMap((s, i) => recs[i].records.map((r) => [r.date, `${r.start}–${r.end}`, who(s.child_id), r.extra ? EXTRA[r.extra] : "정규", r.pay ? PAY[r.pay] : "-",
          r.status ? `${ST[r.status]?.[0] ?? r.status}${r.auto && r.status === "present" ? " (자동)" : ""}` : "예정", r.reason]))
          .sort((x, y) => `${x[0]}${x[1]}`.localeCompare(`${y[0]}${y[1]}`))];
      await writeXlsxFile([
        { data: totals, sheet: "월별 현황", columns: [{ width: 22 }, ...Array(9).fill({ width: 9 })], stickyRowsCount: 1 },
        { data: classes, sheet: "수업별 출결", columns: [{ width: 12 }, { width: 13 }, { width: 22 }, { width: 16 }, { width: 8 }, { width: 12 }, { width: 30 }], stickyRowsCount: 1 },
      ]).toFile(`출결_${month}.xlsx`);
    } catch (e) { setExportError(errText(e)); } finally { setExporting(false); }
  };

  const count = (k: string) => (roll.data ?? []).filter((r) => r.state.status === k).length;
  const dayLabel = new Date(`${day}T00:00`).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  return (
    <>
      <PageTitle title="출결 관리" sub="수업은 따로 체크하지 않으면 출석으로 처리돼요. 결석·사유결석·지각, 보강(수업 옮기기), 장기결강만 여기서 기록하세요. 기관 휴무일은 일정 관리에서 정해요. 바우처 서류에 자동으로 반영됩니다." />
      <Tabs value={tab} onChange={setTab} items={[["day", "일별 출결"], ["month", "월별 현황"], ["long", "장기결강"]]} />
      {tab === "day" && (
        <section>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-semibold md:text-[25px]">{dayLabel}</h3>
            <Badge>기본 출석 처리 · 예외만 기록</Badge>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              {!!roll.data?.length && <span className="text-[13px]">결석 {count("absent")} · 사유결석 {count("excused")} · 지각 {count("late")}</span>}
              <div className="w-44"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="날짜" /></div>
            </div>
          </div>
          {roll.isLoading ? <p className="text-sm text-slate-400">불러오는 중…</p> : !roll.data?.length ? <Empty>이 날짜에 수업이 없습니다.</Empty> : (
            <ul className="divide-y divide-slate-200 border-y border-slate-300">{roll.data.map((r) => <RollRow key={r.schedule_id} r={r} who={who(r.child_id)} onDone={refresh} />)}</ul>)}
          {roll.error && <Notice tone="red">{errText(roll.error)}</Notice>}
          <AddClass day={day} onDone={refresh} />
          <p className="mt-3 text-xs text-slate-500">출결은 바우처 서류와 정산에 자동 반영됩니다.</p>
        </section>)}

      {tab === "long" && <Absences who={who} onDone={refresh} />}

      {tab === "month" && (
        <section>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-semibold md:text-[25px]">{Number(month.slice(0, 4))}년 {Number(month.slice(5, 7))}월 출결 현황</h3>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={!summary.data?.length || exporting} onClick={exportXlsx}><Download size={14} />{exporting ? "만드는 중…" : "엑셀로 내보내기"}</Button>
              <div className="w-44"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="월" /></div>
            </div>
          </div>
          {!summary.data?.length ? <Empty>이 달의 수업이 없습니다.</Empty> : (
            <Table head={["아동", "수업", "출석", "(자동)", "지각", "결석", "사유결석", "옮김", "남은 수업", "출석률"]}>
              {summary.data.map((s) => (
                <tr key={s.child_id}>
                  <Td className="font-semibold">{who(s.child_id)}</Td><Td>{s.scheduled}</Td><Td>{s.present + s.makeup}</Td><Td className="text-slate-400">{s.auto}</Td><Td>{s.late}</Td>
                  <Td className={s.absent ? "font-semibold text-red-700" : ""}>{s.absent}</Td><Td>{s.excused}</Td><Td>{s.moved}</Td><Td>{s.upcoming}</Td>
                  <Td>{s.rate_pct == null ? "–" : <Badge tone={s.rate_pct >= 90 ? "green" : s.rate_pct >= 75 ? "amber" : "red"}>{s.rate_pct}%</Badge>}</Td>
                </tr>))}
            </Table>)}
          {exportError && <div className="mt-2"><Notice tone="red">{exportError}</Notice></div>}
          <p className="mt-3 text-xs text-slate-500">출석에는 따로 체크하지 않아 자동으로 출석 처리된 수업(자동)이 포함돼요. 출석률 = (출석+지각) ÷ (출석+지각+결석). 사유결석·장기결강은 빼고 계산합니다.</p>
        </section>)}
    </>
  );
}

/** 수업 추가: a one-off class on the chosen day, either 바우처 5회 (goes into the voucher form) or 유료 (does not). */
function AddClass({ day, onDone }: { day: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const empty = { child_id: "", start: "", extra: "" as Extra | "" };
  const [f, setF] = useState(empty);
  const add = useMutation({
    mutationFn: () => api("/schedules", { method: "POST", json: { child_id: f.child_id, date: day, start: f.start, extra: f.extra } }),
    onSuccess: () => { setF(empty); setOpen(false); onDone(); },
  });
  if (!open) return <div className="mt-4"><Button onClick={() => { add.reset(); setOpen(true); }}>+ 수업 추가</Button></div>;
  return (
    <form className="mt-4 space-y-3 rounded-3xl bg-slate-100 p-5 shadow-sm" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <Segmented aria-label="추가 종류" value={f.extra} onChange={(extra) => setF({ ...f, extra })} items={(Object.keys(EXTRA) as Extra[]).map((k) => [k, EXTRA[k]] as [Extra, string])} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1"><Label label="아동"><ChildPicker value={f.child_id || null} onChange={(id) => setF({ ...f, child_id: id ?? "" })} /></Label></div>
        <Label label={`시작 시간 (${md(day)})`}><Input type="time" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Label>
        <Button disabled={add.isPending || !f.child_id || !f.extra}>추가</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>취소</Button>
      </div>
      <p className="text-xs text-slate-500">바우처는 한 달 26만원(일반 5회·야간 4회)까지만 바우처 서류에 들어가고, 넘는 수업은 자동으로 사비가 돼요. 수업마다 결제 칸에서 바우처·사비·인지로 바꿀 수 있어요. 유료로 추가한 수업은 처음부터 사비예요. 담당 치료사와 수업 길이는 아동·시간표 설정을 따라요.</p>
      {add.error && <Notice tone="red">{errText(add.error)}</Notice>}
    </form>
  );
}

function RollRow({ r, who, onDone }: { r: Row; who: string; onDone: () => void }) {
  const [note, setNote] = useState(""), [late, setLate] = useState(""), [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false), [to, setTo] = useState({ date: "", start: r.start, reason: "" });
  const mark = useMutation({
    mutationFn: (status: string) => api(`/schedules/${r.schedule_id}/attendance`, { method: "PUT", json: { status, minutes_late: status === "late" && late ? Number(late) : null, note: note.trim() || null } }),
    onSuccess: () => { setNote(""); setLate(""); onDone(); },
  });
  const clear = useMutation({ mutationFn: () => api(`/schedules/${r.schedule_id}/attendance`, { method: "DELETE" }), onSuccess: onDone });
  const move = useMutation({ mutationFn: () => api(`/schedules/${r.schedule_id}/move`, { method: "POST", json: { date: to.date, start: to.start, reason: to.reason.trim() || null } }), onSuccess: () => { setMoving(false); onDone(); } });
  const unmove = useMutation({ mutationFn: () => api(`/schedules/${r.schedule_id}/unmove`, { method: "POST" }), onSuccess: onDone });
  const pay = useMutation({ mutationFn: (v: string) => api(`/schedules/${r.schedule_id}/pay`, { method: "PUT", json: { pay: v || null } }), onSuccess: onDone });
  const st = r.state.status;
  const err = mark.error || clear.error || move.error || unmove.error || pay.error;
  const badge = st === "moved" ? <Badge>옮김 → {r.moved_to ? `${md(r.moved_to.date)} ${r.moved_to.start}` : "?"}</Badge>
    : st ? <Badge tone={ST[st]?.[1]}>{ST[st]?.[0] ?? st}{st === "late" && r.attendance?.minutes_late ? ` ${r.attendance.minutes_late}분` : ""}{r.state.auto && st === "present" ? " (자동)" : ""}</Badge>
    : <Badge>예정</Badge>;
  const controls = st !== "moved" && !(r.state.auto && st === "excused");
  const choice = (v: string) => (v === "present" ? r.attendance && clear.mutate() : mark.mutate(v));
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="w-24 shrink-0 text-sm font-semibold tabular-nums">{r.start}–{r.end}</span>
        <span className="font-semibold">{who}</span>
        <span className="text-sm text-slate-500">{r.therapist}</span>
        {r.moved_from && <Badge tone="indigo">보강</Badge>}
        {r.extra && <Badge tone={r.extra === "paid" ? "amber" : "indigo"}>{EXTRA[r.extra]}</Badge>}
        {badge}
        {r.pay && <select aria-label="결제 구분" disabled={pay.isPending} value={r.pay_auto ? "" : r.pay} onChange={(e) => pay.mutate(e.target.value)}
          className={`rounded-full border px-2.5 py-0.5 text-xs ${r.pay === "voucher" ? "border-indigo-200 bg-indigo-100 text-indigo-800" : r.pay === "cognitive" ? "border-green-200 bg-green-100 text-green-800" : "border-amber-200 bg-amber-100 text-amber-800"}`}>
          <option value="">{PAY[r.pay]} (자동)</option>
          {(Object.keys(PAY) as Pay[]).map((k) => <option key={k} value={k}>{PAY[k]}</option>)}
        </select>}
        {r.state.reason && <span className="text-xs text-slate-500">{r.state.reason}</span>}
        {controls && (
          <div className="flex flex-wrap items-center gap-1 md:ml-auto">
            <Segmented aria-label="출결" value={st && ["present", "absent", "excused", "late"].includes(st) && !(r.state.auto && st !== "present") ? st : ""}
              disabled={mark.isPending || clear.isPending} onChange={choice} tone={(v) => (v === "present" ? "ink" : "accent")}
              items={[["present", "출석"], ["absent", "결석"], ["excused", "사유결석"], ["late", "지각"]]} />
            {!r.attendance && !r.moved_from && <Button variant="ghost" onClick={() => { move.reset(); setMoving(!moving); }}>보강 잡기</Button>}
            {r.source !== "timetable" && <Button variant="ghost" onClick={() => setEditing(!editing)}>시간 수정</Button>}
          </div>)}
      </div>
      {controls && (
        <div className="mt-2 flex flex-wrap items-center gap-2 md:justify-end">
          <div className="w-48"><Input placeholder="사유 (예: 감기)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} aria-label="사유" /></div>
          <div className="w-24"><Input type="number" min={0} max={240} placeholder="지각 분" value={late} onChange={(e) => setLate(e.target.value)} aria-label="지각 분" /></div>
          {r.attendance && <Button variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}><Undo2 size={14} />기본(출석)으로</Button>}
        </div>)}
      {editing && <EditClassForm c={{ id: r.schedule_id, date: r.date, start: r.start, end: r.end, extra: r.extra }} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); onDone(); }} />}
      {st === "moved" && <div className="mt-2"><Button variant="ghost" disabled={unmove.isPending} onClick={() => unmove.mutate()}><Undo2 size={14} />옮기기 취소</Button></div>}
      {moving && (
        <form className="mt-2 flex flex-wrap items-end gap-2 rounded-2xl bg-slate-100 p-4" onSubmit={(e) => { e.preventDefault(); move.mutate(); }}>
          <Label label="보강 날짜"><Input type="date" required value={to.date} onChange={(e) => setTo({ ...to, date: e.target.value })} /></Label>
          <Label label="시작 시간"><Input type="time" required value={to.start} onChange={(e) => setTo({ ...to, start: e.target.value })} /></Label>
          <Label label="사유 (선택)"><Input maxLength={200} value={to.reason} onChange={(e) => setTo({ ...to, reason: e.target.value })} /></Label>
          <Button disabled={move.isPending}>옮기기</Button>
          <Button type="button" variant="ghost" onClick={() => setMoving(false)}>취소</Button>
        </form>)}
      {err && <div className="mt-2"><Notice tone="red">{errText(err)}</Notice></div>}
    </li>
  );
}

function Absences({ who, onDone }: { who: (id: string) => string; onDone: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["attendance", "absences"], queryFn: () => api<Absence[]>("/absences") });
  const [f, setF] = useState({ child_id: "", start: "", end: "", reason: "" });
  const done = () => { qc.invalidateQueries({ queryKey: ["attendance", "absences"] }); onDone(); };
  const add = useMutation({ mutationFn: () => api("/absences", { method: "POST", json: { ...f, reason: f.reason.trim() || null } }), onSuccess: () => { setF({ child_id: "", start: "", end: "", reason: "" }); done(); } });
  const remove = useMutation({ mutationFn: (id: string) => api(`/absences/${id}`, { method: "DELETE" }), onSuccess: done });
  return (
    <section>
      <h3 className="mb-4 text-xl font-semibold md:text-[25px]">장기결강</h3>
      <form className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_9.5rem_9.5rem_minmax(0,1fr)_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Label label="아동"><ChildPicker value={f.child_id || null} onChange={(id) => setF({ ...f, child_id: id ?? "" })} /></Label>
        <Label label="시작일"><Input type="date" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Label>
        <Label label="종료일"><Input type="date" required min={f.start} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Label>
        <Label label="사유"><Input maxLength={200} placeholder="예: 입원, 방학" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Label>
        <Button disabled={add.isPending || !f.child_id}>등록</Button>
      </form>
      <p className="mt-2 text-xs text-slate-500">기간 안의 수업은 모두 사유결석으로 처리되고 바우처 서류에서 빠지며, ‘기타사항’에 기간과 사유가 적혀요.</p>
      {!!list.data?.length && (
        <ul className="mt-5 divide-y divide-slate-200 border-y border-slate-300">
          {list.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-2 py-2.5 text-sm">
              <span className="font-semibold">{who(a.child_id)}</span>
              <span className="tabular-nums text-slate-600">{a.start} ~ {a.end}</span>
              {a.reason && <span className="text-slate-500">{a.reason}</span>}
              <Badge>수업 점유 안 함</Badge>
              <button className="ml-auto rounded p-1.5 text-red-600 hover:bg-red-50" aria-label="장기결강 삭제" onClick={() => remove.mutate(a.id)}><Trash2 size={14} /></button>
            </li>))}
        </ul>)}
      {(add.error || remove.error) && <div className="mt-2"><Notice tone="red">{errText(add.error || remove.error)}</Notice></div>}
    </section>
  );
}
