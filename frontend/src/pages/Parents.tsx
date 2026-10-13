import { useState } from "react";
import { useCreate, useRecords } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import { Badge, Button, Card, Empty, ErrorNotice, Input, Label, Notice, PageTitle, Textarea } from "../components/ui";

type Consultation = { id: string; date: string; start: string | null; end: string | null; minutes: number | null; counselor: string; participants: string[]; topics: string[]; summary: string; guidance_given: string | null; follow_up: string | null; created_at: string };
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
        <Notice>상담 기록은 치료사가 직접 작성합니다. AI 보호자 안내문 초안은 AI 대화(아동 선택)에서 요청할 수 있으며, 승인 대기 목록에서 검토·승인한 뒤에만 기록됩니다.</Notice>
        {records.error ? <ErrorNotice error={records.error} /> : !records.data?.length ? <Card><Empty>{records.isLoading ? "불러오는 중…" : "상담 기록이 없습니다."}</Empty></Card>
          : [...records.data].reverse().map((c) => (
            <Card key={c.id} title={`${c.date}${c.start && c.end ? ` ${c.start}–${c.end}` : ""}${c.minutes != null ? ` (${c.minutes}분)` : ""}`} action={<span className="text-xs text-slate-500">상담자: {c.counselor}</span>}>
              {(c.participants.length > 0 || c.topics.length > 0) && <div className="mb-2 flex flex-wrap gap-1">
                {c.topics.map((t) => <Badge key={t} tone="indigo">{t}</Badge>)}
                {c.participants.length > 0 && <span className="text-xs text-slate-500">참여: {c.participants.join(", ")}</span>}
              </div>}
              <p className="whitespace-pre-wrap text-sm">{c.summary}</p>
              {c.guidance_given && <p className="mt-2 whitespace-pre-wrap text-sm"><b className="text-xs text-slate-600">지도·안내 </b>{c.guidance_given}</p>}
              {c.follow_up && <p className="mt-1 whitespace-pre-wrap text-sm"><b className="text-xs text-slate-600">후속 조치 </b>{c.follow_up}</p>}
            </Card>))}
      </div>
    </div>
  );
}
export default function Parents() { return <><PageTitle title="보호자 상담" sub="치료사가 작성한 상담 기록" /><RequireChild>{(id) => <Inner childId={id} />}</RequireChild></>; }
