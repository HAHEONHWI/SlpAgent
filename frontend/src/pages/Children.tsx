import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Plus, RotateCcw, Trash2 } from "lucide-react";
import ChildImport from "../components/ChildImport";
import { ageLabel, api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import { useMe } from "../lib/me";
import { Button, Card, Empty, Input, Label, Notice, PageTitle, Select, Table, Td } from "../components/ui";

// 장애등록 여부: Y / N / 미입력(null)
const yn = (v: string) => (v === "Y" ? true : v === "N" ? false : null);
const ynOf = (v?: boolean | null) => (v === true ? "Y" : v === false ? "N" : "");
// 발달재활 바우처 등급과 월 본인부담금 (정산 기준과 같음)
const GRADES: [string, string][] = [["다", "기초 · 면제"], ["가", "차상위 · 2만"], ["나", "65% 이하 · 4만"], ["라", "120% 이하 · 6만"], ["마", "180% 이하 · 8만"]];
type TherapistRow = { name: string; code_prefix?: string | null };

export default function Children() {
  const { children, setChildId, childId } = useChild();
  const qc = useQueryClient();
  const role = useMe().data?.role, canWrite = role === "admin" || role === "therapist";
  const [importing, setImporting] = useState(false);
  const [formOpen, setFormOpen] = useState<boolean | null>(null);  // null: open only while there are no children
  const showForm = formOpen ?? children.length === 0;
  const therapistRoster = useQuery({ queryKey: ["org", "roster"], queryFn: () => api<{ therapists: TherapistRow[]; suggestions: string[] }>("/org/roster") });
  const therapistRows = therapistRoster.data?.therapists ?? [];
  const therapists = therapistRows.length ? therapistRows.map((t) => t.name) : therapistRoster.data?.suggestions ?? [];
  const sorted = [...children].sort((a, b) => a.alias.localeCompare(b.alias, "ko", { numeric: true }) || a.display_name.localeCompare(b.display_name, "ko"));
  const assign = useMutation({
    mutationFn: ({ id, therapist }: { id: string; therapist: string | null }) => api(`/children/${id}/therapist`, { method: "PUT", json: { therapist } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["org"] }); },
  });
  const grade = useMutation({
    mutationFn: ({ id, voucher_grade }: { id: string; voucher_grade: string | null }) => api(`/children/${id}/voucher`, { method: "PUT", json: { voucher_grade } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["settlement"] }); },
  });
  const disability = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean | null }) => api(`/children/${id}/disability`, { method: "PUT", json: { disability_registered: value } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["children"] }),
  });
  const choices = (current?: string | null) => (current && !therapists.includes(current) ? [...therapists, current] : therapists);
  const [ending, setEnding] = useState<{ id: string; display_name: string } | null>(null);
  const [lastDay, setLastDay] = useState("");
  const ended = useQuery({ queryKey: ["children", "terminated"], queryFn: () => api<{ id: string; display_name: string; alias: string; terminated_on: string }[]>("/children/terminated") });
  const terminate = useMutation({
    mutationFn: (id: string) => api(`/children/${id}/terminate`, { method: "POST", json: { terminated_on: lastDay } }),
    onSuccess: (_, id) => { if (id === childId) setChildId(null); setEnding(null); return qc.invalidateQueries(); },
  });
  const [del, setDel] = useState<{ id: string; display_name: string; alias: string } | null>(null);
  const trash = useMutation({
    mutationFn: (id: string) => api(`/children/${id}/archive`, { method: "POST" }),
    onSuccess: (_, id) => { if (id === childId) setChildId(null); setDel(null); qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["timetable"] }); qc.invalidateQueries({ queryKey: ["schedules"] }); },
  });
  const empty = { display_name: "", birth_date: "", sex: "", therapist: "", voucher_grade: "", disability: "" };
  const [f, setF] = useState(empty);
  const codePrefix = therapistRows.find((t) => t.name === f.therapist)?.code_prefix ?? null;
  const code = useQuery({ queryKey: ["children", "next-code", f.therapist],
    queryFn: () => api<{ code_prefix: string | null; alias: string | null }>(`/children/next-code?therapist=${encodeURIComponent(f.therapist)}`),
    enabled: !!f.therapist });
  const codeReady = !!f.therapist && !!codePrefix && !!code.data?.alias && !code.isFetching && !code.error;
  const voucherGrade = f.disability === "N" ? "" : f.voucher_grade;
  const create = useMutation({
    mutationFn: () => api("/children", { method: "POST", json: { display_name: f.display_name, birth_date: f.birth_date, sex: f.sex || null, therapist: f.therapist,
      voucher_grade: voucherGrade || null, disability_registered: yn(f.disability) } }),
    onSuccess: () => { setF(empty); qc.invalidateQueries({ queryKey: ["settlement"] }); qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["org"] }); },
  });
  return (
    <>
      <PageTitle title="아동 관리" sub="최소 정보만 수집합니다. 가명코드만 AI에 전달되며 이름·연락처는 전송되지 않습니다." />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button onClick={() => setFormOpen(!showForm)} aria-expanded={showForm}><Plus size={14} />아동 등록</Button>
        {canWrite && <Button variant="outline" onClick={() => setImporting(!importing)}><FileSpreadsheet size={14} />엑셀로 한꺼번에 등록</Button>}
        <span className="ml-auto text-[13px] text-slate-500">아동 {children.length}명</span>
      </div>
      {showForm && (
        <div className="mb-7 rounded-3xl bg-slate-100 p-5 shadow-sm">
          <form onSubmit={(e) => { e.preventDefault(); if (codeReady) create.mutate(); }}>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <Label label="담당 치료사"><Select value={f.therapist} required onChange={(e) => setF({ ...f, therapist: e.target.value })}>
              <option value="">선택하세요</option>{therapists.map((t) => <option key={t}>{t}</option>)}</Select></Label>
            <Label label="이름"><Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} required /></Label>
            <Label label="생년월일"><Input type="date" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })} required /></Label>
            <Label label="성별"><Select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="">미입력</option><option>남</option><option>여</option></Select></Label>
            <Label label="장애등록 여부"><Select value={f.disability} onChange={(e) => setF({ ...f, disability: e.target.value })}>
              <option value="">미입력</option><option value="Y">Y (등록)</option><option value="N">N (미등록)</option></Select></Label>
            <Label label="바우처 등급"><Select value={voucherGrade} disabled={f.disability === "N"} onChange={(e) => setF({ ...f, voucher_grade: e.target.value, disability: e.target.value ? "Y" : f.disability })}>
              <option value="">유형 미설정</option>{GRADES.map(([g, d]) => <option key={g} value={g}>{g}형 ({d})</option>)}</Select></Label>
            <Label label="아이 코드"><Input value={code.data?.alias ?? ""} readOnly placeholder={!f.therapist ? "치료사를 먼저 선택하세요" : codePrefix ? "코드를 확인하는 중…" : "관리자 설정 필요"} /></Label>
            </div>
            {!f.therapist ? <p className="mt-2 text-xs text-slate-500">담당 치료사를 선택하면 아이 코드가 자동으로 표시됩니다.</p>
              : !codePrefix ? <p className="mt-2 text-xs text-slate-500">등록하려면 관리자가 이 치료사의 아이 코드 알파벳을 먼저 지정해야 합니다.</p> : null}
            {codePrefix && code.error && <div className="mt-2"><Notice tone="red">{errText(code.error)}</Notice></div>}
            {create.error && <div className="mt-3"><Notice tone="red">{errText(create.error)}</Notice></div>}
            <div className="mt-4 flex gap-2"><Button disabled={create.isPending || !codeReady}>등록</Button><Button type="button" variant="outline" onClick={() => setFormOpen(false)}>닫기</Button></div>
          </form>
        </div>)}
      <div>
          {children.length === 0 ? <Empty>{role === "therapist" ? "담당 아동이 없어요. 치료사는 담당 아동만 보여요. 기관 관리자가 기관 설정 › 치료사 목록에서 이 계정을 연결하고 아동의 담당 치료사로 지정하면 나타나요." : "등록된 아동이 없습니다."}</Empty> : (
            <Table head={["가명", "이름", "생년월일", "성별", "나이", "장애등록", "바우처 등급", "담당", ""]}>
              {sorted.map((c) => (
                <tr key={c.id} className={c.id === childId ? "bg-indigo-100/70" : undefined}><Td className="font-semibold">{c.alias}</Td><Td>{c.display_name}</Td><Td>{c.birth_date}</Td><Td>{(c as any).sex ?? "-"}</Td><Td>{ageLabel((c as any).age_months) || "-"}</Td>
                  <Td>{canWrite
                    ? <Select aria-label={`${c.display_name} 장애등록 여부`} className="w-16 min-w-16 py-1" value={ynOf((c as any).disability_registered)} disabled={disability.isPending || !!c.voucher_grade && c.disability_registered === true}
                        onChange={(e) => disability.mutate({ id: c.id, value: yn(e.target.value) })}>
                        <option value="">-</option><option value="Y">Y</option><option value="N">N</option></Select>
                    : ynOf((c as any).disability_registered) || "-"}</Td>
                  <Td>{canWrite
                    ? <Select aria-label={`${c.display_name} 바우처 등급`} className="w-24 min-w-24 py-1" value={(c as any).voucher_grade ?? ""}
                        disabled={(c as any).disability_registered === false || grade.isPending || (disability.isPending && disability.variables.id === c.id)}
                        onChange={(e) => grade.mutate({ id: c.id, voucher_grade: e.target.value || null })}>
                        <option value="">미설정</option>{GRADES.map(([g]) => <option key={g} value={g}>{g}형</option>)}</Select>
                    : (c as any).voucher_grade ? `${(c as any).voucher_grade}형` : "-"}</Td>
                  <Td>{canWrite
                  ? <Select aria-label={`${c.display_name} 담당 치료사`} className="w-28 min-w-28 py-1" value={(c as any).therapist ?? ""} disabled={assign.isPending}
                      onChange={(e) => assign.mutate({ id: c.id, therapist: e.target.value || null })}>
                      <option value="">-</option>{choices((c as any).therapist).map((t) => <option key={t}>{t}</option>)}</Select>
                  : (c as any).therapist ?? "-"}</Td>
                  <Td><div className="flex gap-1">
                    <Button variant={c.id === childId ? "primary" : "outline"} onClick={() => setChildId(c.id)}>{c.id === childId ? "선택됨" : "선택"}</Button>
                    {canWrite && <Button variant="outline" onClick={() => {
                      terminate.reset(); setLastDay(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })); setEnding(c);
                    }}>종결</Button>}
                    {canWrite && <Button variant="ghost" className="text-red-600" aria-label={`${c.display_name} 삭제`} onClick={() => { trash.reset(); setDel(c); }}><Trash2 size={14} /></Button>}
                  </div></Td></tr>
              ))}
            </Table>
          )}
      </div>
      {importing && <ChildImport onClose={() => setImporting(false)} />}
      <Card title={`종결된 아동 (${ended.data?.length ?? 0})`}>
        {ended.error ? <Notice tone="red">{errText(ended.error)}</Notice> : ended.data?.length
          ? <Table head={["가명", "이름", "종결일"]}>{ended.data.map(c =>
              <tr key={c.id}><Td>{c.alias}</Td><Td>{c.display_name}</Td><Td>{c.terminated_on}</Td></tr>)}</Table>
          : <p>{ended.isLoading ? "불러오는 중…" : "종결된 아동이 없습니다."}</p>}
      </Card>
      {ending && <div className="fixed inset-0 z-30 grid place-items-center bg-slate-900/30 p-3">
        <form role="dialog" aria-label="아동 종결" className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5" onSubmit={e => { e.preventDefault(); terminate.mutate(ending.id); }}>
          <h3 className="font-semibold">{ending.display_name} 아동 종결</h3>
          <Label label="종결일"><Input type="date" required value={lastDay} onChange={e => setLastDay(e.target.value)} /></Label>
          <p className="text-sm">종결일을 포함해 이후 수업을 모두 취소합니다. 종결일 전 수업과 출결 기록은 보존됩니다.</p>
          {terminate.error && <Notice tone="red">{errText(terminate.error)}</Notice>}
          <div className="flex gap-2"><Button type="button" variant="outline" disabled={terminate.isPending} onClick={() => setEnding(null)}>닫기</Button>
            <Button disabled={!lastDay || terminate.isPending}>종결 처리</Button></div>
        </form></div>}
      <Trash isAdmin={role === "admin"} canWrite={canWrite} />
      {del && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/30 p-2 sm:items-center" onClick={() => setDel(null)}>
          <div role="dialog" aria-label="아동 삭제" className="w-full max-w-sm rounded-3xl bg-slate-100 p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
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
    <Card title={`휴지통 · 삭제된 아동 (${list.data.length})`} className="mt-10">
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
