import clsx from "clsx";
import { ApiError } from "../lib/api";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// Minimal shadcn/ui-style primitives (hand-written; the shadcn CLI was not run).
export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "danger" | "ghost" }) {
  return <button {...p} className={clsx("inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 active:scale-[.98]",
    { primary: "bg-indigo-600 text-white hover:bg-indigo-700", outline: "border border-slate-300 bg-white hover:bg-slate-50", danger: "bg-red-600 text-white hover:bg-red-700", ghost: "hover:bg-slate-100" }[variant], className)} />;
}
const field = "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx(field, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={clsx(field, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx(field, "min-h-20", p.className)} />;
export const Label = ({ children, label }: { children: ReactNode; label: string }) => (
  <label className="block text-xs font-medium text-slate-600"><span className="mb-1 block">{label}</span>{children}</label>
);
export const Card = ({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={clsx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
    {title && <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2>{action}</header>}
    <div className="p-4">{children}</div>
  </section>
);
export const PageTitle = ({ title, sub }: { title: string; sub?: string }) => (
  <div className="mb-5"><h1 className="text-xl font-bold">{title}</h1>{sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}</div>
);
export const Badge = ({ tone = "slate", children }: { tone?: "slate" | "amber" | "green" | "red" | "indigo"; children: ReactNode }) => (
  <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", { slate: "bg-slate-100 text-slate-700", amber: "bg-amber-100 text-amber-800", green: "bg-green-100 text-green-800", red: "bg-red-100 text-red-800", indigo: "bg-indigo-100 text-indigo-800" }[tone])}>{children}</span>
);
export const Notice = ({ tone = "amber", children }: { tone?: "amber" | "red"; children: ReactNode }) => (
  <div className={clsx("rounded-md border px-3 py-2 text-sm", tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800")}>{children}</div>
);
export const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500">{head.map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{children}</tbody></table></div>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={clsx("px-2 py-2 align-top", className)}>{children}</td>;
export const Empty = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-sm text-slate-400">{children}</p>;
// API error notice; 404 from endpoints the server has not shipped yet shows a soft notice instead.
export const ErrorNotice = ({ error }: { error: unknown }) => !error ? null : error instanceof ApiError && error.status === 404
  ? <Notice>서버가 아직 이 기능을 지원하지 않습니다.</Notice> : <Notice tone="red">{error instanceof Error ? error.message : String(error)}</Notice>;
