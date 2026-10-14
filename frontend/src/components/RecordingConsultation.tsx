import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic } from "lucide-react";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { resumableUpload, type UploadTarget } from "../lib/upload";
import { Badge, Button, Card, Input, Label, Notice, Select, Textarea } from "./ui";

type Job = {
  id: string; status: string; kind: string; meta: { date: string; counselor: string }; filename: string; upload_size: number;
  original_size?: number; compressed_size?: number; duration_seconds?: number; chunk_count?: number; chunks_done?: number;
  chunks_failed?: number; wait_reason?: string | null; wait_until?: string | null; fallback_chunks?: number;
  error?: { reason: string; message: string } | null; draft_id?: string | null; created_at: string;
};
type Draft = { id: string; kind: string; status: string; payload: { job_id: string; sections: Record<string, string>; chunks_failed?: number } };

const MAX_MB = 200;
const EXT = [".m4a", ".mp3", ".wav", ".webm", ".ogg", ".flac", ".mp4", ".aac", ".mpeg", ".mpga"];
export const SECTIONS: [string, string][] = [["goals", "오늘의 치료 목표"], ["activities", "진행한 활동"], ["child_responses", "아동의 주요 반응"],
  ["spontaneous_speech", "자발 발화 및 의사소통 특징"], ["therapist_prompting", "치료사의 촉진과 피드백"],
  ["parent_communication", "보호자 상담 및 전달 사항"], ["home_activities", "가정 연계 활동"], ["next_plan", "다음 회기 계획"]];
const STATUS: Record<string, [string, "amber" | "green" | "red" | "slate" | "indigo"]> = {
  uploading: ["업로드 중", "slate"], queued: ["대기열", "slate"], transcribing: ["받아쓰는 중", "indigo"], waiting: ["대기 중", "amber"],
  merging: ["합치는 중", "indigo"], summarizing: ["요약 중", "indigo"], draft_ready: ["검토 대기", "amber"], approved: ["기록 반영됨", "green"], rejected: ["반려됨", "slate"], failed: ["실패", "red"], cancelled: ["취소됨", "slate"],
};
const WAIT: Record<string, string> = {
  groq_quota: "무료 받아쓰기 한도에 도달해 다음 시간대에 이어서 처리합니다.", groq_rate_limited: "받아쓰기 요청이 많아 잠시 후 이어서 처리합니다.",
  groq_unavailable: "받아쓰기 서비스가 일시적으로 응답하지 않아 다시 시도합니다.", fallback_unavailable: "예비 받아쓰기도 일시적으로 사용할 수 없어 다시 시도합니다.",
  retry_backoff: "잠시 후 다시 시도합니다.", stt_not_available: "받아쓰기 서비스를 사용할 수 없어 대기합니다.",
};
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const mb = (b?: number) => (b ? `${(b / 1024 / 1024).toFixed(1)}MB` : "-");
const mins = (s?: number) => (s ? `${Math.round(s / 60)}분` : "-");
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "");

