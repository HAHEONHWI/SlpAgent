import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic } from "lucide-react";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { Badge, Button, Card, Input, Label, Notice, Textarea } from "./ui";

type Payload = {
  date: string; start: string | null; end: string | null; minutes: number | null; counselor: string;
  summary: string; session_summary: string; topics: string[]; parent_concerns: string[]; guidance_given: string;
  home_activities: string[]; follow_up: string; participants: string[]; transcript: string; duration_seconds: number;
  stt_provider?: string;
};
type Draft = { id: string; kind: string; status: string; payload: Payload; created_at?: string };

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const LIST_FIELDS = ["topics", "parent_concerns", "home_activities", "participants"] as const;
const TEXT_FIELDS: [keyof Payload, string][] = [["summary", "상담 요약"], ["session_summary", "오늘 수업 요약"], ["guidance_given", "제공한 지도·안내"], ["follow_up", "후속 조치"]];
const LIST_LABELS: Record<(typeof LIST_FIELDS)[number], string> = { topics: "상담 주제", parent_concerns: "보호자 질문·걱정", home_activities: "가정 연계 활동", participants: "참석자" };

/** Consultation recording -> Groq Whisper transcript -> gpt draft -> therapist edits and approves. */
export default function RecordingConsultation({ childId }: { childId: string }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0); // remount the file input to clear it after a successful upload
  const [form, setForm] = useState({ date: today(), start: "", end: "", counselor: "" });
  const drafts = useQuery({
    queryKey: ["proposals", childId, "consultation_recording"],
    queryFn: async () => (await api<Draft[]>(`/proposals?child_id=${childId}`)).filter((d) => d.kind === "consultation_recording"),
  });
  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append("file", file!);
      body.append("consult_date", form.date);
      body.append("counselor", form.counselor);
      if (form.start && form.end) { body.append("start", form.start); body.append("end", form.end); }
      return api<Draft>(`/children/${childId}/consultations/recording`, { method: "POST", body, long: true });
    },
    onSuccess: () => { setFile(null); setInputKey((k) => k + 1); qc.invalidateQueries({ queryKey: ["proposals"] }); },
  });
  const tooBig = !!file && file.size > 30 * 1024 * 1024;
  return (
    <div className="space-y-3">
      <Card title="녹음 파일로 상담 기록 만들기" action={<Mic size={16} className="text-slate-400" aria-hidden />}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); upload.mutate(); }}>
          <Label label="상담 녹음 파일 (m4a, mp3, wav 등 · 30MB 이하)">
            <Input key={inputKey} type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac,.aac" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </Label>
          {tooBig && <Notice tone="red">30MB를 넘는 파일은 올릴 수 없습니다. 녹음을 나눠서 올려 주세요.</Notice>}
          <div className="grid grid-cols-3 gap-2">
            <Label label="상담일"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></Label>
            <Label label="시작 (선택)"><Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Label>
            <Label label="종료 (선택)"><Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Label>
          </div>
          <Label label="상담자"><Input value={form.counselor} onChange={(e) => setForm({ ...form, counselor: e.target.value })} required /></Label>
          <p className="text-xs text-slate-500">녹음은 Groq(미국)에서 받아쓰고(장애 시 OpenRouter·Google, 데이터 비보관 조건) OpenAI(미국)에서 요약합니다. 원본 녹음은 서비스에 저장하지 않습니다. 보호자에게 녹음과 처리에 대한 동의를 받은 녹음만 올려 주세요.</p>
          {upload.error && <Notice tone="red">{errText(upload.error)}</Notice>}
          <Button disabled={!file || tooBig || upload.isPending}>{upload.isPending ? "받아쓰고 요약하는 중… (1분 이내)" : "받아쓰기 · 요약 초안 만들기"}</Button>
        </form>
      </Card>
      {drafts.data?.map((d) => <DraftEditor key={d.id} draft={d} />)}
    </div>
  );
}

function DraftEditor({ draft }: { draft: Draft }) {
  const qc = useQueryClient();
  const [p, setP] = useState<Payload>(draft.payload);
  const [lists, setLists] = useState(() => Object.fromEntries(LIST_FIELDS.map((k) => [k, (draft.payload[k] ?? []).join(", ")])) as Record<string, string>);
  const [showTranscript, setShowTranscript] = useState(false);
  const done = () => qc.invalidateQueries({ queryKey: ["proposals"] }).then(() => qc.invalidateQueries({ queryKey: ["consultations"] }));
  const edited = (): Payload => ({ ...p, ...Object.fromEntries(LIST_FIELDS.map((k) => [k, lists[k].split(",").map((x) => x.trim()).filter(Boolean)])) });
  // Save the therapist's edits first, then approve, so the record contains exactly what was reviewed.
  const approve = useMutation({
    mutationFn: async () => {
      await api(`/proposals/${draft.id}`, { method: "PUT", json: { payload: edited() } });
      return api(`/proposals/${draft.id}/approve`, { method: "POST" });
    },
    onSuccess: done,
  });
  const reject = useMutation({ mutationFn: () => api(`/proposals/${draft.id}/reject`, { method: "POST" }), onSuccess: done });
  return (
    <Card title={`상담 기록 초안 · ${p.date}`} className="border-amber-300" action={<Badge tone="amber">미승인 초안</Badge>}>
      <div className="space-y-3">
        <Notice>AI가 녹음에서 만든 초안입니다. 아래 녹취록과 대조해 틀린 내용을 고친 뒤 승인하세요. 승인 전에는 아동 기록에 저장되지 않습니다.</Notice>
        {p.stt_provider === "openrouter" && <Notice>기본 받아쓰기 서비스가 한도를 넘어 <b>예비 경로(범용 AI 모델)</b>로 받아썼습니다. 빠지거나 바뀐 말이 있을 수 있으니 녹취록을 특히 꼼꼼히 확인하세요.</Notice>}
        {TEXT_FIELDS.map(([k, label]) => (
          <Label key={k} label={label}><Textarea value={(p[k] as string) ?? ""} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></Label>))}
        <div className="grid gap-2 md:grid-cols-2">
          {LIST_FIELDS.map((k) => (
            <Label key={k} label={`${LIST_LABELS[k]} (쉼표 구분)`}><Input value={lists[k]} onChange={(e) => setLists({ ...lists, [k]: e.target.value })} /></Label>))}
        </div>
        <div>
          <button type="button" className="text-sm text-indigo-700 underline" onClick={() => setShowTranscript(!showTranscript)} aria-expanded={showTranscript}>
            {showTranscript ? "녹취록 닫기" : `녹취록 보기 (${Math.round(p.duration_seconds / 60) || 1}분 분량)`}</button>
          {showTranscript && <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">{p.transcript}</p>}
        </div>
        {(approve.error || reject.error) && <Notice tone="red">{errText(approve.error || reject.error)}</Notice>}
        <div className="flex gap-2">
          <Button onClick={() => approve.mutate()} disabled={approve.isPending || !p.summary.trim()}>검토 완료 · 상담 기록으로 저장</Button>
          <Button variant="ghost" onClick={() => reject.mutate()} disabled={reject.isPending}>삭제(반려)</Button>
        </div>
      </div>
    </Card>
  );
}
