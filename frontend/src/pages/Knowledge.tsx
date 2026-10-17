import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Badge, Card, Empty, Input, Notice, PageTitle, Table, Td } from "../components/ui";

const ST: Record<string, [string, any]> = { text_ok: ["텍스트 추출", "green"], partial: ["일부 OCR·검수 필요", "amber"], ocr_required: ["OCR·검수 필요", "red"] };

export default function Knowledge() {
  const [q, setQ] = useState(""), [term, setTerm] = useState("");
  const docs = useQuery({ queryKey: ["kdocs"], queryFn: () => api<any[]>("/knowledge/documents") });
  const res = useQuery({ queryKey: ["ksearch", term], queryFn: () => api<any[]>(`/knowledge/search?q=${encodeURIComponent(term)}`), enabled: term.length > 1 });
  return (
    <>
      <PageTitle title="AI 지식자료실" sub="기관 내부 열람 전용 · 원문 자료는 외부 공개·재배포하지 않습니다." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="자료 목록">
          {!docs.data?.length ? <Empty>적재된 자료가 없습니다. (backend/scripts/ingest_knowledge.py)</Empty> : (
            <Table head={["문서", "검사", "쪽수", "상태"]}>
              {docs.data.map((d) => <tr key={d.source}><Td className="max-w-56 !whitespace-normal [overflow-wrap:anywhere]">{d.source}</Td><Td>{d.test_code ?? "-"}</Td><Td>{d.pages}</Td><Td><Badge tone={ST[d.status][1]}>{ST[d.status][0]}</Badge></Td></tr>)}
            </Table>)}
          <div className="mt-3"><Notice>검사 서류는 사용 허가된 검사만 AI 대화의 근거로 검색됩니다. OCR·검수가 필요한 페이지는 검수 전까지 검색·AI 답변에서 제외됩니다.</Notice></div>
        </Card>
        <Card title="자료 검색">
          <form className="mb-3" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}><Input placeholder="검색어 입력 후 Enter" value={q} onChange={(e) => setQ(e.target.value)} /></form>
          {term && !res.data?.length && !res.isLoading && <Empty>결과가 없습니다.</Empty>}
          <div className="space-y-2">{res.data?.map((r, i) => (
            <div key={i} className="rounded-md border border-slate-200 p-2"><div className="mb-1 flex items-center gap-2 text-xs"><Badge tone="indigo">{r.document}</Badge><span>p.{r.page}</span><span className="text-slate-400">유사도 {r.score}</span></div>
              <p className="whitespace-pre-wrap text-xs text-slate-700">{r.text.slice(0, 400)}</p></div>))}</div>
        </Card>
      </div>
    </>
  );
}
