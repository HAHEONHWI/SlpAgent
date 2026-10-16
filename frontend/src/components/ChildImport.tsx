import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import { detect, FIELD_LABEL, readRows, toChildren, type Field, type ImportRow, type Mapping } from "../lib/childImport";
import { Badge, Button, Card, Label, Notice, Select, Table, Td } from "./ui";

/** 엑셀로 한꺼번에 등록: read the file in the browser, show what will be registered, then send only the
 * derived fields (birth date and sex, never the 주민번호 digit). */
export default function ChildImport({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { children } = useChild();
  const [sheet, setSheet] = useState<{ raw: unknown[][]; headerAt: number; head: string[] } | null>(null);
  const [map, setMap] = useState<Mapping | null>(null), [problem, setProblem] = useState(""), [fileName, setFileName] = useState("");
  const [codes, setCodes] = useState<Record<number, string>>({}); // codes the user edited in the preview, by line
  const [overwrite, setOverwrite] = useState(false);
  const parsed = sheet && map && map.name >= 0 && map.birth >= 0 ? toChildren(sheet.raw, sheet.headerAt, map, children.map((c) => c.alias)) : null;
  const rows = parsed?.map((r) => (codes[r.line] !== undefined ? { ...r, alias: codes[r.line].trim() } : r)) ?? null;
  const byCode = new Map(children.map((c) => [c.alias.trim().toLowerCase(), c]));
  type Known = (typeof children)[number] & { therapist?: string | null; voucher_grade?: string | null };
  const people = new Map(children.map((c) => [`${c.display_name.trim()}|${c.birth_date}`, c as Known]));
  /** What overwriting would change for an already registered child (blank cells keep what is there). */
  const changes = (r: ImportRow, c: Known) => [
    r.alias && r.alias !== c.alias.trim() && "코드", r.therapist && r.therapist !== (c.therapist ?? "") && "담당",
    r.voucher_grade && r.voucher_grade !== (c.voucher_grade ?? "") && "등급", r.sex && r.sex !== (c.sex ?? "") && "성별",
  ].filter(Boolean) as string[];
  const inFile = new Map<string, ImportRow[]>();
  for (const r of rows ?? []) inFile.set(r.alias.toLowerCase(), [...(inFile.get(r.alias.toLowerCase()) ?? []), r]);
  /** Why a row cannot be registered as is: null = new child. */
  const status = (r: ImportRow): { tone: "red" | "slate" | "green" | "indigo"; text: string } => {
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
  const dup = (r: ImportRow) => status(r).tone === "slate";
  const fix = (rows ?? []).filter((r) => status(r).tone === "red");
  const send = useMutation({
    mutationFn: () => api<{ created: number; updated: number; skipped: { display_name: string; reason: string }[] }>("/children/import", { method: "POST",
      json: { overwrite, rows: [...ready, ...update].map(({ alias, display_name, birth_date, sex, therapist, voucher_grade }) => ({ alias, display_name, birth_date, sex, therapist, voucher_grade })) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["children"] }); qc.invalidateQueries({ queryKey: ["org"] }); },
  });
  const pick = async (file?: File) => {
    if (!file) return;
    setProblem(""); setSheet(null); setMap(null); setCodes({}); send.reset(); setFileName(file.name);
    try {
      const raw = await readRows(file);
      const found = detect(raw);
      if (!found) setProblem("제목 줄을 찾지 못했어요. 첫 줄에 ‘대상자명’(또는 이름) 같은 제목이 있어야 해요.");
      else { setSheet({ raw, headerAt: found.headerAt, head: found.head }); setMap(found.map); }
    } catch (e) { setProblem(e instanceof Error && /xls|엑셀/.test(e.message) ? e.message : "파일을 읽지 못했어요. .xlsx 또는 .csv 파일인지 확인해 주세요."); }
  };
  return (
    <Card title="엑셀로 한꺼번에 등록" className="mt-4" action={<Button variant="ghost" onClick={onClose}>닫기</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">첫 줄에 <b>대상자명</b>, <b>생년월일</b>(예: 210405-3), <b>지정제공인력</b>, <b>아이코드</b>, <b>등급명</b>(예: 나형) 제목이 있는 엑셀(.xlsx)이나 CSV를 올려 주세요. 아이코드가 비어 있으면 ‘임시-001’처럼 임시 코드를 붙여요.</p>
        <Notice>생년월일 뒤 숫자(3·4 등)는 이 컴퓨터에서 출생연도와 성별을 알아내는 데만 쓰고 서버로 보내거나 저장하지 않아요. 원본 파일도 올라가지 않아요.</Notice>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600 hover:border-indigo-400 hover:bg-indigo-50/40">
          <FileSpreadsheet size={18} /> {fileName || "파일 선택 (.xlsx, .csv)"}
          <input type="file" accept=".xlsx,.csv,.xls" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {problem && <Notice tone="red">{problem}</Notice>}
        {sheet && map && !send.data && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">열 맞추기 <span className="font-normal text-slate-500">— 각 항목을 엑셀의 어느 열에서 읽을지 확인하세요</span></p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              {(Object.keys(FIELD_LABEL) as Field[]).map((f) => (
                <Label key={f} label={FIELD_LABEL[f] + (f === "name" || f === "birth" ? " *" : "")}>
                  <Select value={map[f]} onChange={(e) => setMap({ ...map, [f]: Number(e.target.value) })}>
                    <option value={-1}>{f === "code" ? "없음 (임시 코드)" : "사용 안 함"}</option>
                    {sheet.head.map((h, i) => <option key={i} value={i}>{String.fromCharCode(65 + (i % 26))}열 · {h || "(제목 없음)"}</option>)}
                  </Select>
                </Label>))}
            </div>
            {(map.name < 0 || map.birth < 0) && <p className="mt-2 text-sm text-red-600">이름과 생년월일 열은 꼭 골라야 해요.</p>}
          </div>)}
        {rows && !rows.length && !send.data && <Notice tone="red">등록할 아동이 없어요.</Notice>}
        {rows && rows.length > 0 && !send.data && (<>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            <span><b>이미 등록된 아이는 엑셀 내용으로 덮어쓰기</b><br />
              <span className="text-slate-500">이름과 생년월일이 같으면 같은 아이로 보고 아이코드·담당·바우처 등급·성별을 엑셀대로 바꿔요. 엑셀에서 빈 칸인 항목은 그대로 두고, 엑셀에 없는 아이는 지우지 않아요. 수업 기록과 출결은 그대로예요.</span></span>
          </label>
          <p className="text-sm">모두 {rows.length}명 · <b className="text-green-700">새로 등록 {ready.length}명</b>
            {overwrite && <> · <b className="text-indigo-700">덮어쓰기 {update.length}명</b></>}
            {rows.some(dup) && <> · {overwrite ? "바뀐 것 없음" : "이미 있음"} {rows.filter(dup).length}명</>}{fix.length > 0 && <> · <span className="text-red-600">확인 필요 {fix.length}명</span></>}</p>
          {fix.some((r) => status(r).text.startsWith("코드 중복")) && <Notice>같은 아이코드를 쓰는 아이가 있어요. 빨간 줄의 아이코드 칸을 눌러 다른 코드로 고치면 함께 등록돼요.</Notice>}
          <div className="max-h-96 overflow-y-auto">
            <Table head={["줄", "아이코드", "이름", "생년월일", "성별", "담당", "등급", ""]}>
              {rows.map((r) => { const st = status(r); return (
                <tr key={r.line} className={st.tone === "red" ? "bg-red-50" : st.tone === "slate" ? "text-slate-400" : st.tone === "indigo" ? "bg-indigo-50/50" : ""}>
                  <Td className="text-xs text-slate-400">{r.line}</Td>
                  <Td><input value={r.alias} maxLength={40} onChange={(e) => setCodes({ ...codes, [r.line]: e.target.value })} aria-label={`${r.display_name} 아이코드`}
                    className={`w-20 rounded border px-1 py-0.5 text-sm ${st.tone === "red" && !r.error ? "border-red-400 bg-white" : "border-transparent bg-transparent hover:border-slate-300"}`} /></Td>
                  <Td>{r.display_name}</Td><Td>{r.birth_date || "-"}</Td><Td>{r.sex ?? "-"}</Td><Td>{r.therapist ?? "-"}</Td><Td>{r.voucher_grade ? `${r.voucher_grade}형` : "-"}</Td>
                  <Td><Badge tone={st.tone}>{st.text}</Badge></Td>
                </tr>); })}
            </Table>
          </div>
          {send.error && <Notice tone="red">{errText(send.error)}</Notice>}
          <Button disabled={!(ready.length + update.length) || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? "저장 중…" : [ready.length && `${ready.length}명 등록`, update.length && `${update.length}명 덮어쓰기`].filter(Boolean).join(" · ")}</Button>
        </>)}
        {send.data && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-green-700">{send.data.created}명을 등록했어요.{send.data.updated ? ` ${send.data.updated}명을 덮어썼어요.` : ""}</p>
            {send.data.skipped.length > 0 && <Notice>건너뛴 {send.data.skipped.length}명: {send.data.skipped.map((s) => `${s.display_name}(${s.reason})`).join(", ")}</Notice>}
            <Button variant="outline" onClick={() => { setSheet(null); setMap(null); setCodes({}); setFileName(""); send.reset(); }}>다른 파일 올리기</Button>
          </div>)}
      </div>
    </Card>
  );
}
