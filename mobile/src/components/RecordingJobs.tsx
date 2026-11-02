import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errText } from "@/lib/api";
import { FINISHED, SECTIONS, STATUS, STEP_AT, STEPS, WAIT, mb, mins, type Draft, type Job } from "@/lib/recordings";
import { Badge, Button, C, Card, Input, Notice, Row, T, TextField, confirm } from "./ui";

const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "");

/** The child's recent recording jobs, polled every 4 s while any is still being processed. */
export function useJobs(childId: string) {
  return useQuery({
    queryKey: ["recordings", childId],
    queryFn: () => api<Job[]>(`/children/${childId}/recordings`),
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => !FINISHED.includes(j.status)) ? 4000 : false),
  });
}

export function JobList({ childId, limit = 5 }: { childId: string; limit?: number }) {
  const jobs = useJobs(childId);
  const rows = (jobs.data ?? []).filter((j) => j.status !== "cancelled").slice(0, limit);
  if (jobs.error) return <Notice tone="red">{errText(jobs.error)}</Notice>;
  return <>{rows.map((j) => <JobCard key={j.id} job={j} childId={childId} />)}</>;
}

export function JobCard({ job, childId }: { job: Job; childId: string }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["recordings", childId] });
  const cancel = useMutation({ mutationFn: () => api(`/recordings/${job.id}/cancel`, { method: "POST" }), onSuccess: refresh });
  const retry = useMutation({ mutationFn: () => api(`/recordings/${job.id}/retry`, { method: "POST" }), onSuccess: refresh });
  const [label, tone] = STATUS[job.status] ?? [job.status, "slate"];
  const active = !FINISHED.includes(job.status);
  const at = STEP_AT[job.status];
  const pct = job.chunk_count ? Math.round(((job.chunks_done ?? 0) / job.chunk_count) * 100) : 0;
  return (
    <Card title={`${job.kind === "session" ? "회기" : "상담"} 녹음 · ${job.meta.date}`} action={<Badge tone={tone}>{label}</Badge>}>
      {at !== undefined && (
        <View style={{ flexDirection: "row", borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: C.line }}>
          {STEPS.map((l, i) => (
            <View key={l} style={{ flex: 1, padding: 8, backgroundColor: i === at ? C.accentSoft : C.white, borderLeftWidth: i ? 1 : 0, borderColor: C.line }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: i === at ? C.accentDark : C.ink }}>{i < at ? "완료" : i === at ? (job.status === "draft_ready" ? "검토 대기" : "진행 중") : "대기"}</Text>
              <Text style={{ fontSize: 11, color: C.text2 }}>{l}</Text>
            </View>))}
        </View>)}
      <T small muted>{`길이 ${mins(job.duration_seconds)} · 원본 ${mb(job.original_size ?? job.upload_size)} → 변환 ${mb(job.compressed_size)}`}</T>
      {(job.status === "transcribing" || job.status === "waiting") && !!job.chunk_count && (
        <View style={{ gap: 4 }}>
          <Progress value={pct / 100} />
          <T small muted>{`구간 ${job.chunks_done ?? 0}/${job.chunk_count} 받아씀${job.fallback_chunks ? ` (예비 경로 ${job.fallback_chunks}개)` : ""}`}</T>
        </View>)}
      {job.status === "queued" && <T small muted>압축·분할을 준비하고 있습니다.</T>}
      {job.status === "uploading" && <T small muted>휴대폰에서 아직 다 올리지 못했어요. 위쪽 ‘올리지 못한 녹음’에서 다시 올릴 수 있어요.</T>}
      {job.status === "waiting" && <Notice>{`${WAIT[job.wait_reason ?? ""] ?? "잠시 후 이어서 처리합니다."}${job.wait_until ? ` (다시 시도: ${time(job.wait_until)})` : ""}`}</Notice>}
      {job.status === "failed" && <Notice tone="red">{job.error?.message ?? "처리에 실패했습니다."}</Notice>}
      {!!job.chunks_failed && job.status === "draft_ready" && <Notice>{`받아쓰지 못한 구간이 ${job.chunks_failed}개 있습니다. 녹취록에 [인식 실패]로 표시되어 있으며 내용을 추측해 채우지 않았습니다.`}</Notice>}
      {(job.status === "failed" || job.status === "waiting" || active) && (
        <Row>
          {(job.status === "failed" || job.status === "waiting") && <Button small variant="outline" title="다시 시도" loading={retry.isPending} onPress={() => retry.mutate()} />}
          {active && <Button small variant="ghost" title="취소" loading={cancel.isPending} onPress={async () => { if (await confirm("이 녹음 처리를 취소할까요?")) cancel.mutate(); }} />}
        </Row>)}
      {(cancel.error || retry.error) && <Notice tone="red">{errText(cancel.error || retry.error)}</Notice>}
      {job.status === "draft_ready" && <Review job={job} childId={childId} />}
      {job.status === "approved" && <T small style={{ color: C.greenText }}>승인되어 ‘기록’ 탭의 녹음 기록에 저장되었어요.</T>}
      {job.status === "rejected" && <T small muted>반려된 초안이에요. 아동 기록에는 반영되지 않았어요.</T>}
    </Card>
  );
}

