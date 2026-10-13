import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ageLabel } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import { ApprovedHistory, DraftView, type Draft } from "../components/DraftView";
import { Button, Card, Input, Label, Notice, PageTitle, Textarea } from "../components/ui";

const SECTIONS: [string, string][] = [["purpose", "활동 목적"], ["materials", "준비물"], ["sequence", "진행 순서"], ["modeling_examples", "언어적 모델링 예시"],
  ["response_elicitation", "반응 유도 방법"], ["difficulty_adjustments", "난이도 조절"], ["measurement", "수행 측정 방법"], ["parent_linkage", "보호자 연계 활동"]];
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function Inner({ childId }: { childId: string }) {
  const { child } = useChild();
  const [f, setF] = useState({ goal_area: "", current_level: "", preferences: "", materials: "", time_minutes: "30", prompting_level: "" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const run = useMutation({
    mutationFn: () => api<Draft>(`/children/${childId}/activities/generate`, { method: "POST", long: true, json: {
      goal_area: f.goal_area, current_level: f.current_level, preferences: list(f.preferences), materials: list(f.materials),
      time_minutes: Number(f.time_minutes), prompting_level: f.prompting_level } }),
    onSuccess: setDraft,
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="활동 조건">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setDraft(null); run.mutate(); }}>
          <p className="text-xs text-slate-500">아동 연령: {ageLabel(child?.age_months)} (생년월일에서 자동 계산)</p>
          <Label label="목표 영역"><Input value={f.goal_area} onChange={set("goal_area")} placeholder="예: 2음절 단어 모방" required /></Label>
          <Label label="현재 수행 수준"><Textarea value={f.current_level} onChange={set("current_level")} placeholder="예: 모델 제시 시 5회 중 2회 모방" required /></Label>
          <Label label="선호 활동 (쉼표 구분)"><Input value={f.preferences} onChange={set("preferences")} /></Label>
          <Label label="준비물 (쉼표 구분)"><Input value={f.materials} onChange={set("materials")} /></Label>
          <div className="grid grid-cols-2 gap-2">
            <Label label="치료시간(분)"><Input type="number" min={1} max={180} value={f.time_minutes} onChange={set("time_minutes")} required /></Label>
            <Label label="촉진 수준"><Input value={f.prompting_level} onChange={set("prompting_level")} placeholder="예: 모델링" required /></Label>
          </div>
          {run.error && <Notice tone="red">{errText(run.error)}</Notice>}
          <Button disabled={run.isPending}>{run.isPending ? "생성 중…" : "AI 활동 초안 생성"}</Button>
        </form>
      </Card>
      <div className="space-y-4 lg:col-span-2">
        {draft ? <DraftView draft={draft} sections={SECTIONS} onDone={() => setDraft(null)} />
          : <Notice>조건을 입력하고 생성하면 활동 초안이 여기에 표시됩니다. 승인 전에는 저장되지 않습니다.</Notice>}
        <ApprovedHistory path={`/children/${childId}/therapy-activities`} sections={SECTIONS} kindLabel="치료활동" />
      </div>
    </div>
  );
}
export default function Activities() { return <><PageTitle title="치료활동 생성" /><RequireChild>{(id) => <Inner childId={id} />}</RequireChild></>; }
