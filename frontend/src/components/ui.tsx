import clsx from "clsx";
import { useLocation } from "react-router-dom";
import { ApiError, ageLabel } from "../lib/api";
import { useChild } from "../lib/child";
import { findMenu } from "../lib/menu";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// Hand-written primitives styled after the Claude Design "SLP Agent" system: warm paper ground,
// pill buttons, 24px cards on a soft shadow, flush-left labels.
export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "danger" | "ghost" }) {
  return <button {...p} className={clsx("inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold leading-5 transition-colors disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
    { primary: "bg-indigo-600 text-slate-50 hover:bg-indigo-700 active:bg-indigo-800",
      outline: "border border-slate-300 bg-transparent text-slate-900 hover:bg-slate-900/[.06] active:bg-slate-900/[.12]",
      danger: "bg-red-600 text-white hover:bg-red-700",
      ghost: "text-slate-800 hover:bg-slate-100 active:bg-slate-200" }[variant], className)} />;
}
const field = "w-full min-h-9 rounded-[14px] border border-slate-300/80 bg-slate-100/70 px-3 py-1.5 text-sm text-slate-900 caret-indigo-600 transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600/15 disabled:opacity-60";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx(field, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={clsx(field, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx(field, "min-h-20", p.className)} />;
export const Label = ({ children, label }: { children: ReactNode; label: string }) => (
  <label className="block text-xs text-slate-600"><span className="mb-1.5 block">{label}</span>{children}</label>
);
export const Card = ({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) => (
  // min-w-0: a wide table inside scrolls within the card instead of widening the page on phones
  <section className={clsx("min-w-0 overflow-hidden rounded-3xl bg-white shadow-sm print:shadow-none", className)}>
    {title && <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5"><h2 className="text-[17px] font-semibold leading-tight">{title}</h2>{action}</header>}
    <div className="p-5">{children}</div>
  </section>
);
/** Page header: the menu group as a kicker, the title, and the selected child on child-scoped screens. */
export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  const { pathname } = useLocation();
  const { child } = useChild();
  const m = findMenu(pathname);
  const kicker = pathname === "/" ? "SLP AI" : m?.group.title ?? (pathname === "/account" ? "계정" : "");
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
      <div className="min-w-0">
        {kicker && <div className="text-[11px] font-semibold uppercase tracking-[.1em] text-indigo-700">{kicker}</div>}
        <h1 className="mt-1.5 text-[28px] font-semibold leading-[1.12] md:text-[38px]">{title}</h1>
        {sub && <p className="mt-2 max-w-3xl text-sm text-slate-500 [word-break:keep-all]">{sub}</p>}
      </div>
      {m?.item.child && child && (
        <div className="flex items-center gap-2.5 rounded-full bg-indigo-100 px-3.5 py-2 text-[13px]">
          <span className="font-semibold">{child.alias}</span><span>{child.display_name}</span><span className="text-slate-500">{ageLabel(child.age_months)}</span>
        </div>)}
    </div>
  );
}
export const Badge = ({ tone = "slate", children }: { tone?: "slate" | "amber" | "green" | "red" | "indigo"; children: ReactNode }) => (
  <span className={clsx("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-[.02em]", { slate: "bg-slate-200/70 text-slate-800", amber: "bg-amber-100 text-amber-800", green: "bg-green-100 text-green-800", red: "bg-red-100 text-red-800", indigo: "bg-indigo-100 text-indigo-800" }[tone])}>{children}</span>
);
export const Notice = ({ tone = "amber", children }: { tone?: "amber" | "red"; children: ReactNode }) => (
  <div className={clsx("rounded-xl px-4 py-3 text-sm", tone === "amber" ? "bg-indigo-100/70 text-slate-900" : "bg-red-50 text-red-800")}>{children}</div>
);
export const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-300 text-left text-[11px] tracking-[.08em] text-slate-500">{head.map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-200 [&>tr:hover]:bg-slate-900/[.03]">{children}</tbody></table></div>
);
// Cells don't wrap (narrow screens scroll the table sideways instead of breaking words letter by letter);
// `wrap` is for free-text cells such as reasons.
export const Td = ({ children, className, wrap }: { children?: ReactNode; className?: string; wrap?: boolean }) =>
  <td className={clsx("px-2 py-2.5 align-top", wrap ? "min-w-48 [word-break:keep-all]" : "whitespace-nowrap", className)}>{children}</td>;
export const Empty = ({ children }: { children: ReactNode }) => <p className="py-8 text-center text-sm text-slate-400">{children}</p>;
// API error notice; 404 from endpoints the server has not shipped yet shows a soft notice instead.
export const ErrorNotice = ({ error }: { error: unknown }) => !error ? null : error instanceof ApiError && error.status === 404
  ? <Notice>서버가 아직 이 기능을 지원하지 않습니다.</Notice> : <Notice tone="red">{error instanceof Error ? error.message : String(error)}</Notice>;
