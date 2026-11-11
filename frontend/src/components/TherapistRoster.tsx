import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { useMe } from "../lib/me";
import { Badge, Button, Card, Empty, Input, Notice, Select } from "./ui";

type Row = { id?: string; name: string; uid: string | null; email?: string | null; code_prefix?: string | null };
type Member = { uid: string; email: string | null; name: string | null; role: string | null };
type Roster = { therapists: Row[]; suggestions: string[]; members?: Member[] };
const ROLE: Record<string, string> = { admin: "관리자", therapist: "치료사", assistant: "보조" };
const CODE_PREFIXES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** 기관 설정 › 치료사 목록: the names used for 담당 치료사 and the timetable, each linked to a sign-in account. */
export default function TherapistRoster() {
  const qc = useQueryClient();
  const isAdmin = useMe().data?.role === "admin";
  const q = useQuery({ queryKey: ["org", "roster"], queryFn: () => api<Roster>("/org/roster") });
  const [rows, setRows] = useState<Row[]>([]), [dirty, setDirty] = useState(false);
  useEffect(() => { if (q.data && !dirty) setRows(q.data.therapists); }, [q.data, dirty]);
  const save = useMutation({
    mutationFn: () => api<Roster>("/org/roster", { method: "PUT", json: { therapists: rows.map(({ id, name, uid, code_prefix }) => ({ id, name: name.trim(), uid, code_prefix })) } }),
    onSuccess: (r) => { setRows(r.therapists); setDirty(false); qc.setQueryData(["org", "roster"], r);
      ["children", "me", "timetable"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); qc.invalidateQueries({ queryKey: ["org", "therapists"] }); },
  });
  const set = (next: Row[]) => { setRows(next); setDirty(true); };
  const members = q.data?.members ?? [];
  const taken = new Set(rows.map((r) => r.uid).filter(Boolean));
  const usedPrefixes = new Set(rows.map((r) => r.code_prefix).filter(Boolean));
  const label = (m: Member) => `${m.name ?? "(이름 없음)"} · ${m.email ?? m.uid}${m.role ? ` · ${ROLE[m.role] ?? m.role}` : ""}`;

  return (
    <Card title="치료사 목록" className="mt-4 max-w-3xl">
      <p className="mb-3 text-sm text-slate-600">아동의 담당 치료사와 주간 시간표 교사 이름은 이 목록에서 고릅니다. 아이 코드 알파벳을 지정하면 A-01~A-99 형식으로 자동 입력돼요. 계정을 연결하면 그 치료사가 로그인했을 때 맨 위 아동 선택에 ‘내 아동’이 먼저 보여요. 이름을 바꾸면 아동 담당과 시간표 이름도 함께 바뀝니다. 아동에게 배정된 치료사는 자동으로 이 목록에 들어와요.</p>
      {q.isLoading ? <p className="text-sm text-slate-400">불러오는 중…</p> : (
        <div className="space-y-2">
          {!rows.length && <Empty>아직 치료사 목록이 없어요.</Empty>}
          {!rows.length && isAdmin && !!q.data?.suggestions.length && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
              <span className="text-slate-600">지금 쓰이는 이름: {q.data.suggestions.join(", ")}</span>
              <Button variant="outline" onClick={() => set(q.data!.suggestions.map((name) => ({ name, uid: members.find((m) => m.name === name)?.uid ?? null })))}>이 이름들로 시작</Button>
            </div>)}
          {rows.map((r, i) => (
            <div key={r.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2">
              <div className="w-36 shrink-0"><Input value={r.name} maxLength={20} placeholder="치료사 이름" disabled={!isAdmin} aria-label="치료사 이름"
                onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></div>
              <div className="w-28 shrink-0"><Select value={r.code_prefix ?? ""} disabled={!isAdmin} aria-label={`${r.name} 아이 코드 알파벳`}
                onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, code_prefix: e.target.value || null } : x)))}>
                <option value="">코드 미지정</option>{CODE_PREFIXES.map((prefix) => <option key={prefix} value={prefix} disabled={usedPrefixes.has(prefix) && r.code_prefix !== prefix}>{prefix}</option>)}
              </Select></div>
              {isAdmin ? (
                <div className="min-w-56 flex-1"><Select value={r.uid ?? ""} aria-label={`${r.name} 계정`} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, uid: e.target.value || null } : x)))}>
                  <option value="">계정 연결 안 함</option>
                  {members.filter((m) => m.uid === r.uid || !taken.has(m.uid)).map((m) => <option key={m.uid} value={m.uid}>{label(m)}</option>)}
                </Select></div>
              ) : <span className="text-sm text-slate-500">{r.email ? r.email : "계정 없음"}</span>}
              {r.uid ? <Badge tone="green">계정 연결됨</Badge> : <Badge>계정 없음</Badge>}
              {isAdmin && <button className="rounded p-1.5 text-red-600 hover:bg-red-50" aria-label={`${r.name} 삭제`} onClick={() => set(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
            </div>))}
          {isAdmin && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="ghost" onClick={() => set([...rows, { name: "", uid: null }])} disabled={rows.length >= 50}><Plus size={14} />치료사 추가</Button>
              <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending || rows.some((r) => !r.name.trim())}>{save.isPending ? "저장 중…" : "저장"}</Button>
              {dirty && <Button variant="ghost" onClick={() => { setDirty(false); setRows(q.data?.therapists ?? []); }}>되돌리기</Button>}
            </div>)}
          {save.isSuccess && !dirty && <p className="text-sm text-green-700">저장되었습니다.</p>}
          {(save.error || q.error) && <Notice tone="red">{errText(save.error || q.error)}</Notice>}
          {isAdmin && !members.some((m) => m.role === "therapist" || m.role === "admin") && <p className="text-xs text-slate-500">연결할 계정은 이 기관으로 가입·승인된 계정만 보여요.</p>}
        </div>)}
    </Card>
  );
}
