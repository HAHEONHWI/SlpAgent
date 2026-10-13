import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useMe } from "../lib/me";
import { errText } from "../lib/hooks";
import { Badge, Button, Card, Empty, Input, Notice, PageTitle, Select, Table, Td } from "../components/ui";

type Signup = { uid: string; email: string | null; org_name: string; therapist_name: string; status: string; reason: string | null; created_at: string; org_id?: string; suggested_org_id?: string | null };
type Org = { org_id: string; name: string; status: string; created_at: string; users: number; children: number; sessions_30d: number; last_activity: string | null; licensed_assessments: string[] };
type Account = { uid: string; email: string | null; name: string | null; org_id: string | null; org_name: string | null; role: string | null; site_admin: boolean; disabled: boolean };
type Preview = { source_name: string; target_name: string; counts: Record<string, number>; preview_token: string };

const TESTS = ["K-SNAP", "ESDM", "EASIC", "K-MB-CDI-I", "K-MB-CDI-T", "REVT", "SELSI", "PRES", "KOSECT", "K-CDI"];
const ROLES: Record<string, string> = { admin: "기관 관리자", therapist: "치료사", assistant: "보조(읽기 전용)" };
const ST: Record<string, [string, any]> = { pending: ["승인 대기", "amber"], approved: ["승인됨", "green"], rejected: ["거절됨", "red"] };
const COL: Record<string, string> = { children: "아동", users: "사용자", assessments: "검사", therapy_sessions: "회기", session_notes: "기록문", behavior_observations: "행동관찰",
  vocabulary_records: "어휘", treatment_plans: "치료계획", parent_consultations: "상담", schedules: "일정", generated_documents: "문서", chat_conversations: "대화",
  chat_messages: "메시지", ai_analyses: "AI 초안", clinical_analyses: "승인 분석", therapy_activities: "활동", knowledge_documents: "자료", audit_logs: "감사로그" };
const dt = (s?: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "-");
const TABS = [["signups", "가입 신청"], ["orgs", "기관"], ["accounts", "계정"]] as const;
type Tab = (typeof TABS)[number][0];

/** Site (platform) admin: signups, organizations (rename/licenses/merge) and accounts. Aggregate counts only. */
export default function Platform() {
  const { label, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("signups");
  const summary = useQuery({ queryKey: ["platform", "summary"], queryFn: () => api<any>("/platform/summary") });
  const orgs = useQuery({ queryKey: ["platform", "orgs"], queryFn: () => api<Org[]>("/platform/organizations") });
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
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm w-fit" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-md px-4 py-1.5 ${tab === k ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}>{l}</button>))}
        </div>
        {tab === "signups" && <Signups orgs={orgs.data ?? []} />}
        {tab === "orgs" && <Orgs orgs={orgs.data ?? []} />}
        {tab === "accounts" && <Accounts orgs={orgs.data ?? []} />}
      </main>
    </div>
  );
}

const useRefresh = () => { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: ["platform"] }); };

