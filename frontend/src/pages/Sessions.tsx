import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { errText, useClassSlot, useCreate, useRecords } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import RecordingConsultation from "../components/RecordingConsultation";
import RecordingRecords from "../components/RecordingRecords";
import ClassTimeFields from "../components/ClassTimeFields";
import { Badge, Button, Card, Empty, Input, Label, Notice, PageTitle, Section, Select, Textarea } from "../components/ui";

// 수업 기록 = what used to be two screens (회기별 치료기록 + 보호자 상담): after each class the therapist writes what was
// done and what was told to the parent. Activity accuracy / utterances are optional details saved as a session record.
type Consultation = { id: string; date: string; start: string | null; end: string | null; minutes: number | null; counselor: string; participants: string[]; topics: string[];
  summary: string; guidance_given: string | null; follow_up: string | null; created_at: string; session_summary?: string | null; parent_concerns?: string[] | null;
  home_activities?: string[] | null; transcript?: string | null; source?: string };
type Session = { id: string; date: string; start: string; end: string; minutes: number; therapist: string; status: string; activities: { name: string; correct: number; trials: number; prompt_level?: string | null }[];
  activity_accuracy: { accuracy_pct: number | null }[]; utterances: string[]; observed_behaviors: string[]; created_at: string };
type A = { name: string; correct: string; trials: string; prompt_level: string };
const blankA: A = { name: "", correct: "", trials: "", prompt_level: "" };
const blank = { summary: "", guidance_given: "", follow_up: "", topics: "", participants: "", utterances: "", behaviors: "" };
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function Inner({ childId }: { childId: string }) {
  const consultations = useRecords<Consultation>(childId, "consultations");
  const sessions = useRecords<Session>(childId, "sessions");
  const saveConsult = useCreate(childId, "consultations");
  const saveSession = useCreate(childId, "sessions");
  const therapists = useQuery({ queryKey: ["org", "therapists"], queryFn: () => api<string[]>("/org/therapists") }).data ?? [];
  const [f, setF] = useState(blank);
  const [details, setDetails] = useState(false);
  const [acts, setActs] = useState<A[]>([{ ...blankA }]);
  const [err, setErr] = useState("");
  const slot = useClassSlot(childId);
  const set = (k: keyof typeof blank) => (e: any) => setF({ ...f, [k]: e.target.value });
  const upd = (i: number, k: keyof A, v: string) => setActs(acts.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  const filledActs = acts.filter((a) => a.name.trim());
  const hasDetails = filledActs.length > 0 || !!f.utterances.trim() || !!f.behaviors.trim();

  const submit = async () => {
    setErr("");
    if (hasDetails && (!slot.start || !slot.end)) return setErr("활동·발화·관찰을 함께 저장하려면 시작·종료 시간을 넣어 주세요.");
    try {
      await saveConsult.mutateAsync({ date: slot.date, start: slot.start || null, end: slot.end || null, counselor: slot.counselor, participants: csv(f.participants), topics: csv(f.topics),
        summary: f.summary, guidance_given: f.guidance_given || null, follow_up: f.follow_up || null });
      if (hasDetails) await saveSession.mutateAsync({ date: slot.date, start: slot.start, end: slot.end, therapist: slot.counselor, status: "completed",
        utterances: lines(f.utterances), observed_behaviors: lines(f.behaviors),
        activities: filledActs.map((a) => ({ name: a.name.trim(), correct: Number(a.correct || 0), trials: Number(a.trials || 0), prompt_level: a.prompt_level || null })) });
      setF(blank); setActs([{ ...blankA }]); setDetails(false);
    } catch (e) { setErr(errText(e)); }
  };

  // one timeline: written records and older session records, newest day first
  const days = [...new Set([...(consultations.data ?? []).map((c) => c.date), ...(sessions.data ?? []).map((s) => s.date)])].sort().reverse();
  const busy = saveConsult.isPending || saveSession.isPending;
  return (
    <div className="grid items-start gap-10 lg:grid-cols-2">
      <Section title="수업 기록 쓰기">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <ClassTimeFields slot={slot} />
          <Label label="담당 치료사">{therapists.length
            ? <Select value={slot.counselor} onChange={(e) => slot.setCounselor(e.target.value)} required><option value="">선택</option>{therapists.map((t) => <option key={t}>{t}</option>)}</Select>
            : <Input value={slot.counselor} onChange={(e) => slot.setCounselor(e.target.value)} required />}</Label>
          <Label label="수업 내용"><Textarea className="min-h-28" value={f.summary} onChange={set("summary")} required placeholder="오늘 한 활동과 아동의 반응" /></Label>
          <Label label="보호자에게 안내한 내용 (선택)"><Textarea value={f.guidance_given} onChange={set("guidance_given")} placeholder="가정에서 할 활동, 전달 사항" /></Label>
          <Label label="다음 수업·후속 조치 (선택)"><Textarea value={f.follow_up} onChange={set("follow_up")} /></Label>
          <div className="grid grid-cols-2 gap-2">
            <Label label="주제 (쉼표 구분, 선택)"><Input value={f.topics} onChange={set("topics")} placeholder="예: 발음, 어휘" /></Label>
            <Label label="참여자 (쉼표 구분, 선택)"><Input value={f.participants} onChange={set("participants")} placeholder="예: 어머니" /></Label>
          </div>
          <div className="flex items-center gap-2 pt-3">
            <button type="button" className="flex items-center gap-1 text-lg font-semibold" onClick={() => setDetails(!details)} aria-expanded={details}>
              {details ? <ChevronDown size={16} /> : <ChevronRight size={16} />}활동 행 <span className="text-sm font-normal text-slate-500">정확도·발화·관찰 (선택)</span></button>
            {details && <Button type="button" variant="outline" className="ml-auto" onClick={() => setActs([...acts, { ...blankA }])}>행 추가</Button>}
          </div>
          {details && (
            <div className="space-y-3">
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-300 text-left text-[11px] tracking-[.08em] text-slate-500">
                <th className="px-1 py-2 font-semibold">활동</th><th className="px-1 py-2 font-semibold">정반응</th><th className="px-1 py-2 font-semibold">전체 시행</th><th className="px-1 py-2 font-semibold">촉진</th></tr></thead>
                <tbody className="divide-y divide-slate-200">{acts.map((a, i) => (
                  <tr key={i}><td className="min-w-40 px-1 py-1.5"><Input placeholder="활동 내용" value={a.name} onChange={(e) => upd(i, "name", e.target.value)} /></td>
                    <td className="w-20 px-1 py-1.5"><Input type="number" min={0} aria-label="정반응" value={a.correct} onChange={(e) => upd(i, "correct", e.target.value)} /></td>
                    <td className="w-20 px-1 py-1.5"><Input type="number" min={0} aria-label="전체 시행" value={a.trials} onChange={(e) => upd(i, "trials", e.target.value)} /></td>
                    <td className="w-24 px-1 py-1.5"><Input aria-label="촉진" value={a.prompt_level} onChange={(e) => upd(i, "prompt_level", e.target.value)} /></td></tr>))}</tbody></table></div>
              <Label label="아동의 실제 발화 (줄바꿈 구분)"><Textarea value={f.utterances} onChange={set("utterances")} /></Label>
              <Label label="관찰 행동 (줄바꿈 구분)"><Textarea value={f.behaviors} onChange={set("behaviors")} /></Label>
              <p className="text-xs text-slate-500">활동 정확도는 발달 분석·경과 그래프에 쓰여요. 저장하려면 시작·종료 시간이 필요해요.</p>
            </div>)}
          {err && <Notice tone="red">{err}</Notice>}
          <div className="pt-2"><Button disabled={busy}>{busy ? "저장 중…" : "기록 저장"}</Button></div>
        </form>
      </Section>

      <div className="min-w-0 space-y-3">
        <RecordingConsultation childId={childId} defaultKind="consultation" />
        <RecordingRecords childId={childId} />
        <h3 className="pt-6 text-xl font-semibold">지난 수업 기록</h3>
        {consultations.error || sessions.error ? <Notice tone="red">{errText(consultations.error || sessions.error)}</Notice>
          : !days.length ? <Card><Empty>{consultations.isLoading || sessions.isLoading ? "불러오는 중…" : "수업 기록이 없습니다."}</Empty></Card>
          : days.map((d) => {
            const cs = (consultations.data ?? []).filter((c) => c.date === d);
            const ss = (sessions.data ?? []).filter((s) => s.date === d);
            const first = cs[0] ?? null;
            const time = first?.start ? `${first.start}${first.end ? `–${first.end}` : ""}` : ss[0] ? `${ss[0].start}–${ss[0].end}` : "";
            return (
              <Card key={d} title={`${d}${time ? ` ${time}` : ""}`} action={<span className="text-xs text-slate-500">{first?.counselor ?? ss[0]?.therapist}</span>}>
                {cs.map((c) => (
                  <div key={c.id} className="mb-3 last:mb-0">
                    {(c.topics.length > 0 || c.participants.length > 0 || c.source === "recording_ai_approved") && <div className="mb-2 flex flex-wrap items-center gap-1">
                      {c.topics.map((t) => <Badge key={t} tone="indigo">{t}</Badge>)}
                      {c.participants.length > 0 && <span className="text-xs text-slate-500">참여: {c.participants.join(", ")}</span>}
                      {c.source === "recording_ai_approved" && <Badge>녹음 기반 · 치료사 승인</Badge>}
                    </div>}
                    {c.session_summary && <p className="mb-1 whitespace-pre-wrap text-sm"><b className="text-xs text-slate-600">수업 요약 </b>{c.session_summary}</p>}
                    <p className="whitespace-pre-wrap text-sm">{c.summary}</p>
                    {!!c.parent_concerns?.length && <p className="mt-1 text-sm"><b className="text-xs text-slate-600">보호자 질문·걱정 </b>{c.parent_concerns.join(" · ")}</p>}
                    {c.guidance_given && <p className="mt-2 whitespace-pre-wrap text-sm"><b className="text-xs text-slate-600">보호자 안내 </b>{c.guidance_given}</p>}
                    {!!c.home_activities?.length && <p className="mt-1 text-sm"><b className="text-xs text-slate-600">가정 연계 활동 </b>{c.home_activities.join(" · ")}</p>}
                    {c.follow_up && <p className="mt-1 whitespace-pre-wrap text-sm"><b className="text-xs text-slate-600">후속 조치 </b>{c.follow_up}</p>}
                    {c.transcript && <details className="mt-2 text-sm"><summary className="cursor-pointer text-indigo-700">녹취록</summary><p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-slate-700">{c.transcript}</p></details>}
                  </div>))}
                {ss.map((s) => (
                  <div key={s.id} className="mt-2 rounded-xl bg-slate-100 p-3 text-sm">
                    <p className="mb-1 text-xs font-semibold text-slate-500">활동 기록 {s.start}–{s.end} ({s.minutes}분)</p>
                    <ul>{s.activities.map((a, i) => <li key={i}>{a.name}: {a.correct}/{a.trials} ({s.activity_accuracy[i]?.accuracy_pct ?? "-"}%){a.prompt_level && ` · 촉진: ${a.prompt_level}`}</li>)}</ul>
                    {s.utterances.length > 0 && <p className="mt-1 text-xs text-slate-600">발화: {s.utterances.join(" / ")}</p>}
                    {s.observed_behaviors.length > 0 && <p className="mt-1 text-xs text-slate-600">관찰: {s.observed_behaviors.join(" / ")}</p>}
                  </div>))}
              </Card>);
          })}
      </div>
    </div>
  );
}
export default function Sessions() { return <><PageTitle title="수업 기록" sub="매 수업 후 한 일과 보호자에게 안내한 내용을 기록해요. 녹음 파일로 초안을 만들 수도 있어요." /><RequireChild>{(id) => <Inner key={id} childId={id} />}</RequireChild></>; }
