import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errText } from "@/lib/api";
import { useChild } from "@/lib/child";
import { hm, monday, plusDays, today } from "@/lib/dates";
import { refreshSchedules, useTherapists } from "@/lib/hooks";
import { canWrite, useMe } from "@/lib/me";
import { CLASS_PAY, type ClassPay } from "@/lib/extraClass";
import { ChildPicker } from "./ChildPicker";
import { Badge, Button, C, Card, Checkbox, DateField, Empty, IconButton, Input, Loading, Notice, Row, Segmented, Select, Sheet, T, TextField, s } from "./ui";

type Teacher = { id: string; name: string; short: string; color: string };
type Config = { session_minutes: number; break_minutes: number; morning_start: string; morning_count: number; afternoon_start: string; afternoon_count: number; days: number[]; teachers: Teacher[]; closed: string[] };
type Entry = { id: string; day: number; slot: string; teacher_id: string; child_id: string | null; pay?: ClassPay; label: string | null; note: string | null; highlight: boolean; valid_from: string | null; valid_to: string | null };
type Data = { config: Config; morning: string[]; afternoon: string[]; entries: Entry[] };
type Cell = { day: number; slot: string; teacher: Teacher };

const DAY = ["", "월", "화", "수", "목", "금", "토", "일"];
const PALETTE = ["#2563eb", "#9f1239", "#7e22ce", "#ea580c", "#15803d", "#0f766e", "#be185d", "#a16207", "#1e40af", "#4d7c0f"];
const newId = () => Math.random().toString(36).slice(2, 10);

