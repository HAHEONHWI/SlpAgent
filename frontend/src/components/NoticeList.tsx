import { useState } from "react";
import { Pencil, Pin, Trash2 } from "lucide-react";
import type { Notice } from "../lib/notices";
import { Empty } from "./ui";

/** Notices as an accordion. Bodies are plain text (rendered as text, line breaks kept). */
export default function NoticeList({ notices, editable, onEdit, onDelete, unreadAfter }: {
  notices: Notice[]; editable?: (n: Notice) => boolean; onEdit?: (n: Notice) => void; onDelete?: (n: Notice) => void; unreadAfter?: string;
}) {
  const [open, setOpen] = useState<string | null>(notices[0]?.id ?? null);
  if (!notices.length) return <Empty>공지사항이 없습니다.</Empty>;
  return (
    <ul className="border-t border-slate-200">
      {notices.map((n) => {
        const shown = open === n.id;
        return (
        <li key={n.id} className="border-b border-slate-200">
          <button className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-4 text-left hover:bg-slate-900/[.03] sm:grid-cols-[56px_88px_minmax(0,1fr)_110px] sm:px-2" onClick={() => setOpen(shown ? null : n.id)} aria-expanded={shown}>
            <span className="order-3 col-span-2 flex items-center gap-2 sm:order-none sm:col-span-1">
              {n.pinned && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] text-indigo-800"><Pin size={11} aria-hidden />고정</span>}
              <span className="text-xs text-slate-500 sm:hidden">{n.scope === "site" ? "사이트" : "기관"}</span>
            </span>
            <span className="hidden text-xs text-slate-500 sm:block">{n.scope === "site" ? "사이트 공지" : "기관 공지"}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-2"><b className="min-w-0 truncate font-semibold">{n.title}</b>
                {unreadAfter !== undefined && n.created_at > unreadAfter && <span className="size-2 shrink-0 rounded-full bg-indigo-600" aria-label="새 공지" />}</span>
              {!shown && <span className="mt-1 block truncate text-[13px] opacity-75">{n.body}</span>}
            </span>
            <span className="text-right text-xs text-slate-500">{n.created_at.slice(0, 10).replaceAll("-", ".")}</span>
          </button>
          {shown && (
            <div className="pb-5 sm:pl-[176px] sm:pr-[126px]">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{n.body}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <span>{n.author_name ?? (n.scope === "site" ? "사이트 관리자" : "기관 관리자")}</span>
                {n.updated_at && n.updated_at.slice(0, 16) !== n.created_at.slice(0, 16) && <span>· 수정 {n.updated_at.slice(0, 10)}</span>}
                {editable?.(n) && <>
                  <button className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100" onClick={() => onEdit?.(n)}><Pencil size={12} />수정</button>
                  <button className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-red-600 hover:bg-red-50" onClick={() => onDelete?.(n)}><Trash2 size={12} />삭제</button>
                </>}
              </div>
            </div>)}
        </li>);
      })}
    </ul>
  );
}
