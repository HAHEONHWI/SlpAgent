import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import RequireChild from "../components/RequireChild";
import DocumentExport from "../components/DocumentExport";
import VoucherHwpx from "../components/VoucherHwpx";
import { Card, Input, Label, PageTitle } from "../components/ui";

function Inner({ childId }: { childId: string }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const org = useQuery({ queryKey: ["org"], queryFn: () => api<any>("/org") });
  const [price, setPrice] = useState(""), [vm, setVm] = useState("");
  const effPrice = price || (org.data?.unit_price?.toString() ?? ""), effVm = vm || (org.data?.voucher_minutes?.toString() ?? "");
  const q = new URLSearchParams({ month, child_id: childId, ...(effPrice && { unit_price: effPrice }), ...(effVm && { voucher_minutes: effVm }) });
  const s = useQuery({ queryKey: ["billing", q.toString()], queryFn: () => api<any>(`/billing/summary?${q}`) });
  const d = s.data;
  const row = (k: string, v: any) => <div className="flex justify-between border-b border-slate-100 py-2 text-sm"><span className="text-slate-600">{k}</span><b>{v ?? "–"}</b></div>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="월별 집계 (코드 계산)">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Label label="월"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Label>
          <Label label="바우처 한도(분, 기본=기관 설정)"><Input type="number" placeholder={org.data?.voucher_minutes?.toString() ?? ""} value={vm} onChange={(e) => setVm(e.target.value)} /></Label>
          <Label label="회기 단가(원, 기본=기관 설정)"><Input type="number" placeholder={org.data?.unit_price?.toString() ?? ""} value={price} onChange={(e) => setPrice(e.target.value)} /></Label>
        </div>
        {d && <>{row("완료 회기 수", d.session_count)}{row("총 제공시간(분)", d.total_minutes)}{row("바우처 사용(분)", d.voucher_minutes)}{row("추가구매(분)", d.additional_minutes)}{row("총 이용금액(원)", d.total_amount?.toLocaleString())}
          {d.amount_note && <p className="mt-2 text-xs text-amber-700">{d.amount_note}</p>}</>}
      </Card>
      <Card title="문서 출력"><DocumentExport childId={childId} month={month} /></Card>
      <Card title="발달재활 서비스 제공 기록지 (HWPX)" className="lg:col-span-2"><VoucherHwpx childId={childId} month={month} /></Card>
    </div>
  );
}
export default function Voucher() { return <><PageTitle title="바우처·문서 생성" sub="시간·횟수·금액은 서버 코드가 계산하며 AI는 관여하지 않습니다." /><RequireChild>{(id) => <Inner childId={id} />}</RequireChild></>; }