/** Weekly timetable, one weekday at a time on the phone: rows are time slot x teacher, like the paper sheet. */
export default function Timetable() {
  const qc = useQueryClient();
  const me = useMe().data;
  const isAdmin = me?.role === "admin", writable = canWrite(me);
  const { children } = useChild();
  const [day, setDay] = useState(() => new Date().getDay() || 7); // ISO weekday, today by default
  const tt = useQuery({ queryKey: ["timetable"], queryFn: () => api<Data>("/timetable") });
  const [week, setWeek] = useState(today());
  const [edit, setEdit] = useState(false), [cell, setCell] = useState<Cell | null>(null), [setup, setSetup] = useState(false);
  const refresh = () => refreshSchedules(qc, ["timetable"]);

  const from = monday(week), to = plusDays(from, 6);
  const byCell = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of tt.data?.entries ?? []) {
      if ((e.valid_from ?? "0000") > to || (e.valid_to ?? "9999") < from) continue; // not running that week
      const k = `${e.day}|${e.slot}|${e.teacher_id}`; m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [tt.data, from, to]);
  const childName = (id: string | null) => children.find((c) => c.id === id)?.display_name ?? "(삭제된 아동)";

  if (tt.isLoading) return <Loading />;
  if (!tt.data) return <Notice tone="red">{errText(tt.error)}</Notice>;
  const { config: cfg, morning, afternoon } = tt.data;
  const shown = cfg.days.includes(day) ? day : cfg.days[0];
  const closed = new Set(cfg.closed);
  const isClosed = (d: number, slot: string, t: string) => closed.has(`${d}|${slot}|*`) || closed.has(`${d}|${slot}|${t}`);

  const block = (slot: string) => (
    <View key={slot} style={{ flexDirection: "row", borderTopWidth: 1, borderColor: C.line, backgroundColor: slot >= "19:00" ? C.paper : C.white }}>
      <View style={{ width: 54, justifyContent: "center", alignItems: "center", borderRightWidth: 1, borderColor: C.line }}>
        <Text style={{ fontWeight: "700", color: C.ink, fontVariant: ["tabular-nums"] }}>{hm(slot)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {cfg.teachers.map((t, i) => {
          const off = isClosed(shown, slot, t.id);
          const items = byCell.get(`${shown}|${slot}|${t.id}`) ?? [];
          return (
            <Pressable key={t.id} disabled={!edit} onPress={() => setCell({ day: shown, slot, teacher: t })}
              style={({ pressed }) => [s.row, { minHeight: 36, paddingHorizontal: 8, borderTopWidth: i ? 1 : 0, borderColor: C.line, backgroundColor: off ? C.slateBg : pressed ? C.accentSoft : "transparent" }]}>
              <Text style={{ width: 30, textAlign: "center", fontWeight: "800", color: t.color }}>{t.short}</Text>
              <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6, paddingVertical: 4 }}>
                {off && <Text style={{ color: C.muted, fontSize: 12 }}>닫힘</Text>}
                {items.map((e) => (
                  <Text key={e.id} style={[{ color: t.color, fontWeight: "700", fontSize: 14 }, e.highlight && { backgroundColor: "#fde68a", borderRadius: 6, paddingHorizontal: 4 }]}>
                    {e.child_id ? childName(e.child_id) : e.label}{e.note ? <Text style={{ fontWeight: "400" }}>({e.note})</Text> : null}
                    {e.child_id && e.pay === "private" ? <Text style={{ fontWeight: "400" }}> · 사비</Text> : null}
                  </Text>))}
              </View>
              {edit && !off && <Text style={{ color: C.muted }}>＋</Text>}
            </Pressable>);
        })}
      </View>
    </View>);

  return (
    <View style={{ gap: 12 }}>
      <Row style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <IconButton icon="chevron-back" label="지난주" onPress={() => setWeek(plusDays(from, -7))} />
        <View style={{ alignItems: "center" }}>
          <T bold>{`${from.slice(5).replace("-", "/")} ~ ${to.slice(5).replace("-", "/")}`}</T>
          <T small muted>{`수업 ${cfg.session_minutes}분 + 상담 ${cfg.break_minutes}분`}</T>
        </View>
        <IconButton icon="chevron-forward" label="다음주" onPress={() => setWeek(plusDays(from, 7))} />
      </Row>
      <Row>
        {writable && <Button small variant={edit ? "primary" : "outline"} icon="create-outline" title={edit ? "편집 끝내기" : "편집"} onPress={() => { setEdit(!edit); setCell(null); }} />}
        {isAdmin && <Button small variant="outline" icon="settings-outline" title="시간·교사 설정" onPress={() => setSetup(true)} />}
      </Row>
      {!cfg.teachers.length ? (
        <Card><Empty>{isAdmin ? "‘시간·교사 설정’에서 담당 교사를 먼저 추가하세요." : "아직 시간표가 없습니다. 기관 관리자가 담당 교사를 설정해야 합니다."}</Empty></Card>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {cfg.days.map((d) => (
              <Pressable key={d} accessibilityRole="tab" accessibilityState={{ selected: d === shown }} onPress={() => setDay(d)}
                style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center", backgroundColor: d === shown ? C.accent : C.paper }}>
                <Text style={{ color: d === shown ? "#fff" : C.ink, fontWeight: "700" }}>{DAY[d]}</Text>
              </Pressable>))}
          </View>
          {edit && <T small style={{ color: C.accentDark }}>칸을 누르면 아동을 넣거나 뺄 수 있어요.</T>}
          <View style={{ borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: C.border, backgroundColor: C.white }}>
            {morning.map(block)}
            {morning.length > 0 && afternoon.length > 0 && <Text style={{ textAlign: "center", paddingVertical: 6, backgroundColor: C.paper, color: C.text2, fontWeight: "700", letterSpacing: 6, borderTopWidth: 1, borderColor: C.border }}>점심시간</Text>}
            {afternoon.map(block)}
          </View>
        </>
      )}
      <Sheet visible={!!cell} onClose={() => setCell(null)} title={cell ? `${DAY[cell.day]}요일 ${hm(cell.slot)} · ${cell.teacher.name}` : ""}>
        {cell && <CellEditor key={`${cell.day}${cell.slot}${cell.teacher.id}`} cell={cell} entries={byCell.get(`${cell.day}|${cell.slot}|${cell.teacher.id}`) ?? []} cfg={cfg} isAdmin={isAdmin}
          closedHere={isClosed(cell.day, cell.slot, cell.teacher.id)} onSaved={refresh} />}
      </Sheet>
      <Sheet visible={setup && isAdmin} onClose={() => setSetup(false)} title="시간·교사 설정">
        {setup && <Setup cfg={cfg} onDone={() => { setSetup(false); refresh(); }} />}
      </Sheet>
    </View>
  );
}

