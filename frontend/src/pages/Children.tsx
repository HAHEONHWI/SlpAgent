import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, RotateCcw, Trash2 } from "lucide-react";
import ChildImport from "../components/ChildImport";
import { ageLabel, api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import { useMe } from "../lib/me";
import { Button, Card, Empty, Input, Label, Notice, PageTitle, Select, Table, Td } from "../components/ui";

export default function Children() {
  const { children, setChildId, childId } = useChild();
  const qc = useQueryClient();
  const role = useMe().data?.role, canWrite = role === "admin" || role === "therapist";
  const [importing, setImporting] = useState(false);
  const therapists = useQuery({ queryKey: ["org", "therapists"], queryFn: () => api<string[]>("/org/therapists") }).data ?? [];
  const sorted = [...children].sort((a, b) => a.alias.localeCompare(b.alias, "ko", { numeric: true }) || a.display_name.localeCompare(b.display_name, "ko"));
  const assign = useMutation({
    mutationFn: ({ id, therapist }: { id: string; therapist: string | null }) => api(`/children/${id}/therapist`, { method: "PUT", json: { therapist } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["org"] }); },
  });
  const choices = (current?: string | null) => (current && !therapists.includes(current) ? [...therapists, current] : therapists);
  const [del, setDel] = useState<{ id: string; display_name: string; alias: string } | null>(null);
  const trash = useMutation({
    mutationFn: (id: string) => api(`/children/${id}/archive`, { method: "POST" }),
    onSuccess: (_, id) => { if (id === childId) setChildId(null); setDel(null); qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["timetable"] }); qc.invalidateQueries({ queryKey: ["schedules"] }); },
  });
  const [f, setF] = useState({ alias: "", display_name: "", birth_date: "", sex: "", therapist: "" });
  const create = useMutation({
    mutationFn: () => api("/children", { method: "POST", json: { ...f, sex: f.sex || null, therapist: f.therapist.trim() || null } }),
    onSuccess: () => { setF({ alias: "", display_name: "", birth_date: "", sex: "", therapist: "" }); qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["org"] }); },
  });
  return (
    <>
      <PageTitle title="아동 관리" sub="최소 정보만 수집합니다. 가명코드만 AI에 전달되며 이름·연락처는 전송되지 않습니다." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="아동 등록">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Label label="가명코드 (예: A-01)"><Input value={f.alias} onChange={(e) => setF({ ...f, alias: e.target.value })} required /></Label>
            <Label label="이름"><Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} required /></Label>
            <Label label="생년월일"><Input type="date" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })} required /></Label>
            <Label label="성별"><Select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="">미입력</option><option>남</option><option>여</option></Select></Label>
            <Label label="담당 치료사"><Select value={f.therapist} onChange={(e) => setF({ ...f, therapist: e.target.value })}>
              <option value="">선택 안 함</option>{therapists.map((t) => <option key={t}>{t}</option>)}</Select></Label>
            {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
            <Button disabled={create.isPending}>등록</Button>
          </form>
        </Card>
        <Card title={`아동 목록 (${children.length})`} className="lg:col-span-2"
          action={canWrite && <Button variant="outline" onClick={() => setImporting(!importing)}><FileSpreadsheet size={14} />엑셀로 등록</Button>}>
          {children.length === 0 ? <Empty>{role === "therapist" ? "담당 아동이 없어요. 치료사는 담당 아동만 보여요. 기관 관리자가 기관 설정 › 치료사 목록에서 이 계정을 연결하고 아동의 담당 치료사로 지정하면 나타나요." : "등록된 아동이 없습니다."}</Empty> : (
            <Table head={["가명", "이름", "생년월일", "성별", "나이", "담당", ""]}>
              {sorted.map((c) => (
                <tr key={c.id}><Td>{c.alias}</Td><Td>{c.display_name}</Td><Td>{c.birth_date}</Td><Td>{(c as any).sex ?? "-"}</Td><Td>{ageLabel((c as any).age_months) || "-"}</Td><Td>{canWrite
                  ? <Select aria-label={`${c.display_name} 담당 치료사`} className="w-28 py-1" value={(c as any).therapist ?? ""} disabled={assign.isPending}
                      onChange={(e) => assign.mutate({ id: c.id, therapist: e.target.value || null })}>
                      <option value="">-</option>{choices((c as any).therapist).map((t) => <option key={t}>{t}</option>)}</Select>
                  : (c as any).therapist ?? "-"}</Td>
                  <Td><div className="flex gap-1">
                    <Button variant={c.id === childId ? "primary" : "outline"} onClick={() => setChildId(c.id)}>{c.id === childId ? "선택됨" : "선택"}</Button>
                    {canWrite && <Button variant="ghost" className="text-red-600" aria-label={`${c.display_name} 삭제`} onClick={() => { trash.reset(); setDel(c); }}><Trash2 size={14} /></Button>}
                  </div></Td></tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      {importing && <ChildImport onClose={() => setImporting(false)} />}
      <Trash isAdmin={role === "admin"} canWrite={canWrite} />
      {del && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/30 p-2 sm:items-center" onClick={() => setDel(null)}>
          <div role="dialog" aria-label="아동 삭제" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold">{del.display_name} ({del.alias}) 아동을 삭제할까요?</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              <li>아동 목록과 주간 시간표에서 빠지고, 오늘 이후 예정된 일정은 취소돼요.</li>
              <li>기록은 지워지지 않고 아래 ‘삭제된 아동’에 남아서 언제든 복구할 수 있어요.</li>
            </ul>
            {trash.error && <div className="mt-3"><Notice tone="red">{errText(trash.error)}</Notice></div>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDel(null)}>취소</Button>
              <Button variant="danger" disabled={trash.isPending} onClick={() => trash.mutate(del.id)}>{trash.isPending ? "삭제 중…" : "삭제"}</Button>
            </div>
          </div>
        </div>)}
    </>
  );
}

type Archived = { id: string; alias: string; display_name: string; birth_date: string; archived_at: string | null };

/** 삭제된 아동: restore, or (admin) delete permanently with every linked record. */
function Trash({ isAdmin, canWrite }: { isAdmin: boolean; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["children", "archived"], queryFn: () => api<Archived[]>("/children/archived") });
  const [purge, setPurge] = useState<Archived | null>(null), [typed, setTyped] = useState("");
  const done = () => { qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["timetable"] }); };
  const restore = useMutation({ mutationFn: (id: string) => api(`/children/${id}/restore`, { method: "POST" }), onSuccess: done });
  const wipe = useMutation({
    mutationFn: (c: Archived) => api(`/children/${c.id}/purge`, { method: "POST", json: { confirm_name: typed } }),
    onSuccess: () => { setPurge(null); setTyped(""); done(); },
  });
  if (!list.data?.length) return null;
  return (
    <Card title={`삭제된 아동 (${list.data.length})`} className="mt-4">
      <Table head={["가명", "이름", "삭제한 날", ""]}>
        {list.data.map((c) => (
          <tr key={c.id} className="text-slate-500"><Td>{c.alias}</Td><Td>{c.display_name}</Td><Td>{c.archived_at?.slice(0, 10) ?? "-"}</Td>
            <Td><div className="flex flex-wrap gap-1">
              {canWrite && <Button variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(c.id)}><RotateCcw size={14} />복구</Button>}
              {isAdmin && <Button variant="ghost" className="text-red-600" onClick={() => { wipe.reset(); setTyped(""); setPurge(c); }}>영구 삭제</Button>}
            </div></Td></tr>))}
      </Table>
      {restore.error && <div className="mt-2"><Notice tone="red">{errText(restore.error)}</Notice></div>}
      {purge && (
        <div className="mt-3 space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-900">{purge.display_name} 아동을 영구 삭제할까요?</p>
          <p className="text-sm text-red-800/90">검사·회기·계획·상담·녹음 기록, 일정과 출결, AI 대화, 만든 문서까지 모두 지워지고 되돌릴 수 없어요. 감사로그에는 삭제했다는 사실만 남아요.</p>
          <Label label={`확인을 위해 아동 이름 ‘${purge.display_name}’을 입력하세요`}><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></Label>
          <div className="flex gap-2">
            <Button variant="danger" disabled={typed.trim() !== purge.display_name.trim() || wipe.isPending} onClick={() => wipe.mutate(purge)}>{wipe.isPending ? "삭제 중…" : "영구 삭제"}</Button>
            <Button variant="ghost" onClick={() => setPurge(null)}>취소</Button>
          </div>
          {wipe.error && <Notice tone="red">{errText(wipe.error)}</Notice>}
        </div>)}
    </Card>
  );
}
