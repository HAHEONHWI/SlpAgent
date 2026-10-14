import { useState } from "react";
import { Pencil, Pin, Trash2 } from "lucide-react";
import type { Notice } from "../lib/notices";
import { Badge, Empty } from "./ui";

/** Notices as an accordion. Bodies are plain text (rendered as text, line breaks kept). */
export default function NoticeList({ notices, editable, onEdit, onDelete, unreadAfter }: {
  notices: Notice[]; editable?: (n: Notice) => boolean; onEdit?: (n: Notice) => void; onDelete?: (n: Notice) => void; unreadAfter?: string;
}) {
  const [open, setOpen] = useState<string | null>(notices[0]?.id ?? null);
  if (!notices.length) return <Empty>공지사항이 없습니다.</Empty>;
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {notices.map((n) => (
        <li key={n.id}>
          <button className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50" onClick={() => setOpen(open === n.id ? null : n.id)} aria-expanded={open === n.id}>
            {n.pinned && <Pin size={14} className="shrink-0 text-indigo-600" aria-label="고정" />}
            <Badge tone={n.scope === "site" ? "indigo" : "slate"}>{n.scope === "site" ? "사이트 공지" : "기관 공지"}</Badge>
            <span className="min-w-0 flex-1 truncate font-medium">{n.title}</span>
            {unreadAfter !== undefined && n.created_at > unreadAfter && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-label="새 공지" />}
            <span className="shrink-0 text-xs text-slate-400">{n.created_at.slice(0, 10)}</span>
          </button>
          {open === n.id && (
            <div className="px-4 pb-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{n.body}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <span>{n.author_name ?? (n.scope === "site" ? "사이트 관리자" : "기관 관리자")}</span>
                {n.updated_at && n.updated_at.slice(0, 16) !== n.created_at.slice(0, 16) && <span>· 수정 {n.updated_at.slice(0, 10)}</span>}
                {editable?.(n) && <>
                  <button className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-slate-600 hover:bg-slate-100" onClick={() => onEdit?.(n)}><Pencil size={12} />수정</button>
                  <button className="inline-flex items-center gap-1 rounded px-2 py-1 text-red-600 hover:bg-red-50" onClick={() => onDelete?.(n)}><Trash2 size={12} />삭제</button>
                </>}
              </div>
            </div>)}
        </li>))}
    </ul>
  );
}
