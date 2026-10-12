import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { Badge, Button, Card, Notice } from "./ui";

export type Evidence = { document?: string | null; page?: number | null; item_number?: string | null; evaluation_date?: string | null; request_field?: string | null };
export type Claim = { text: string; evidence: Evidence[] };
export type Draft = { id: string; kind: string; status: string; payload: Record<string, any> };

const evLabel = (e: Evidence) => e.request_field ? `입력: ${e.request_field}`
  : [e.document, e.page && `p.${e.page}`, e.item_number && `문항 ${e.item_number}`, e.evaluation_date].filter(Boolean).join(" · ");

export function ClaimList({ claims }: { claims: Claim[] }) {
  if (!claims?.length) return <p className="text-sm text-slate-400">해당 없음</p>;
  return (
    <ul className="space-y-2">
      {claims.map((c, i) => (
        <li key={i} className="text-sm">
          <p>{c.text}</p>
          <div className="mt-1 flex flex-wrap gap-1">{c.evidence.map((e, j) => <span key={j} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">근거: {evLabel(e)}</span>)}</div>
        </li>
      ))}
    </ul>
  );
}

/** Renders an ai_analyses draft section-by-section and offers approve/reject. */
export function DraftView({ draft, sections, onDone }: { draft: Draft; sections: [string, string][]; onDone: () => void }) {
  const qc = useQueryClient();
  const done = () => { qc.invalidateQueries({ queryKey: ["proposals"] }); onDone(); };
  const approve = useMutation({ mutationFn: () => api(`/proposals/${draft.id}/approve`, { method: "POST" }), onSuccess: done });
  const reject = useMutation({ mutationFn: () => api(`/proposals/${draft.id}/reject`, { method: "POST" }), onSuccess: done });
  return (
    <div className="space-y-4">
      <Notice>AI가 만든 <b>미승인 초안</b>입니다. 진단이 아니며, 근거를 원자료와 대조한 뒤 승인하세요. 수정이 필요하면 AI 채팅의 승인 대기 목록에서 내용을 고칠 수 있습니다.</Notice>
      {sections.map(([key, label]) => {
        const v = draft.payload[key];
        if (v === undefined) return null;
        return <Card key={key} title={label}>{Array.isArray(v) ? <ClaimList claims={v} /> : <ClaimList claims={[v]} />}</Card>;
      })}
      <div className="flex items-center gap-2">
        <Badge tone="amber">미승인 초안</Badge>
        <Button onClick={() => approve.mutate()} disabled={approve.isPending}>검토 완료 · 승인</Button>
        <Button variant="ghost" onClick={() => reject.mutate()} disabled={reject.isPending}>반려</Button>
      </div>
      {(approve.error || reject.error) && <Notice tone="red">{errText(approve.error || reject.error)}</Notice>}
    </div>
  );
}
