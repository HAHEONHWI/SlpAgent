import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { Badge, Card, Empty, PageTitle } from "../components/ui";

export default function Dashboard() {
  const { children } = useChild();
  const pending = useQuery({ queryKey: ["proposals"], queryFn: () => api<any[]>("/proposals") });
  const defs = useQuery({ queryKey: ["defs"], queryFn: () => api<any[]>("/assessment-definitions") });
  return (
    <>
      <PageTitle title="대시보드" sub="AI가 만든 초안은 승인 전까지 기록에 반영되지 않습니다." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="담당 아동"><p className="text-3xl font-bold">{children.length}</p><Link className="text-sm text-indigo-600" to="/children">관리 →</Link></Card>
        <Card title="승인 대기 AI 초안"><p className="text-3xl font-bold">{pending.data?.length ?? "–"}</p><Link className="text-sm text-indigo-600" to="/ai">AI 대화에서 검토 →</Link></Card>
        <Card title="검사 자료 준비 상태">
          {defs.data?.length ? <ul className="space-y-1 text-xs">{defs.data.map((d) => (
            <li key={d.code} className="flex justify-between"><span>{d.name}</span>
              <span className="flex gap-1">{d.norm_tables_loaded ? <Badge tone="green">규준</Badge> : <Badge tone="amber">규준 없음</Badge>}{d.item_bank_loaded ? <Badge tone="green">문항</Badge> : <Badge>문항 미적재</Badge>}</span></li>))}</ul> : <Empty>없음</Empty>}
        </Card>
      </div>
    </>
  );
}
