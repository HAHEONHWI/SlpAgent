import clsx from "clsx";
import { Badge, Empty, Input, Notice } from "../ui";

// Item-bank entry shape served by GET /assessment-definitions/{code}/items.
// Item text is licensed content: render it only inside the authenticated app.
export type BankItem = {
  item_id: string;
  source_item_number?: string | null;
  domain?: string | null;
  age_range?: string | null;
  prompt?: string | null;
  response_options?: unknown[];
  source?: { file?: string; page?: number } | null;
  needs_review?: boolean;
};

const SECTION: Record<string, string> = { pre: "언어이전", receptive: "수용언어", expressive: "표현언어" };

const optLabel = (o: unknown) =>
  typeof o === "string" || typeof o === "number" ? String(o)
    : o && typeof o === "object" && "label" in o ? String((o as { label: unknown }).label)
    : JSON.stringify(o);
const optValue = (o: unknown) =>
  o && typeof o === "object" && "value" in o ? String((o as { value: unknown }).value) : optLabel(o);

export function ItemChecklist({ items, responses, onChange }: {
  items: BankItem[];
  responses: Record<string, string>;
  onChange: (itemId: string, value: string) => void;
}) {
  if (!items.length) return <Empty>적재된 문항이 없습니다.</Empty>;
  // Group by section (receptive/expressive, from the item_id prefix), domain, then age_range, keeping bank order.
  // Without the section, receptive and expressive items of the same domain/age mix and their numbers collide.
  const groups: { key: string; section: string | null; domain: string; age: string | null; items: BankItem[] }[] = [];
  for (const it of items) {
    const domain = it.domain || "영역 미지정", age = it.age_range || null;
    const prefix = it.item_id.split("-")[0];
    const section = prefix === domain ? null : SECTION[prefix] ?? prefix;
    const key = `${section ?? ""}\u0000${domain}\u0000${age ?? ""}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, section, domain, age, items: [] }));
    g.items.push(it);
  }
  const answered = items.filter((i) => (responses[i.item_id] ?? "") !== "").length;
  return (
    <div className="space-y-3">
      <Notice>
        문항은 원 기록지와 대조한 사람 검수가 끝나지 않았습니다(검수 대기). 응답은 기록용이며, 공식 규준표가 없어 총점·표준점수·백분위·발달연령은 산출되지 않습니다.
      </Notice>
      <p className="text-xs text-slate-500">응답한 문항 {answered} / {items.length} (응답한 문항만 저장됩니다)</p>
      <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
        {groups.map((g) => (
          <div key={g.key} className="rounded-md border border-slate-200">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-700">
              {g.section && <Badge tone="indigo">{g.section}</Badge>}<span>{g.domain}</span>{g.age && <Badge>{g.age}</Badge>}
            </div>
            <ul className="divide-y divide-slate-100">
              {g.items.map((it) => {
                const val = responses[it.item_id] ?? "";
                const opts = it.response_options ?? [];
                return (
                  <li key={it.item_id} className="space-y-1.5 px-2 py-2">
                    <div className="flex items-start gap-2 text-sm">
                      <span className="shrink-0 font-mono text-xs text-slate-500">{it.source_item_number ?? it.item_id}</span>
                      <span className="flex-1">{it.prompt}</span>
                      {it.needs_review && <Badge tone="amber">검수 필요</Badge>}
                    </div>
                    {opts.length ? (
                      <div className="flex flex-wrap gap-1" role="radiogroup">
                        {opts.map((o, k) => {
                          const v = optValue(o), on = val === v;
                          return (
                            <button key={k} type="button" role="radio" aria-checked={on}
                              onClick={() => onChange(it.item_id, on ? "" : v)}
                              className={clsx("rounded-md border px-2 py-0.5 text-xs", on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white hover:bg-slate-50")}>
                              {optLabel(o)}
                            </button>);
                        })}
                      </div>
                    ) : (
                      <Input className="h-7 max-w-40 py-0.5 text-xs" placeholder="응답/점수" value={val} onChange={(e) => onChange(it.item_id, e.target.value)} />
                    )}
                  </li>);
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ItemResponses({ items }: { items: { item_id: string; response?: unknown; note?: string | null }[] }) {
  if (!items?.length) return <p className="text-xs text-slate-400">저장된 문항 응답이 없습니다.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i, k) => (
        <span key={`${i.item_id}-${k}`} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs">
          <span className="font-mono text-slate-500">{i.item_id}</span> → {i.response == null || i.response === "" ? "-" : typeof i.response === "object" ? JSON.stringify(i.response) : String(i.response)}
          {i.note && <span className="text-slate-400"> ({i.note})</span>}
        </span>))}
    </div>
  );
}
