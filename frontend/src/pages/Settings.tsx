import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { Button, Card, Empty, Input, Label, Notice, PageTitle, Table, Td } from "../components/ui";
import { useAuth } from "../lib/auth";

export default function Settings() {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ["org"], queryFn: () => api<any>("/org") });
  const [f, setF] = useState({ name: "", min: "", max: "", unit_price: "", voucher_minutes: "" });
  useEffect(() => {
    const o = org.data; if (!o) return;
    setF({ name: o.name ?? "", min: o.behavior_scale?.min?.toString() ?? "", max: o.behavior_scale?.max?.toString() ?? "", unit_price: o.unit_price?.toString() ?? "", voucher_minutes: o.voucher_minutes?.toString() ?? "" });
  }, [org.data]);
  const save = useMutation({
    mutationFn: () => api("/org", { method: "PUT", json: {
      name: f.name, behavior_scale: f.min !== "" && f.max !== "" ? { min: Number(f.min), max: Number(f.max) } : null,
      unit_price: f.unit_price === "" ? null : Number(f.unit_price), voucher_minutes: f.voucher_minutes === "" ? null : Number(f.voucher_minutes) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org"] }),
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <PageTitle title="기관 설정" sub="관리자(admin)만 저장할 수 있습니다." />
      <Card className="max-w-xl">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Label label="기관명"><Input value={f.name} onChange={set("name")} required /></Label>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">행동 강도 관찰 척도 (기관 정의)</p>
            <div className="grid grid-cols-2 gap-2"><Input type="number" placeholder="최소" value={f.min} onChange={set("min")} /><Input type="number" placeholder="최대" value={f.max} onChange={set("max")} /></div>
            <p className="mt-1 text-[11px] text-slate-500">설정하지 않으면 ABC 관찰에서 강도를 입력할 수 없습니다.</p>
          </div>
          <Label label="회기당 금액(원)"><Input type="number" min={0} value={f.unit_price} onChange={set("unit_price")} /></Label>
          <Label label="바우처 월 한도(분)"><Input type="number" min={0} value={f.voucher_minutes} onChange={set("voucher_minutes")} /></Label>
          <Notice>금액·시간 계산은 이 값을 사용해 서버 코드가 수행합니다. 값을 비우면 금액은 계산되지 않습니다.</Notice>
          {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
          {save.isSuccess && <p className="text-sm text-green-700">저장되었습니다.</p>}
          <Button disabled={save.isPending}>저장</Button>
        </form>
      </Card>
      <AuditLog />
    </>
  );
}

function AuditLog() {
  const { label } = useAuth();
  const logs = useQuery({ queryKey: ["audit"], queryFn: () => api<any[]>("/admin/audit-logs?limit=100"), retry: false });
  if (logs.error) return null; // admin-only endpoint; other roles simply don't see the panel
  return (
    <Card title="감사로그 (최근 100건, 관리자 전용)" className="mt-4">
      {!logs.data?.length ? <Empty>기록이 없습니다.</Empty> : (
        <Table head={["시각", "사용자", "역할", "작업", "대상", "AI 경유"]}>
          {logs.data.map((l) => <tr key={l.id}><Td className="whitespace-nowrap text-xs">{l.created_at.slice(0, 19).replace("T", " ")}</Td><Td>{l.actor}</Td><Td>{l.role}</Td><Td>{l.action}</Td><Td>{l.collection}</Td><Td>{l.via_ai ? "●" : ""}</Td></tr>)}
        </Table>)}
      {label && <p className="mt-2 text-[11px] text-slate-400">조회 자체도 감사로그에 기록됩니다.</p>}
    </Card>
  );
}
