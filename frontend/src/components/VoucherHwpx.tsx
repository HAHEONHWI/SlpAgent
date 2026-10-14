import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Download, Plus, Trash2 } from "lucide-react";
import { api, download } from "../lib/api";
import { errText } from "../lib/hooks";
import { useChild } from "../lib/child";
import { Badge, Button, Input, Label, Notice, Textarea } from "./ui";

type Visit = { date: string; start: string; end: string; therapist: string; content: string; content_source?: string };
type Other = { date: string; text: string };
type MonthData = { month: string; minutes: number; unit_price: number | null; visits: Visit[]; other: Other[] };

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthsBetween = (a: string, b: string) => {
  const out: string[] = [];
  for (let m = a; m <= b && out.length < 12; m = addMonths(m, 1)) out.push(m);
  return out;
};
const label = (ym: string) => `${Number(ym.slice(5))}월`;

/** 발달재활 서비스 제공 기록지 (HWPX): page 1 times, page 2 what was done, page 3 the month calendar. */
export default function VoucherHwpx({ childId, month }: { childId: string; month: string }) {
  const { child } = useChild();
  const [from, setFrom] = useState(month), [to, setTo] = useState(month);
  useEffect(() => { setFrom(month); setTo(month); }, [month]);
  const months = monthsBetween(from, to < from ? from : to);
  const [tab, setTab] = useState(month);
  const [edits, setEdits] = useState<Record<string, Visit[]>>({});
  const [otherEdits, setOtherEdits] = useState<Record<string, Other[]>>({});
  const [opt, setOpt] = useState({ unit_price: "", copay: "", phone: "" });
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [saved, setSaved] = useState("");
  const loaded = useQueries({ queries: months.map((m) => ({ queryKey: ["voucher-visits", childId, m], queryFn: () => api<MonthData>(`/children/${childId}/voucher-visits?month=${m}`) })) });
  const current = months.includes(tab) ? tab : months[0];
  const data = loaded[months.indexOf(current)]?.data;
  const visits = edits[current] ?? data?.visits ?? [];
  const setVisits = (v: Visit[]) => setEdits({ ...edits, [current]: v });
  const other = otherEdits[current] ?? data?.other ?? [];
  const setOther = (o: Other[]) => setOtherEdits({ ...otherEdits, [current]: o });
  const patch = (i: number, p: Partial<Visit>) => setVisits(visits.map((v, j) => (j === i ? { ...v, ...p } : v)));
  const plus = (hhmm: string, min: number) => { const [h, m] = hhmm.split(":").map(Number); const t = h * 60 + m + min; return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  const empty = visits.filter((v) => !v.content.trim()).length;

  const run = async () => {
    setBusy(true); setErr(""); setSaved("");
    try {
      const body = {
        months: months.map((m) => ({ month: m, ...(edits[m] ? { visits: edits[m] } : {}), ...(otherEdits[m] ? { other: otherEdits[m] } : {}) })),
        ...(opt.unit_price && { unit_price: Number(opt.unit_price) }), ...(opt.copay && { copay: Number(opt.copay) }), ...(opt.phone.trim() && { phone: opt.phone.trim() }),
      };
      setSaved(await download(`/children/${childId}/voucher-hwpx`, body, `${child?.display_name ?? "아동"}-${label(months[0])}.hwpx`));
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">1쪽 수업 시간, 2쪽 수업 내용(별지), 3쪽 그 달 달력을 양식 그대로 채웁니다. 일정·출결(결석·취소 제외)과 회기 기록에서 가져오고, 아래에서 고칠 수 있어요.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Label label="시작 월"><Input type="month" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></Label>
        <Label label="끝 월 (최대 12개월)"><Input type="month" value={to} min={from} max={addMonths(from, 11)} onChange={(e) => setTo(e.target.value)} /></Label>
        <Label label="회기 단가(원)"><Input type="number" min={0} placeholder={data?.unit_price ? data.unit_price.toLocaleString() : "양식 값"} value={opt.unit_price} onChange={(e) => setOpt({ ...opt, unit_price: e.target.value })} /></Label>
        <Label label="본인부담금(원)"><Input type="number" min={0} placeholder="비우면 빈칸" value={opt.copay} onChange={(e) => setOpt({ ...opt, copay: e.target.value })} /></Label>
        <Label label="기관 전화"><Input placeholder="비우면 양식 값" value={opt.phone} onChange={(e) => setOpt({ ...opt, phone: e.target.value })} /></Label>
      </div>

      {months.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {months.map((m, i) => (
            <button key={m} onClick={() => setTab(m)} className={`rounded-md px-3 py-1 text-sm ${m === current ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {label(m)} {loaded[i]?.data && <span className="opacity-70">· {(edits[m] ?? loaded[i].data!.visits).length}회</span>}
            </button>))}
        </div>)}

      <div className="rounded-lg border border-slate-200">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm">
          <b>{current.slice(0, 4)}년 {label(current)}</b><span className="text-slate-500">{visits.length}회</span>
          {empty > 0 && <Badge tone="amber">내용 없는 회기 {empty}</Badge>}
          {edits[current] && <button className="ml-auto text-xs text-slate-500 underline" onClick={() => { const { [current]: _drop, ...rest } = edits; setEdits(rest); }}>기록에서 다시 불러오기</button>}
        </div>
        {!data ? <p className="p-3 text-sm text-slate-400">불러오는 중…</p> : (
          <div className="divide-y divide-slate-100">
            {visits.map((v, i) => (
              <div key={i} className="grid gap-2 p-3 sm:grid-cols-[8.5rem_5.5rem_5.5rem_6rem_1fr_auto]">
                <Input type="date" value={v.date} onChange={(e) => patch(i, { date: e.target.value })} aria-label="날짜" />
                <Input type="time" value={v.start} onChange={(e) => patch(i, { start: e.target.value, end: plus(e.target.value, data.minutes) })} aria-label="시작" />
                <Input type="time" value={v.end} onChange={(e) => patch(i, { end: e.target.value })} aria-label="종료" />
                <Input value={v.therapist} maxLength={20} placeholder="담당" onChange={(e) => patch(i, { therapist: e.target.value })} aria-label="담당 재활사" />
                <Textarea className="min-h-10" rows={2} value={v.content} placeholder="수업 내용 (2쪽 별지)" onChange={(e) => patch(i, { content: e.target.value })} aria-label="수업 내용" />
                <button className="self-start rounded p-2 text-red-600 hover:bg-red-50" aria-label="이 회기 빼기" onClick={() => setVisits(visits.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>))}
            {!visits.length && <p className="p-3 text-sm text-slate-400">이 달에 수업 기록이 없어요. 아래에서 직접 추가할 수 있어요.</p>}
            <div className="p-2">
              <Button variant="ghost" onClick={() => setVisits([...visits, { date: `${current}-01`, start: "09:50", end: plus("09:50", data.minutes), therapist: visits[visits.length - 1]?.therapist ?? "", content: "" }])}><Plus size={14} />회기 추가</Button>
            </div>
          </div>)}
      </div>

      {data && (
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-sm font-medium">기타사항 <span className="font-normal text-slate-500">— 1쪽 ‘일자 · 기타사항’ 칸 (출결의 보강·결강·장기결강에서 자동으로 채워져요)</span></p>
          <div className="space-y-2">
            {other.map((o, i) => (
              <div key={i} className="flex gap-2">
                <div className="w-28 shrink-0"><Input value={o.date} maxLength={20} placeholder="일자" aria-label="일자" onChange={(e) => setOther(other.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} /></div>
                <Input value={o.text} maxLength={300} placeholder="내용" aria-label="기타사항" onChange={(e) => setOther(other.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <button className="rounded p-2 text-red-600 hover:bg-red-50" aria-label="이 줄 빼기" onClick={() => setOther(other.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>))}
            {!other.length && <p className="text-sm text-slate-400">이 달에는 기록할 기타사항이 없어요.</p>}
            <Button variant="ghost" onClick={() => setOther([...other, { date: "", text: "" }])}><Plus size={14} />줄 추가</Button>
          </div>
        </div>)}

      {err && <Notice tone="red">{err}</Notice>}
      {saved && <p className="text-sm text-green-700">‘{saved}’ 파일을 내려받았어요.</p>}
      <Button onClick={run} disabled={busy || loaded.some((q) => q.isLoading)}>
        <Download size={14} />{busy ? "만드는 중…" : months.length > 1 ? `${months.length}개월 내려받기 (${child?.display_name ?? ""}-n월.hwpx 묶음)` : `${child?.display_name ?? ""}-${label(current)}.hwpx 내려받기`}
      </Button>
      <p className="text-xs text-slate-500">5회를 넘는 달은 1쪽·2쪽이 5회씩 나뉘어 추가돼요. 승인번호·서명란은 비워 둡니다.</p>
    </div>
  );
}
