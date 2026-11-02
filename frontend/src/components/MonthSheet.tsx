import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, X } from "lucide-react";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { useMe } from "../lib/me";
import { Button, Input, Label, Notice, Select, Tabs } from "./ui";

type Slot = { date: string; start: string };
type Plan = { child_id: string; same_as_actual: boolean; slots: Slot[] };
type Sheet = { therapist: string; therapists: string[] | null; names: Record<string, string>; classes: (Slot & { child_id: string })[]; plans: Plan[] };
type Data = { config: { session_minutes: number; days: number[] }; morning: string[]; afternoon: string[] };

const DAY = ["", "월", "화", "수", "목", "금", "토", "일"];
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")}`; };
const plus = (s: string, min: number) => { const [h, m] = s.split(":").map(Number); const t = h * 60 + m + min; return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const isoDay = (d: string) => new Date(d + "T00:00:00").getDay() || 7;
const daysOf = (month: string, keep: number[]) => {
  const [y, m] = month.split("-").map(Number), last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).filter((d) => keep.includes(isoDay(d)));
};
const sorted = (s: Slot[]) => [...s].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

/** 월간 수업일정표 like the paper sheet, one teacher at a time (admins pick the teacher, others see their own):
 *  rows = days, columns = time slots. 실제 = the teacher's classes, 결제 = the dates each child's 바우처 서류 claims
 *  (실제와 동일: the first 5 classes; otherwise the 결제 날짜 entered here). */
