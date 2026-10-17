import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { Badge, Empty, PageTitle } from "../components/ui";

export default function Dashboard() {
  const { children } = useChild();
  const pending = useQuery({ queryKey: ["proposals"], queryFn: () => api<any[]>("/proposals") });
  const defs = useQuery({ queryKey: ["defs"], queryFn: () => api<any[]>("/assessment-definitions") });
  return (
    <>
      <PageTitle title="대시보드" sub="AI가 만든 초안은 승인 전까지 기록에 반영되지 않습니다." />
      <div className="grid gap-px overflow-hidden rounded-3xl bg-slate-200 shadow-sm md:grid-cols-3">
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
        <section className="flex flex-col gap-2.5 bg-white p-6">
          <h2 className="text-xs text-slate-500">검사 자료 준비 상태</h2>
          {defs.data?.length ? <ul className="text-sm">{defs.data.map((d) => (
            <li key={d.code} className="flex items-center gap-2.5 border-t border-slate-200 py-2"><span className="min-w-0 flex-1 font-semibold [word-break:keep-all]">{d.name}</span>
              <span className="flex shrink-0 gap-1">{d.norm_tables_loaded ? <Badge tone="green">규준</Badge> : <Badge tone="indigo">규준 없음</Badge>}{d.item_bank_loaded ? <Badge tone="green">문항</Badge> : <Badge>문항 미적재</Badge>}</span></li>))}</ul> : <Empty>없음</Empty>}
        </section>
      </div>
    </>
  );
}