function CellEditor({ cell, entries, cfg, isAdmin, closedHere, onSaved }: { cell: Cell; entries: Entry[]; cfg: Config; isAdmin: boolean; closedHere: boolean; onSaved: () => void }) {
  const { children } = useChild();
  const blank = { mode: "child" as "child" | "label", child_id: "", pay: "voucher" as ClassPay, label: "", note: "", highlight: false, valid_from: "", valid_to: "" };
  const [f, setF] = useState(blank), [editing, setEditing] = useState<string | null>(null);
  const body = () => ({ day: cell.day, slot: cell.slot, teacher_id: cell.teacher.id, child_id: f.mode === "child" ? f.child_id || null : null, label: f.mode === "label" ? f.label : null,
    pay: f.pay, note: f.note.trim() || null, highlight: f.highlight, valid_from: f.valid_from || null, valid_to: f.valid_to || null });
  const save = useMutation({
    mutationFn: () => editing ? api(`/timetable/entries/${editing}`, { method: "PUT", json: body() }) : api("/timetable/entries", { method: "POST", json: body() }),
    onSuccess: () => { setF(blank); setEditing(null); onSaved(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/timetable/entries/${id}`, { method: "DELETE" }), onSuccess: onSaved });
  const toggle = useMutation({
    mutationFn: (key: string) => api("/timetable/config", { method: "PUT", json: { ...cfg, closed: cfg.closed.includes(key) ? cfg.closed.filter((k) => k !== key) : [...cfg.closed, key] } }),
    onSuccess: onSaved,
  });
  const load = (e: Entry) => { setEditing(e.id); setF({ mode: e.child_id ? "child" : "label", child_id: e.child_id ?? "", pay: e.pay ?? "voucher", label: e.label ?? "", note: e.note ?? "", highlight: e.highlight, valid_from: e.valid_from ?? "", valid_to: e.valid_to ?? "" }); };
  const slotKey = `${cell.day}|${cell.slot}|*`, cellKey = `${cell.day}|${cell.slot}|${cell.teacher.id}`;
  const err = save.error || remove.error || toggle.error;
  return (
    <>
      {entries.map((e) => (
        <Row key={e.id} style={{ flexWrap: "nowrap", borderBottomWidth: 1, borderColor: C.line, paddingBottom: 8 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <T bold>{e.child_id ? children.find((c) => c.id === e.child_id)?.display_name ?? "(삭제된 아동)" : e.label}</T>
            <Row>{!e.child_id ? <Badge>미등록</Badge> : <Badge tone={e.pay === "private" ? "amber" : "indigo"}>{CLASS_PAY[e.pay ?? "voucher"]}</Badge>}
              <T small muted>{[e.note, (e.valid_from || e.valid_to) && `${e.valid_from ?? ""}~${e.valid_to ?? ""}`].filter(Boolean).join(" · ")}</T></Row>
          </View>
          <IconButton icon="create-outline" label="수정" onPress={() => load(e)} />
          <IconButton icon="trash-outline" label="빼기" color={C.red} onPress={() => remove.mutate(e.id)} />
        </Row>))}
      {closedHere ? <Notice>닫아 둔 칸입니다.</Notice> : (
        <>
          <T bold>{editing ? "수정" : "아동 넣기"}</T>
          <Segmented value={f.mode} onChange={(mode) => setF({ ...f, mode })} items={[["child", "등록된 아동"], ["label", "이름만 입력"]]} />
          {f.mode === "child"
            ? <ChildPicker value={f.child_id || null} onChange={(id) => setF({ ...f, child_id: id ?? "" })} />
            : <TextField label="아동 이름" value={f.label} maxLength={30} onChangeText={(label) => setF({ ...f, label })} hint="이름만 넣은 칸은 시간표에만 보이고, 날짜별 일정·출결은 만들어지지 않아요." />}
          {f.mode === "child" && <Select label="수업 구분" value={f.pay} options={Object.entries(CLASS_PAY) as [ClassPay, string][]} onChange={(pay) => setF({ ...f, pay })} />}
          <TextField label="메모 (예: 13, 10월-)" value={f.note} maxLength={60} onChangeText={(note) => setF({ ...f, note })} />
          <Row style={{ flexWrap: "nowrap" }}>
            <View style={{ flex: 1 }}><DateField label="시작일 (선택)" optional value={f.valid_from} onChange={(valid_from) => setF({ ...f, valid_from })} /></View>
            <View style={{ flex: 1 }}><DateField label="종료일 (선택)" optional value={f.valid_to} onChange={(valid_to) => setF({ ...f, valid_to })} /></View>
          </Row>
          <Checkbox checked={f.highlight} onChange={(highlight) => setF({ ...f, highlight })} label="노란색으로 강조" />
          <Row>
            <Button title={editing ? "저장" : "넣기"} loading={save.isPending} disabled={(f.mode === "child" && !f.child_id) || (f.mode === "label" && !f.label.trim())} onPress={() => save.mutate()} />
            {editing && <Button variant="ghost" title="취소" onPress={() => { setEditing(null); setF(blank); }} />}
          </Row>
        </>)}
      {isAdmin && (
        <Row style={{ borderTopWidth: 1, borderColor: C.line, paddingTop: 10 }}>
          {!cfg.closed.includes(slotKey) && <Button small variant="outline" title={cfg.closed.includes(cellKey) ? "이 칸 열기" : "이 칸 닫기"} onPress={() => toggle.mutate(cellKey)} />}
          <Button small variant="outline" title={`${DAY[cell.day]} ${hm(cell.slot)} 전체 ${cfg.closed.includes(slotKey) ? "열기" : "닫기"}`} onPress={() => toggle.mutate(slotKey)} />
        </Row>)}
      {err && <Notice tone="red">{errText(err)}</Notice>}
    </>
  );
}

function Setup({ cfg, onDone }: { cfg: Config; onDone: () => void }) {
  const [c, setC] = useState<Config>(cfg);
  const roster = useTherapists();
  const save = useMutation({ mutationFn: () => api("/timetable/config", { method: "PUT", json: c }), onSuccess: onDone });
  const num = (k: keyof Config) => (v: string) => setC({ ...c, [k]: Number(v.replace(/\D/g, "")) || 0 });
  const setT = (i: number, patch: Partial<Teacher>) => setC({ ...c, teachers: c.teachers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const move = (i: number, d: number) => { const t = [...c.teachers]; [t[i], t[i + d]] = [t[i + d], t[i]]; setC({ ...c, teachers: t }); };
  const half = (node: React.ReactNode) => <View style={{ flex: 1 }}>{node}</View>;
  return (
    <>
      <Row style={{ flexWrap: "nowrap" }}>{half(<TextField label="수업(분)" keyboardType="number-pad" value={String(c.session_minutes)} onChangeText={num("session_minutes")} />)}
        {half(<TextField label="상담·쉬는(분)" keyboardType="number-pad" value={String(c.break_minutes)} onChangeText={num("break_minutes")} />)}</Row>
      <Row style={{ flexWrap: "nowrap" }}>{half(<DateField label="오전 시작" mode="time" value={c.morning_start} onChange={(v) => setC({ ...c, morning_start: v })} />)}
        {half(<TextField label="오전 타임 수" keyboardType="number-pad" value={String(c.morning_count)} onChangeText={num("morning_count")} />)}</Row>
      <Row style={{ flexWrap: "nowrap" }}>{half(<DateField label="오후 시작" mode="time" value={c.afternoon_start} onChange={(v) => setC({ ...c, afternoon_start: v })} />)}
        {half(<TextField label="오후 타임 수" keyboardType="number-pad" value={String(c.afternoon_count)} onChangeText={num("afternoon_count")} />)}</Row>
      <T small muted>운영 요일</T>
      <Row>{[1, 2, 3, 4, 5, 6, 7].map((d) => (
        <Checkbox key={d} checked={c.days.includes(d)} label={DAY[d]} onChange={(on) => setC({ ...c, days: on ? [...c.days, d].sort() : c.days.filter((x) => x !== d) })} />))}</Row>
      <T small muted>담당 교사 (시간마다 이 순서로 줄이 생겨요)</T>
      {c.teachers.map((t, i) => (
        <View key={t.id} style={{ gap: 6, padding: 10, borderRadius: 14, backgroundColor: C.paper }}>
          <Row style={{ flexWrap: "nowrap" }}>
            <View style={{ width: 70 }}><Input value={t.short} maxLength={4} placeholder="약칭" style={{ color: t.color, fontWeight: "800", textAlign: "center" }} onChangeText={(short) => setT(i, { short })} /></View>
            <View style={{ flex: 1 }}><Input value={t.name} maxLength={20} placeholder="이름" onChangeText={(name) => setT(i, { name })} onBlur={() => !t.short.trim() && t.name.trim() && setT(i, { short: t.name.trim().slice(0, 1) })} /></View>
          </Row>
          {roster.length > 0 && !t.name && <Select value="" placeholder="치료사 목록에서 고르기" options={roster.map((n) => [n, n] as [string, string])} onChange={(name) => setT(i, { name, short: t.short || name.slice(0, 1) })} />}
          <Row gap={6}>{PALETTE.map((p) => (
            <Pressable key={p} accessibilityLabel={`색 ${p}`} onPress={() => setT(i, { color: p })}
              style={{ width: 24, height: 24, borderRadius: 99, backgroundColor: p, borderWidth: t.color === p ? 3 : 0, borderColor: C.inkDark }} />))}</Row>
          <Row>
            <IconButton icon="arrow-up" label="위로" disabled={i === 0} onPress={() => move(i, -1)} />
            <IconButton icon="arrow-down" label="아래로" disabled={i === c.teachers.length - 1} onPress={() => move(i, 1)} />
            <Button small variant="ghost" title="삭제" onPress={() => setC({ ...c, teachers: c.teachers.filter((_, j) => j !== i) })} />
          </Row>
        </View>))}
      <Button variant="outline" title="+ 교사 추가" disabled={c.teachers.length >= 20}
        onPress={() => setC({ ...c, teachers: [...c.teachers, { id: newId(), name: "", short: "", color: PALETTE[c.teachers.length % PALETTE.length] }] })} />
      <T small muted>교사를 지우면 그 교사 줄의 칸은 시간표에서 보이지 않아요(기록은 남아요).</T>
      {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
      <Button title="저장" loading={save.isPending} onPress={() => save.mutate()} />
    </>
  );
}
