import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import VoucherHwpx from "./VoucherHwpx";
import { errText } from "../lib/hooks";
import { Badge, Button, Empty, ErrorNotice, Label, Notice, Select } from "./ui";

// 바우처 서류 = the 발달재활 서비스 제공 기록지 HWPX (기록지·별지·일정표 in one file), filled from records.
const TYPES: Record<string, string> = { voucher: "바우처 서류", progress_report: "치료 경과보고서", parent_consultation: "보호자 상담기록" };
// Listed-only types: older voucher drafts, 평가 결과 요약서 made before 검사 removal, and documents approved in AI chat.
const LABELS: Record<string, string> = { ...TYPES, assessment_summary: "평가 결과 요약서", service_record: "서비스 제공기록지", schedule: "서비스 일정표", parent_guidance: "보호자 안내문 (승인됨)" };
type Doc = { id: string; type: string; month: string | null; format: string | null; status: string; created_at?: string; approved_at?: string | null; download_url?: string; expires_at?: string; hwpx_validation?: string | null };
type Link = { download_url: string; expires_at: string };

// The API builds download URLs from the request host; behind the dev proxy that host is the
// frontend origin without the /api prefix, so route same-origin links back through the proxy.
export const href = (u: string) => {
  const url = new URL(u, location.origin);
  return url.origin === location.origin && !url.pathname.startsWith("/api") ? `/api${url.pathname}${url.search}` : url.toString();
};

export default function DocumentExport({ childId, month }: { childId: string; month: string }) {
  const qc = useQueryClient();
  const [type, setType] = useState("voucher"), [format, setFormat] = useState("docx");
  const voucher = type === "voucher";
  // Docs created/approved here carry a fresh signed URL; listed (past) docs request one on click.
  const [fresh, setFresh] = useState<Doc[]>([]);
  const key = ["documents", childId];
  const history = useQuery({ queryKey: key, queryFn: () => api<Doc[]>(`/children/${childId}/documents`), retry: false });
  const merge = (d: Doc) => { setFresh((x) => [{ ...x.find((y) => y.id === d.id), ...d }, ...x.filter((y) => y.id !== d.id)]); qc.invalidateQueries({ queryKey: key }); };
  const create = useMutation({ mutationFn: () => api<Doc>(`/children/${childId}/documents`, { method: "POST", json: { type, month, format } }), onSuccess: merge });
  const approve = useMutation({ mutationFn: (id: string) => api<Doc>(`/generated-documents/${id}/approve`, { method: "POST" }), onSuccess: merge });
  const link = useMutation({
    mutationFn: (id: string) => api<Link>(`/generated-documents/${id}/link`, { method: "POST" }),
    onSuccess: (r) => { location.href = href(r.download_url); },
  });
  const listed = history.data ?? [];
  const docs: Doc[] = [...fresh.map((f) => ({ ...listed.find((l) => l.id === f.id), ...f })), ...listed.filter((l) => !fresh.some((f) => f.id === l.id))];
  const live = (d: Doc) => !!d.download_url && (!d.expires_at || new Date(d.expires_at).getTime() > Date.now() + 5000);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Label label="문서 종류"><Select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Label>
        <Label label="형식">{voucher
          ? <Select value="hwpx" disabled><option value="hwpx">HWPX (한글)</option></Select>
          : <Select value={format} onChange={(e) => setFormat(e.target.value)}><option value="docx">DOCX</option><option value="pdf">PDF</option></Select>}</Label>
      </div>
      {voucher ? <VoucherHwpx childId={childId} month={month} /> : <>
      <Button onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? "생성 중…" : `${month} 초안 생성`}</Button>
      {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
      </>}
      {!voucher && <Notice>초안에는 "초안" 표시가 들어갑니다. 승인번호와 서명은 자동으로 채워지지 않으니 출력 후 수기로 기재하세요. 다운로드 링크는 짧은 시간 후 만료되며, 지난 문서는 다운로드할 때마다 새 링크를 받습니다.</Notice>}
      <h3 className="pt-2 text-xs font-semibold text-slate-600">생성된 문서</h3>
      <ErrorNotice error={history.error} />
      {!docs.length && !history.isLoading && !history.error && <Empty>생성된 문서가 없습니다.</Empty>}
      {docs.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-2 text-sm">
          <span className="font-medium">{LABELS[d.type] ?? d.type}</span>{d.format && <span className="text-slate-500">{d.month} · {d.format.toUpperCase()}</span>}
          <Badge tone={d.status === "approved" ? "green" : "amber"}>{d.status === "approved" ? "승인됨" : "초안"}</Badge>
          {d.hwpx_validation && <Badge tone="red">한컴 호환 미검증</Badge>}
          {d.created_at && <span className="text-xs text-slate-400">{d.created_at.slice(0, 16).replace("T", " ")}</span>}
          {!d.format ? <span className="ml-auto text-xs text-slate-400">파일 없음 (AI 대화에서 승인된 기록)</span> : live(d)
            ? <a className="ml-auto inline-flex items-center gap-1 text-indigo-600" href={href(d.download_url!)}><Download size={14} />다운로드</a>
            : <button className="ml-auto inline-flex items-center gap-1 text-indigo-600 disabled:opacity-50" disabled={link.isPending} onClick={() => link.mutate(d.id)}><Download size={14} />{link.isPending && link.variables === d.id ? "링크 생성 중…" : "다운로드"}</button>}
          {d.status === "draft" && <Button variant="outline" onClick={() => approve.mutate(d.id)} disabled={approve.isPending}>검토 완료 · 승인</Button>}
        </div>
      ))}
      {approve.error && <Notice tone="red">{errText(approve.error)}</Notice>}
      <ErrorNotice error={link.error} />
    </div>
  );
}
