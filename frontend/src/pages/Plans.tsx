import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText, useCreate, useRecords } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import { Badge, Button, Card, Empty, Input, Label, Notice, PageTitle, Select } from "../components/ui";

const TONE: Record<string, any> = { draft: "amber", active: "green", superseded: "slate" };
const LABEL: Record<string, string> = { draft: "초안(미승인)", active: "활성", superseded: "이전 버전" };
type G = { kind: string; text: string; measure: string; criterion: string; basis: string };
const blank: G = { kind: "short", text: "", measure: "", criterion: "", basis: "" };

function Inner({ childId }: { childId: string }) {
  const qc = useQueryClient();
  const plans = useRecords<any>(childId, "plans");
  const create = useCreate(childId, "plans");
  const approve = useMutation({ mutationFn: (id: string) => api(`/plans/${id}/approve`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["plans", childId] }) });
  const [goals, setGoals] = useState<G[]>([{ ...blank }]);
  const [rationale, setRationale] = useState("");
  const upd = (i: number, k: keyof G, v: string) => setGoals(goals.map((g, j) => (j === i ? { ...g, [k]: v } : g)));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="새 계획 버전 (초안)">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate({ goals: goals.map((g) => ({ ...g, basis: g.basis || null })), rationale: rationale || null }, { onSuccess: () => setGoals([{ ...blank }]) } as any); }}>
          {goals.map((g, i) => (
            <div key={i} className="space-y-2 rounded-md border border-slate-200 p-2">
              <Select value={g.kind} onChange={(e) => upd(i, "kind", e.target.value)}><option value="long">장기목표</option><option value="short">단기목표</option></Select>
              <Input placeholder="목표" value={g.text} onChange={(e) => upd(i, "text", e.target.value)} required />
              <Input placeholder="측정 방법 (예: 정반응률)" value={g.measure} onChange={(e) => upd(i, "measure", e.target.value)} required />
              <Input placeholder="수행 기준 (예: 3회기 연속 80%)" value={g.criterion} onChange={(e) => upd(i, "criterion", e.target.value)} required />
              <Input placeholder="근거 (검사명·문항·평가일)" value={g.basis} onChange={(e) => upd(i, "basis", e.target.value)} />
            </div>))}
          <Button type="button" variant="ghost" onClick={() => setGoals([...goals, { ...blank }])}>+ 목표 추가</Button>
          <Label label="계획 근거"><Input value={rationale} onChange={(e) => setRationale(e.target.value)} /></Label>
          {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
          <Button disabled={create.isPending}>초안 저장</Button>
        </form>
      </Card>
      <div className="space-y-4 lg:col-span-2">
        <Notice>승인된 목표만 활성화됩니다. 새 버전을 승인하면 이전 활성 버전은 삭제되지 않고 '이전 버전'으로 보존됩니다.</Notice>
        {!plans.data?.length ? <Card><Empty>계획이 없습니다.</Empty></Card> : [...plans.data].reverse().map((p) => (
          <Card key={p.id} title={`버전 ${p.version}`} action={<div className="flex items-center gap-2"><Badge tone={TONE[p.status]}>{LABEL[p.status]}</Badge>{p.status === "draft" && <Button onClick={() => approve.mutate(p.id)}>승인·활성화</Button>}</div>}>
            <ul className="space-y-2 text-sm">{p.goals.map((g: any, i: number) => (
              <li key={i} className="rounded border border-slate-100 p-2"><Badge>{g.kind === "long" ? "장기" : "단기"}</Badge> <b>{g.text}</b>
                <div className="mt-1 text-xs text-slate-500">측정: {g.measure} · 기준: {g.criterion}{g.basis && <> · 근거: {g.basis}</>}</div></li>))}</ul>
            {p.source !== "therapist" && <p className="mt-2 text-xs text-amber-700">AI 제안에서 생성됨</p>}
          </Card>))}
        {approve.error && <Notice tone="red">{errText(approve.error)}</Notice>}
      </div>
    </div>
  );
}
export default function Plans() { return <><PageTitle title="치료계획" sub="장기·단기목표, 버전 관리" /><RequireChild>{(id) => <Inner childId={id} />}</RequireChild></>; }
