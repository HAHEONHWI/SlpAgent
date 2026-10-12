import { useState } from "react";
import { errText, useCreate, useRecords } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import { Button, Card, Empty, Input, Label, Notice, PageTitle, Table, Td, Textarea } from "../components/ui";

const blank = { observed_at: "", antecedent: "", behavior: "", consequence: "", setting: "", activity: "", people: "", frequency: "", duration_sec: "", intensity: "", observer: "", memo: "" };

function Inner({ childId }: { childId: string }) {
  const list = useRecords<any>(childId, "behavior");
  const create = useCreate(childId, "behavior");
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: any) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => (v === "" ? null : Number(v));
  const submit = () => create.mutate({
    observed_at: f.observed_at, antecedent: f.antecedent, behavior: f.behavior, consequence: f.consequence, setting: f.setting || null, activity: f.activity || null,
    people_present: f.people.split(",").map((s) => s.trim()).filter(Boolean), frequency: num(f.frequency), duration_sec: num(f.duration_sec), intensity: num(f.intensity), observer: f.observer, memo: f.memo || null,
  }, { onSuccess: () => setF(blank) } as any);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="ABC 관찰 기록">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Label label="발생 시각"><Input type="datetime-local" value={f.observed_at} onChange={set("observed_at")} required /></Label>
          <Label label="선행사건 (A)"><Textarea value={f.antecedent} onChange={set("antecedent")} required /></Label>
          <Label label="관찰 가능한 행동 (B)"><Textarea value={f.behavior} onChange={set("behavior")} required placeholder="해석이 아닌 눈에 보이는 행동만" /></Label>
          <Label label="후속사건 (C)"><Textarea value={f.consequence} onChange={set("consequence")} required /></Label>
          <div className="grid grid-cols-2 gap-2"><Label label="환경"><Input value={f.setting} onChange={set("setting")} /></Label><Label label="활동"><Input value={f.activity} onChange={set("activity")} /></Label></div>
          <Label label="참여자 (쉼표 구분)"><Input value={f.people} onChange={set("people")} /></Label>
          <div className="grid grid-cols-3 gap-2"><Label label="빈도"><Input type="number" min={0} value={f.frequency} onChange={set("frequency")} /></Label><Label label="지속(초)"><Input type="number" min={0} value={f.duration_sec} onChange={set("duration_sec")} /></Label><Label label="강도"><Input type="number" value={f.intensity} onChange={set("intensity")} /></Label></div>
          <p className="text-[11px] text-slate-500">강도는 기관이 정의한 척도 범위만 허용됩니다(기관 설정 필요).</p>
          <Label label="관찰자"><Input value={f.observer} onChange={set("observer")} required /></Label>
          <Label label="메모"><Textarea value={f.memo} onChange={set("memo")} /></Label>
          {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
          <Button disabled={create.isPending}>저장</Button>
        </form>
      </Card>
      <Card title="관찰 기록" className="lg:col-span-2">
        <div className="mb-3"><Notice>행동기능 분석(잠정 가설)은 [통합 발달 분석 → 행동 패턴 분석]에서 생성할 수 있으며, 진단이 아닌 치료사 검토용 초안입니다.</Notice></div>
        {!list.data?.length ? <Empty>기록이 없습니다.</Empty> : (
          <Table head={["시각", "A 선행", "B 행동", "C 후속", "빈도", "강도"]}>
            {[...list.data].reverse().map((b) => <tr key={b.id}><Td>{b.observed_at.replace("T", " ")}</Td><Td>{b.antecedent}</Td><Td>{b.behavior}</Td><Td>{b.consequence}</Td><Td>{b.frequency ?? "-"}</Td><Td>{b.intensity ?? "-"}</Td></tr>)}
          </Table>)}
      </Card>
    </div>
  );
}
export default function Behavior() { return <><PageTitle title="행동분석" sub="ABC 관찰 기록" /><RequireChild>{(id) => <Inner childId={id} />}</RequireChild></>; }