function Signups({ orgs }: { orgs: Org[] }) {
  const refresh = useRefresh();
  const [filter, setFilter] = useState<"pending" | "">("pending");
  const [choice, setChoice] = useState<Record<string, { org: string; role: string }>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const signups = useQuery({ queryKey: ["platform", "signups", filter], queryFn: () => api<Signup[]>(`/platform/signups${filter ? `?status=${filter}` : ""}`) });
  const approve = useMutation({
    mutationFn: ({ uid, org, role }: { uid: string; org: string; role: string }) =>
      api(`/platform/signups/${uid}/approve`, { method: "POST", json: org ? { org_id: org, role } : {} }),
    onSuccess: refresh,
  });
  const reject = useMutation({ mutationFn: (uid: string) => api(`/platform/signups/${uid}/reject`, { method: "POST", json: { reason: reason[uid] } }), onSuccess: refresh });
  const pick = (r: Signup) => choice[r.uid] ?? { org: r.suggested_org_id ?? "", role: "therapist" };
  const orgName = (id: string) => { const o = orgs.find((x) => x.org_id === id); return o ? `${o.name} (${id.slice(0, 6)})` : id; };
  return (
    <Card title="가입 신청" action={
      <div className="flex gap-1 text-xs">{([["pending", "승인 대기"], ["", "전체"]] as const).map(([v, l]) => (
        <Button key={v} variant={filter === v ? "primary" : "outline"} onClick={() => setFilter(v)}>{l}</Button>))}</div>}>
      {!signups.data?.length ? <Empty>{filter ? "승인 대기 중인 신청이 없습니다." : "신청이 없습니다."}</Empty> : (
        <Table head={["신청일", "아이디(이메일)", "신청 기관명", "치료사", "상태", "처리"]}>
          {signups.data.map((r) => {
            const c = pick(r);
            return (
              <tr key={r.uid}>
                <Td className="whitespace-nowrap text-xs">{dt(r.created_at)}</Td><Td>{r.email ?? r.uid}</Td><Td className="font-medium">{r.org_name}</Td><Td>{r.therapist_name}</Td>
                <Td><Badge tone={ST[r.status]?.[1]}>{ST[r.status]?.[0] ?? r.status}</Badge>
                  {r.status === "approved" && r.org_id && <p className="mt-1 text-xs text-slate-500">→ {orgName(r.org_id)}</p>}
                  {r.reason && <p className="mt-1 text-xs text-slate-500">사유: {r.reason}</p>}</Td>
                <Td>{r.status === "pending" && (
                  <div className="space-y-1.5">
                    {r.suggested_org_id && <p className="text-xs text-amber-700">같은 이름의 기관 “{orgName(r.suggested_org_id)}”이 이미 있습니다. 합류를 권장합니다.</p>}
                    <div className="flex flex-wrap items-center gap-1">
                      <Select aria-label="승인 방식" className="w-48" value={c.org} onChange={(e) => setChoice({ ...choice, [r.uid]: { ...c, org: e.target.value } })}>
                        <option value="">새 기관으로 만들기 (신청자=관리자)</option>
                        {orgs.map((o) => <option key={o.org_id} value={o.org_id}>기존 기관 합류: {o.name} ({o.org_id.slice(0, 6)}, 사용자 {o.users})</option>)}
                      </Select>
                      {c.org && <Select aria-label="역할" className="w-36" value={c.role} onChange={(e) => setChoice({ ...choice, [r.uid]: { ...c, role: e.target.value } })}>
                        {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
                      <Button onClick={() => approve.mutate({ uid: r.uid, ...c })} disabled={approve.isPending}>승인</Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Input className="w-48" placeholder="거절 사유" value={reason[r.uid] ?? ""} onChange={(e) => setReason({ ...reason, [r.uid]: e.target.value })} />
                      <Button variant="outline" disabled={!reason[r.uid]?.trim() || reject.isPending} onClick={() => reject.mutate(r.uid)}>거절</Button>
                    </div>
                  </div>)}</Td>
              </tr>);
          })}
        </Table>)}
      {(approve.error || reject.error) && <div className="mt-2"><Notice tone="red">{errText(approve.error || reject.error)}</Notice></div>}
    </Card>
  );
}

function Orgs({ orgs }: { orgs: Org[] }) {
  const refresh = useRefresh();
  const [rename, setRename] = useState<{ org: string; name: string } | null>(null);
  const [lic, setLic] = useState<{ org: string; codes: string[] } | null>(null);
  const [merge, setMerge] = useState<{ source: Org; target: string; preview?: Preview; confirm: string } | null>(null);
  const saveName = useMutation({ mutationFn: (r: { org: string; name: string }) => api(`/platform/organizations/${r.org}`, { method: "PUT", json: { name: r.name } }),
    onSuccess: () => { setRename(null); refresh(); } });
  const saveLic = useMutation({ mutationFn: (e: { org: string; codes: string[] }) => api(`/platform/organizations/${e.org}/licenses`, { method: "PUT", json: { codes: e.codes } }),
    onSuccess: () => { setLic(null); refresh(); } });
  const preview = useMutation({ mutationFn: (m: { source: string; target: string }) => api<Preview>(`/platform/organizations/${m.source}/merge-preview`, { method: "POST", json: { target_org_id: m.target } }),
    onSuccess: (p) => setMerge((m) => (m ? { ...m, preview: p } : m)) });
  const apply = useMutation({
    mutationFn: (m: { source: string; target: string; token: string; confirm: string }) =>
      api(`/platform/organizations/${m.source}/merge`, { method: "POST", json: { target_org_id: m.target, preview_token: m.token, confirmation: m.confirm } }),
    onSuccess: () => { setMerge(null); refresh(); },
  });
  const err = saveName.error || saveLic.error || preview.error || apply.error;
  return (
    <div className="space-y-4">
      <Card title={`기관 (${orgs.length})`}>
        {!orgs.length ? <Empty>승인된 기관이 없습니다.</Empty> : (
          <Table head={["기관명", "생성일", "사용자", "아동", "최근 30일 회기", "마지막 활동", "사용 허가 검사", ""]}>
            {orgs.map((o) => (
              <tr key={o.org_id}>
                <Td className="font-medium">{rename?.org === o.org_id ? (
                  <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); saveName.mutate(rename); }}>
                    <Input className="w-40" value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} maxLength={80} required autoFocus />
                    <Button disabled={saveName.isPending}>저장</Button><Button type="button" variant="ghost" onClick={() => setRename(null)}>취소</Button>
                  </form>) : <>{o.name}<p className="font-mono text-[10px] text-slate-400">{o.org_id.slice(0, 8)}</p></>}</Td>
                <Td className="text-xs">{dt(o.created_at)}</Td><Td>{o.users}</Td><Td>{o.children}</Td><Td>{o.sessions_30d}</Td><Td className="text-xs">{dt(o.last_activity)}</Td>
                <Td>{lic?.org === o.org_id ? (
                  <div className="space-y-2">
                    <div className="flex max-w-xs flex-wrap gap-1">{TESTS.map((t) => {
                      const on = lic.codes.includes(t);
                      return <button key={t} type="button" aria-pressed={on} onClick={() => setLic({ ...lic, codes: on ? lic.codes.filter((c) => c !== t) : [...lic.codes, t] })}
                        className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 text-slate-600"}`}>{t}</button>; })}</div>
                    <div className="flex gap-1"><Button onClick={() => saveLic.mutate(lic)} disabled={saveLic.isPending}>저장</Button><Button variant="ghost" onClick={() => setLic(null)}>취소</Button></div>
                  </div>) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {o.licensed_assessments.length ? o.licensed_assessments.map((c) => <Badge key={c} tone="indigo">{c}</Badge>) : <span className="text-xs text-slate-400">없음</span>}
                    <Button variant="ghost" onClick={() => setLic({ org: o.org_id, codes: o.licensed_assessments })}>편집</Button>
                  </div>)}</Td>
                <Td><div className="flex flex-col items-start gap-1">
                  <Button variant="ghost" onClick={() => setRename({ org: o.org_id, name: o.name })}>이름 변경</Button>
                  {orgs.length > 1 && <Button variant="ghost" onClick={() => { preview.reset(); apply.reset(); setMerge({ source: o, target: "", confirm: "" }); }}>다른 기관에 병합</Button>}
                </div></Td>
              </tr>))}
          </Table>)}
        <p className="mt-2 text-xs text-slate-500">사용 허가(라이선스)를 확인한 검사만 지정하세요. 허가된 기관만 해당 검사의 문항과 자료실 원문을 볼 수 있습니다.</p>
      </Card>

      {merge && (
        <Card title={`기관 병합: “${merge.source.name}”을 다른 기관으로`} className="border-amber-300">
          <div className="space-y-3">
            <Notice>병합하면 이 기관의 <b>모든 사용자·아동·기록·문서·대화</b>가 대상 기관으로 옮겨지고, 이 기관은 닫힙니다. <b>되돌릴 수 없습니다.</b> 기관 설정은 대상 기관 것이 유지되고, 사용 허가 검사는 대상 기관 기준입니다.</Notice>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">대상 기관</span>
              <Select aria-label="대상 기관" className="w-64" value={merge.target}
                onChange={(e) => { setMerge({ ...merge, target: e.target.value, preview: undefined, confirm: "" }); if (e.target.value) preview.mutate({ source: merge.source.org_id, target: e.target.value }); }}>
                <option value="">선택</option>
                {orgs.filter((o) => o.org_id !== merge.source.org_id).map((o) => <option key={o.org_id} value={o.org_id}>{o.name} ({o.org_id.slice(0, 8)}, 사용자 {o.users}·아동 {o.children})</option>)}
              </Select>
            </div>
            {preview.isPending && <p className="text-sm text-slate-500">옮길 데이터를 계산하는 중…</p>}
            {merge.preview && (
              <>
                <div className="text-sm">
                  <p className="mb-1 font-medium">옮겨질 데이터</p>
                  {Object.keys(merge.preview.counts).length ? (
                    <div className="flex flex-wrap gap-1">{Object.entries(merge.preview.counts).map(([k, v]) => <Badge key={k}>{COL[k] ?? k} {v}</Badge>)}</div>
                  ) : <p className="text-slate-500">옮길 기록이 없습니다.</p>}
                </div>
                <label className="block text-sm">확인을 위해 원본 기관 ID <code className="rounded bg-slate-100 px-1 font-mono">{merge.source.org_id}</code> 를 입력하세요.
                  <Input className="mt-1 font-mono" value={merge.confirm} onChange={(e) => setMerge({ ...merge, confirm: e.target.value.trim() })} autoComplete="off" spellCheck={false} />
                </label>
                <div className="flex gap-2">
                  <Button variant="danger" disabled={merge.confirm !== merge.source.org_id || apply.isPending}
                    onClick={() => apply.mutate({ source: merge.source.org_id, target: merge.target, token: merge.preview!.preview_token, confirm: merge.confirm })}>
                    {apply.isPending ? "병합 중…" : "병합 실행"}</Button>
                  <Button variant="ghost" onClick={() => setMerge(null)}>취소</Button>
                </div>
              </>)}
          </div>
        </Card>)}
      {err && <Notice tone="red">{errText(err)}</Notice>}
    </div>
  );
}

