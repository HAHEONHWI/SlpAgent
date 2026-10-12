import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { Badge, Button, Label, Notice, Select } from "./ui";

const TYPES: Record<string, string> = { service_record: "서비스 제공기록지", schedule: "서비스 일정표", progress_report: "치료 경과보고서", assessment_summary: "평가 결과 요약서", parent_consultation: "보호자 상담기록" };
type Doc = { id: string; type: string; month: string; format: string; status: string; download_url: string; expires_at: string; hwpx_validation?: string | null };

// The API builds download URLs from the request host; behind the dev proxy that host is the
// frontend origin without the /api prefix, so route same-origin links back through the proxy.
const href = (u: string) => {
  const url = new URL(u, location.origin);
  return url.origin === location.origin && !url.pathname.startsWith("/api") ? `/api${url.pathname}${url.search}` : url.toString();
};

export default function DocumentExport({ childId, month }: { childId: string; month: string }) {
  const [type, setType] = useState("service_record"), [format, setFormat] = useState("docx");
  const [docs, setDocs] = useState<Doc[]>([]);
  const create = useMutation({
    mutationFn: () => api<Doc>(`/children/${childId}/documents`, { method: "POST", json: { type, month, format } }),
    onSuccess: (d) => setDocs((x) => [d, ...x]),
  });
  const approve = useMutation({
    mutationFn: (id: string) => api<Doc>(`/generated-documents/${id}/approve`, { method: "POST" }),
    onSuccess: (r) => setDocs((x) => x.map((d) => (d.id === r.id ? { ...d, ...r } : d))),
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Label label="문서 종류"><Select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Label>
        <Label label="형식"><Select value={format} onChange={(e) => setFormat(e.target.value)}><option value="docx">DOCX</option><option value="pdf">PDF</option><option value="hwpx">HWPX (호환성 미검증)</option></Select></Label>
      </div>
      <Button onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? "생성 중…" : `${month} 초안 생성`}</Button>
      {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
      <Notice>초안에는 "초안" 표시가 들어갑니다. 승인번호와 서명은 자동으로 채워지지 않으니 출력 후 수기로 기재하세요. 다운로드 링크는 짧은 시간 후 만료됩니다.</Notice>
      {docs.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-2 text-sm">
          <span className="font-medium">{TYPES[d.type]}</span><span className="text-slate-500">{d.month} · {d.format.toUpperCase()}</span>
          <Badge tone={d.status === "approved" ? "green" : "amber"}>{d.status === "approved" ? "승인됨" : "초안"}</Badge>
          {d.hwpx_validation && <Badge tone="red">한컴 호환 미검증</Badge>}
          <a className="ml-auto inline-flex items-center gap-1 text-indigo-600" href={href(d.download_url)}><Download size={14} />다운로드</a>
          {d.status === "draft" && <Button variant="outline" onClick={() => approve.mutate(d.id)} disabled={approve.isPending}>검토 완료 · 승인</Button>}
        </div>
      ))}
      {approve.error && <Notice tone="red">{errText(approve.error)}</Notice>}
    </div>
  );
}
