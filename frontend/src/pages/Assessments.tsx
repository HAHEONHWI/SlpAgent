import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText, useCreate, useRecords } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import { Badge, Button, Card, Empty, Input, Label, Notice, PageTitle, Select, Table, Td, Textarea } from "../components/ui";

type Item = { item_id: string; response: string };

function Inner({ childId }: { childId: string }) {
  const defs = useQuery({ queryKey: ["defs"], queryFn: () => api<any[]>("/assessment-definitions") });
  const list = useRecords<any>(childId, "assessments");
  const create = useCreate(childId, "assessments");
  const [f, setF] = useState({ test_code: "", assessed_on: "", examiner: "", raw_total: "", observations: "" });
  const [items, setItems] = useState<Item[]>([{ item_id: "", response: "" }]);
  const def = defs.data?.find((d) => d.code === f.test_code);
  const submit = () => create.mutate({
    test_code: f.test_code, assessed_on: f.assessed_on, examiner: f.examiner, observations: f.observations || null,
    raw_total: f.raw_total === "" ? null : Number(f.raw_total), items: items.filter((i) => i.item_id).map((i) => ({ item_id: i.item_id, response: i.response })),
  }, { onSuccess: () => { setItems([{ item_id: "", response: "" }]); setF({ ...f, raw_total: "", observations: "" }); } } as any);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="검사 결과 입력">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Label label="검사"><Select value={f.test_code} onChange={(e) => setF({ ...f, test_code: e.target.value })} required><option value="">선택</option>{defs.data?.map((d) => <option key={d.code} value={d.code}>{d.code} · {d.name}</option>)}</Select></Label>
          {def && <Notice>{def.norm_tables_loaded ? "규준표 로드됨" : "공식 규준표가 없어 표준점수·발달연령·백분위는 산출되지 않습니다. 기록지의 원점수만 입력하세요."}{def.notes && <><br />{def.notes}</>}</Notice>}
          <Label label="검사일"><Input type="date" value={f.assessed_on} onChange={(e) => setF({ ...f, assessed_on: e.target.value })} required /></Label>
          <Label label="검사자"><Input value={f.examiner} onChange={(e) => setF({ ...f, examiner: e.target.value })} required /></Label>
          <Label label="원점수 (기록지 기재값)"><Input type="number" value={f.raw_total} onChange={(e) => setF({ ...f, raw_total: e.target.value })} /></Label>
          <div><p className="mb-1 text-xs font-medium text-slate-600">문항 응답 (기록지 문항번호)</p>
            {items.map((it, i) => (
              <div key={i} className="mb-1 flex gap-1"><Input placeholder="문항" className="w-20" value={it.item_id} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, item_id: e.target.value } : x))} />
                <Input placeholder="응답/점수" value={it.response} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, response: e.target.value } : x))} /></div>))}
            <Button type="button" variant="ghost" onClick={() => setItems([...items, { item_id: "", response: "" }])}>+ 문항 추가</Button></div>
          <Label label="관찰 메모"><Textarea value={f.observations} onChange={(e) => setF({ ...f, observations: e.target.value })} /></Label>
          {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
          <Button disabled={create.isPending}>저장</Button>
        </form>
      </Card>
      <Card title="검사 이력" className="lg:col-span-2">
        {!list.data?.length ? <Empty>검사 기록이 없습니다.</Empty> : (
          <Table head={["검사일", "검사", "월령", "원점수", "문항수", "규준 점수"]}>
            {[...list.data].reverse().map((a) => (
              <tr key={a.id}><Td>{a.assessed_on}</Td><Td>{a.test_code}</Td><Td>{a.age_months_at_test}</Td><Td>{a.raw_total ?? "-"}</Td><Td>{a.items.length}</Td>
                <Td><Badge tone="amber">{a.derived_scores.status === "norm_unavailable" ? "규준 없음" : "산출"}</Badge></Td></tr>))}
          </Table>)}
      </Card>
    </div>
  );
}
export default function Assessments() { return <><PageTitle title="발달검사 관리" sub="검사별 독립 문항 화면은 문항 은행 적재(프롬프트 A) 후 제공됩니다. 현재는 범용 입력입니다." /><RequireChild>{(id) => <Inner childId={id} />}</RequireChild></>; }
