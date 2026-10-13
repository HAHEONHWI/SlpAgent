import { useState } from "react";
import { useCreate, useRecords } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import RecordingConsultation from "../components/RecordingConsultation";
import { Badge, Button, Card, Empty, ErrorNotice, Input, Label, Notice, PageTitle, Textarea } from "../components/ui";

type Consultation = { id: string; date: string; start: string | null; end: string | null; minutes: number | null; counselor: string; participants: string[]; topics: string[]; summary: string; guidance_given: string | null; follow_up: string | null; created_at: string;
  session_summary?: string | null; parent_concerns?: string[] | null; home_activities?: string[] | null; transcript?: string | null; source?: string };
const blank = { date: "", start: "", end: "", counselor: "", participants: "", topics: "", summary: "", guidance_given: "", follow_up: "" };
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function Inner({ childId }: { childId: string }) {
  const records = useRecords<Consultation>(childId, "consultations");
  const create = useCreate(childId, "consultations");
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = () => create.mutate({
    date: f.date, start: f.start || null, end: f.end || null, counselor: f.counselor, participants: list(f.participants), topics: list(f.topics),
    summary: f.summary, guidance_given: f.guidance_given || null, follow_up: f.follow_up || null,
  }, { onSuccess: () => setF({ ...blank, counselor: f.counselor }) } as any);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="상담 기록 입력">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Label label="상담일"><Input type="date" value={f.date} onChange={set("date")} required /></Label>
          <div className="grid grid-cols-2 gap-2"><Label label="시작 (선택)"><Input type="time" value={f.start} onChange={set("start")} /></Label><Label label="종료 (선택)"><Input type="time" value={f.end} onChange={set("end")} /></Label></div>
          <Label label="상담자"><Input value={f.counselor} onChange={set("counselor")} required /></Label>
          <Label label="참여자 (쉼표 구분)"><Input value={f.participants} onChange={set("participants")} placeholder="예: 어머니, 아버지" /></Label>
          <Label label="상담 주제 (쉼표 구분)"><Input value={f.topics} onChange={set("topics")} placeholder="예: 가정 내 의사소통, 과제 안내" /></Label>
          <Label label="상담 내용 요약"><Textarea value={f.summary} onChange={set("summary")} required /></Label>
          <Label label="제공한 지도·안내"><Textarea value={f.guidance_given} onChange={set("guidance_given")} /></Label>
          <Label label="후속 조치"><Textarea value={f.follow_up} onChange={set("follow_up")} /></Label>
          <ErrorNotice error={create.error} />
          <Button disabled={create.isPending}>저장</Button>
        </form>
      </Card>
      <div className="space-y-3 lg:col-span-2">
        <RecordingConsultation childId={childId} />
        <Notice>상담 기록은 치료사가 직접 쓰거나, 녹음 파일에서 만든 초안을 검토·승인해 저장합니다. AI 초안은 승인 전까지 기록되지 않습니다.</Notice>
        {records.error ? <ErrorNotice error={records.error} /> : !records.data?.length ? <Card><Empty>{records.isLoading ? "불러오는 중…" : "상담 기록이 없습니다."}</Empty></Card>
          : [...records.data].reverse().map((c) => (
            <Card key={c.id} title={`${c.date}${c.start && c.end ? ` ${c.start}–${c.end}` : ""}${c.minutes != null ? ` (${c.minutes}분)` : ""}`} action={<span className="text-xs text-slate-500">상담자: {c.counselor}</span>}>
              {(c.participants.length > 0 || c.topics.length > 0) && <div className="mb-2 flex flex-wrap gap-1">
                {c.topics.map((t) => <Badge key={t} tone="indigo">{t}</Badge>)}
                {c.participants.length > 0 && <span className="text-xs text-slate-500">참여: {c.participants.join(", ")}</span>}
              </div>}
              {c.source === "recording_ai_approved" && <p className="mb-1"><Badge>녹음 기반 · 치료사 승인</Badge></p>}
              <p className="whitespace-pre-wrap text-sm">{c.summary}</p>
              {c.session_summary && <p className="mt-2 whitespace-pre-wrap text-sm"><b className="text-xs text-slate-600">수업 요약 </b>{c.session_summary}</p>}
              {!!c.parent_concerns?.length && <p className="mt-1 text-sm"><b className="text-xs text-slate-600">보호자 질문·걱정 </b>{c.parent_concerns.join(" · ")}</p>}
              {c.guidance_given && <p className="mt-2 whitespace-pre-wrap text-sm"><b className="text-xs text-slate-600">지도·안내 </b>{c.guidance_given}</p>}
              {!!c.home_activities?.length && <p className="mt-1 text-sm"><b className="text-xs text-slate-600">가정 연계 활동 </b>{c.home_activities.join(" · ")}</p>}
              {c.follow_up && <p className="mt-1 whitespace-pre-wrap text-sm"><b className="text-xs text-slate-600">후속 조치 </b>{c.follow_up}</p>}
              {c.transcript && <details className="mt-2 text-sm"><summary className="cursor-pointer text-indigo-700">녹취록</summary><p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-slate-700">{c.transcript}</p></details>}
            </Card>))}
      </div>
    </div>
  );
}
export default function Parents() { return <><PageTitle title="보호자 상담" sub="치료사가 작성한 상담 기록" /><RequireChild>{(id) => <Inner childId={id} />}</RequireChild></>; }
