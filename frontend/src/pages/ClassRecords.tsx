import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { SECTIONS } from "../components/RecordingConsultation";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import ChildPicker from "../components/ChildPicker";
import { Badge, Button, Card, Empty, Input, Label, Notice, PageTitle, Select } from "../components/ui";

type State = { status: string | null; auto: boolean; reason: string | null };
type Session = { id: string; start: string | null; end: string | null; minutes: number | null; activities: { name: string; accuracy_pct?: number | null }[];
  utterances: string[]; observed_behaviors: string[]; note: string | null };
type Rec = { date: string; start: string | null; end: string | null; child_id: string; therapist: string | null; schedule_id: string | null; makeup: boolean;
  state: State; sessions: Session[]; recordings: { id: string; kind: string; sections: Record<string, string> }[]; consultations: Consult[] };
type Consult = { id: string; start: string | null; end: string | null; counselor: string; topics: string[]; summary: string; session_summary?: string | null;
  guidance_given?: string | null; follow_up?: string | null; home_activities?: string[] | null; parent_concerns?: string[] | null };

const ST: Record<string, [string, "green" | "amber" | "red" | "slate" | "indigo"]> = {
  present: ["출석", "green"], late: ["지각", "amber"], absent: ["결석", "red"], excused: ["사유결석", "slate"], makeup: ["보강", "indigo"], moved: ["옮김", "slate"],
};
const DOW = "일월화수목금토";
const label = (iso: string) => { const d = new Date(iso + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()} (${DOW[d.getDay()]})`; };
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const SEC = Object.fromEntries(SECTIONS);

/** 수업 기록 조회: a month of classes across children with attendance and the records written for each. */
export default function ClassRecords() {
  const { children, childId: child, setChildId } = useChild(); // the child picked at the top of the screen
  const nav = useNavigate();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [therapist, setTherapist] = useState(""), [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const therapists = useQuery({ queryKey: ["org", "therapists"], queryFn: () => api<string[]>("/org/therapists") }).data ?? [];
  const q = new URLSearchParams({ month, ...(child ? { child_id: child } : {}), ...(therapist ? { therapist } : {}) });
  const list = useQuery({ queryKey: ["class-records", q.toString()], queryFn: () => api<Rec[]>(`/class-records?${q}`) });
  const who = (id: string) => { const c = children.find((x) => x.id === id); return c ? `${c.display_name} · ${c.alias}` : "(삭제된 아동)"; };
  const happened = (r: Rec) => r.state.status && !["absent", "excused", "moved"].includes(r.state.status);
  const written = (r: Rec) => r.consultations.length > 0 || r.sessions.length > 0 || r.recordings.length > 0;
  const rows = (list.data ?? []).filter((r) => !missing || (happened(r) && r.date <= today() && !written(r)));
  const days = [...new Set(rows.map((r) => r.date))];
  const done = (list.data ?? []).filter((r) => happened(r) && r.date <= today());

  return (
    <>
      <PageTitle title="수업 기록 조회" sub="위에서 고른 아이(없으면 전체)의 달별 수업과 출결, 수업 기록·활동 기록·녹음 기록을 한 번에 봐요." />
      <Card className="mb-4">
        <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_10rem_auto] sm:items-end">
          <Label label="월"><Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Label>
          <Label label="아동 (위쪽 선택과 같아요)"><ChildPicker value={child} onChange={setChildId} emptyLabel="전체 아동" /></Label>
          <Label label="치료사"><Select value={therapist} onChange={(e) => setTherapist(e.target.value)}><option value="">전체</option>{therapists.map((t) => <option key={t}>{t}</option>)}</Select></Label>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />기록 없는 수업만</label>
        </div>
        {list.data && <p className="mt-3 text-sm text-slate-600">지난 수업 {done.length}개 중 기록 있음 <b>{done.filter(written).length}</b> · 기록 없음 <b className="text-amber-700">{done.filter((r) => !written(r)).length}</b></p>}
      </Card>

      {list.isLoading ? <p className="text-sm text-slate-400">불러오는 중…</p> : !rows.length ? <Card><Empty>{missing ? "기록이 빠진 수업이 없어요." : "이 조건의 수업이 없어요."}</Empty></Card> : (
        <div className="space-y-3">
          {days.map((d) => (
            <section key={d} className="rounded-lg border border-slate-200 bg-white">
              <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">{label(d)}{d === today() && <span className="ml-2 text-xs font-normal text-indigo-700">오늘</span>}</h2>
              <ul className="divide-y divide-slate-100">
                {rows.filter((r) => r.date === d).map((r) => {
                  const key = `${r.date}-${r.child_id}-${r.start}`;
                  const st = r.state.status;
                  return (
                    <Fragment key={key}>
                      <li>
                        <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-slate-50" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                          {open === key ? <ChevronDown size={14} className="shrink-0 text-slate-400" /> : <ChevronRight size={14} className="shrink-0 text-slate-400" />}
                          <span className="w-24 shrink-0 text-sm tabular-nums text-slate-600">{r.start}{r.end && `–${r.end}`}</span>
                          <span className="font-medium">{who(r.child_id)}</span>
                          <span className="text-sm text-slate-500">{r.therapist}</span>
                          {r.makeup && <Badge tone="indigo">보강</Badge>}
                          {st ? <Badge tone={ST[st]?.[1]}>{ST[st]?.[0] ?? st}{r.state.auto && st === "present" ? " (자동)" : ""}</Badge> : <Badge>예정</Badge>}
                          <span className="ml-auto flex flex-wrap gap-1">
                            {r.consultations.length > 0 && <Badge tone="green">수업 기록</Badge>}
                            {r.sessions.length > 0 && <Badge tone="green">활동 기록</Badge>}
                            {r.sessions.some((s) => s.note) && <Badge tone="green">노트</Badge>}
                            {r.recordings.length > 0 && <Badge tone="green">녹음 기록</Badge>}
                            {!written(r) && happened(r) && r.date <= today() && <Badge tone="amber">기록 없음</Badge>}
                          </span>
                        </button>
                        {open === key && (
                          <div className="space-y-3 bg-slate-50/60 px-4 pb-4 pt-2 text-sm">
                            {r.state.reason && <p className="text-slate-500">{r.state.reason}</p>}
                            {r.consultations.map((c) => (
                              <div key={c.id} className="rounded-md border border-slate-200 bg-white p-3">
                                <p className="mb-1 text-xs font-semibold text-slate-500">수업 기록 · {c.counselor}{c.start && ` · ${c.start}${c.end ? `–${c.end}` : ""}`}</p>
                                {c.topics?.length > 0 && <p className="mb-1 flex flex-wrap gap-1">{c.topics.map((t) => <Badge key={t}>{t}</Badge>)}</p>}
                                {c.session_summary && <p className="whitespace-pre-wrap"><span className="text-slate-500">수업 </span>{c.session_summary}</p>}
                                <p className="whitespace-pre-wrap">{c.summary}</p>
                                {c.parent_concerns && c.parent_concerns.length > 0 && <p className="mt-1"><span className="text-slate-500">보호자 질문 </span>{c.parent_concerns.join(" / ")}</p>}
                                {c.guidance_given && <p className="mt-1 whitespace-pre-wrap"><span className="text-slate-500">안내 </span>{c.guidance_given}</p>}
                                {c.home_activities && c.home_activities.length > 0 && <p className="mt-1"><span className="text-slate-500">가정 활동 </span>{c.home_activities.join(" / ")}</p>}
                                {c.follow_up && <p className="mt-1 whitespace-pre-wrap"><span className="text-slate-500">후속 </span>{c.follow_up}</p>}
                              </div>))}
                            {r.sessions.map((s) => (
                              <div key={s.id} className="rounded-md border border-slate-200 bg-white p-3">
                                <p className="mb-1 text-xs font-semibold text-slate-500">회기 기록 {s.start && `${s.start}–${s.end}`}{s.minutes ? ` · ${s.minutes}분` : ""}</p>
                                {s.activities.length > 0 && <p><span className="text-slate-500">활동 </span>{s.activities.map((a) => `${a.name}${a.accuracy_pct != null ? ` ${a.accuracy_pct}%` : ""}`).join(", ")}</p>}
                                {s.utterances.length > 0 && <p><span className="text-slate-500">발화 </span>{s.utterances.join(" / ")}</p>}
                                {s.observed_behaviors.length > 0 && <p><span className="text-slate-500">관찰 </span>{s.observed_behaviors.join(", ")}</p>}
                                {s.note && <p className="mt-2 whitespace-pre-wrap">{s.note}</p>}
                              </div>))}
                            {r.recordings.map((rec) => (
                              <div key={rec.id} className="rounded-md border border-slate-200 bg-white p-3">
                                <p className="mb-1 text-xs font-semibold text-slate-500">{rec.kind === "consultation" ? "상담 녹음 기록" : "회기 녹음 기록"}</p>
                                {Object.entries(rec.sections).map(([k, v]) => <p key={k} className="mt-1"><span className="text-slate-500">{SEC[k] ?? k} </span><span className="whitespace-pre-wrap">{v}</span></p>)}
                              </div>))}
                            {!written(r) && <p className="text-slate-500">이 수업의 기록이 아직 없어요.</p>}
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" onClick={() => { setChildId(r.child_id); nav("/sessions"); }}>{written(r) ? "수업 기록 보기" : "수업 기록 쓰기"}</Button>
                            </div>
                          </div>)}
                      </li>
                    </Fragment>);
                })}
              </ul>
            </section>))}
        </div>)}
      {list.error && <Notice tone="red">{errText(list.error)}</Notice>}
    </>
  );
}