export const Progress = ({ value }: { value: number }) => (
  <View style={{ height: 8, borderRadius: 99, backgroundColor: C.paper, overflow: "hidden" }}>
    <View style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, height: "100%", backgroundColor: C.accent }} />
  </View>
);

/** Therapist edits the transcript and the 8 sections, then approves (the draft becomes the child's record). */
function Review({ job, childId }: { job: Job; childId: string }) {
  const qc = useQueryClient();
  const transcript = useQuery({ queryKey: ["transcript", job.id], queryFn: () => api<{ text: string; edited_text: string | null }>(`/recordings/${job.id}/transcript`) });
  const draft = useQuery({ queryKey: ["proposal", job.draft_id], enabled: !!job.draft_id,
    queryFn: async () => (await api<Draft[]>(`/proposals?child_id=${childId}`)).find((d) => d.id === job.draft_id) ?? null });
  const [text, setText] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [sections, setSections] = useState<Record<string, string> | null>(null);
  const current = sections ?? draft.data?.payload.sections ?? {};
  const done = () => { qc.invalidateQueries({ queryKey: ["recordings", childId] }); qc.invalidateQueries({ queryKey: ["recording-records", childId] }); qc.invalidateQueries({ queryKey: ["proposal"] }); qc.invalidateQueries({ queryKey: ["proposals"] }); qc.invalidateQueries({ queryKey: ["class-records"] }); };
  const resummarize = useMutation({
    mutationFn: () => api(`/recordings/${job.id}/transcript`, { method: "PUT", json: { text, resummarize: true } }),
    onSuccess: () => { setText(null); setSections(null); qc.invalidateQueries({ queryKey: ["recordings", childId] }); },
  });
  const approve = useMutation({
    mutationFn: async () => {
      await api(`/proposals/${job.draft_id}`, { method: "PUT", json: { payload: { ...draft.data!.payload, sections: current } } });
      return api(`/proposals/${job.draft_id}/approve`, { method: "POST" });
    },
    onSuccess: done,
  });
  const reject = useMutation({ mutationFn: () => api(`/proposals/${job.draft_id}/reject`, { method: "POST" }), onSuccess: done });
  if (!draft.data) return draft.isLoading ? <T small muted>초안을 불러오는 중…</T> : <Notice>이 녹음의 기록은 이미 승인되었거나 반려되었습니다.</Notice>;
  return (
    <View style={{ gap: 12, backgroundColor: C.paper, borderRadius: 18, padding: 12 }}>
      <Notice>AI가 만든 미승인 초안입니다. 녹취록과 대조해 고친 뒤 승인하세요. 녹음에서 확인되지 않은 항목은 "확인되지 않음"으로 두었습니다.</Notice>
      <Button small variant="outline" icon={showText ? "chevron-up" : "chevron-down"} title={showText ? "녹취록 접기" : "녹취록 보기·수정"} onPress={() => setShowText(!showText)} />
      {showText && (
        <View style={{ gap: 6 }}>
          <Input multiline style={{ minHeight: 220, fontSize: 13 }} value={text ?? transcript.data?.edited_text ?? transcript.data?.text ?? ""} onChangeText={setText} />
          <Button small variant="outline" title="고친 녹취록으로 다시 요약" disabled={text === null} loading={resummarize.isPending} onPress={() => resummarize.mutate()} />
          <T small muted>화자는 구분하지 않았습니다.</T>
        </View>)}
      {SECTIONS.map(([k, l]) => <TextField key={k} label={l} multiline value={current[k] ?? ""} onChangeText={(v) => setSections({ ...current, [k]: v })} />)}
      {(approve.error || resummarize.error || reject.error) && <Notice tone="red">{errText(approve.error || resummarize.error || reject.error)}</Notice>}
      <Button icon="checkmark" title="검토 완료 · 아동 기록에 저장" loading={approve.isPending} onPress={() => approve.mutate()} />
      <Button variant="ghost" title="반려 (기록에 넣지 않음)" loading={reject.isPending} onPress={async () => { if (await confirm("이 초안을 반려할까요?", "아동 기록에 반영되지 않아요.", "반려", true)) reject.mutate(); }} />
    </View>
  );
}
