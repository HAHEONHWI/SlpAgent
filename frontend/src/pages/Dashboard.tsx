import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { KNOWLEDGE_ENABLED } from "../lib/menu";
import { Badge, Empty, PageTitle } from "../components/ui";

export default function Dashboard() {
  const { children } = useChild();
  const pending = useQuery({ queryKey: ["proposals"], queryFn: () => api<any[]>("/proposals") });
  const docs = useQuery({ queryKey: ["kdocs"], queryFn: () => api<{ source: string; test_code: string | null; status: string }[]>("/knowledge/documents"), enabled: KNOWLEDGE_ENABLED });
  // One row per licensed test: searchable when any of its pages passed extraction/review.
  const tests = new Map<string, boolean>();
  for (const d of docs.data ?? []) if (d.test_code) tests.set(d.test_code, !!tests.get(d.test_code) || d.status !== "ocr_required");
  return (
    <>
      <PageTitle title="대시보드" sub="AI가 만든 초안은 승인 전까지 기록에 반영되지 않습니다." />
      <div className={`grid gap-px overflow-hidden rounded-3xl bg-slate-200 shadow-sm ${KNOWLEDGE_ENABLED ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        <section className="flex flex-col gap-1.5 bg-white p-6">
          <h2 className="text-xs text-slate-500">담당 아동</h2>
          <p className="text-[56px] font-semibold leading-none tracking-[-.03em] md:text-[72px]">{children.length}</p>
          <Link className="mt-1 text-sm font-semibold text-indigo-700" to="/children">관리 →</Link>
        </section>
        <section className="flex flex-col gap-1.5 bg-white p-6">
          <h2 className="text-xs text-slate-500">승인 대기 AI 초안</h2>
          <p className="text-[56px] font-semibold leading-none tracking-[-.03em] text-indigo-600 md:text-[72px]">{pending.data?.length ?? "–"}</p>
          <Link className="mt-1 text-sm font-semibold text-indigo-700" to="/ai">AI 대화에서 검토 →</Link>
        </section>
        {KNOWLEDGE_ENABLED && <section className="flex flex-col gap-2.5 bg-white p-6">
          <h2 className="text-xs text-slate-500">AI 참고 검사 서류</h2>
          {tests.size ? <ul className="flex flex-wrap gap-1.5">{[...tests].map(([code, ok]) => (
            <li key={code}><Badge tone={ok ? "green" : "slate"}>{code}{ok ? "" : " · 검수 필요"}</Badge></li>))}</ul> : <Empty>적재된 검사 서류가 없습니다</Empty>}
          <p className="text-xs text-slate-500">AI 대화가 근거로 검색합니다. 검수 전 OCR 페이지는 제외됩니다.</p>
          <Link className="mt-1 text-sm font-semibold text-indigo-700" to="/knowledge">AI 지식자료실 →</Link>
        </section>}
      </div>
    </>
  );
}
