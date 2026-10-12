import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, Empty, Table, Td } from "../ui";

export type VocabRecord = {
  id: string; word: string; modality: "receptive" | "expressive"; status: string; observed_on: string;
  created_at?: string; source?: string | null; category?: string | null; target?: boolean;
};

export const STATUS: Record<string, string> = { not_observed: "미관찰", emerging: "출현 중", with_prompt: "촉진 시 가능", independent: "독립 사용" };
export const MOD: Record<string, string> = { receptive: "수용", expressive: "표현" };
const SERIES = [
  { key: "emerging", color: "#f59e0b" },
  { key: "with_prompt", color: "#6366f1" },
  { key: "independent", color: "#16a34a" },
] as const;
const TONE: Record<string, "slate" | "amber" | "indigo" | "green"> = { not_observed: "slate", emerging: "amber", with_prompt: "indigo", independent: "green" };

// Chronological order of recorded observations; same-day ties fall back to creation time, then input order.
function chrono(rows: VocabRecord[]) {
  return rows.map((r, i) => ({ r, i })).sort((a, b) =>
    a.r.observed_on.localeCompare(b.r.observed_on) || (a.r.created_at ?? "").localeCompare(b.r.created_at ?? "") || a.i - b.i).map((x) => x.r);
}

// For each observation date, count distinct words by their latest recorded status as of that date.
// Pure tallying of recorded rows; no estimation or interpolation.
function series(rows: VocabRecord[]) {
  const sorted = chrono(rows);
  const dates = [...new Set(sorted.map((r) => r.observed_on))];
  const latest = new Map<string, string>();
  let k = 0;
  return dates.map((d) => {
    while (k < sorted.length && sorted[k].observed_on <= d) { latest.set(sorted[k].word.trim(), sorted[k].status); k++; }
    const point: Record<string, string | number> = { date: d };
    for (const s of SERIES) point[STATUS[s.key]] = 0;
    for (const st of latest.values()) if (st in STATUS && st !== "not_observed") point[STATUS[st]] = (point[STATUS[st]] as number) + 1;
    return point;
  });
}

function ModalityChart({ modality, rows }: { modality: string; rows: VocabRecord[] }) {
  const data = series(rows.filter((r) => r.modality === modality));
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-700">{MOD[modality]}어휘</p>
      {data.length < 2 ? <Empty>관찰일이 2개 이상 기록되면 변화 그래프가 표시됩니다.</Empty> : (
        <div className="h-64"><ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" fontSize={11} />
            <YAxis allowDecimals={false} fontSize={11} />
            <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
            {SERIES.map((s) => <Area key={s.key} type="stepAfter" stackId="1" dataKey={STATUS[s.key]} stroke={s.color} fill={s.color} fillOpacity={0.35} isAnimationActive={false} />)}
          </AreaChart>
        </ResponsiveContainer></div>)}
    </div>
  );
}

export function VocabChangeChart({ rows }: { rows: VocabRecord[] }) {
  return (
    <Card title="어휘 습득 변화 (누적 어휘 수)">
      <p className="mb-3 text-xs text-slate-500">각 관찰일 기준, 그때까지 기록된 어휘별 최신 상태로 서로 다른 어휘 수를 셉니다. 기록된 관찰만 사용하며 미관찰 상태는 제외합니다.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <ModalityChart modality="receptive" rows={rows} />
        <ModalityChart modality="expressive" rows={rows} />
      </div>
    </Card>
  );
}

export function WordHistory({ word, modality, rows, onClose }: { word: string; modality: string; rows: VocabRecord[]; onClose: () => void }) {
  const hist = chrono(rows.filter((r) => r.word.trim() === word.trim() && r.modality === modality));
  return (
    <Card title={`'${word}' 상태 변화 · ${MOD[modality] ?? modality}`} action={<Button type="button" variant="ghost" onClick={onClose}>닫기</Button>}>
      {!hist.length ? <Empty>기록이 없습니다.</Empty> : (
        <Table head={["관찰일", "상태", "출처"]}>
          {hist.map((r) => <tr key={r.id}><Td>{r.observed_on}</Td><Td><Badge tone={TONE[r.status] ?? "slate"}>{STATUS[r.status] ?? r.status}</Badge></Td><Td>{r.source ?? "-"}</Td></tr>)}
        </Table>)}
    </Card>
  );
}