/** Long recording -> queued compress/split/transcribe/merge/summary -> therapist edits transcript and 8 sections -> approve. */
export default function RecordingConsultation({ childId, defaultKind = "consultation" }: { childId: string; defaultKind?: "session" | "consultation" }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [form, setForm] = useState({ kind: defaultKind, date: today(), start: "", end: "", counselor: "", consent: false });
  const [progress, setProgress] = useState<number | null>(null);
  const jobs = useQuery({
    queryKey: ["recordings", childId],
    queryFn: () => api<Job[]>(`/children/${childId}/recordings`),
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => !["draft_ready", "approved", "rejected", "failed", "cancelled"].includes(j.status)) ? 4000 : false),
    // Polling pauses while the tab is hidden; refresh as soon as the therapist returns to a long-running job.
    refetchOnWindowFocus: "always",
  });
  const ext = file ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  const fileError = !file ? null : !EXT.includes(ext) ? `지원하지 않는 형식입니다 (${ext || "확장자 없음"})` : file.size > MAX_MB * 1024 * 1024 ? `${MAX_MB}MB 이하 파일만 올릴 수 있습니다.` : null;
  const start = useMutation({
    mutationFn: async () => {
      const created = await api<{ job: Job; upload: UploadTarget }>(`/children/${childId}/recordings`, { method: "POST", json: {
        filename: file!.name, size: file!.size, content_type: file!.type || "application/octet-stream", kind: form.kind, date: form.date,
        start: form.start && form.end ? form.start : null, end: form.start && form.end ? form.end : null, counselor: form.counselor, consent: form.consent } });
      qc.invalidateQueries({ queryKey: ["recordings", childId] });
      setProgress(0);
      await resumableUpload(created.upload, file!, setProgress);
      return api(`/recordings/${created.job.id}/complete`, { method: "POST" });
    },
    onSettled: () => { setProgress(null); qc.invalidateQueries({ queryKey: ["recordings", childId] }); },
    onSuccess: () => { setFile(null); setInputKey((k) => k + 1); setForm((f) => ({ ...f, consent: false })); },
  });
  return (
    <div className="space-y-3">
      <Card title="녹음 파일로 기록 만들기" action={<Mic size={16} className="text-slate-400" aria-hidden />}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start.mutate(); }}>
          <Label label={`녹음 파일 (m4a, mp3, wav 등 · ${MAX_MB}MB 이하 · 최대 3시간)`}>
            <Input key={inputKey} type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac,.aac" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </Label>
          {fileError && <Notice tone="red">{fileError}</Notice>}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Label label="종류"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "session" | "consultation" })}>
              <option value="session">치료 회기</option><option value="consultation">보호자 상담</option></Select></Label>
            <Label label="날짜"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></Label>
            <Label label="시작 (선택)"><Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Label>
            <Label label="종료 (선택)"><Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Label>
          </div>
          <Label label="담당 치료사"><Input value={form.counselor} onChange={(e) => setForm({ ...form, counselor: e.target.value })} required /></Label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} required />
            <span>(필수) 녹음 대상자(보호자·법정대리인)에게 녹음과 외부 음성 인식 서비스 전송에 대한 동의를 받았습니다.</span>
          </label>
          <p className="text-xs text-slate-500">녹음은 Groq(미국)에서 받아쓰고, 한도 초과·장애 시 관리자가 허용한 경우 OpenRouter(미국, 데이터 비보관)를 씁니다. 요약은 OpenAI(미국)에서 합니다. 원본 녹음은 처리 중에만 임시 보관 후 삭제됩니다.</p>
          {progress !== null && (
            <div aria-live="polite">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              <p className="mt-1 text-xs text-slate-500">업로드 {Math.round(progress * 100)}% · 연결이 끊기면 이어서 올립니다.</p>
            </div>)}
          {start.error && <Notice tone="red">{errText(start.error)}</Notice>}
          <Button disabled={!file || !!fileError || !form.consent || start.isPending}>{start.isPending ? "올리는 중…" : "올리고 받아쓰기 시작"}</Button>
        </form>
      </Card>
      {jobs.data?.filter((j) => j.status !== "cancelled").slice(0, 5).map((j) => <JobCard key={j.id} job={j} childId={childId} />)}
    </div>
  );
}

function JobCard({ job, childId }: { job: Job; childId: string }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["recordings", childId] });
  const cancel = useMutation({ mutationFn: () => api(`/recordings/${job.id}/cancel`, { method: "POST" }), onSuccess: refresh });
  const retry = useMutation({ mutationFn: () => api(`/recordings/${job.id}/retry`, { method: "POST" }), onSuccess: refresh });
  const [label, tone] = STATUS[job.status] ?? [job.status, "slate"];
  const active = !["draft_ready", "approved", "rejected", "failed", "cancelled"].includes(job.status);
  const pct = job.chunk_count ? Math.round(((job.chunks_done ?? 0) / job.chunk_count) * 100) : 0;
  return (
    <Card title={`${job.kind === "session" ? "회기" : "상담"} 녹음 · ${job.meta.date}`} action={<Badge tone={tone}>{label}</Badge>}>
      <div className="space-y-2 text-sm">
        <p className="text-xs text-slate-500">{job.filename} · 길이 {mins(job.duration_seconds)} · 원본 {mb(job.original_size ?? job.upload_size)} → 변환 {mb(job.compressed_size)}</p>
        {(job.status === "transcribing" || job.status === "waiting") && job.chunk_count ? (
          <div><div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-indigo-600" style={{ width: `${pct}%` }} /></div>
            <p className="mt-1 text-xs text-slate-500">구간 {job.chunks_done ?? 0}/{job.chunk_count} 받아씀{job.fallback_chunks ? ` (예비 경로 ${job.fallback_chunks}개)` : ""}</p></div>) : null}
        {job.status === "queued" && <p className="text-xs text-slate-500">압축·분할을 준비하고 있습니다.</p>}
        {job.status === "waiting" && <Notice>{WAIT[job.wait_reason ?? ""] ?? "잠시 후 이어서 처리합니다."}{job.wait_until && ` (다시 시도: ${time(job.wait_until)})`}</Notice>}
        {job.status === "failed" && <Notice tone="red">{job.error?.message ?? "처리에 실패했습니다."}</Notice>}
        {!!job.chunks_failed && job.status === "draft_ready" && <Notice>받아쓰지 못한 구간이 {job.chunks_failed}개 있습니다. 녹취록에 [인식 실패]로 표시되어 있으며 내용을 추측해 채우지 않았습니다.</Notice>}
        <div className="flex flex-wrap gap-2">
          {(job.status === "failed" || job.status === "waiting") && <Button variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>다시 시도</Button>}
          {active && <Button variant="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>취소</Button>}
        </div>
        {(cancel.error || retry.error) && <Notice tone="red">{errText(cancel.error || retry.error)}</Notice>}
        {job.status === "draft_ready" && <Review job={job} childId={childId} />}
        {job.status === "approved" && <p className="text-sm text-green-700">승인되어 ‘수업 기록’ 화면의 녹음 기록에 저장되었어요.</p>}
        {job.status === "rejected" && <p className="text-sm text-slate-500">반려된 초안이에요. 아동 기록에는 반영되지 않았어요.</p>}
      </div>
    </Card>
  );
}

