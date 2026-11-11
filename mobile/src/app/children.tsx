import { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { ageLabel, api, errText, type Child } from "@/lib/api";
import { today } from "@/lib/dates";
import { useChild } from "@/lib/child";
import { canWrite, useMe } from "@/lib/me";
import { detect, FIELD_LABEL, readRows, toChildren, type Field, type ImportRow, type Mapping } from "@/lib/childImport";
import { Badge, Button, C, Card, DateField, Empty, IconButton, Input, Notice, Row, Screen, Select, Sheet, T, TextField, Checkbox, confirm, type Tone } from "@/components/ui";

// 장애등록 여부: Y / N / 미입력(null)
const yn = (v: string) => (v === "Y" ? true : v === "N" ? false : null);
const ynOf = (v?: boolean | null) => (v === true ? "Y" : v === false ? "N" : "");
// 발달재활 바우처 등급과 월 본인부담금 (정산 기준과 같음)
const GRADES: [string, string][] = [["다", "기초 · 면제"], ["가", "차상위 · 2만"], ["나", "65% 이하 · 4만"], ["라", "120% 이하 · 6만"], ["마", "180% 이하 · 8만"]];
type TherapistRow = { name: string; code_prefix?: string | null };

export default function Children() {
  const { children, setChildId, childId } = useChild();
  const qc = useQueryClient();
  const role = useMe().data?.role, writable = canWrite(useMe().data);
  const ended = useQuery({ queryKey: ["children", "terminated"], queryFn: () => api<(Child & { terminated_on: string })[]>("/children/terminated") });
  const [importing, setImporting] = useState(false);
  const [formOpen, setFormOpen] = useState<boolean | null>(null); // null: open only while there are no children
  const showForm = writable && (formOpen ?? children.length === 0);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Child | null>(null);
  const sorted = [...children].sort((a, b) => a.alias.localeCompare(b.alias, "ko", { numeric: true }) || a.display_name.localeCompare(b.display_name, "ko"))
    .filter((c) => !q.trim() || `${c.display_name}${c.alias}${c.therapist ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const empty = { alias: "", display_name: "", birth_date: "", sex: "", therapist: "", voucher_grade: "", disability: "" };
  const [f, setF] = useState(empty);
  const therapistRoster = useQuery({ queryKey: ["org", "roster"], queryFn: () => api<{ therapists: TherapistRow[]; suggestions: string[] }>("/org/roster") });
  const therapistRows = therapistRoster.data?.therapists ?? [];
  const therapists = therapistRows.length ? therapistRows.map((t) => t.name) : therapistRoster.data?.suggestions ?? [];
  const codePrefix = therapistRows.find((t) => t.name === f.therapist)?.code_prefix ?? null;
  const code = useQuery({ queryKey: ["children", "next-code", f.therapist],
    queryFn: () => api<{ code_prefix: string | null; alias: string | null }>(`/children/next-code?therapist=${encodeURIComponent(f.therapist)}`),
    enabled: !!f.therapist && !!codePrefix });
  const create = useMutation({
    mutationFn: () => api("/children", { method: "POST", json: { alias: codePrefix ? code.data?.alias : f.alias, display_name: f.display_name, birth_date: f.birth_date, sex: f.sex || null, therapist: f.therapist.trim() || null,
      voucher_grade: f.voucher_grade || null, disability_registered: yn(f.disability) } }),
    onSuccess: () => { setF(empty); setFormOpen(false); ["settlement", "children", "org"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });
  return (
    <Screen onRefresh={() => qc.invalidateQueries({ queryKey: ["children"] })}>
      <T small muted>최소 정보만 수집합니다. 가명코드만 AI에 전달되며 이름·연락처는 전송되지 않습니다.</T>
      {writable && (
        <Row>
          <Button small icon="add" title="아동 등록" onPress={() => setFormOpen(!showForm)} />
          <Button small variant="outline" icon="document-outline" title="엑셀로 한꺼번에 등록" onPress={() => setImporting(true)} />
        </Row>)}
      {showForm && (
        <Card title="아동 등록">
          <TextField label="아이 코드" value={codePrefix ? code.data?.alias ?? "" : f.alias} editable={!codePrefix} onChangeText={(alias) => setF({ ...f, alias })} />
          <TextField label="이름" value={f.display_name} onChangeText={(display_name) => setF({ ...f, display_name })} />
          <DateField label="생년월일" value={f.birth_date} onChange={(birth_date) => setF({ ...f, birth_date })} />
          <Select label="성별" value={f.sex} options={[["", "미입력"], ["남", "남"], ["여", "여"]]} onChange={(sex) => setF({ ...f, sex })} />
          <Select label="담당 치료사" value={f.therapist} options={[["", "선택 안 함"], ...therapists.map((t) => [t, t] as [string, string])]} onChange={(therapist) => setF({ ...f, therapist, alias: "" })} />
          <Select label="장애등록 여부" value={f.disability} options={[["", "미입력"], ["Y", "Y (등록)"], ["N", "N (미등록)"]]} onChange={(disability) => setF({ ...f, disability, voucher_grade: disability === "N" ? "" : f.voucher_grade })} />
          <Select label="바우처 등급" value={f.voucher_grade} options={[["", "유형 미설정"], ...GRADES.map(([g, d]) => [g, `${g}형 (${d})`] as [string, string])]} disabled={f.disability === "N"} onChange={(voucher_grade) => setF({ ...f, voucher_grade, disability: voucher_grade ? "Y" : f.disability })} />
          {f.therapist && !codePrefix && <T small muted>관리자가 기관 설정에서 이 치료사의 아이 코드 알파벳을 지정하면 자동 입력돼요.</T>}
          {codePrefix && code.error && <Notice tone="red">{errText(code.error)}</Notice>}
          {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
          <Button title="등록" loading={create.isPending} disabled={!!codePrefix && (!code.data?.alias || code.isFetching || !!code.error) || !codePrefix && !f.alias.trim() || !f.display_name.trim() || !f.birth_date} onPress={() => create.mutate()} />
        </Card>)}
      <Input value={q} onChangeText={setQ} placeholder={`아동 ${children.length}명 · 이름·코드·담당 검색`} />
      {children.length === 0 ? <Empty>{role === "therapist" ? "담당 아동이 없어요. 치료사는 담당 아동만 보여요. 기관 관리자가 기관 설정 › 치료사 목록에서 이 계정을 연결하고 아동의 담당 치료사로 지정하면 나타나요." : "등록된 아동이 없습니다."}</Empty>
        : sorted.map((c) => (
          <Card key={c.id} style={c.id === childId ? { borderWidth: 2, borderColor: C.accent } : undefined}>
            <Row style={{ flexWrap: "nowrap" }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T bold style={{ fontSize: 17 }}>{`${c.alias}  ${c.display_name}`}</T>
                <T small muted>{[c.birth_date, c.sex, ageLabel(c.age_months)].filter(Boolean).join(" · ")}</T>
                <Row gap={4}>
                  <Badge>{`담당 ${c.therapist ?? "-"}`}</Badge>
                  <Badge tone={c.voucher_grade ? "indigo" : "slate"}>{c.voucher_grade ? `${c.voucher_grade}형` : "등급 미설정"}</Badge>
                  <Badge>{`장애등록 ${ynOf(c.disability_registered) || "-"}`}</Badge>
                </Row>
              </View>
              {writable && <IconButton icon="create-outline" label={`${c.display_name} 수정`} onPress={() => setEdit(c)} />}
            </Row>
            <Button small variant={c.id === childId ? "primary" : "outline"} title={c.id === childId ? "선택됨" : "선택"} onPress={() => setChildId(c.id)} />
          </Card>))}
      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.display_name} (${edit.alias})` : ""}>
        {edit && <EditChild key={edit.id} c={edit} therapists={therapists} onClose={() => setEdit(null)} />}
      </Sheet>
      <Sheet visible={importing} onClose={() => setImporting(false)} title="엑셀로 한꺼번에 등록">{importing && <ChildImport />}</Sheet>
      <Card title={`종결된 아동 (${ended.data?.length ?? 0})`}>
        {ended.error ? <Notice tone="red">{errText(ended.error)}</Notice> : ended.data?.length ? ended.data.map(c =>
          <T key={c.id}>{`${c.alias} ${c.display_name} · ${c.terminated_on}`}</T>) : <T muted>{ended.isLoading ? "불러오는 중…" : "종결된 아동이 없습니다."}</T>}
      </Card>
      <Trash isAdmin={role === "admin"} writable={writable} />
    </Screen>
  );
}