function Accounts({ orgs }: { orgs: Org[] }) {
  const refresh = useRefresh();
  const myUid = useMe().data?.uid;
  const accounts = useQuery({ queryKey: ["platform", "accounts"], queryFn: () => api<Account[]>("/platform/accounts") });
  const [edit, setEdit] = useState<Record<string, { org: string; role: string }>>({});
  const [q, setQ] = useState("");
  const save = useMutation({
    mutationFn: ({ uid, org, role }: { uid: string; org: string; role: string }) =>
      api(`/platform/accounts/${uid}/access`, { method: "PUT", json: org ? { org_id: org, role } : { org_id: null, role: null } }),
    onSuccess: (_, v) => { setEdit(({ [v.uid]: _drop, ...rest }) => rest); refresh(); },
  });
  const status = useMutation({ mutationFn: ({ uid, disabled }: { uid: string; disabled: boolean }) => api(`/platform/accounts/${uid}/status`, { method: "PUT", json: { disabled } }), onSuccess: refresh });
  const rows = (accounts.data ?? []).filter((a) => !q || `${a.email} ${a.name} ${a.org_name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card title={`계정 (${accounts.data?.length ?? 0})`} action={<Input className="w-56" placeholder="이메일·이름·기관 검색" value={q} onChange={(e) => setQ(e.target.value)} />}>
      {accounts.isLoading ? <p className="text-sm text-slate-400">불러오는 중…</p> : !rows.length ? <Empty>계정이 없습니다.</Empty> : (
        <Table head={["계정", "소속 기관", "역할", "상태", ""]}>
          {rows.map((a) => {
            const e = edit[a.uid] ?? { org: a.org_id ?? "", role: a.role ?? "therapist" };
            const dirty = !!edit[a.uid] && (e.org !== (a.org_id ?? "") || (!!e.org && e.role !== a.role));
            const self = a.uid === myUid; // the server also refuses self-suspension
            return (
              <tr key={a.uid} className={a.disabled ? "opacity-60" : ""}>
                <Td><p className="font-medium">{a.email ?? a.uid}</p>{a.name && <p className="text-xs text-slate-500">{a.name}</p>}</Td>
                {a.site_admin ? <><Td><Badge tone="indigo">사이트 관리자</Badge></Td><Td>–</Td></> : <>
                  <Td><Select aria-label="소속 기관" className="w-44" value={e.org} onChange={(ev) => setEdit({ ...edit, [a.uid]: { ...e, org: ev.target.value } })}>
                    <option value="">소속 없음 (사용 불가)</option>
                    {orgs.map((o) => <option key={o.org_id} value={o.org_id}>{o.name} ({o.org_id.slice(0, 6)})</option>)}
                  </Select></Td>
                  <Td><Select aria-label="역할" className="w-36" disabled={!e.org} value={e.role} onChange={(ev) => setEdit({ ...edit, [a.uid]: { ...e, role: ev.target.value } })}>
                    {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Td></>}
                <Td>{a.disabled ? <Badge tone="red">정지됨</Badge> : <Badge tone="green">사용 중</Badge>}</Td>
                <Td><div className="flex flex-wrap gap-1">
                  {!a.site_admin && dirty && <Button onClick={() => save.mutate({ uid: a.uid, ...e })} disabled={save.isPending}>저장</Button>}
                  {!self && (a.disabled
                    ? <Button variant="outline" onClick={() => status.mutate({ uid: a.uid, disabled: false })}>재개</Button>
                    : <Button variant="ghost" onClick={() => status.mutate({ uid: a.uid, disabled: true })}>정지</Button>)}
                </div></Td>
              </tr>);
          })}
        </Table>)}
      {(save.error || status.error) && <div className="mt-2"><Notice tone="red">{errText(save.error || status.error)}</Notice></div>}
      <p className="mt-2 text-xs text-slate-500">역할·소속 변경과 정지는 다음 요청부터 바로 적용됩니다. 기관의 마지막 관리자는 다른 역할로 바꿀 수 없습니다.</p>
    </Card>
  );
}
