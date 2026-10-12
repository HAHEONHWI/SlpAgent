import { useState } from "react";
import { errText, useCreate, useRecords } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import { Badge, Button, Card, Empty, Input, Label, Notice, PageTitle } from "../components/ui";

type A = { name: string; correct: string; trials: string; prompt_level: string };
const blankA: A = { name: "", correct: "", trials: "", prompt_level: "" };

function Inner({ childId }: { childId: string }) {
  const list = useRecords<any>(childId, "sessions");
  const create = useCreate(childId, "sessions");
  const [f, setF] = useState({ date: "", start: "", end: "", therapist: "", utterances: "", behaviors: "" });
  const [acts, setActs] = useState<A[]>([{ ...blankA }]);
  const upd = (i: number, k: keyof A, v: string) => setActs(acts.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="회기 기록 입력">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate({
          date: f.date, start: f.start, end: f.end, therapist: f.therapist, status: "completed", utterances: lines(f.utterances), observed_behaviors: lines(f.behaviors),
          activities: acts.filter((a) => a.name).map((a) => ({ name: a.name, correct: Number(a.correct), trials: Number(a.trials), prompt_level: a.prompt_level || null })),
        }, { onSuccess: () => { setActs([{ ...blankA }]); setF({ ...f, utterances: "", behaviors: "" }); } } as any); }}>
          <Label label="날짜"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Label>
          <div className="grid grid-cols-2 gap-2"><Label label="시작"><Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required /></Label><Label label="종료"><Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} required /></Label></div>
          <Label label="치료사"><Input value={f.therapist} onChange={(e) => setF({ ...f, therapist: e.target.value })} required /></Label>
          {acts.map((a, i) => (
            <div key={i} className="space-y-2 rounded-md border border-slate-200 p-2">
              <Input placeholder="활동 내용" value={a.name} onChange={(e) => upd(i, "name", e.target.value)} />
              <div className="grid grid-cols-3 gap-2"><Input type="number" min={0} placeholder="정반응" value={a.correct} onChange={(e) => upd(i, "correct", e.target.value)} /><Input type="number" min={0} placeholder="전체 시행" value={a.trials} onChange={(e) => upd(i, "trials", e.target.value)} /><Input placeholder="촉진" value={a.prompt_level} onChange={(e) => upd(i, "prompt_level", e.target.value)} /></div>
            </div>))}
          <Button type="button" variant="ghost" onClick={() => setActs([...acts, { ...blankA }])}>+ 활동 추가</Button>
          <Label label="아동의 실제 발화 (줄바꿈 구분)"><textarea className="min-h-16 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={f.utterances} onChange={(e) => setF({ ...f, utterances: e.target.value })} /></Label>
          <Label label="관찰 행동 (줄바꿈 구분)"><textarea className="min-h-16 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={f.behaviors} onChange={(e) => setF({ ...f, behaviors: e.target.value })} /></Label>
          {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
          <Button disabled={create.isPending}>저장</Button>
        </form>
      </Card>
      <div className="space-y-3 lg:col-span-2">
        <Notice>기록문 초안은 AI 채팅(아동 선택)에서 요청하면 승인 대기 초안으로 생성됩니다. 관찰되지 않은 내용은 포함되지 않아야 하니 승인 전 확인하세요.</Notice>
        {!list.data?.length ? <Card><Empty>회기 기록이 없습니다.</Empty></Card> : [...list.data].reverse().map((s) => (
          <Card key={s.id} title={`${s.date} ${s.start}–${s.end} (${s.minutes}분)`} action={<Badge tone={s.status === "completed" ? "green" : "slate"}>{s.status}</Badge>}>
            <ul className="text-sm">{s.activities.map((a: any, i: number) => { const st = s.activity_accuracy[i]; return <li key={i}>{a.name}: {a.correct}/{a.trials} ({st.accuracy_pct ?? "-"}%){a.prompt_level && ` · 촉진: ${a.prompt_level}`}</li>; })}</ul>
            {s.utterances.length > 0 && <p className="mt-2 text-xs text-slate-600">발화: {s.utterances.join(" / ")}</p>}
          </Card>))}
      </div>
    </div>
  );
}
export default function Sessions() { return <><PageTitle title="회기별 치료기록" /><RequireChild>{(id) => <Inner childId={id} />}</RequireChild></>; }
