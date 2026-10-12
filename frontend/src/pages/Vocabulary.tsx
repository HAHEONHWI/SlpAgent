import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText, useCreate, useRecords } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import { Badge, Button, Card, Empty, Input, Label, Notice, PageTitle, Select, Table, Td } from "../components/ui";

const STATUS: Record<string, string> = { not_observed: "미관찰", emerging: "출현 중", with_prompt: "촉진 시 가능", independent: "독립 사용" };
const MOD: Record<string, string> = { receptive: "수용", expressive: "표현" };

function Inner({ childId }: { childId: string }) {
  const list = useRecords<any>(childId, "vocabulary");
  const home = useQuery({ queryKey: ["home", childId, list.dataUpdatedAt], queryFn: () => api<any>(`/children/${childId}/vocabulary/home-list`) });
  const create = useCreate(childId, "vocabulary");
  const [q, setQ] = useState(""), [mod, setMod] = useState("");
  const [f, setF] = useState({ word: "", modality: "expressive", status: "emerging", observed_on: "", category: "", difficulty: "", target: false });
  const rows = (list.data ?? []).filter((r) => (!mod || r.modality === mod) && (!q || r.word.includes(q)));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="어휘 기록">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate({ ...f, category: f.category || null, difficulty: f.difficulty ? Number(f.difficulty) : null, source: "session" }, { onSuccess: () => setF({ ...f, word: "" }) } as any); }}>
          <Label label="어휘"><Input value={f.word} onChange={(e) => setF({ ...f, word: e.target.value })} required /></Label>
          <div className="grid grid-cols-2 gap-2">
            <Label label="구분"><Select value={f.modality} onChange={(e) => setF({ ...f, modality: e.target.value })}>{Object.entries(MOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Label>
            <Label label="습득 상태"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Label></div>
          <Label label="관찰일"><Input type="date" value={f.observed_on} onChange={(e) => setF({ ...f, observed_on: e.target.value })} required /></Label>
          <div className="grid grid-cols-2 gap-2"><Label label="의미 범주"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Label><Label label="난이도(1-5)"><Input type="number" min={1} max={5} value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })} /></Label></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.target} onChange={(e) => setF({ ...f, target: e.target.checked })} />목표어휘</label>
          {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
          <Button disabled={create.isPending}>저장</Button>
        </form>
      </Card>
      <div className="space-y-4 lg:col-span-2">
        <Card title="가정연계 어휘 목록 (초안)">
          {home.data?.words.length ? <div className="flex flex-wrap gap-1.5">{home.data.words.map((w: string) => <Badge key={w} tone="indigo">{w}</Badge>)}</div> : <Empty>목표어휘(미독립)가 없습니다.</Empty>}
        </Card>
        <Card title="어휘 기록">
          <div className="mb-3 flex gap-2"><Input placeholder="어휘 검색" value={q} onChange={(e) => setQ(e.target.value)} /><Select className="w-32" value={mod} onChange={(e) => setMod(e.target.value)}><option value="">전체</option>{Object.entries(MOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          {!rows.length ? <Empty>기록이 없습니다.</Empty> : <Table head={["어휘", "구분", "상태", "관찰일", "범주", "목표"]}>{rows.map((r) => <tr key={r.id}><Td>{r.word}</Td><Td>{MOD[r.modality]}</Td><Td>{STATUS[r.status]}</Td><Td>{r.observed_on}</Td><Td>{r.category ?? "-"}</Td><Td>{r.target ? "●" : ""}</Td></tr>)}</Table>}
        </Card>
      </div>
    </div>
  );
}
export default function Vocabulary() { return <><PageTitle title="어휘 발달 관리" sub="수용어휘·표현어휘 구분, 관찰일별 습득 상태" /><RequireChild>{(id) => <Inner childId={id} />}</RequireChild></>; }
