import { Fragment, useMemo, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Printer, Settings2, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import { useMe } from "../lib/me";
import { Badge, Button, Card, Empty, Input, Label, Notice, Select } from "./ui";
import ChildPicker from "./ChildPicker";

type Teacher = { id: string; name: string; short: string; color: string };
type Config = { session_minutes: number; break_minutes: number; morning_start: string; morning_count: number; afternoon_start: string; afternoon_count: number; days: number[]; teachers: Teacher[]; closed: string[] };
type Entry = { id: string; day: number; slot: string; teacher_id: string; child_id: string | null; label: string | null; note: string | null; highlight: boolean; valid_from: string | null; valid_to: string | null };
type Data = { config: Config; morning: string[]; afternoon: string[]; entries: Entry[] };
type Cell = { day: number; slot: string; teacher: Teacher };

const DAY = ["", "월", "화", "수", "목", "금", "토", "일"];
const PALETTE = ["#2563eb", "#9f1239", "#7e22ce", "#ea580c", "#15803d", "#0f766e", "#be185d", "#a16207", "#1e40af", "#4d7c0f"];
const HATCH = { backgroundImage: "repeating-linear-gradient(135deg, #cbd5e1 0 1px, transparent 1px 7px)", backgroundColor: "#e2e8f0" };
// Weekend columns and 7:00-and-later rows share one shade, like the paper sheet.
const WEEKEND = { backgroundColor: "#d4d4d8" };
const EVENING = WEEKEND;
const isEvening = (slot: string) => slot >= "19:00";
const PHONE = "(max-width: 639px)";
/** True on phone-width screens (re-renders when the width crosses the breakpoint). */
const usePhone = () => useSyncExternalStore((cb) => { const m = matchMedia(PHONE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
  () => matchMedia(PHONE).matches, () => false);
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const monday = (s: string) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
const plus = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")}`; };

/** Weekly timetable grid: columns are weekdays, rows are time slot x teacher, like the paper sheet clinics keep. */
export default function Timetable() {
  const qc = useQueryClient();
  const me = useMe().data;
  const isAdmin = me?.role === "admin", canWrite = me?.role === "admin" || me?.role === "therapist";
  const { children } = useChild();
  const phone = usePhone();
  const [phoneDay, setPhoneDay] = useState(() => new Date().getDay() || 7); // ISO weekday, today by default
  const tt = useQuery({ queryKey: ["timetable"], queryFn: () => api<Data>("/timetable") });
  const [week, setWeek] = useState(iso(new Date()));
  const [edit, setEdit] = useState(false), [cell, setCell] = useState<Cell | null>(null), [setup, setSetup] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["timetable"] });

  const from = iso(monday(week)), to = iso(plus(monday(week), 6));
  const byCell = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of tt.data?.entries ?? []) {
      if ((e.valid_from ?? "0000") > to || (e.valid_to ?? "9999") < from) continue; // not running that week
      const k = `${e.day}|${e.slot}|${e.teacher_id}`; m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [tt.data, from, to]);
  const childName = (id: string | null) => children.find((c) => c.id === id)?.display_name ?? "(삭제된 아동)";

  if (tt.isLoading) return <p className="text-sm text-slate-400">불러오는 중…</p>;
  if (!tt.data) return <Notice tone="red">{errText(tt.error)}</Notice>;
  const { config: cfg, morning, afternoon } = tt.data;
  // On a phone the grid shows one day at a time (chosen with the tabs above it); printing always shows the week.
  const shown = phone ? [cfg.days.includes(phoneDay) ? phoneDay : cfg.days[0]] : cfg.days;
  const closed = new Set(cfg.closed);
  // Text lines down the page: a row is as tall as its fullest cell (two children sharing a cell by period = 2 lines).
  const printRows = [...morning, ...afternoon].reduce((n, slot) => n + cfg.teachers.reduce((m, t) =>
    m + Math.max(1, ...cfg.days.map((d) => byCell.get(`${d}|${slot}|${t.id}`)?.length ?? 0)), 0), 0) + 2; // + header + lunch
  const fontPt = Math.max(6, Math.min(12, Math.round((274 / printRows) * 2.83 * 0.6 * 10) / 10)); // row height (mm→pt) x 0.6
  const isClosed = (day: number, slot: string, t: string) => closed.has(`${day}|${slot}|*`) || closed.has(`${day}|${slot}|${t}`);

  const block = (slot: string, last: boolean) => cfg.teachers.map((t, i) => (
    <tr key={slot + t.id} className={i === cfg.teachers.length - 1 && !last ? "border-b-2 border-slate-400" : ""}>
      {i === 0 && <th rowSpan={cfg.teachers.length} style={isEvening(slot) ? EVENING : undefined} className="border border-slate-300 bg-white px-1 text-center text-sm font-semibold tabular-nums">{hm(slot)}</th>}
      <td className="border border-slate-300 px-1 text-center text-xs font-bold" style={{ color: t.color, backgroundColor: t.color + "1a" }} title={t.name}>{t.short}</td>
      {shown.map((day) => {
        const off = isClosed(day, slot, t.id);
        const items = byCell.get(`${day}|${slot}|${t.id}`) ?? [];
        return (
          <td key={day} style={off ? HATCH : isEvening(slot) ? EVENING : day >= 6 ? WEEKEND : undefined}
            className={`h-7 border border-slate-300 px-1 text-center text-[13px] leading-tight ${edit ? "cursor-pointer hover:outline hover:outline-2 hover:outline-indigo-400" : ""}`}
            onClick={edit ? () => setCell({ day, slot, teacher: t }) : undefined}>
            {items.map((e) => (
              <span key={e.id} className={`block font-semibold ${e.highlight ? "rounded-md bg-indigo-600 px-1 !text-slate-50" : ""}`} style={{ color: t.color }}
                title={[e.note, e.valid_from && `${e.valid_from}부터`, e.valid_to && `${e.valid_to}까지`].filter(Boolean).join(" · ")}>
                {e.child_id ? childName(e.child_id) : e.label}{e.note && <span className="font-normal">({e.note})</span>}
              </span>))}
          </td>);
      })}
    </tr>));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <Label label="기준 주"><Input type="date" value={week} onChange={(e) => e.target.value && setWeek(e.target.value)} className="w-40" /></Label>
        <p className="pb-2 text-xs text-slate-500">{from} ~ {to} · 수업 {cfg.session_minutes}분 + 상담 {cfg.break_minutes}분</p>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {canWrite && <Button variant={edit ? "primary" : "outline"} onClick={() => { setEdit(!edit); setCell(null); }}><Pencil size={14} />{edit ? "편집 끝내기" : "편집"}</Button>}
          {isAdmin && <Button variant="outline" onClick={() => setSetup(!setup)}><Settings2 size={14} />시간·교사 설정</Button>}
          <Button variant="outline" onClick={() => window.print()}><Printer size={14} />인쇄</Button>
        </div>
      </div>
      {setup && isAdmin && <Setup cfg={cfg} onDone={() => { setSetup(false); refresh(); }} />}
      {!cfg.teachers.length ? (
        <Card><Empty>{isAdmin ? "‘시간·교사 설정’에서 담당 교사를 먼저 추가하세요." : "아직 시간표가 없습니다. 기관 관리자가 담당 교사를 설정해야 합니다."}</Empty></Card>
      ) : (
        <>
          {edit && <p className="text-xs text-indigo-700 print:hidden">칸을 누르면 아동을 넣거나 뺄 수 있어요.</p>}
          {/* Print: one A4 portrait page, the grid stretched to fill it; font scales with the number of rows. */}
          <style>{`@media print {
            @page { size: A4 portrait; margin: 8mm; }
            html, body { height: auto !important; margin: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            /* 281mm is printable on A4; keep a few mm spare and no margin below, or browsers start a 2nd page */
            .tt-sheet { height: 274mm; margin: 0 !important; overflow: hidden !important; border-radius: 0; break-inside: avoid; break-after: avoid; }
            .tt-sheet table { height: 100%; min-width: 0 !important; table-layout: fixed; font-size: ${fontPt}pt; }
            .tt-sheet td, .tt-sheet th { height: auto !important; padding: 0 2px !important; font-size: inherit !important; line-height: 1.1 !important; }
          }`}</style>
          {phone && (
            <div role="tablist" aria-label="요일" className="grid gap-1 print:hidden" style={{ gridTemplateColumns: `repeat(${cfg.days.length}, minmax(0, 1fr))` }}>
              {cfg.days.map((d) => (
                <button key={d} role="tab" aria-selected={shown[0] === d} onClick={() => setPhoneDay(d)}
                  className={`rounded-md py-1.5 text-sm ${shown[0] === d ? "bg-indigo-600 font-semibold text-white" : "bg-slate-100 text-slate-700"}`}>{DAY[d]}</button>))}
            </div>)}
          <div className="tt-sheet overflow-x-auto rounded-2xl border border-slate-300 bg-white">
            <table className={`w-full border-collapse ${phone ? "" : "min-w-[720px]"}`}>
              <thead>
                <tr className="bg-slate-100 text-sm">
                  <th className="w-16 border border-slate-300 py-1" /><th className="w-12 border border-slate-300 py-1">담당</th>
                  {shown.map((d) => <th key={d} className="border border-slate-300 py-1" style={d >= 6 ? WEEKEND : undefined}>{DAY[d]}{phone && "요일"}</th>)}
                </tr>
              </thead>
              <tbody>
                {morning.map((s, i) => <Fragment key={s}>{block(s, i === morning.length - 1)}</Fragment>)}
                {morning.length > 0 && afternoon.length > 0 && (
                  <tr><td colSpan={shown.length + 2} className="border-y-2 border-slate-400 bg-slate-50 py-1 text-center text-sm font-semibold tracking-[0.5em] text-slate-600">점심시간</td></tr>)}
                {afternoon.map((s, i) => <Fragment key={s}>{block(s, i === afternoon.length - 1)}</Fragment>)}
              </tbody>
            </table>
          </div>
        </>
      )}
      {cell && <CellEditor cell={cell} entries={byCell.get(`${cell.day}|${cell.slot}|${cell.teacher.id}`) ?? []} cfg={cfg} isAdmin={isAdmin}
        closedHere={isClosed(cell.day, cell.slot, cell.teacher.id)} onClose={() => setCell(null)} onSaved={refresh} />}
    </div>
  );
}

