import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { useMe } from "../lib/me";
import { Button, Card, Empty, Notice } from "./ui";

type Member = { uid: string; email: string | null; name: string | null; role: string | null };
const ROLE: Record<string, string> = { therapist: "치료사", assistant: "보조" };

/** 기관 설정 › 회계 담당 (admins only): besides admins, only the accounts picked here see 정산. */
export default function Accountants() {
  const isAdmin = useMe().data?.role === "admin";
  if (!isAdmin) return null;
  return <Picker />;
}

function Picker() {
  const qc = useQueryClient();
  const roster = useQuery({ queryKey: ["org", "roster"], queryFn: () => api<{ members?: Member[] }>("/org/roster") });
  const current = useQuery({ queryKey: ["org", "accountants"], queryFn: () => api<{ accountants: string[] }>("/org/accountants") });
  const [picked, setPicked] = useState<string[]>([]), [dirty, setDirty] = useState(false);
  useEffect(() => { if (current.data && !dirty) setPicked(current.data.accountants); }, [current.data, dirty]);
  const save = useMutation({
    mutationFn: () => api<{ accountants: string[] }>("/org/accountants", { method: "PUT", json: { accountants: picked } }),
    onSuccess: (r) => { setPicked(r.accountants); setDirty(false); qc.setQueryData(["org", "accountants"], r); qc.invalidateQueries({ queryKey: ["me"] }); },
  });
  const members = (roster.data?.members ?? []).filter((m) => m.role !== "admin");  // admins always see 정산
  const toggle = (uid: string) => { setPicked(picked.includes(uid) ? picked.filter((u) => u !== uid) : [...picked, uid]); setDirty(true); };
  return (
    <Card title="회계 담당" className="mt-4 max-w-3xl">
      <p className="mb-3 text-sm text-slate-600">정산 메뉴는 기관 관리자와 여기서 고른 회계 담당만 볼 수 있어요. 회계 담당은 모든 아동의 정산을 봅니다.</p>
      {!members.length ? <Empty>관리자 외 계정이 없습니다.</Empty> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {members.map((m) => (
            <li key={m.uid}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={picked.includes(m.uid)} onChange={() => toggle(m.uid)} />
                <span className="font-medium">{m.name ?? "(이름 없음)"}</span>
                <span className="truncate text-slate-500">{m.email ?? m.uid}</span>
                {m.role && <span className="ml-auto shrink-0 text-xs text-slate-400">{ROLE[m.role] ?? m.role}</span>}
              </label>
            </li>))}
        </ul>)}
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>저장</Button>
        {save.isSuccess && !dirty && <span className="text-sm text-green-700">저장되었습니다.</span>}
      </div>
      {(save.error || current.error) && <div className="mt-2"><Notice tone="red">{errText(save.error || current.error)}</Notice></div>}
    </Card>
  );
}
