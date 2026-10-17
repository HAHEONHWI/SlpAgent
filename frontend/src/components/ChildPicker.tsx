import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import clsx from "clsx";
import { useChild } from "../lib/child";
import { useMe } from "../lib/me";
import { ageLabel } from "../lib/api";

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
/** "가나다" -> "ㄱㄴㄷ" so typing initial consonants finds a child. */
const initials = (s: string) => [...s].map((ch) => {
  const c = ch.charCodeAt(0) - 0xac00;
  return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
}).join("");
const norm = (s: string) => s.replace(/\s/g, "").toLowerCase();

type Props = {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Label of the "no child" choice; omit to make a child required. */
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  /** "header": the larger top-bar picker with the child's initial and age. */
  variant?: "field" | "header";
};

/** Searchable child picker (name, code, or 초성), used everywhere a child is chosen. */
export default function ChildPicker({ value, onChange, emptyLabel, placeholder = "아동 이름·코드 검색", className, variant = "field", ...rest }: Props) {
  const header = variant === "header";
  const { children } = useChild();
  const [open, setOpen] = useState(false), [q, setQ] = useState(""), [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null);
  const id = useId();
  const selected = children.find((c) => c.id === value) ?? null;

  const me = useMe().data;
  const myName = (me?.therapist_name ?? me?.name ?? "").trim(); // the 치료사 목록 entry linked to this account
  const options = useMemo(() => {
    const k = norm(q);
    const hits = !k ? children : children.filter((c) => {
      const name = norm(c.display_name), code = norm(c.alias);
      return name.includes(k) || code.includes(k) || initials(name).includes(k) || norm((c as any).therapist ?? "").includes(k);
    });
    // My own children first, then grouped by teacher (가나다), children without a teacher last.
    const teacher = (c: (typeof children)[number]) => ((c as any).therapist ?? "").trim();
    const group = (c: (typeof children)[number]) => (myName && teacher(c) === myName ? "내 아동" : teacher(c) || "담당 없음");
    const rank = (g: string) => (g === "내 아동" ? 0 : g === "담당 없음" ? 2 : 1);
    const sorted = [...hits].sort((a, b) => rank(group(a)) - rank(group(b)) || group(a).localeCompare(group(b), "ko")
      || a.display_name.localeCompare(b.display_name, "ko") || a.alias.localeCompare(b.alias));
    const rows: { id: string | null; label: string; sub?: string; group?: string }[] =
      sorted.map((c) => ({ id: c.id, label: c.display_name, sub: c.alias, group: group(c) }));
    return emptyLabel && !k ? [{ id: null, label: emptyLabel }, ...rows] : rows;
  }, [children, q, emptyLabel, myName]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { list.current?.querySelectorAll('[role="option"]')[hi]?.scrollIntoView({ block: "nearest" }); }, [hi]);

  const pick = (v: string | null) => { onChange(v); setOpen(false); setQ(""); };
  const show = () => { setOpen(true); setQ(""); setTimeout(() => input.current?.focus(), 0); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (options[hi]) pick(options[hi].id); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={box} className={clsx("relative", className)}>
      {!open && header ? (
        <button type="button" onClick={show} aria-haspopup="listbox" aria-label={rest["aria-label"] ?? "아동 선택"}
          className={clsx("flex h-11 w-full items-center gap-3 rounded-2xl border border-slate-200 px-2 text-left text-slate-900 sm:px-3", selected ? "bg-indigo-100" : "bg-slate-50 hover:bg-slate-100")}>
          <span className={clsx("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", selected ? "bg-indigo-600 text-slate-50" : "bg-slate-100")}>{selected ? selected.display_name[0] : "–"}</span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="text-[10px] uppercase tracking-[.1em] opacity-60">아동 선택</span>
            <span className="truncate text-sm font-semibold">{selected ? `${selected.alias} ${selected.display_name}` : emptyLabel ?? "선택 안 함"}</span>
          </span>
          {selected && selected.age_months != null && <span className="hidden shrink-0 rounded-full border border-indigo-600 bg-slate-50 px-2.5 py-0.5 text-[11px] text-indigo-600 lg:inline">만 {ageLabel(selected.age_months)}</span>}
          <ChevronDown size={16} className="shrink-0" />
        </button>
      ) : !open ? (
        <button type="button" onClick={show} aria-haspopup="listbox" aria-label={rest["aria-label"] ?? "아동 선택"}
          className="flex min-h-9 w-full items-center gap-2 rounded-[14px] border border-slate-300/80 bg-slate-100/70 px-3 py-1.5 text-left text-sm hover:border-slate-400 focus:outline-none focus-visible:border-indigo-600">
          <span className={clsx("min-w-0 flex-1 truncate", !selected && "text-slate-500")}>
            {selected ? <>{selected.display_name} <span className="text-slate-500">· {selected.alias}</span></> : emptyLabel ?? "아동 선택"}
          </span>
          <ChevronDown size={14} className="shrink-0 text-slate-400" />
        </button>
      ) : (
        <div className={clsx("flex items-center gap-2 border border-indigo-600 bg-white px-3 ring-2 ring-indigo-600/15", header ? "h-11 rounded-2xl" : "min-h-9 rounded-[14px] py-1.5")}>
          <Search size={14} className="shrink-0 text-slate-400" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={key} placeholder={placeholder}
            role="combobox" aria-expanded aria-controls={id} aria-autocomplete="list" aria-label={rest["aria-label"] ?? "아동 검색"}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="text-slate-400 hover:text-slate-700"><X size={14} /></button>
        </div>
      )}
      {open && (
        <ul ref={list} id={id} role="listbox" className={clsx("absolute left-0 z-40 mt-1 overflow-y-auto bg-slate-50 py-1 shadow-md", header ? "max-h-[420px] w-[min(420px,calc(100vw-24px))] rounded-3xl" : "right-0 max-h-72 min-w-56 rounded-2xl border border-slate-200")}>
          {options.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">‘{q}’에 맞는 아동이 없어요</li>}
          {options.map((o, i) => (<Fragment key={o.id ?? "none"}>
            {o.group && o.group !== options[i - 1]?.group && (
              <li role="presentation" className="sticky top-0 bg-slate-100 px-4 pb-1 pt-1.5 text-[11px] font-semibold text-slate-500">{o.group}</li>)}
            <li role="option" aria-selected={o.id === value}
              onMouseDown={(e) => { e.preventDefault(); pick(o.id); }} onMouseEnter={() => setHi(i)}
              className={clsx("flex cursor-pointer items-baseline gap-2 border-b border-slate-200 px-4 text-sm last:border-b-0", header ? "py-2.5" : "py-1.5", i === hi && "bg-slate-100", o.id === value && "bg-indigo-100 font-semibold", o.id === null && "font-semibold")}>
              <span className="truncate">{o.label}</span>{o.sub && <span className="truncate text-xs text-slate-500">{o.sub}</span>}
            </li></Fragment>))}
        </ul>)}
    </div>
  );
}