function CellEditor({ cell, entries, cfg, isAdmin, closedHere, onClose, onSaved }: { cell: Cell; entries: Entry[]; cfg: Config; isAdmin: boolean; closedHere: boolean; onClose: () => void; onSaved: () => void }) {
  const { children } = useChild();
  const blank = { mode: "child" as "child" | "label", child_id: "", label: "", note: "", highlight: false, valid_from: "", valid_to: "" };
  const [f, setF] = useState(blank), [editing, setEditing] = useState<string | null>(null);
  const body = () => ({ day: cell.day, slot: cell.slot, teacher_id: cell.teacher.id, child_id: f.mode === "child" ? f.child_id || null : null, label: f.mode === "label" ? f.label : null,
    note: f.note.trim() || null, highlight: f.highlight, valid_from: f.valid_from || null, valid_to: f.valid_to || null });
  const save = useMutation({
    mutationFn: () => editing ? api(`/timetable/entries/${editing}`, { method: "PUT", json: body() }) : api("/timetable/entries", { method: "POST", json: body() }),
    onSuccess: () => { setF(blank); setEditing(null); onSaved(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/timetable/entries/${id}`, { method: "DELETE" }), onSuccess: onSaved });
  const toggle = useMutation({
    mutationFn: (key: string) => api("/timetable/config", { method: "PUT", json: { ...cfg, closed: cfg.closed.includes(key) ? cfg.closed.filter((k) => k !== key) : [...cfg.closed, key] } }),
    onSuccess: onSaved,
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const load = (e: Entry) => { setEditing(e.id); setF({ mode: e.child_id ? "child" : "label", child_id: e.child_id ?? "", label: e.label ?? "", note: e.note ?? "", highlight: e.highlight, valid_from: e.valid_from ?? "", valid_to: e.valid_to ?? "" }); };
  const slotKey = `${cell.day}|${cell.slot}|*`, cellKey = `${cell.day}|${cell.slot}|${cell.teacher.id}`;
  const err = save.error || remove.error || toggle.error;
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/30 p-2 sm:items-center print:hidden" onClick={onClose}>
      <div role="dialog" aria-label="시간표 칸 편집" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <p className="font-semibold">{DAY[cell.day]}요일 {hm(cell.slot)} · <span style={{ color: cell.teacher.color }}>{cell.teacher.name}</span></p>
          <button className="ml-auto rounded p-1 hover:bg-slate-100" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>
        {entries.length > 0 && (
          <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{e.child_id ? children.find((c) => c.id === e.child_id)?.display_name ?? "(삭제된 아동)" : e.label}</span>
                {!e.child_id && <Badge>미등록</Badge>}
                <span className="text-xs text-slate-500">{[e.note, (e.valid_from || e.valid_to) && `${e.valid_from ?? ""}~${e.valid_to ?? ""}`].filter(Boolean).join(" · ")}</span>
                <button className="ml-auto rounded p-1 hover:bg-slate-100" aria-label="수정" onClick={() => load(e)}><Pencil size={14} /></button>
                <button className="rounded p-1 text-red-600 hover:bg-red-50" aria-label="빼기" onClick={() => remove.mutate(e.id)}><Trash2 size={14} /></button>
              </li>))}
          </ul>)}
        {closedHere ? <Notice>닫아 둔 칸입니다.</Notice> : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <p className="text-sm font-medium text-slate-700">{editing ? "수정" : "아동 넣기"}</p>
            <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1 text-sm">
              {(["child", "label"] as const).map((m) => <button type="button" key={m} onClick={() => setF({ ...f, mode: m })} className={`rounded-full py-1 ${f.mode === m ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}>{m === "child" ? "등록된 아동" : "이름만 입력"}</button>)}
            </div>
            {f.mode === "child"
              ? <ChildPicker value={f.child_id || null} onChange={(id) => setF({ ...f, child_id: id ?? "" })} aria-label="아동" />
              : <Input value={f.label} onChange={set("label")} maxLength={30} required placeholder="아동 이름" aria-label="아동 이름" />}
            {f.mode === "label" && <p className="text-[11px] text-slate-500">이름만 넣은 칸은 시간표에만 보이고, 날짜별 일정·출결은 만들어지지 않아요.</p>}
            <Label label="메모 (예: 13, 10월-)"><Input value={f.note} onChange={set("note")} maxLength={60} /></Label>
            <div className="grid grid-cols-2 gap-2">
              <Label label="시작일 (선택)"><Input type="date" value={f.valid_from} onChange={set("valid_from")} /></Label>
              <Label label="종료일 (선택)"><Input type="date" value={f.valid_to} onChange={set("valid_to")} /></Label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.highlight} onChange={set("highlight")} />노란색으로 강조</label>
            <div className="flex gap-2">
              <Button disabled={save.isPending || (f.mode === "child" && !f.child_id)}>{editing ? "저장" : "넣기"}</Button>
              {editing && <Button type="button" variant="ghost" onClick={() => { setEditing(null); setF(blank); }}>취소</Button>}
            </div>
          </form>)}
        {isAdmin && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {!cfg.closed.includes(slotKey) && <Button variant="outline" onClick={() => toggle.mutate(cellKey)}>{cfg.closed.includes(cellKey) ? "이 칸 열기" : "이 칸 닫기"}</Button>}
            <Button variant="outline" onClick={() => toggle.mutate(slotKey)}>{cfg.closed.includes(slotKey) ? `${DAY[cell.day]} ${hm(cell.slot)} 전체 열기` : `${DAY[cell.day]} ${hm(cell.slot)} 전체 닫기`}</Button>
          </div>)}
        {err && <div className="mt-3"><Notice tone="red">{errText(err)}</Notice></div>}
      </div>
    </div>
  );
}

