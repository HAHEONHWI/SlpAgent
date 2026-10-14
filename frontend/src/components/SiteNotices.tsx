import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import type { Notice } from "../lib/notices";
import NoticeEditor, { type NoticeDraft } from "./NoticeEditor";
import NoticeList from "./NoticeList";
import { Button, Card, Notice as Alert } from "./ui";

/** Site admin › 공지: notices every organization's users see. */
export default function SiteNotices() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["platform", "notices"], queryFn: () => api<Notice[]>("/platform/notices") });
  const [editing, setEditing] = useState<Notice | "new" | null>(null);
  const done = () => { setEditing(null); qc.invalidateQueries({ queryKey: ["platform", "notices"] }); };
  const save = useMutation({
    mutationFn: (d: NoticeDraft) => editing && editing !== "new"
      ? api(`/platform/notices/${editing.id}`, { method: "PUT", json: d }) : api("/platform/notices", { method: "POST", json: d }),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: (n: Notice) => api(`/platform/notices/${n.id}`, { method: "DELETE" }), onSuccess: done });
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">사이트 공지는 모든 기관의 사용자에게 ‘공지사항’과 알림 종에 보여요.</p>
      {editing ? (
        <Card title={editing === "new" ? "사이트 공지 쓰기" : "사이트 공지 수정"}>
          <NoticeEditor key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? undefined : editing} busy={save.isPending} onSave={(d) => save.mutate(d)} onCancel={() => setEditing(null)} />
          {save.error && <div className="mt-2"><Alert tone="red">{errText(save.error)}</Alert></div>}
        </Card>
      ) : <Button onClick={() => { save.reset(); setEditing("new"); }}><Plus size={14} />사이트 공지 쓰기</Button>}
      {list.isLoading ? <p className="text-sm text-slate-400">불러오는 중…</p> : (
        <NoticeList notices={list.data ?? []} editable={() => true} onEdit={(n) => { save.reset(); setEditing(n); }}
          onDelete={(n) => { if (confirm(`‘${n.title}’ 공지를 삭제할까요?`)) remove.mutate(n); }} />)}
      {(list.error || remove.error) && <Alert tone="red">{errText(list.error || remove.error)}</Alert>}
    </div>
  );
}
