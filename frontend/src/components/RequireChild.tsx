import type { ReactNode } from "react";
import { useChild } from "../lib/child";
import { ageLabel } from "../lib/api";

export default function RequireChild({ children }: { children: (childId: string) => ReactNode }) {
  const { childId, child, children: list, setChildId } = useChild();
  if (!childId || !child) return (
    <div className="overflow-hidden rounded-3xl bg-slate-100 shadow-sm">
      <div className="border-b border-slate-200 p-6">
        <h3 className="mb-1.5 text-xl font-semibold">아동을 먼저 선택하세요</h3>
        <p className="text-sm text-slate-500">이 화면은 선택한 아동을 기준으로 동작합니다. 상단의 아동 선택에서도 바꿀 수 있습니다.</p>
      </div>
      {list.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] bg-slate-50">
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => setChildId(c.id)}
              className="flex items-center gap-3 border-b border-r border-slate-200 px-4 py-3.5 text-left text-sm hover:bg-indigo-100">
              <span className="w-14 shrink-0 truncate font-semibold">{c.alias}</span><span className="min-w-0 flex-1 truncate">{c.display_name}</span>
              <span className="shrink-0 text-xs text-slate-500">{ageLabel(c.age_months)}</span>
            </button>))}
        </div>)}
    </div>);
  return <>{children(childId)}</>;
}
