import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { errText } from "../lib/hooks";
import EditClassForm from "./EditClassForm";
import PaymentSettings from "./PaymentSettings";
import { useMe } from "../lib/me";
import type { Pay } from "../lib/extraClass";
import { Button, Input, Label, Notice, Select, Tabs } from "./ui";

type Slot = { date: string; start: string };
type Lesson = Slot & { id: string; child_id: string; end: string; note?: string | null; pay: Pay; can_edit: boolean; revision: string };
type EditablePay = Exclude<Pay, "pending">;
type Plan = { child_id: string; mode: "actual" | "manual" | "unset"; slots: Slot[]; can_edit: boolean; revision: string | null };
type Sheet = { reserved?: (Slot & { end: string })[]; aliases?: Record<string, string>; therapist: string; therapists: string[] | null; names: Record<string, string>; classes: Lesson[]; plans: Plan[]; can_edit: boolean; default_same_as_actual: boolean };
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
  const me = useMe().data;
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 7));
  const [view, setView] = useState<"actual" | "pay">("actual");
  const [teacher, setTeacher] = useState<string | null>(null); // null = the server's default (admin: own name or first)
  const [slot, setSlot] = useState<Slot | null>(null), [newChild, setNewChild] = useState("");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [staleLesson, setStaleLesson] = useState(false);
  const lessonHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (lesson) lessonHeading.current?.focus(); }, [lesson]);
  const [editingSettings, setEditingSettings] = useState(false);
  const [editingPay, setEditingPay] = useState(false);
  const [childId, setChildId] = useState(""), [draft, setDraft] = useState<{ same: boolean; slots: Slot[]; revision: string | null } | null>(null);
  const tt = useQuery({ queryKey: ["timetable"], queryFn: () => api<Data>("/timetable") });
  const q = new URLSearchParams({ month, ...(teacher !== null && { therapist: teacher }) });
  const sheet = useQuery({ queryKey: ["month-sheet", q.toString()], queryFn: () => api<Sheet>(`/month-sheet?${q}`) });
  const name = (id: string) => sheet.data?.names[id] ?? "?";
  const plan = sheet.data?.plans.find((p) => p.child_id === childId);
  const actual = useMemo(() => sheet.data?.classes ?? [], [sheet.data]);
  const refresh = () => Promise.all(["month-sheet", "schedules", "attendance", "settlement", "voucher-visits", "class-records"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
  const add = useMutation({
    mutationFn: (where: Slot) => api("/schedules/month-sheet", { method: "POST", json: { ...where, child_id: newChild, therapist: sheet.data?.therapist } }),
    onSuccess: () => { setSlot(null); return refresh(); },
    onError: () => { void sheet.refetch(); },
  });
  const openSlot = (date: string, start: string) => { setNewChild(""); add.reset(); setSlot({ date, start }); };
  const available = (sheet.data?.plans ?? []).filter(p => p.can_edit);
  const reserved = view === "actual" ? sheet.data?.reserved ?? [] : [];
  const save = useMutation({
    mutationFn: () => api(`/children/${childId}/pay-plan?month=${month}`, { method: "PUT", json: { same_as_actual: draft!.same, slots: draft!.same ? [] : draft!.slots, expected_revision: draft!.revision } }),
    onSuccess: async () => { await refresh(); setDraft(null); },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) { await sheet.refetch(); setDraft(null); }
    },
  });
  const changePay = useMutation({
    mutationFn: async ({ lesson, pay }: { lesson: Lesson; pay: EditablePay }) => {
      const plan = sheet.data?.plans.find((p) => p.child_id === lesson.child_id);
      if (!plan) throw new Error("이 아동의 결제 일정을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.");
      const selected = (s: Slot) => s.date === lesson.date && s.start === lesson.start;
      let slots = plan.slots;
      if (plan.mode === "actual" || plan.mode === "unset") {
        slots = (await api<{ visits: Slot[] }>(`/children/${lesson.child_id}/voucher-visits?month=${month}`)).visits
          .map(({ date, start }) => ({ date, start }));
      }
      if (pay === "voucher") {
        await api(`/children/${lesson.child_id}/pay-plan?month=${month}`, { method: "PUT", json: {
          same_as_actual: false, slots: sorted([...slots.filter((s) => !selected(s)), { date: lesson.date, start: lesson.start }]),
          expected_revision: plan.revision,
        } });
      } else {
        const next = slots.filter((s) => !selected(s));
        if (plan.mode !== "unset" && slots.some(selected) && next.length) {
          await api(`/children/${lesson.child_id}/pay-plan?month=${month}`, { method: "PUT", json: {
            same_as_actual: false, slots: next, expected_revision: plan.revision,
          } });
        }
      }
      await api(`/schedules/${lesson.id}/pay`, { method: "PUT", json: { pay } });
    },
    onSuccess: refresh,
    onError: () => { void sheet.refetch(); void refresh(); },
  });

  // Each cell's names: 결제 view shows the open draft in place of that child's saved 결제 일정.
  const cells = useMemo(() => {
    const m = new Map<string, { cid: string; lesson?: Lesson }[]>();
    const put = (cid: string, s: Slot, lesson?: Lesson) => { const k = `${s.date}|${s.start}`; m.set(k, [...(m.get(k) ?? []), { cid, lesson }]); };
    if (view === "actual") actual.forEach((s) => put(s.child_id, s, s));
    else for (const p of sheet.data?.plans ?? []) {
      const slots = p.child_id === childId && draft ? (draft.same ? (p.mode === "actual" ? p.slots : []) : draft.slots) : p.slots;
      slots.forEach((s) => put(p.child_id, s));
    }
    return m;
  }, [view, actual, sheet.data, childId, draft]);

  if (!tt.data) return tt.error ? <Notice tone="red">{errText(tt.error)}</Notice> : <p className="text-sm text-slate-400">불러오는 중…</p>;
  const { config, morning, afternoon } = tt.data;
  const times = [...new Set([...morning, ...afternoon, ...reserved.map(s => s.start), ...[...cells.keys()].map((k) => k.split("|")[1])])].sort();
  const days = [...new Set([...daysOf(month, config.days.length ? config.days : [1, 2, 3, 4, 5]), ...reserved.map(s => s.date), ...[...cells.keys()].map((k) => k.split("|")[0])])].sort();
  const editing = view === "pay" && !!draft && !draft.same;
  const pick = (cid: string) => { setChildId(cid); setDraft(null); setStaleLesson(false); save.reset(); };
  const open = () => { if (plan) { save.reset(); setDraft({ same: plan.mode === "actual", slots: sorted(plan.slots), revision: plan.revision }); } };
  const canSavePlan = !!(draft && plan && (draft.same ? plan.mode !== "actual" :
    draft.slots.length > 0 && (plan.mode !== "manual" || JSON.stringify(draft.slots) !== JSON.stringify(sorted(plan.slots)))));
  const toggle = (s: Slot) => draft && setDraft({ ...draft, slots: draft.slots.some((x) => x.date === s.date && x.start === s.start)
    ? draft.slots.filter((x) => !(x.date === s.date && x.start === s.start)) : sorted([...draft.slots, s]) });
  const [y, mo] = month.split("-").map(Number);

  return (
    <div className="space-y-3">
      <fieldset disabled={!!lesson || !!slot || !!draft || editingSettings || changePay.isPending} className="flex flex-wrap items-end gap-2 print:hidden">
        <div className="w-44"><Label label="월"><Input type="month" value={month} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setEditingPay(false); pick(""); } }} /></Label></div>
        {sheet.data?.therapists && <div className="w-44"><Label label="교사"><Select aria-label="교사" value={sheet.data.therapist} onChange={(e) => { setEditingPay(false); setTeacher(e.target.value); pick(""); }}>
          {!sheet.data.therapist && <option value="">교사 선택</option>}
          {sheet.data.therapists.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select></Label></div>}
        <Tabs value={view} onChange={(next) => { setView(next); setEditingPay(false); }} items={[["actual", "실제 일정"], ["pay", "결제 일정"]]} />
        {view === "actual" && sheet.data?.can_edit && <Button type="button" variant={editingPay ? "outline" : "ghost"} aria-pressed={editingPay}
          onClick={() => setEditingPay(!editingPay)}>{editingPay ? "편집 완료" : "편집"}</Button>}
        <Button variant="ghost" className="ml-auto" onClick={() => window.print()}><Printer size={14} />인쇄</Button>
      </fieldset>
      {sheet.data?.therapist && !sheet.data.can_edit && <p className="text-sm text-slate-600 print:hidden">이 일정표는 조회만 가능해요. 담당 치료사가 본인 일정표에서 수정할 수 있어요.</p>}
      {view === "actual" && sheet.data?.can_edit && !editingPay && !lesson && <p className="text-sm text-slate-600 print:hidden">빈칸을 누르면 등록된 담당 아동의 수업을 추가하고, 이름을 누르면 그날 수업을 수정할 수 있어요.</p>}
      {editingPay && <p className="text-sm text-slate-600 print:hidden">각 수업 칸에서 고르면 바로 저장돼요. 바우처는 월 결제 날짜에 추가하고, 사비·인지는 제거해요.</p>}
      {changePay.error && <Notice tone="red">{errText(changePay.error)}</Notice>}
      {view === "actual" && staleLesson && !lesson && <Notice>수업 또는 담당 정보가 바뀌었어요. 최신 일정표에서 수업을 다시 선택해 주세요.</Notice>}
      {slot && <form aria-label="빈칸 수업 추가" className="flex flex-wrap items-end gap-2 rounded-lg border p-3 print:hidden"
        onSubmit={e => { e.preventDefault(); if (newChild) add.mutate(slot); }}>
        <strong>{slot.date} {slot.start}~{plus(slot.start, config.session_minutes)} 수업 추가</strong>
        <Label label="등록된 담당 아동"><Select value={newChild} autoFocus disabled={add.isPending} onChange={e => setNewChild(e.target.value)} required>
          <option value="">아동 선택</option>{available.map(p => <option key={p.child_id} value={p.child_id}>{name(p.child_id)} · {sheet.data?.aliases?.[p.child_id]}</option>)}
        </Select></Label>
        <Button disabled={!newChild || add.isPending || !sheet.data?.can_edit}>추가</Button>
        <Button variant="ghost" type="button" disabled={add.isPending} onClick={() => setSlot(null)}>취소</Button>
        {add.error && <Notice tone="red">{errText(add.error)}</Notice>}
      </form>}
      {lesson && <section className="print:hidden" aria-label="선택한 수업 수정">
        <h3 ref={lessonHeading} tabIndex={-1} className="text-sm font-semibold">{name(lesson.child_id)} · {lesson.date} {lesson.start} 수업 수정</h3>
        <EditClassForm key={lesson.id} c={lesson} monthly={{ revision: lesson.revision, onStale: async () => {
          await sheet.refetch(); setLesson(null); setStaleLesson(true);
        } }} onCancel={() => setLesson(null)} onDone={async () => { await refresh(); setLesson(null); }} />
      </section>}
      {view === "pay" && sheet.data?.can_edit && me?.therapist_name === sheet.data.therapist && <fieldset disabled={!!draft}><PaymentSettings onEditingChange={setEditingSettings} /></fieldset>}
      {view === "pay" && (
        <fieldset disabled={editingSettings} className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm print:hidden">
          <p className="text-slate-600">아동을 선택하면 그 아동의 이번 달 바우처 서류와 정산에 사용할 날짜를 확인할 수 있어요.</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48"><Label label="결제 일정을 확인할 아동"><Select aria-label="결제 일정을 확인할 아동" disabled={!!draft} value={childId} onChange={(e) => pick(e.target.value)}>
              <option value="">아동 선택</option>
              {sheet.data?.plans.map((p) => <option key={p.child_id} value={p.child_id}>{name(p.child_id)}</option>)}
            </Select></Label></div>
            {plan && !draft && <>
              <span className="text-slate-500">{plan.mode === "actual" ? "실제 일정과 동일 · 월 첫 5회" : plan.mode === "manual" ? `직접 입력한 결제 일정 ${plan.slots.length}회` : "결제 일정 미설정 · 산정 보류"}</span>
              {plan?.can_edit && <Button variant="outline" onClick={open}>결제 일정 수정</Button>}
            </>}
            {childId && draft && <>
              {plan?.mode === "actual" && <label className="flex items-center gap-1.5"><input type="checkbox" checked={!draft.same}
                disabled={save.isPending} onChange={(e) => setDraft({ ...draft, same: !e.target.checked })} />이 아동의 이번 달 결제 날짜 직접 지정</label>}
              {plan?.mode === "manual" && sheet.data?.default_same_as_actual && <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.same}
                disabled={save.isPending} onChange={(e) => setDraft({ ...draft, same: e.target.checked })} />직접 입력한 날짜를 지우고 내 설정(실제 일정과 동일) 적용</label>}
              {!draft.same && <span className="text-slate-500">아래 표에서 칸을 눌러 {name(childId)}의 결제 날짜를 넣고 빼요 · {draft.slots.length}회</span>}
              <Button disabled={save.isPending || !canSavePlan} onClick={() => save.mutate()}>결제 일정 저장</Button>
              <Button variant="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>취소</Button>
              {draft.same && plan?.mode === "manual" && <span className="text-xs text-slate-500">저장하면 실제 수업 날짜가 자동으로 반영돼요.</span>}
            </>}
          </div>
          {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
        </fieldset>)}

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
                const mine = editing && who.some((entry) => entry.cid === childId);
                const blocked = reserved.some(s => s.date === d && s.start < plus(t, config.session_minutes) && t < s.end);
                return (
              <td key={t} className={`h-9 border border-slate-400 px-1 align-top ${mine ? "bg-indigo-100" : ""}`}>
                    {view === "actual" && !who.length && blocked ? <span className="text-slate-500">예약됨</span>
                    : view === "actual" && !who.length && sheet.data?.can_edit ? <button type="button" aria-label={`${d} ${t} 수업 추가`}
                      disabled={!!slot || !!lesson || sheet.isFetching || sheet.isError || !available.length}
                      className="min-h-9 w-full text-slate-500 hover:bg-indigo-50 focus:bg-indigo-50 print:hidden" onClick={() => openSlot(d, t)}><span className="sr-only">수업 추가</span></button>
                    : editing ? <button type="button" aria-label={`${name(childId)} ${d} ${t} 결제 일정`} aria-pressed={mine} disabled={save.isPending} onClick={() => toggle({ date: d, start: t })}
                      className="min-h-9 w-full text-left hover:bg-indigo-50">{who.map(({ cid }) => name(cid)).join(" · ")}{mine && <X size={10} className="ml-0.5 inline" />}</button> : who.map(({ cid, lesson: c }, j) => (
                      <Fragment key={c?.id ?? cid + j}>
                        {editingPay && c?.can_edit ? <div><span className="text-rose-800">{name(cid)}</span><Select aria-label={`${name(cid)} ${d} ${t} 수업 구분`}
                          className="w-full min-w-[7rem] text-xs" value={c.pay} disabled={changePay.isPending} onChange={(e) => {
                            const pay = e.target.value as Pay;
                            if (pay === "pending") return;
                            const currentPlan = sheet.data?.plans.find((p) => p.child_id === c.child_id);
                            if (pay === "voucher" && currentPlan?.mode === "unset" && !window.confirm(
                              `${name(cid)} · ${month} 결제 일정이 미설정 상태예요. 이 날짜를 바우처로 지정하면 나머지 미지정 수업은 사비로 계산돼요. 계속할까요?`)) {
                              e.currentTarget.value = c.pay;
                              return;
                            }
                            changePay.reset(); changePay.mutate({ lesson: c, pay });
                          }}>
                          {c.pay === "pending" && <option disabled value="pending">결제 미설정</option>}
                          <option value="voucher">바우처</option><option value="private">사비</option><option value="cognitive">인지</option>
                        </Select></div>
                          : view === "pay" && !draft ? <button type="button" className="text-rose-800 hover:underline print:text-rose-800" onClick={() => pick(cid)}>{name(cid)}</button>
                          : c?.can_edit && !lesson && !slot && !sheet.isError ? <button type="button" aria-label={`${name(cid)} ${d} ${t} 수업 수정`} className="text-rose-800 hover:underline" onClick={() => { setStaleLesson(false); setLesson(c); }}>{name(cid)}</button>
                          : <span className={cid === childId && view === "pay" ? "font-semibold text-indigo-700" : "text-rose-800"}>{name(cid)}</span>}
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