function Setup({ cfg, onDone }: { cfg: Config; onDone: () => void }) {
  const [c, setC] = useState<Config>(cfg);
  const roster = useQuery({ queryKey: ["org", "therapists"], queryFn: () => api<string[]>("/org/therapists") }).data ?? [];
  const save = useMutation({ mutationFn: () => api("/timetable/config", { method: "PUT", json: c }), onSuccess: onDone });
  const num = (k: keyof Config) => (e: any) => setC({ ...c, [k]: Number(e.target.value) });
  const setT = (i: number, patch: Partial<Teacher>) => setC({ ...c, teachers: c.teachers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const move = (i: number, d: number) => { const t = [...c.teachers]; [t[i], t[i + d]] = [t[i + d], t[i]]; setC({ ...c, teachers: t }); };
  return (
    <Card title="시간·교사 설정" className="print:hidden">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <Label label="수업(분)"><Input type="number" min={10} max={180} value={c.session_minutes} onChange={num("session_minutes")} /></Label>
          <Label label="상담·쉬는(분)"><Input type="number" min={0} max={60} value={c.break_minutes} onChange={num("break_minutes")} /></Label>
          <Label label="오전 시작"><Input type="time" value={c.morning_start} onChange={(e) => setC({ ...c, morning_start: e.target.value })} /></Label>
          <Label label="오전 타임 수"><Input type="number" min={0} max={12} value={c.morning_count} onChange={num("morning_count")} /></Label>
          <Label label="오후 시작"><Input type="time" value={c.afternoon_start} onChange={(e) => setC({ ...c, afternoon_start: e.target.value })} /></Label>
          <Label label="오후 타임 수"><Input type="number" min={0} max={14} value={c.afternoon_count} onChange={num("afternoon_count")} /></Label>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">운영 요일</p>
          <div className="flex flex-wrap gap-3 text-sm">{[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={c.days.includes(d)} onChange={(e) => setC({ ...c, days: e.target.checked ? [...c.days, d].sort() : c.days.filter((x) => x !== d) })} />{DAY[d]}</label>))}</div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">담당 교사 (시간마다 이 순서로 줄이 생겨요)</p>
          {c.teachers.length > 0 && <div className="mb-1 flex gap-2 text-[11px] text-slate-500"><span className="w-20 text-center">약칭 (표에 표시)</span><span className="w-40">이름</span><span>색</span></div>}
          <div className="space-y-2">
            {c.teachers.map((t, i) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2">
                <div className="w-20 shrink-0"><Input className="text-center font-bold" style={{ color: t.color }} value={t.short} maxLength={4} placeholder="약칭" onChange={(e) => setT(i, { short: e.target.value })} aria-label="약칭 (표에 표시)" /></div>
                <div className="w-40 shrink-0"><Input value={t.name} maxLength={20} placeholder="이름" list="tt-roster" onChange={(e) => setT(i, { name: e.target.value })} onBlur={() => !t.short.trim() && t.name.trim() && setT(i, { short: t.name.trim().slice(0, 1) })} aria-label="이름" /></div>
                <div className="flex gap-1">{PALETTE.map((p) => <button type="button" key={p} aria-label={`색 ${p}`} onClick={() => setT(i, { color: p })} className={`h-5 w-5 rounded-full ${t.color === p ? "ring-2 ring-slate-900 ring-offset-1" : ""}`} style={{ backgroundColor: p }} />)}</div>
                <div className="ml-auto flex gap-1">
                  <Button type="button" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">↑</Button>
                  <Button type="button" variant="ghost" disabled={i === c.teachers.length - 1} onClick={() => move(i, 1)} aria-label="아래로">↓</Button>
                  <Button type="button" variant="ghost" className="text-red-600" onClick={() => setC({ ...c, teachers: c.teachers.filter((_, j) => j !== i) })}>삭제</Button>
                </div>
              </div>))}
          </div>
          <datalist id="tt-roster">{roster.map((n) => <option key={n} value={n} />)}</datalist>
          <Button type="button" variant="outline" className="mt-2" disabled={c.teachers.length >= 20}
            onClick={() => setC({ ...c, teachers: [...c.teachers, { id: crypto.randomUUID().slice(0, 8), name: "", short: "", color: PALETTE[c.teachers.length % PALETTE.length] }] })}>+ 교사 추가</Button>
          <p className="mt-1 text-[11px] text-slate-500">교사를 지우면 그 교사 줄의 칸은 시간표에서 보이지 않아요(기록은 남아요).</p>
        </div>
        {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
        <div className="flex gap-2"><Button disabled={save.isPending}>저장</Button><Button type="button" variant="ghost" onClick={onDone}>닫기</Button></div>
      </form>
    </Card>
  );
}
