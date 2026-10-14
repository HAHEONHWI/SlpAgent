import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { Badge, Button, Card, Empty, Input, Label, Notice, Table, Td } from "./ui";

type Settings = { fallback_enabled: boolean; monthly_fallback_cap_usd: number; chunk_minutes: number; retain_original_days: number;
  groq_configured: boolean; stt_model: string; fallback_configured: boolean; fallback_model: string;
  groq_audio_seconds_per_hour: number; groq_audio_seconds_per_day: number; fallback_usd_per_hour: number };
type Stats = { jobs_total: number; by_status: Record<string, number>; audio_seconds_total: number; original_bytes_total: number; compressed_bytes_total: number;
  avg_processing_seconds: number | null; groq: { hour_seconds: number; day_seconds: number; day_requests: number; hour_limit: number; day_limit: number };
  fallback: { cost_usd: number; seconds: number; requests: number; cap_usd: number; enabled: boolean };
  failures: { job_id: string; reason: string | null; status: string; chunks_failed: number; at: string | null }[]; warnings: string[] };

const STATUS: Record<string, string> = { uploading: "업로드 중", queued: "대기열", transcribing: "받아쓰는 중", waiting: "대기", merging: "합치는 중",
  summarizing: "요약 중", draft_ready: "완료(검토 대기)", failed: "실패", cancelled: "취소" };
const hours = (s: number) => `${(s / 3600).toFixed(1)}시간`;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)}MB`;
const pct = (used: number, limit: number) => (limit ? `${Math.round((used / limit) * 100)}%` : "한도 미설정");

/** Site admin: speech-to-text settings and monitoring (counts only; no recordings or transcripts). */
export default function SttAdmin() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["platform", "stt", "settings"], queryFn: () => api<Settings>("/platform/stt/settings") });
  const stats = useQuery({ queryKey: ["platform", "stt", "stats"], queryFn: () => api<Stats>("/platform/stt/stats"), refetchInterval: 15000 });
  const [f, setF] = useState({ fallback_enabled: false, monthly_fallback_cap_usd: "0", chunk_minutes: "5", retain_original_days: "0" });
  useEffect(() => { const s = settings.data; if (s) setF({ fallback_enabled: s.fallback_enabled, monthly_fallback_cap_usd: String(s.monthly_fallback_cap_usd),
    chunk_minutes: String(s.chunk_minutes), retain_original_days: String(s.retain_original_days) }); }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api("/platform/stt/settings", { method: "PUT", json: { fallback_enabled: f.fallback_enabled, monthly_fallback_cap_usd: Number(f.monthly_fallback_cap_usd),
      chunk_minutes: Number(f.chunk_minutes), retain_original_days: Number(f.retain_original_days) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform", "stt"] }),
  });
  const s = settings.data, st = stats.data;
  const kpi = (k: string, v: string | number) => <div key={k} className="rounded-lg border border-slate-200 p-3"><p className="text-xs text-slate-500">{k}</p><p className="mt-1 text-lg font-bold">{v}</p></div>;
  return (
    <div className="space-y-4">
      {st?.warnings.map((w) => <Notice key={w}>{w}</Notice>)}
      <Card title="받아쓰기 현황">
        {!st ? <p className="text-sm text-slate-400">불러오는 중…</p> : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {kpi("전체 작업", st.jobs_total)}{kpi("총 음성", hours(st.audio_seconds_total))}
              {kpi("용량 (원본 → 변환)", `${mb(st.original_bytes_total)} → ${mb(st.compressed_bytes_total)}`)}
              {kpi("평균 처리 시간", st.avg_processing_seconds == null ? "-" : `${Math.round(st.avg_processing_seconds / 60)}분`)}
              {kpi("Groq 이번 시간", `${Math.round(st.groq.hour_seconds / 60)}분 · ${pct(st.groq.hour_seconds, st.groq.hour_limit)}`)}
              {kpi("Groq 오늘", `${Math.round(st.groq.day_seconds / 60)}분 · ${pct(st.groq.day_seconds, st.groq.day_limit)}`)}
              {kpi("예비 경로 이번 달", `${st.fallback.requests}회 · $${st.fallback.cost_usd.toFixed(3)}`)}
              {kpi("예비 비용 상한", st.fallback.cap_usd ? `$${st.fallback.cap_usd} 중 ${pct(st.fallback.cost_usd, st.fallback.cap_usd)}` : "미설정")}
            </div>
            <div className="flex flex-wrap gap-1">{Object.entries(st.by_status).map(([k, v]) => <Badge key={k} tone={k === "failed" ? "red" : k === "waiting" ? "amber" : "slate"}>{STATUS[k] ?? k} {v}</Badge>)}</div>
            {st.failures.length ? (
              <Table head={["작업", "상태", "사유", "실패 구간", "시각"]}>
                {st.failures.map((x) => <tr key={x.job_id}><Td className="font-mono text-xs">{x.job_id}</Td><Td>{STATUS[x.status] ?? x.status}</Td><Td wrap>{x.reason ?? "-"}</Td><Td>{x.chunks_failed}</Td><Td className="text-xs">{x.at?.slice(0, 16).replace("T", " ") ?? "-"}</Td></tr>)}
              </Table>) : <Empty>실패한 작업이 없습니다.</Empty>}
          </div>)}
      </Card>
      <Card title="받아쓰기 설정">
        {s && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <p className="text-xs text-slate-500">기본: Groq {s.stt_model || "(미설정)"} {s.groq_configured ? "✓" : "✗"} · 예비: OpenRouter {s.fallback_model || "(미설정)"} {s.fallback_configured ? "✓" : "✗"} ·
              Groq 오디오 한도(서버 환경변수): 시간당 {s.groq_audio_seconds_per_hour ? `${s.groq_audio_seconds_per_hour}초` : "미설정"}, 일일 {s.groq_audio_seconds_per_day ? `${s.groq_audio_seconds_per_day}초` : "미설정"}</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.fallback_enabled} onChange={(e) => setF({ ...f, fallback_enabled: e.target.checked })} disabled={!s.fallback_configured} />
              Groq 한도 초과·장애 시 예비 경로(OpenRouter, 유료) 사용</label>
            <div className="grid gap-2 md:grid-cols-3">
              <Label label="예비 경로 월 비용 상한 (USD)"><Input type="number" min={0} step="0.5" value={f.monthly_fallback_cap_usd} onChange={(e) => setF({ ...f, monthly_fallback_cap_usd: e.target.value })} /></Label>
              <Label label="분할 길이 (분, 3~10)"><Input type="number" min={3} max={10} step="0.5" value={f.chunk_minutes} onChange={(e) => setF({ ...f, chunk_minutes: e.target.value })} /></Label>
              <Label label="원본 녹음 보관 (일, 0=처리 후 즉시 삭제, 최대 30)"><Input type="number" min={0} max={30} value={f.retain_original_days} onChange={(e) => setF({ ...f, retain_original_days: e.target.value })} /></Label>
            </div>
            <p className="text-xs text-slate-500">예비 경로 예상 비용: 시간당 약 ${s.fallback_usd_per_hour.toFixed(3)} (실제 사용량으로 갱신). 예상 비용이 월 상한을 넘으면 사용하지 않고 작업을 대기시킵니다.</p>
            {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
            {save.isSuccess && <p className="text-sm text-green-700">저장했습니다.</p>}
            <Button disabled={save.isPending}>저장</Button>
          </form>)}
      </Card>
    </div>
  );
}
