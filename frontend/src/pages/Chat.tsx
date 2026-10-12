import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import { Badge, Button, Card, Notice, PageTitle, Textarea } from "../components/ui";

type Msg = { role: "user" | "assistant"; text: string };

export default function Chat() {
  const { childId, child } = useChild();
  const qc = useQueryClient();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [conv, setConv] = useState<{ id: string; child: string | null } | null>(null);
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  // A conversation is bound to the child it started with; switching child starts a new one.
  const active = conv && conv.child === childId ? conv.id : null;

  const send = useMutation({
    mutationFn: (message: string) => api("/chat", { method: "POST", json: { message, conversation_id: active, child_id: active ? undefined : childId } }),
    onSuccess: (r, message) => {
      setConv({ id: r.conversation_id, child: childId });
      setMsgs((m) => [...m, { role: "assistant", text: r.text }]);
      qc.invalidateQueries({ queryKey: ["proposals"] });
      setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50);
    },
  });
  const submit = () => {
    if (!input.trim() || send.isPending) return;
    if (!active) setMsgs([]);
    setMsgs((m) => [...(active ? m : []), { role: "user", text: input }]);
    send.mutate(input); setInput("");
  };
  return (
    <>
      <PageTitle title="AI 전문 채팅" sub={child ? `아동별 모드: ${child.alias} — 이 아동의 기록을 조회합니다.` : "일반 모드: 아동 데이터에 접근하지 않습니다."} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2"><Badge tone={child ? "indigo" : "slate"}>{child ? "아동별" : "일반"}</Badge><span className="text-xs text-slate-500">AI 답변은 미승인 초안입니다. 근거(문서·페이지·평가일)를 확인하세요.</span></div>
          <div className="h-[55vh] space-y-3 overflow-y-auto rounded-md bg-slate-50 p-3">
            {msgs.length === 0 && <p className="text-sm text-slate-400">질문을 입력하세요.</p>}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white" : "max-w-[85%] whitespace-pre-wrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"}>{m.text}</div>
            ))}
            {send.isPending && <p className="text-sm text-slate-400">생각 중…</p>}
            <div ref={end} />
          </div>
          {send.error && <div className="mt-2"><Notice tone="red">{errText(send.error)}</Notice></div>}
          <div className="mt-3 flex gap-2">
            <Textarea className="min-h-12" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Enter 전송, Shift+Enter 줄바꿈"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
            <Button onClick={submit} disabled={send.isPending}><Send size={14} />전송</Button>
          </div>
        </Card>
        <Proposals childId={childId} />
      </div>
    </>
  );
}

function Proposals({ childId }: { childId: string | null }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["proposals", childId], queryFn: () => api<any[]>(`/proposals${childId ? `?child_id=${childId}` : ""}`) });
  const done = () => { qc.invalidateQueries({ queryKey: ["proposals"] }); qc.invalidateQueries(); };
  const approve = useMutation({ mutationFn: (id: string) => api(`/proposals/${id}/approve`, { method: "POST" }), onSuccess: done });
  const reject = useMutation({ mutationFn: (id: string) => api(`/proposals/${id}/reject`, { method: "POST" }), onSuccess: done });
  const [edit, setEdit] = useState<Record<string, string>>({});
  const save = useMutation({ mutationFn: ({ id, payload }: any) => api(`/proposals/${id}`, { method: "PUT", json: { payload } }), onSuccess: () => { setEdit({}); done(); } });
  return (
    <Card title={`승인 대기 초안 (${data.length})`}>
      {data.length === 0 && <p className="text-sm text-slate-400">대기 중인 초안이 없습니다.</p>}
      <div className="space-y-3">
        {data.map((p) => {
          const text = edit[p.id] ?? JSON.stringify(p.payload, null, 2);
          let valid = true; try { JSON.parse(text); } catch { valid = false; }
          return (
            <div key={p.id} className="rounded-md border border-amber-200 bg-amber-50/50 p-3">
              <div className="mb-2 flex items-center justify-between"><Badge tone="amber">{p.kind}</Badge><span className="text-[11px] text-slate-500">미승인</span></div>
              <Textarea className="min-h-32 font-mono text-xs" value={text} onChange={(e) => setEdit({ ...edit, [p.id]: e.target.value })} />
              {!valid && <p className="text-xs text-red-600">JSON 형식 오류</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button disabled={!valid || edit[p.id] === undefined} variant="outline" onClick={() => save.mutate({ id: p.id, payload: JSON.parse(text) })}>수정 저장</Button>
                <Button disabled={edit[p.id] !== undefined} onClick={() => approve.mutate(p.id)}>승인</Button>
                <Button variant="ghost" onClick={() => reject.mutate(p.id)}>반려</Button>
              </div>
              {edit[p.id] !== undefined && <p className="mt-1 text-[11px] text-slate-500">수정 후 '수정 저장'을 먼저 눌러야 승인할 수 있습니다.</p>}
            </div>
          );
        })}
      </div>
      {(approve.error || reject.error || save.error) && <div className="mt-2"><Notice tone="red">{errText(approve.error || reject.error || save.error)}</Notice></div>}
    </Card>
  );
}
