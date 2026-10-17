import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import { ApprovedHistory, DraftView, type Draft } from "../components/DraftView";
import { Button, Card, Notice, PageTitle } from "../components/ui";

const MODES = {
  integrated: {
    label: "통합 발달 분석", path: "analysis/integrated", kind: "integrated_analysis", needs: "검사 기록",
    sections: [["assessment_overview", "평가 개요"], ["age_and_assessment_dates", "생활연령 및 검사일"], ["strengths", "강점 영역"], ["support_needs", "지원 필요 영역"],
      ["shared_observations", "검사 간 공통 관찰"], ["inconsistencies", "검사 간 불일치"], ["additional_assessment_needs", "추가 평가 필요 사항"], ["candidate_treatment_goals", "치료목표 후보"]],
  },
  behavior: {
    label: "행동 패턴 분석", path: "analysis/behavior", kind: "behavior_analysis", needs: "ABC 관찰 기록",
    sections: [["abc_patterns", "반복 패턴"], ["tentative_function_hypotheses", "행동기능 잠정 가설 (확정 아님)"], ["environmental_factors", "가능한 환경적 요인"],
      ["additional_observations_needed", "추가 관찰이 필요한 정보"], ["replacement_communication_candidates", "대체 의사소통 행동 후보"], ["therapist_review_strategies", "치료사 검토용 지원전략 초안"]],
  },
} as const;
type Mode = keyof typeof MODES;

function Inner({ childId, initial }: { childId: string; initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const run = useMutation({ mutationFn: () => api<Draft>(`/children/${childId}/${MODES[mode].path}`, { method: "POST", long: true }), onSuccess: setDraft });
  const m = MODES[mode];
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-full bg-slate-100 p-1 text-sm w-fit">
        {(Object.keys(MODES) as Mode[]).map((k) => (
          <button key={k} onClick={() => { setMode(k); setDraft(null); run.reset(); }} className={`rounded-full px-3 py-1.5 ${k === mode ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}>{MODES[k].label}</button>))}
      </div>
      <Card title={m.label}>
        <p className="mb-3 text-sm text-slate-600">저장된 {m.needs}만 근거로 사용합니다. 서로 다른 검사의 점수는 합산하지 않으며, 기록에 없는 사실은 만들지 않습니다.{mode === "behavior" && " 자폐·행동장애를 진단하지 않고, 강압적 중재는 제안하지 않습니다."}</p>
        <Button onClick={() => { setDraft(null); run.mutate(); }} disabled={run.isPending}>{run.isPending ? "분석 중…" : "AI 초안 생성"}</Button>
        {run.error && <div className="mt-3"><Notice tone="red">{errText(run.error)}</Notice></div>}
      </Card>
      {draft && <DraftView draft={draft} sections={m.sections as unknown as [string, string][]} onDone={() => setDraft(null)} />}
      <ApprovedHistory key={mode} path={`/children/${childId}/clinical-analyses?kind=${m.kind}`} sections={m.sections as unknown as [string, string][]} kindLabel={m.label} />
    </div>
  );
}

export default function Analysis({ initial = "integrated" }: { initial?: Mode }) {
  return <><PageTitle title="통합 발달 분석" sub="AI 분석 결과는 미승인 초안이며 승인 후에만 기록됩니다." /><RequireChild>{(id) => <Inner childId={id} initial={initial} />}</RequireChild></>;
}