/** 담당·바우처 등급·장애등록 변경과 삭제(휴지통). */
function EditChild({ c, therapists, onClose }: { c: Child; therapists: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { childId, setChildId } = useChild();
  const inval = (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const assign = useMutation({ mutationFn: (therapist: string | null) => api(`/children/${c.id}/therapist`, { method: "PUT", json: { therapist } }), onSuccess: () => inval("children", "org") });
  const grade = useMutation({ mutationFn: (voucher_grade: string | null) => api(`/children/${c.id}/voucher`, { method: "PUT", json: { voucher_grade } }), onSuccess: () => inval("children", "settlement") });
  const disability = useMutation({ mutationFn: (value: boolean | null) => api(`/children/${c.id}/disability`, { method: "PUT", json: { disability_registered: value } }), onSuccess: () => inval("children") });
  const trash = useMutation({
    mutationFn: () => api(`/children/${c.id}/archive`, { method: "POST" }),
    onSuccess: () => { if (c.id === childId) setChildId(null); inval("children", "timetable", "schedules"); onClose(); },
  });
  const choices = c.therapist && !therapists.includes(c.therapist) ? [...therapists, c.therapist] : therapists;
  const [ending, setEnding] = useState(false), [endDay, setEndDay] = useState(today);
  const terminate = useMutation({ mutationFn: () => api(`/children/${c.id}/terminate`, { method: "POST", json: { terminated_on: endDay } }),
    onSuccess: () => { if (childId === c.id) setChildId(null); onClose(); return qc.invalidateQueries(); } });
  const err = assign.error || grade.error || disability.error || trash.error || terminate.error;
  return (
    <>
      <Select label="담당 치료사" value={c.therapist ?? ""} disabled={assign.isPending} options={[["", "-"], ...choices.map((t) => [t, t] as [string, string])]} onChange={(v) => assign.mutate(v || null)} />
      <Select label="바우처 등급" value={c.voucher_grade ?? ""} disabled={grade.isPending || c.disability_registered === false && !c.voucher_grade} options={[["", "미설정"], ...GRADES.map(([g, d]) => [g, `${g}형 (${d})`] as [string, string])]} onChange={(v) => grade.mutate(v || null)} />
      <Select label="장애등록 여부" value={ynOf(c.disability_registered)} disabled={disability.isPending || !!c.voucher_grade && c.disability_registered === true} options={[["", "-"], ["Y", "Y"], ["N", "N"]]} onChange={(v) => disability.mutate(yn(v))} />
      {err && <Notice tone="red">{errText(err)}</Notice>}
      {ending ? <>
        <DateField label="종결일" value={endDay} onChange={setEndDay} />
        <Row><Button variant="outline" title="닫기" disabled={terminate.isPending} onPress={() => setEnding(false)} />
          <Button title="종결 처리" loading={terminate.isPending} onPress={async () => {
            if (await confirm(`${c.display_name} 아동을 종결할까요?`, `${endDay}부터 모든 수업을 취소합니다. 종결일 전 수업과 출결 기록은 보존됩니다.`, "종결 처리")) terminate.mutate();
          }} /></Row>
      </> : <Button variant="outline" title="아동 종결" onPress={() => setEnding(true)} />}
      <Button variant="danger" icon="trash-outline" title="삭제 (휴지통으로)" loading={trash.isPending} onPress={async () => {
        if (await confirm(`${c.display_name} (${c.alias}) 아동을 삭제할까요?`, "아동 목록과 주간 시간표에서 빠지고, 오늘 이후 예정된 일정은 취소돼요. 기록은 지워지지 않고 ‘삭제된 아동’에 남아서 언제든 복구할 수 있어요.", "삭제", true)) trash.mutate();
      }} />
    </>
  );
}

type Archived = { id: string; alias: string; display_name: string; birth_date: string; archived_at: string | null };

/** 삭제된 아동: restore, or (admin) delete permanently with every linked record. */
function Trash({ isAdmin, writable }: { isAdmin: boolean; writable: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["children", "archived"], queryFn: () => api<Archived[]>("/children/archived") });
  const [purge, setPurge] = useState<Archived | null>(null), [typed, setTyped] = useState("");
  const done = () => { qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["timetable"] }); };
  const restore = useMutation({ mutationFn: (id: string) => api(`/children/${id}/restore`, { method: "POST" }), onSuccess: done });
  const wipe = useMutation({ mutationFn: (c: Archived) => api(`/children/${c.id}/purge`, { method: "POST", json: { confirm_name: typed } }), onSuccess: () => { setPurge(null); setTyped(""); done(); } });
  if (!list.data?.length) return null;
  return (
    <Card title={`휴지통 · 삭제된 아동 (${list.data.length})`}>
      {list.data.map((c) => (
        <View key={c.id} style={{ gap: 6, borderTopWidth: 1, borderColor: C.line, paddingTop: 8 }}>
          <T muted>{`${c.alias} ${c.display_name} · 삭제 ${c.archived_at?.slice(0, 10) ?? "-"}`}</T>
          <Row>
            {writable && <Button small variant="outline" icon="refresh" title="복구" disabled={restore.isPending} onPress={() => restore.mutate(c.id)} />}
            {isAdmin && <Button small variant="ghost" title="영구 삭제" onPress={() => { wipe.reset(); setTyped(""); setPurge(c); }} />}
          </Row>
          {purge?.id === c.id && (
            <View style={{ gap: 8, backgroundColor: C.redBg, borderRadius: 14, padding: 12 }}>
              <T bold style={{ color: C.redText }}>{`${c.display_name} 아동을 영구 삭제할까요?`}</T>
              <T small style={{ color: C.redText }}>검사·회기·계획·상담·녹음 기록, 일정과 출결, AI 대화, 만든 문서까지 모두 지워지고 되돌릴 수 없어요. 감사로그에는 삭제했다는 사실만 남아요.</T>
              <TextField label={`확인을 위해 아동 이름 ‘${c.display_name}’을 입력하세요`} value={typed} onChangeText={setTyped} />
              <Row>
                <Button small variant="danger" title="영구 삭제" loading={wipe.isPending} disabled={typed.trim() !== c.display_name.trim()} onPress={() => wipe.mutate(c)} />
                <Button small variant="ghost" title="취소" onPress={() => setPurge(null)} />
              </Row>
              {wipe.error && <Notice tone="red">{errText(wipe.error)}</Notice>}
            </View>)}
        </View>))}
      {restore.error && <Notice tone="red">{errText(restore.error)}</Notice>}
    </Card>
  );
}

