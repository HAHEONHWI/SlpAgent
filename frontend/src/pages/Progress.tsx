import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useRecords } from "../lib/hooks";
import RequireChild from "../components/RequireChild";
import { Card, Empty, Notice, PageTitle } from "../components/ui";

const COLORS = ["#c85a36", "#4f7a5a", "#c49a3a", "#5b7a99", "#8e5a7a", "#6b5c50"];

function Inner({ childId }: { childId: string }) {
  const list = useRecords<any>(childId, "sessions");
  const sessions = (list.data ?? []).filter((s) => s.status === "completed");
  const names = [...new Set(sessions.flatMap((s) => s.activities.map((a: any) => a.name)))] as string[];
  const data = sessions.map((s) => {
    const row: Record<string, any> = { date: s.date };
    s.activity_accuracy.forEach((a: any) => { if (a.accuracy_pct != null) row[a.name] = a.accuracy_pct; });
    return row;
  });
  return (
    <>
      <div className="mb-4"><Notice>회기별 활동 정반응률(정반응÷전체 시행)입니다. 표준화 검사 점수와 직접 합산·비교하지 않습니다.</Notice></div>
      <Card title="활동별 정반응률 추이 (%)">
        {data.length < 1 ? <Empty>완료된 회기 기록이 없습니다.</Empty> : (
          <div className="h-80"><ResponsiveContainer><LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} /><Tooltip /><Legend />
            {names.map((n, i) => <Line key={n} type="monotone" dataKey={n} stroke={COLORS[i % COLORS.length]} connectNulls dot />)}</LineChart></ResponsiveContainer></div>)}
      </Card>
    </>
  );
}
export default function Progress() { return <><PageTitle title="발달 진행도 분석" /><RequireChild>{(id) => <Inner childId={id} />}</RequireChild></>; }
