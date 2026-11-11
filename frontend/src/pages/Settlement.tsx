import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { useMe } from "../lib/me";
import { errText } from "../lib/hooks";
import { Badge, Button, Empty, Input, Notice, PageTitle, Table, Td } from "../components/ui";

type Row = { child_id: string; grade: string | null; day_sessions: number; night_sessions: number; paid_sessions: number;
  copay: number | null; copay_charged: number | null; copay_refund: number | null; voucher_amount: number | null; support: number | null;
  over_budget: boolean; paid_amount: number | null; guardian_total: number | null;
  cognitive_sessions: number; cognitive_amount: number | null; pending_sessions: number };
type Data = { month: string; paid_price: number | null; rows: Row[] };
type Grades = { total: number; day_price: number; night_price: number; grades: { grade: string; copay: number; support: number }[] };

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const won = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString());
const sum = (rows: Row[], k: keyof Row) => rows.some((r) => r[k] == null) ? null : rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
const HEAD = ["아동", "유형", "일반", "야간", "서류상 금액", "정부지원금", "본인부담금", "청구", "환불", "사비", "사비 금액", "인지", "인지 금액", "결제 미설정", "보호자 청구"];
const COUNTS = new Set([2, 3, 9, 11, 13]);  // columns holding a number of classes, not won
const NUMERIC = HEAD.map((_, i) => i).filter((i) => i >= 2);
const num = "text-right tabular-nums";

export default function Settlement() {
  const me = useMe().data;
  if (me && !me.can_settle) return <><PageTitle title="정산" /><Notice>정산은 기관 관리자와 기관 관리자가 정한 회계 담당만 볼 수 있어요.</Notice></>;
  return <SettlementView />;
}