/** 엑셀로 한꺼번에 등록: read the file on the phone, show what will be registered, then send only the derived fields
 * (birth date and sex, never the 주민번호 digit). */
function ChildImport() {
  const qc = useQueryClient();
  const { children } = useChild();
  const [sheet, setSheet] = useState<{ raw: unknown[][]; headerAt: number; head: string[] } | null>(null);
  const [map, setMap] = useState<Mapping | null>(null), [problem, setProblem] = useState(""), [fileName, setFileName] = useState("");
  const [codes, setCodes] = useState<Record<number, string>>({}); // codes the user edited in the preview, by line
  const [overwrite, setOverwrite] = useState(false);
  const parsed = sheet && map && map.name >= 0 && map.birth >= 0 ? toChildren(sheet.raw, sheet.headerAt, map, children.map((c) => c.alias)) : null;
  const rows = parsed?.map((r) => (codes[r.line] !== undefined ? { ...r, alias: codes[r.line].trim() } : r)) ?? null;
  const byCode = new Map(children.map((c) => [c.alias.trim().toLowerCase(), c]));
  const people = new Map(children.map((c) => [`${c.display_name.trim()}|${c.birth_date}`, c]));
  /** What overwriting would change for an already registered child (blank cells keep what is there). */
  const changes = (r: ImportRow, c: Child) => [
    r.alias && r.alias !== c.alias.trim() && "코드", r.therapist && r.therapist !== (c.therapist ?? "") && "담당",
    r.voucher_grade && r.voucher_grade !== (c.voucher_grade ?? "") && "등급", r.sex && r.sex !== (c.sex ?? "") && "성별",
  ].filter(Boolean) as string[];
  const inFile = new Map<string, ImportRow[]>();
  for (const r of rows ?? []) inFile.set(r.alias.toLowerCase(), [...(inFile.get(r.alias.toLowerCase()) ?? []), r]);
  const status = (r: ImportRow): { tone: Tone; text: string } => {
    if (r.error) return { tone: "red", text: r.error };
    const known = people.get(`${r.display_name}|${r.birth_date}`);
    if (known && !overwrite) return { tone: "slate", text: "이미 등록됨" };
    if (!r.alias) return { tone: "red", text: "아이코드를 입력하세요" };
    const owner = byCode.get(r.alias.toLowerCase());
    if (owner && owner.id !== known?.id) return { tone: "red", text: `코드 중복 · 이미 사용 중 (${owner.display_name})` };
    const twins = (inFile.get(r.alias.toLowerCase()) ?? []).filter((x) => x.line !== r.line);
    if (twins.length) return { tone: "red", text: `코드 중복 (${twins.map((x) => x.display_name).join(", ")})` };
    if (known) { const ch = changes(r, known); return ch.length ? { tone: "indigo", text: `덮어쓰기: ${ch.join("·")}` } : { tone: "slate", text: "바뀐 것 없음" }; }
    return { tone: "green", text: "새로 등록" };
  };
  const ready = (rows ?? []).filter((r) => status(r).tone === "green");
  const update = (rows ?? []).filter((r) => status(r).tone === "indigo");
  const fix = (rows ?? []).filter((r) => status(r).tone === "red");
  const dup = (rows ?? []).filter((r) => status(r).tone === "slate");
  const send = useMutation({
    mutationFn: () => api<{ created: number; updated: number; skipped: { display_name: string; reason: string }[] }>("/children/import", { method: "POST",
      json: { overwrite, rows: [...ready, ...update].map(({ alias, display_name, birth_date, sex, therapist, voucher_grade }) => ({ alias, display_name, birth_date, sex, therapist, voucher_grade })) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["org"] }); },
  });
  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "*/*"], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const file = r.assets[0];
    setProblem(""); setSheet(null); setMap(null); setCodes({}); send.reset(); setFileName(file.name);
    try {
      const raw = await readRows(file);
      const found = detect(raw);
      if (!found) setProblem("제목 줄을 찾지 못했어요. 첫 줄에 ‘대상자명’(또는 이름) 같은 제목이 있어야 해요.");
      else { setSheet({ raw, headerAt: found.headerAt, head: found.head }); setMap(found.map); }
    } catch (e) { setProblem(e instanceof Error && /xls|엑셀/.test(e.message) ? e.message : "파일을 읽지 못했어요. .xlsx 또는 .csv 파일인지 확인해 주세요."); }
  };
  const colLabel = (i: number) => `${String.fromCharCode(65 + (i % 26))}열 · ${sheet?.head[i] || "(제목 없음)"}`;
  return (
    <>
      <T small>첫 줄에 대상자명, 생년월일(예: 210405-3), 지정제공인력, 아이코드, 등급명(예: 나형) 제목이 있는 엑셀(.xlsx)이나 CSV를 골라 주세요. 아이코드가 비어 있으면 ‘임시-001’처럼 임시 코드를 붙여요.</T>
      <Notice>생년월일 뒤 숫자(3·4 등)는 이 휴대폰에서 출생연도와 성별을 알아내는 데만 쓰고 서버로 보내거나 저장하지 않아요. 원본 파일도 올라가지 않아요.</Notice>
      <Button variant="outline" icon="document-attach-outline" title={fileName || "파일 선택 (.xlsx, .csv)"} onPress={pick} />
      {!!problem && <Notice tone="red">{problem}</Notice>}
      {sheet && map && !send.data && (
        <View style={{ gap: 8 }}>
          <T bold>열 맞추기</T>
          {(Object.keys(FIELD_LABEL) as Field[]).map((fld) => (
            <Select key={fld} label={FIELD_LABEL[fld] + (fld === "name" || fld === "birth" ? " *" : "")} value={String(map[fld])}
              options={[["-1", fld === "code" ? "없음 (임시 코드)" : "사용 안 함"], ...sheet.head.map((_, i) => [String(i), colLabel(i)] as [string, string])]}
              onChange={(v) => setMap({ ...map, [fld]: Number(v) })} />))}
          {(map.name < 0 || map.birth < 0) && <Notice tone="red">이름과 생년월일 열은 꼭 골라야 해요.</Notice>}
        </View>)}
      {rows && !rows.length && !send.data && <Notice tone="red">등록할 아동이 없어요.</Notice>}
      {rows && rows.length > 0 && !send.data && (
        <>
          <Checkbox checked={overwrite} onChange={setOverwrite} label={<View><T bold>이미 등록된 아이는 엑셀 내용으로 덮어쓰기</T>
            <T small muted>이름과 생년월일이 같으면 같은 아이로 보고 아이코드·담당·바우처 등급·성별을 엑셀대로 바꿔요. 빈 칸인 항목은 그대로 두고, 엑셀에 없는 아이는 지우지 않아요.</T></View>} />
          <T small>{`모두 ${rows.length}명 · 새로 등록 ${ready.length}명${overwrite ? ` · 덮어쓰기 ${update.length}명` : ""}${dup.length ? ` · ${overwrite ? "바뀐 것 없음" : "이미 있음"} ${dup.length}명` : ""}${fix.length ? ` · 확인 필요 ${fix.length}명` : ""}`}</T>
          {fix.some((r) => status(r).text.startsWith("코드 중복")) && <Notice>같은 아이코드를 쓰는 아이가 있어요. 빨간 줄의 아이코드를 다른 코드로 고치면 함께 등록돼요.</Notice>}
          {rows.map((r) => { const st = status(r); return (
            <View key={r.line} style={{ gap: 4, padding: 10, borderRadius: 12, backgroundColor: st.tone === "red" ? C.redBg : st.tone === "indigo" ? C.accentSoft : C.paper, opacity: st.tone === "slate" ? 0.6 : 1 }}>
              <Row style={{ justifyContent: "space-between" }}><T bold>{`${r.line}줄 · ${r.display_name}`}</T><Badge tone={st.tone}>{st.text}</Badge></Row>
              <T small muted>{[r.birth_date || "-", r.sex, r.therapist, r.voucher_grade && `${r.voucher_grade}형`].filter(Boolean).join(" · ")}</T>
              <Input value={r.alias} maxLength={40} onChangeText={(v) => setCodes({ ...codes, [r.line]: v })} accessibilityLabel={`${r.display_name} 아이코드`} />
            </View>); })}
          {send.error && <Notice tone="red">{errText(send.error)}</Notice>}
          <Button title={send.isPending ? "저장 중…" : [ready.length && `${ready.length}명 등록`, update.length && `${update.length}명 덮어쓰기`].filter(Boolean).join(" · ") || "등록할 아이 없음"}
            loading={send.isPending} disabled={!(ready.length + update.length)} onPress={() => send.mutate()} />
        </>)}
      {send.data && (
        <>
          <Notice tone="green">{`${send.data.created}명을 등록했어요.${send.data.updated ? ` ${send.data.updated}명을 덮어썼어요.` : ""}`}</Notice>
          {send.data.skipped.length > 0 && <Notice>{`건너뛴 ${send.data.skipped.length}명: ${send.data.skipped.map((x) => `${x.display_name}(${x.reason})`).join(", ")}`}</Notice>}
          <Button variant="outline" title="다른 파일 올리기" onPress={() => { setSheet(null); setMap(null); setCodes({}); setFileName(""); send.reset(); }} />
        </>)}
    </>
  );
}
