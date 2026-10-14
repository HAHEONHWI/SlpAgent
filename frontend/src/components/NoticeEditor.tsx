import { useState } from "react";
import { Button, Input, Label, Textarea } from "./ui";

export type NoticeDraft = { title: string; body: string; pinned: boolean };

export default function NoticeEditor({ initial, busy, onSave, onCancel }: { initial?: NoticeDraft; busy?: boolean; onSave: (d: NoticeDraft) => void; onCancel?: () => void }) {
  const [d, setD] = useState<NoticeDraft>(initial ?? { title: "", body: "", pinned: false });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave({ ...d, title: d.title.trim(), body: d.body.trim() }); }}>
      <Label label="제목"><Input value={d.title} maxLength={100} required onChange={(e) => setD({ ...d, title: e.target.value })} /></Label>
      <Label label="내용"><Textarea className="min-h-32" value={d.body} maxLength={5000} required onChange={(e) => setD({ ...d, body: e.target.value })} /></Label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.pinned} onChange={(e) => setD({ ...d, pinned: e.target.checked })} />맨 위에 고정</label>
      <div className="flex gap-2">
        <Button disabled={busy || !d.title.trim() || !d.body.trim()}>{busy ? "저장 중…" : "저장"}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>취소</Button>}
      </div>
    </form>
  );
}
