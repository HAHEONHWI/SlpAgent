import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { Badge, Button, Card, Empty, ErrorNotice, Notice } from "./ui";

export type Evidence = { document?: string | null; page?: number | null; item_number?: string | null; evaluation_date?: string | null; request_field?: string | null };
export type Claim = { text: string; evidence: Evidence[] };
export type Draft = { id: string; kind: string; status: string; payload: Record<string, any> };

// ABC/session evidence cites internal record ids as item_number; the date identifies them for a reader.
const RECORD_DOCS = new Set(["ABC 관찰", "회기기록"]);
const evLabel = (e: Evidence) => e.request_field ? `입력: ${e.request_field}`
  : [e.document, e.page && `p.${e.page}`, e.item_number && !RECORD_DOCS.has(e.document ?? "") && `문항 ${e.item_number}`, e.evaluation_date].filter(Boolean).join(" · ");

export function ClaimList({ claims }: { claims: Claim[] }) {
  if (!claims?.length) return <p className="text-sm text-slate-400">해당 없음</p>;
  return (
    <ul className="space-y-2">
      {claims.map((c, i) => (
        <li key={i} className="text-sm">
          <p>{typeof c === "string" ? c : c.text}</p>
          <div className="mt-1 flex flex-wrap gap-1">{(c?.evidence ?? []).map((e, j) => <span key={j} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">근거: {evLabel(e)}</span>)}</div>
        </li>
      ))}
    </ul>
  );
}

/** Renders an ai_analyses draft section-by-section and offers approve/reject. */
export function DraftView({ draft, sections, onDone }: { draft: Draft; sections: [string, string][]; onDone: () => void }) {
  const qc = useQueryClient();
  const done = () => { qc.invalidateQueries({ queryKey: ["proposals"] }); qc.invalidateQueries({ queryKey: ["approved"] }); onDone(); };
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

type Approved = { id: string; kind?: string; payload: Record<string, any>; approved_by?: string | null; created_at: string };

/** Read-only list of approved records (e.g. clinical-analyses, therapy-activities); each expands to its sections. */
export function ApprovedHistory({ path, sections, kindLabel }: { path: string; sections: [string, string][]; kindLabel: string }) {
  const q = useQuery({ queryKey: ["approved", path], queryFn: () => api<Approved[]>(path), retry: false });
  const [open, setOpen] = useState<string | null>(null);
  const items = [...(q.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <Card title="승인된 기록">
      {q.error ? <ErrorNotice error={q.error} /> : q.isLoading ? <Empty>불러오는 중…</Empty> : !items.length ? <Empty>승인된 기록이 없습니다.</Empty> : (
        <ul className="divide-y divide-slate-100">
          {items.map((it) => (
            <li key={it.id} className="py-2">
              <button className="flex w-full items-center gap-2 text-left text-sm" onClick={() => setOpen(open === it.id ? null : it.id)}>
                <Badge tone="green">승인됨</Badge><span className="font-medium">{kindLabel}</span>
                <span className="text-slate-500">{it.created_at.slice(0, 16).replace("T", " ")}</span>
                {it.approved_by && <span className="text-xs text-slate-400">승인: {it.approved_by}</span>}
                <span className="ml-auto text-xs text-indigo-600">{open === it.id ? "접기" : "펼치기"}</span>
              </button>
              {open === it.id && (
                <div className="mt-3 space-y-3">
                  {sections.map(([key, label]) => {
                    const v = it.payload?.[key];
                    if (v === undefined) return null;
                    return <div key={key}><h3 className="mb-1 text-xs font-semibold text-slate-600">{label}</h3><ClaimList claims={Array.isArray(v) ? v : [v]} /></div>;
                  })}
                </div>)}
            </li>))}
        </ul>)}
    </Card>
  );
}