function Review({ job, childId }: { job: Job; childId: string }) {
  const qc = useQueryClient();
  const transcript = useQuery({ queryKey: ["transcript", job.id], queryFn: () => api<{ text: string; edited_text: string | null }>(`/recordings/${job.id}/transcript`) });
  const draft = useQuery({ queryKey: ["proposal", job.draft_id], enabled: !!job.draft_id,
    queryFn: async () => (await api<Draft[]>(`/proposals?child_id=${childId}`)).find((d) => d.id === job.draft_id) ?? null });
  const [text, setText] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<string, string> | null>(null);
  const current = sections ?? draft.data?.payload.sections ?? {};
  const resummarize = useMutation({
    mutationFn: () => api(`/recordings/${job.id}/transcript`, { method: "PUT", json: { text, resummarize: true } }),
    onSuccess: () => { setText(null); setSections(null); qc.invalidateQueries({ queryKey: ["recordings", childId] }); },
  });
  const approve = useMutation({
    mutationFn: async () => {
      await api(`/proposals/${job.draft_id}`, { method: "PUT", json: { payload: { ...draft.data!.payload, sections: current } } });
      return api(`/proposals/${job.draft_id}/approve`, { method: "POST" });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recordings", childId] }); qc.invalidateQueries({ queryKey: ["recording-records", childId] }); qc.invalidateQueries({ queryKey: ["proposal"] }); },
  });
  if (!draft.data) return draft.isLoading ? <p className="text-xs text-slate-400">초안을 불러오는 중…</p> : <Notice>이 녹음의 기록은 이미 승인되었거나 반려되었습니다.</Notice>;
  return (
    <div className="space-y-3 rounded-lg border border-amber-300 p-3">
      <Notice>AI가 만든 <b>미승인 초안</b>입니다. 녹취록과 대조해 고친 뒤 승인하세요. 녹음에서 확인되지 않은 항목은 "확인되지 않음"으로 두었습니다.</Notice>
      <details>
        <summary className="cursor-pointer text-sm text-indigo-700">녹취록 보기·수정</summary>
        <Textarea className="mt-2 min-h-48 font-mono text-xs" value={text ?? transcript.data?.edited_text ?? transcript.data?.text ?? ""} onChange={(e) => setText(e.target.value)} />
        <div className="mt-1 flex items-center gap-2">
          <Button variant="outline" disabled={text === null || resummarize.isPending} onClick={() => resummarize.mutate()}>고친 녹취록으로 다시 요약</Button>
          <span className="text-xs text-slate-500">화자는 구분하지 않았습니다.</span>
        </div>
      </details>
      {SECTIONS.map(([k, l]) => (
        <Label key={k} label={l}><Textarea value={current[k] ?? ""} onChange={(e) => setSections({ ...current, [k]: e.target.value })} /></Label>))}
      {(approve.error || resummarize.error) && <Notice tone="red">{errText(approve.error || resummarize.error)}</Notice>}
      <Button onClick={() => approve.mutate()} disabled={approve.isPending}>검토 완료 · 아동 기록에 저장</Button>
    </div>
  );
}