export default function MonthSheet() {
  const qc = useQueryClient();
  const me = useMe().data;
  const canWrite = me?.role === "admin" || me?.role === "therapist";
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [view, setView] = useState<"actual" | "pay">("actual");
  const [teacher, setTeacher] = useState<string | null>(null); // null = the server's default (admin: own name or first)
  const [childId, setChildId] = useState(""), [draft, setDraft] = useState<{ same: boolean; slots: Slot[] } | null>(null);
  const tt = useQuery({ queryKey: ["timetable"], queryFn: () => api<Data>("/timetable") });
  const q = new URLSearchParams({ month, ...(teacher !== null && { therapist: teacher }) });
  const sheet = useQuery({ queryKey: ["month-sheet", q.toString()], queryFn: () => api<Sheet>(`/month-sheet?${q}`) });
  const name = (id: string) => sheet.data?.names[id] ?? "?";
  const plan = sheet.data?.plans.find((p) => p.child_id === childId);
  const actual = useMemo(() => sheet.data?.classes ?? [], [sheet.data]);
  const save = useMutation({
    mutationFn: () => api(`/children/${childId}/pay-plan?month=${month}`, { method: "PUT", json: { same_as_actual: draft!.same, slots: draft!.slots } }),
    onSuccess: () => { setDraft(null); ["month-sheet", "schedules", "attendance", "settlement", "voucher-visits"].forEach((key) => qc.invalidateQueries({ queryKey: [key] })); },
  });

  // Each cell's names: 결제 view shows the open draft in place of that child's saved 결제 일정.
  const cells = useMemo(() => {
    const m = new Map<string, string[]>();
    const put = (cid: string, s: Slot) => { const k = `${s.date}|${s.start}`; m.set(k, [...(m.get(k) ?? []), cid]); };
    if (view === "actual") actual.forEach((s) => put(s.child_id, s));
    else for (const p of sheet.data?.plans ?? []) (p.child_id === childId && draft ? draft.slots : p.slots).forEach((s) => put(p.child_id, s));
    if (view === "pay" && draft && childId && !sheet.data?.plans.some((p) => p.child_id === childId)) draft.slots.forEach((s) => put(childId, s));
    return m;
  }, [view, actual, sheet.data, childId, draft]);

  if (!tt.data) return tt.error ? <Notice tone="red">{errText(tt.error)}</Notice> : <p className="text-sm text-slate-400">불러오는 중…</p>;
  const { config, morning, afternoon } = tt.data;
  const times = [...new Set([...morning, ...afternoon, ...[...cells.keys()].map((k) => k.split("|")[1])])].sort();
  const days = daysOf(month, config.days.length ? config.days : [1, 2, 3, 4, 5]);
  const editing = view === "pay" && !!draft && !draft.same;
  const pick = (cid: string) => { setChildId(cid); setDraft(null); save.reset(); };
  const open = () => setDraft({ same: plan?.same_as_actual ?? true, slots: sorted(plan?.slots ?? []) });
  const toggle = (s: Slot) => draft && setDraft({ ...draft, slots: draft.slots.some((x) => x.date === s.date && x.start === s.start)
    ? draft.slots.filter((x) => !(x.date === s.date && x.start === s.start)) : sorted([...draft.slots, s]) });
  const [y, mo] = month.split("-").map(Number);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <div className="w-44"><Label label="월"><Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setDraft(null); }} /></Label></div>
        {sheet.data?.therapists && <div className="w-44"><Label label="교사"><Select value={sheet.data.therapist} onChange={(e) => { setTeacher(e.target.value); setChildId(""); setDraft(null); }}>
          {!sheet.data.therapist && <option value="">교사 선택</option>}
          {sheet.data.therapists.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select></Label></div>}
        <Tabs value={view} onChange={setView} items={[["actual", "실제 일정"], ["pay", "결제 일정"]]} />
        <Button variant="ghost" className="ml-auto" onClick={() => window.print()}><Printer size={14} />인쇄</Button>
      </div>
      {view === "pay" && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm print:hidden">
          <p className="text-slate-600">결제 일정의 날짜가 바우처 서류에 올라가요. ‘실제와 동일’이면 따로 입력하지 않고 그 달 실제 수업 중 처음 5회만 바우처, 나머지는 사비로 잡혀요.</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48"><Select aria-label="아동" value={childId} onChange={(e) => pick(e.target.value)}>
              <option value="">아동 선택</option>
              {Object.entries(sheet.data?.names ?? {}).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </Select></div>
            {childId && !draft && <>
              <span className="text-slate-500">{plan?.same_as_actual === false ? `결제 일정 ${plan.slots.length}회` : "실제와 동일 (처음 5회)"}</span>
              {canWrite && <Button variant="outline" onClick={open}>결제 일정 수정</Button>}
            </>}
            {childId && draft && <>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.same}
                onChange={(e) => setDraft({ same: e.target.checked, slots: draft.slots.length ? draft.slots : sorted(plan?.slots ?? []) })} />실제와 동일</label>
              {!draft.same && <span className="text-slate-500">아래 표에서 칸을 눌러 {name(childId)}의 결제 날짜를 넣고 빼요 · {draft.slots.length}회</span>}
              <Button disabled={save.isPending || (!draft.same && !draft.slots.length)} onClick={() => save.mutate()}>저장</Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>취소</Button>
              {!draft.same && plan?.same_as_actual !== false && <span className="text-xs text-slate-400">실제 수업 처음 5회로 미리 채웠어요</span>}
            </>}
          </div>
          {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
        </div>)}

      {sheet.error && <Notice tone="red">{errText(sheet.error)}</Notice>}
      {sheet.data && !sheet.data.therapist && !sheet.data.therapists && <Notice>치료사 목록에 이 계정이 연결되지 않아 볼 수 있는 수업이 없어요. 기관 관리자에게 연결을 요청하세요.</Notice>}
      <h2 className="text-center text-xl font-semibold">{sheet.data?.therapist && <span className="mr-2 text-base font-normal text-slate-500">{sheet.data.therapist}</span>}{y}년 {mo}월 수업일정표{view === "pay" ? "(결제)" : ""}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-xs">
          <thead><tr className="bg-amber-100">
            <th className="w-14 border border-slate-400" colSpan={2} />
            {times.map((t) => <th key={t} className="border border-slate-400 px-1 py-0.5 font-normal">{hm(t)}<div className="text-red-600">~ {hm(plus(t, config.session_minutes))}</div></th>)}
          </tr></thead>
          <tbody>{days.map((d, i) => (
            <tr key={d} className={i > 0 && isoDay(d) < isoDay(days[i - 1]) ? "border-t-2 border-t-slate-800" : ""}>
              <td className="w-7 border border-slate-400 bg-orange-100 text-center">{Number(d.slice(8))}</td>
              <td className="w-7 border border-slate-400 bg-orange-100 text-center">{DAY[isoDay(d)]}</td>
              {times.map((t) => {
                const who = cells.get(`${d}|${t}`) ?? [];
                const mine = editing && who.includes(childId);
                return (
                  <td key={t} onClick={editing ? () => toggle({ date: d, start: t }) : undefined}
                    className={`h-9 border border-slate-400 px-1 align-top ${editing ? "cursor-pointer hover:bg-indigo-50" : ""} ${mine ? "bg-indigo-100" : ""}`}>
                    {who.map((cid, j) => (
                      <Fragment key={cid + j}>
                        {view === "pay" && !draft ? <button className="text-rose-800 hover:underline print:text-rose-800" onClick={() => pick(cid)}>{name(cid)}</button>
                          : <span className={cid === childId && view === "pay" ? "font-semibold text-indigo-700" : "text-rose-800"}>{name(cid)}</span>}
                        {mine && cid === childId && <X size={10} className="ml-0.5 inline text-slate-400" />}
                        {j < who.length - 1 && <br />}
                      </Fragment>))}
                  </td>);
              })}
            </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
