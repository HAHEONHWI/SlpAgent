import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import { Button, Card, Empty, Input, Label, Notice, PageTitle, Select, Table, Td } from "../components/ui";

export default function Children() {
  const { children, setChildId, childId } = useChild();
  const qc = useQueryClient();
  const [f, setF] = useState({ alias: "", display_name: "", birth_date: "", sex: "" });
  const create = useMutation({
    mutationFn: () => api("/children", { method: "POST", json: { ...f, sex: f.sex || null } }),
    onSuccess: () => { setF({ alias: "", display_name: "", birth_date: "", sex: "" }); qc.invalidateQueries({ queryKey: ["children"] }); },
  });
  return (
    <>
      <PageTitle title="아동 관리" sub="최소 정보만 수집합니다. 가명코드만 AI에 전달되며 이름·연락처는 전송되지 않습니다." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="아동 등록">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Label label="가명코드 (예: A-01)"><Input value={f.alias} onChange={(e) => setF({ ...f, alias: e.target.value })} required /></Label>
            <Label label="이름"><Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} required /></Label>
            <Label label="생년월일"><Input type="date" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })} required /></Label>
            <Label label="성별"><Select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="">미입력</option><option>남</option><option>여</option></Select></Label>
            {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
            <Button disabled={create.isPending}>등록</Button>
          </form>
        </Card>
        <Card title={`아동 목록 (${children.length})`} className="lg:col-span-2">
          {children.length === 0 ? <Empty>등록된 아동이 없습니다.</Empty> : (
            <Table head={["가명", "이름", "생년월일", "월령", ""]}>
              {children.map((c) => (
                <tr key={c.id}><Td>{c.alias}</Td><Td>{c.display_name}</Td><Td>{c.birth_date}</Td><Td>{(c as any).age_months ?? "-"}</Td>
                  <Td><Button variant={c.id === childId ? "primary" : "outline"} onClick={() => setChildId(c.id)}>{c.id === childId ? "선택됨" : "선택"}</Button></Td></tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