function SettlementView() {
  const { children } = useChild();
  const [month, setMonth] = useState(today().slice(0, 7));
  const q = useQuery({ queryKey: ["settlement", month], queryFn: () => api<Data>(`/settlement?month=${month}`) });
  const g = useQuery({ queryKey: ["settlement", "grades"], queryFn: () => api<Grades>("/settlement/grades") }).data;
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState("");
  const who = (id: string) => { const c = children.find((x) => x.id === id); return c ? `${c.display_name} · ${c.alias}` : "–"; };
  const rows = q.data?.rows ?? [];
  const cells = (r: Row) => [who(r.child_id), r.grade ? `${r.grade}형` : "유형 미설정", r.day_sessions, r.night_sessions, r.voucher_amount, r.support,
    r.copay, r.copay_charged, r.copay_refund, r.paid_sessions, r.paid_amount, r.cognitive_sessions, r.cognitive_amount, r.pending_sessions, r.guardian_total];
  const totals = ["합계", "", sum(rows, "day_sessions"), sum(rows, "night_sessions"), sum(rows, "voucher_amount"), sum(rows, "support"),
    sum(rows, "copay"), sum(rows, "copay_charged"), sum(rows, "copay_refund"), sum(rows, "paid_sessions"), sum(rows, "paid_amount"),
    sum(rows, "cognitive_sessions"), sum(rows, "cognitive_amount"), sum(rows, "pending_sessions"), sum(rows, "guardian_total")];

  const exportXlsx = async () => {
    setExporting(true); setExportError("");
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const bold = (value: string | number | null) => ({ value: value ?? "–", fontWeight: "bold" as const });
      await writeXlsxFile([...[HEAD.map(bold)], ...rows.map(cells), totals.map(bold)] as any,
        { sheet: `${month} 정산`, columns: [{ width: 22 }, { width: 11 }, ...Array(HEAD.length - 2).fill({ width: 12 })], stickyRowsCount: 1 }).toFile(`정산_${month}.xlsx`);
    } catch (e) { setExportError(errText(e)); } finally { setExporting(false); }
  };

  const noPrice = rows.some((r) => (r.paid_sessions > 0 && r.paid_amount == null) || (r.cognitive_sessions > 0 && r.cognitive_amount == null));
  const missingGrade = rows.some((r) => !r.grade && (r.day_sessions || r.night_sessions));
  return (
    <>
      <PageTitle title="정산" sub="출결 기준으로 아동별 한 달 바우처·본인부담금·사비·인지 금액을 계산해요. 결석·사유결석·장기결강·옮긴 수업은 빠지고, 아직 안 온 날의 수업은 예정대로 들어가요." />
      {noPrice && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-indigo-100 px-4 py-3.5 text-sm">
          <span className="font-semibold">일반(유료) 단가가 없어 사비·인지 금액을 계산하지 못했어요.</span>
          <Link to="/settings" className="ml-auto rounded-full px-2 py-1 font-semibold text-indigo-700 no-underline hover:bg-indigo-600/10">기관 설정으로 이동</Link>
        </div>)}
      {missingGrade && <Notice>바우처 수업이 있는 아동은 아동 관리에서 유형을 정해야 지원금·본인부담금을 계산할 수 있어요.</Notice>}
      {rows.some((r) => r.pending_sessions > 0) && <Notice>결제 미설정 수업이 있는 아동은 보호자 청구액 산정을 보류해요. 담당 치료사가 월간 일정표에서 결제 방식을 저장해야 해요.</Notice>}
      <section>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h3 className="text-xl font-semibold md:text-[25px]">{Number(month.slice(0, 4))}년 {Number(month.slice(5, 7))}월</h3>
          <span className="text-[13px] text-slate-500">결석 · 옮긴 수업 제외</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={!rows.length || exporting} onClick={exportXlsx}><Download size={14} />{exporting ? "만드는 중…" : "엑셀로 내보내기"}</Button>
            <div className="w-44"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="월" /></div>
          </div>
        </div>
        {q.isLoading ? <p className="text-sm text-slate-400">불러오는 중…</p> : !rows.length ? <Empty>이 달에 정산할 수업이 없습니다. 아동 관리에서 바우처 유형을 정해 주세요.</Empty> : (
          <Table head={HEAD} right={NUMERIC}>
            {rows.map((r) => (
              <tr key={r.child_id}>
                <Td className="font-semibold">{who(r.child_id)}</Td>
                <Td>{r.grade ? <Badge tone="indigo">바우처 {r.grade}형</Badge> : <Badge>유형 미설정</Badge>}</Td>
                <Td className={num}>{r.day_sessions}</Td><Td className={num}>{r.night_sessions}</Td>
                <Td className={`${num} ${r.over_budget ? "font-semibold text-red-700" : ""}`}>{won(r.voucher_amount)}{r.over_budget && " ⚠"}</Td>
                <Td className={num}>{won(r.support)}</Td><Td className={`${num} text-slate-500`}>{won(r.copay)}</Td><Td className={num}>{won(r.copay_charged)}</Td>
                <Td className={`${num} ${r.copay_refund ? "font-semibold text-amber-700" : ""}`}>{won(r.copay_refund)}</Td>
                <Td className={num}>{r.paid_sessions}</Td>
                <Td className={num}>{won(r.paid_amount)}</Td><Td className={num}>{r.cognitive_sessions}</Td><Td className={num}>{won(r.cognitive_amount)}</Td><Td className={num}>{r.pending_sessions}</Td><Td className={`${num} font-semibold`}>{won(r.guardian_total)}</Td>
              </tr>))}
            <tr className="bg-slate-100 font-semibold">{totals.map((v, i) => <Td key={i} className={clsx(i >= 2 && num, i === totals.length - 1 && "text-indigo-700")}>{v == null ? "–" : typeof v === "number" && !COUNTS.has(i) ? won(v) : v}</Td>)}</tr>
          </Table>)}
        {q.error && <Notice tone="red">{errText(q.error)}</Notice>}
        {exportError && <div className="mt-2"><Notice tone="red">{exportError}</Notice></div>}
        {rows.some((r) => r.over_budget) && <div className="mt-3"><Notice tone="red">표시된 아동은 서류상 금액이 월 26만원을 넘어요. 지원금 계산에는 26만원 상한을 적용하므로 초과 금액 처리를 확인해 주세요.</Notice></div>}
        <p className="mt-3 text-xs text-slate-500">금액은 원 단위예요. 토요일 수업과 19시 이후 시작하는 수업은 야간으로 계산해요. ‘실제 일정과 동일’을 저장하면 아동별 월 첫 5회, 결제 일정을 직접 입력한 달은 지정한 날짜를 바우처로 계산해요. 이때 나머지 수업은 사비예요. 지원금 계산에는 월 26만원 상한을 적용해요. 출결 관리에서 수업마다 바우처·사비·인지를 바꿀 수 있어요. 인지는 사비와 같은 단가로 따로 셉니다. 본인부담금은 쓴 바우처 금액만큼 받고 덜 쓴 만큼 환불해요. 유형이 미설정이면 지원금·본인부담금 계산을 보류해요.</p>
      </section>

      {g && (
        <section className="mt-12">
          <h3 className="mb-4 text-xl font-semibold md:text-[25px]">발달재활서비스 기준</h3>
          <Table head={["유형", "바우처 지원금", "본인부담금", "합계"]} right={[1, 2, 3]}>
            {g.grades.map((x) => <tr key={x.grade}><Td className="font-semibold">{x.grade}형</Td><Td className={num}>{won(x.support)}</Td><Td className={num}>{x.copay ? won(x.copay) : "면제"}</Td><Td className={num}>{won(g.total)}</Td></tr>)}
          </Table>
          <p className="mt-3 text-xs text-slate-500">바우처 회당 단가: 일반 {won(g.day_price)}원, 야간 {won(g.night_price)}원 (<Link to="/settings" className="underline">기관 설정</Link>에서 바꿀 수 있어요. 기본 52,000원·65,000원 = 26만원을 월 5회·4회로 나눈 값). 유형별 금액은 보건복지부 발달재활서비스 안내(2026-04-02 수정) 기준이에요.</p>
        </section>)}
    </>
  );
}
