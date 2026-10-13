import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { SECTIONS } from "./RecordingConsultation";
import { Badge, Card } from "./ui";

type Rec = { id: string; kind: string; date: string; start: string | null; end: string | null; counselor: string; sections: Record<string, string>; transcript: string | null; duration_seconds: number | null };
const UNCONFIRMED = "확인되지 않음";

/** Approved records created from recordings (the therapist reviewed and approved each one). */
export default function RecordingRecords({ childId, kind }: { childId: string; kind?: "session" | "consultation" }) {
  const recs = useQuery({ queryKey: ["recording-records", childId], queryFn: () => api<Rec[]>(`/children/${childId}/recording-records`) });
  const rows = (recs.data ?? []).filter((r) => !kind || r.kind === kind);
  if (!rows.length) return null;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <Card key={r.id} title={`${r.date}${r.start && r.end ? ` ${r.start}–${r.end}` : ""} · ${r.kind === "session" ? "회기" : "상담"} 녹음 기록`}
          action={<Badge>녹음 기반 · 치료사 승인</Badge>}>
          <dl className="grid gap-x-4 gap-y-2 text-sm md:grid-cols-2">
            {SECTIONS.map(([k, label]) => (
              <div key={k}><dt className="text-xs font-semibold text-slate-600">{label}</dt>
                <dd className={`whitespace-pre-wrap ${r.sections[k] === UNCONFIRMED ? "text-slate-400" : ""}`}>{r.sections[k] || UNCONFIRMED}</dd></div>))}
          </dl>
          {r.transcript && <details className="mt-3 text-sm"><summary className="cursor-pointer text-indigo-700">녹취록{r.duration_seconds ? ` (${Math.round(r.duration_seconds / 60)}분)` : ""}</summary>
            <p className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-slate-700">{r.transcript}</p></details>}
        </Card>))}
    </div>
  );
}
