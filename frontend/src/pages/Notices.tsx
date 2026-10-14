import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { useMe } from "../lib/me";
import { markSeen, seenAt, useNotices, type Notice } from "../lib/notices";
import NoticeEditor, { type NoticeDraft } from "../components/NoticeEditor";
import NoticeList from "../components/NoticeList";
import { Button, Card, Notice as Alert, PageTitle } from "../components/ui";

export default function Notices() {
  const qc = useQueryClient();
  const me = useMe().data;
  const isAdmin = me?.role === "admin";
  const list = useNotices();
  const [unreadAfter] = useState(() => seenAt(me?.uid)); // dots for this visit, then everything counts as read
  const [editing, setEditing] = useState<Notice | "new" | null>(null);
  useEffect(() => { if (list.data) markSeen(me?.uid, list.data); }, [list.data, me?.uid]);
  const done = () => { setEditing(null); qc.invalidateQueries({ queryKey: ["notices"] }); };
  const save = useMutation({
    mutationFn: (d: NoticeDraft) => editing && editing !== "new"
      ? api(`/notices/${editing.id}`, { method: "PUT", json: d }) : api("/notices", { method: "POST", json: d }),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: (n: Notice) => api(`/notices/${n.id}`, { method: "DELETE" }), onSuccess: done });
  return (
    <>
      <PageTitle title="공지사항" sub="사이트 공지와 우리 기관 공지를 함께 보여요. 고정된 공지가 맨 위에 와요." />
      {isAdmin && !editing && <div className="mb-3"><Button onClick={() => { save.reset(); setEditing("new"); }}><Plus size={14} />기관 공지 쓰기</Button></div>}
      {isAdmin && editing && (
        <Card title={editing === "new" ? "기관 공지 쓰기" : "기관 공지 수정"} className="mb-4">
          <NoticeEditor key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? undefined : editing} busy={save.isPending} onSave={(d) => save.mutate(d)} onCancel={() => setEditing(null)} />
          {save.error && <div className="mt-2"><Alert tone="red">{errText(save.error)}</Alert></div>}
        </Card>)}
      {list.isLoading ? <p className="text-sm text-slate-400">불러오는 중…</p> : (
        <NoticeList notices={list.data ?? []} unreadAfter={unreadAfter} editable={(n) => isAdmin && n.scope === "org"}
          onEdit={(n) => { save.reset(); setEditing(n); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          onDelete={(n) => { if (confirm(`‘${n.title}’ 공지를 삭제할까요?`)) remove.mutate(n); }} />)}
      {(list.error || remove.error) && <div className="mt-2"><Alert tone="red">{errText(list.error || remove.error)}</Alert></div>}
    </>
  );
}
