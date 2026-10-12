import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errText } from "../lib/hooks";
import { Badge, Button, Card, Empty, Input, Notice, PageTitle, Table, Td } from "../components/ui";

type Signup = { uid: string; email: string | null; org_name: string; therapist_name: string; status: string; reason: string | null; created_at: string; org_id?: string };
type Org = { org_id: string; name: string; status: string; created_at: string; users: number; children: number; sessions_30d: number; last_activity: string | null; licensed_assessments: string[] };
const TESTS = ["K-SNAP", "ESDM", "EASIC", "K-MB-CDI-I", "K-MB-CDI-T", "REVT", "SELSI", "PRES", "KOSECT", "K-CDI"];
const dt = (s?: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "-");
const ST: Record<string, [string, any]> = { pending: ["승인 대기", "amber"], approved: ["승인됨", "green"], rejected: ["거절됨", "red"] };

/** Site (platform) admin dashboard: signup approval and organization overview. Aggregate counts only. */
export default function Platform() {
  const { label, logout } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "">("pending");
  const [reason, setReason] = useState<Record<string, string>>({});
  const summary = useQuery({ queryKey: ["platform", "summary"], queryFn: () => api<any>("/platform/summary") });
  const signups = useQuery({ queryKey: ["platform", "signups", filter], queryFn: () => api<Signup[]>(`/platform/signups${filter ? `?status=${filter}` : ""}`) });
  const orgs = useQuery({ queryKey: ["platform", "orgs"], queryFn: () => api<Org[]>("/platform/organizations") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform"] });
  const approve = useMutation({ mutationFn: (uid: string) => api(`/platform/signups/${uid}/approve`, { method: "POST" }), onSuccess: refresh });
  const [editing, setEditing] = useState<{ org: string; codes: string[] } | null>(null);
  const saveLic = useMutation({ mutationFn: (e: { org: string; codes: string[] }) => api(`/platform/organizations/${e.org}/licenses`, { method: "PUT", json: { codes: e.codes } }),
    onSuccess: () => { setEditing(null); refresh(); } });
  const reject = useMutation({ mutationFn: (uid: string) => api(`/platform/signups/${uid}/reject`, { method: "POST", json: { reason: reason[uid] } }), onSuccess: refresh });
  const s = summary.data;
  const kpi = (k: string, v: any) => <Card key={k}><p className="text-xs text-slate-500">{k}</p><p className="mt-1 text-2xl font-bold">{v ?? "–"}</p></Card>;

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <ShieldCheck size={18} className="text-indigo-600" /><span className="font-bold text-indigo-700">SLP Agent 사이트 관리</span>
        <span className="ml-auto text-sm text-slate-500">{label}</span><Button variant="ghost" onClick={logout}>로그아웃</Button>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <PageTitle title="전체 관리자 대시보드" sub="기관별 집계만 표시합니다. 아동 개인정보와 치료 기록은 사이트 관리자에게 보이지 않습니다." />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {[["승인 대기", s?.pending_signups], ["기관", s?.organizations], ["사용자", s?.users], ["아동", s?.children], ["최근 30일 회기", s?.sessions_30d], ["최근 30일 가입 신청", s?.signups_30d]].map(([k, v]) => kpi(k as string, v))}
        </div>

        <Card title="가입 신청" action={
          <div className="flex gap-1 text-xs">{([["pending", "승인 대기"], ["", "전체"]] as const).map(([v, l]) => (
            <Button key={v} variant={filter === v ? "primary" : "outline"} onClick={() => setFilter(v)}>{l}</Button>))}</div>}>
          {!signups.data?.length ? <Empty>{filter ? "승인 대기 중인 신청이 없습니다." : "신청이 없습니다."}</Empty> : (
            <Table head={["신청일", "아이디(이메일)", "기관명", "치료사", "상태", "처리"]}>
              {signups.data.map((r) => (
                <tr key={r.uid}>
                  <Td className="whitespace-nowrap text-xs">{dt(r.created_at)}</Td><Td>{r.email ?? r.uid}</Td><Td className="font-medium">{r.org_name}</Td><Td>{r.therapist_name}</Td>
                  <Td><Badge tone={ST[r.status]?.[1]}>{ST[r.status]?.[0] ?? r.status}</Badge>{r.reason && <p className="mt-1 text-xs text-slate-500">사유: {r.reason}</p>}</Td>
                  <Td>{r.status === "pending" && (
                    <div className="flex flex-wrap items-center gap-1">
                      <Button onClick={() => approve.mutate(r.uid)} disabled={approve.isPending}>승인</Button>
                      <Input className="w-36" placeholder="거절 사유" value={reason[r.uid] ?? ""} onChange={(e) => setReason({ ...reason, [r.uid]: e.target.value })} />
                      <Button variant="outline" disabled={!reason[r.uid]?.trim() || reject.isPending} onClick={() => reject.mutate(r.uid)}>거절</Button>
                    </div>)}</Td>
                </tr>))}
            </Table>)}
          {(approve.error || reject.error) && <div className="mt-2"><Notice tone="red">{errText(approve.error || reject.error)}</Notice></div>}
          <p className="mt-2 text-xs text-slate-500">승인하면 신청한 기관이 새로 만들어지고, 신청자는 그 기관의 관리자 겸 치료사가 됩니다.</p>
        </Card>

        <Card title={`기관 (${orgs.data?.length ?? 0})`}>
          {!orgs.data?.length ? <Empty>승인된 기관이 없습니다.</Empty> : (
            <Table head={["기관명", "생성일", "사용자", "아동", "최근 30일 회기", "마지막 활동", "상태", "사용 허가 검사"]}>
              {orgs.data.map((o) => (
                <tr key={o.org_id}><Td className="font-medium">{o.name}</Td><Td className="text-xs">{dt(o.created_at)}</Td><Td>{o.users}</Td><Td>{o.children}</Td><Td>{o.sessions_30d}</Td>
                  <Td className="text-xs">{dt(o.last_activity)}</Td><Td><Badge tone={o.status === "active" ? "green" : "slate"}>{o.status === "active" ? "사용 중" : o.status}</Badge></Td>
                  <Td>{editing?.org === o.org_id ? (
                    <div className="space-y-2">
                      <div className="flex max-w-xs flex-wrap gap-1">{TESTS.map((t) => {
                        const on = editing.codes.includes(t);
                        return <button key={t} type="button" onClick={() => setEditing({ ...editing, codes: on ? editing.codes.filter((c) => c !== t) : [...editing.codes, t] })}
                          className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 text-slate-600"}`}>{t}</button>; })}</div>
                      <div className="flex gap-1"><Button onClick={() => saveLic.mutate(editing)} disabled={saveLic.isPending}>저장</Button><Button variant="ghost" onClick={() => setEditing(null)}>취소</Button></div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1">
                      {o.licensed_assessments.length ? o.licensed_assessments.map((c) => <Badge key={c} tone="indigo">{c}</Badge>) : <span className="text-xs text-slate-400">없음</span>}
                      <Button variant="ghost" onClick={() => setEditing({ org: o.org_id, codes: o.licensed_assessments })}>편집</Button>
                    </div>)}</Td></tr>))}
            </Table>)}
          {saveLic.error && <div className="mt-2"><Notice tone="red">{errText(saveLic.error)}</Notice></div>}
          <p className="mt-2 text-xs text-slate-500">사용 허가(라이선스)를 확인한 검사만 지정하세요. 허가된 기관만 해당 검사의 문항과 자료실 원문을 볼 수 있습니다.</p>
        </Card>
      </main>
    </div>
  );
}
