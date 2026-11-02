import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { Button, Card, Empty, Input, Label, Notice, PageTitle, Table, Td } from "../components/ui";
import { useAuth } from "../lib/auth";
import TherapistRoster from "../components/TherapistRoster";
import Accountants from "../components/Accountants";

export default function Settings() {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ["org"], queryFn: () => api<any>("/org") });
  const [f, setF] = useState({ name: "", min: "", max: "", unit_price: "", night_price: "", paid_price: "", paid_night_price: "" });
  useEffect(() => {
    const o = org.data; if (!o) return;
    setF({ name: o.name ?? "", min: o.behavior_scale?.min?.toString() ?? "", max: o.behavior_scale?.max?.toString() ?? "", unit_price: o.unit_price?.toString() ?? "", night_price: o.night_price?.toString() ?? "", paid_price: o.paid_price?.toString() ?? "", paid_night_price: o.paid_night_price?.toString() ?? "" });
  }, [org.data]);
  const save = useMutation({
    mutationFn: () => api("/org", { method: "PUT", json: {
      name: f.name, behavior_scale: f.min !== "" && f.max !== "" ? { min: Number(f.min), max: Number(f.max) } : null,
      unit_price: f.unit_price === "" ? null : Number(f.unit_price), paid_price: f.paid_price === "" ? null : Number(f.paid_price),
      night_price: f.night_price === "" ? null : Number(f.night_price), paid_night_price: f.paid_night_price === "" ? null : Number(f.paid_night_price) } }),
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
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">수업 1회 금액(원)</p>
            <div className="grid grid-cols-2 gap-2">
              <Label label="바우처 단가"><Input type="number" min={0} value={f.unit_price} onChange={set("unit_price")} placeholder="52,000" /></Label>
              <Label label="바우처 야간 단가"><Input type="number" min={0} value={f.night_price} onChange={set("night_price")} placeholder="65,000" /></Label>
              <Label label="일반(유료) 단가"><Input type="number" min={0} value={f.paid_price} onChange={set("paid_price")} /></Label>
              <Label label="일반(유료) 야간 단가"><Input type="number" min={0} value={f.paid_night_price} onChange={set("paid_night_price")} placeholder="비우면 일반 단가" /></Label>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">야간은 19:00 이후 시작하거나 토요일인 수업이에요. 바우처 단가를 비우면 52,000원·65,000원(26만원을 월 5회·4회로 나눈 값)을 써요. 사비 수업은 일정에서 직접 선택하며 일반(유료) 단가로 계산해요.</p>
          </div>
          <Notice>총 이용금액은 바우처 단가를 설정한 경우에만 계산합니다.</Notice>
          {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
          {save.isSuccess && <p className="text-sm text-green-700">저장되었습니다.</p>}
          <Button disabled={save.isPending}>저장</Button>
        </form>
      </Card>
      <TherapistRoster />
      <Accountants />
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
