import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errText } from "@/lib/api";
import { dow, hm, plusMinutes, today } from "@/lib/dates";
import { refreshSchedules } from "@/lib/hooks";
import { canWrite, useMe } from "@/lib/me";
import { Button, C, Checkbox, Loading, MonthNav, Notice, Row, Segmented, Select, T } from "./ui";

type Slot = { date: string; start: string };
type Plan = { child_id: string; same_as_actual: boolean; slots: Slot[] };
type Sheet = { therapist: string; therapists: string[] | null; names: Record<string, string>; classes: (Slot & { child_id: string })[]; plans: Plan[] };
type Data = { config: { session_minutes: number; days: number[] }; morning: string[]; afternoon: string[] };

const isoDay = (d: string) => new Date(d + "T00:00:00").getDay() || 7;
const daysOf = (month: string, keep: number[]) => {
  const [y, m] = month.split("-").map(Number), last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).filter((d) => keep.includes(isoDay(d)));
};
const sorted = (s: Slot[]) => [...s].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
const COL = 74;

/** 월간 수업일정표, one teacher at a time: rows = days, columns = time slots (scroll sideways). 실제 = the teacher's classes,
 *  결제 = the dates each child's 바우처 서류 claims (실제와 동일: the first 5 classes; otherwise the 결제 날짜 entered here). */
export default function MonthSheet() {
  const qc = useQueryClient();
  const writable = canWrite(useMe().data);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [view, setView] = useState<"actual" | "pay">("actual");
  const [teacher, setTeacher] = useState<string | null>(null); // null = the server's default (admin: own name or first)
  const [childId, setChildId] = useState(""), [draft, setDraft] = useState<{ same: boolean; slots: Slot[] } | null>(null);
  const tt = useQuery({ queryKey: ["timetable"], queryFn: () => api<Data>("/timetable") });
  const q = new URLSearchParams({ month, ...(teacher !== null && { therapist: teacher }) });
  const sheet = useQuery({ queryKey: ["month-sheet", q.toString()], queryFn: () => api<Sheet>(`/month-sheet?${q}`) });
  const name = (id: string) => sheet.data?.names[id] ?? "?";
  const plan = sheet.data?.plans.find((p) => p.child_id === childId);
  const actual = useMemo(() => sheet.data?.classes ?? [], [sheet.data]);
  const save = useMutation({
    mutationFn: () => api(`/children/${childId}/pay-plan?month=${month}`, { method: "PUT", json: { same_as_actual: draft!.same, slots: draft!.slots } }),
    onSuccess: () => { setDraft(null); refreshSchedules(qc); },
  });

  // Each cell's names: 결제 view shows the open draft in place of that child's saved 결제 일정.
  const cells = useMemo(() => {
    const m = new Map<string, string[]>();
    const put = (cid: string, s: Slot) => { const k = `${s.date}|${s.start}`; m.set(k, [...(m.get(k) ?? []), cid]); };
    if (view === "actual") actual.forEach((s) => put(s.child_id, s));
    else for (const p of sheet.data?.plans ?? []) (p.child_id === childId && draft ? draft.slots : p.slots).forEach((s) => put(p.child_id, s));
    if (view === "pay" && draft && childId && !sheet.data?.plans.some((p) => p.child_id === childId)) draft.slots.forEach((s) => put(childId, s));
    return m;
  }, [view, actual, sheet.data, childId, draft]);

  if (!tt.data) return tt.error ? <Notice tone="red">{errText(tt.error)}</Notice> : <Loading />;
  const { config, morning, afternoon } = tt.data;
  const times = [...new Set([...morning, ...afternoon, ...[...cells.keys()].map((k) => k.split("|")[1])])].sort();
  const days = daysOf(month, config.days.length ? config.days : [1, 2, 3, 4, 5]);
  const editing = view === "pay" && !!draft && !draft.same;
  const pick = (cid: string) => { setChildId(cid); setDraft(null); save.reset(); };
  const open = () => setDraft({ same: plan?.same_as_actual ?? true, slots: sorted(plan?.slots ?? []) });
  const toggle = (sl: Slot) => draft && setDraft({ ...draft, slots: draft.slots.some((x) => x.date === sl.date && x.start === sl.start)
    ? draft.slots.filter((x) => !(x.date === sl.date && x.start === sl.start)) : sorted([...draft.slots, sl]) });

  return (
    <View style={{ gap: 12 }}>
      <MonthNav value={month} onChange={(m) => { setMonth(m); setDraft(null); }} />
      {sheet.data?.therapists && <Select label="교사" value={sheet.data.therapist} placeholder="교사 선택" options={sheet.data.therapists.map((t) => [t, t] as [string, string])}
        onChange={(t) => { setTeacher(t); setChildId(""); setDraft(null); }} />}
      <Segmented value={view} onChange={setView} items={[["actual", "실제 일정"], ["pay", "결제 일정"]]} />
      {view === "pay" && (
        <View style={{ gap: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line }}>
          <T small muted>결제 일정의 날짜가 바우처 서류에 올라가요. ‘실제와 동일’이면 따로 입력하지 않고 그 달 실제 수업 중 처음 5회만 바우처, 나머지는 사비로 잡혀요.</T>
          <Select value={childId} placeholder="아동 선택" title="아동 선택" options={Object.entries(sheet.data?.names ?? {}) as [string, string][]} onChange={pick} />
          {childId && !draft && (
            <Row>
              <T small muted>{plan?.same_as_actual === false ? `결제 일정 ${plan.slots.length}회` : "실제와 동일 (처음 5회)"}</T>
              {writable && <Button small variant="outline" title="결제 일정 수정" onPress={open} />}
            </Row>)}
          {childId && draft && (
            <>
              <Checkbox checked={draft.same} label="실제와 동일" onChange={(same) => setDraft({ same, slots: draft.slots.length ? draft.slots : sorted(plan?.slots ?? []) })} />
              {!draft.same && <T small muted>{`아래 표에서 칸을 눌러 ${name(childId)}의 결제 날짜를 넣고 빼요 · ${draft.slots.length}회`}</T>}
              {!draft.same && plan?.same_as_actual !== false && <T small muted>실제 수업 처음 5회로 미리 채웠어요</T>}
              <Row>
                <Button small title="저장" loading={save.isPending} disabled={!draft.same && !draft.slots.length} onPress={() => save.mutate()} />
                <Button small variant="ghost" title="취소" onPress={() => setDraft(null)} />
              </Row>
            </>)}
          {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
        </View>)}
      {sheet.error && <Notice tone="red">{errText(sheet.error)}</Notice>}
      {sheet.data && !sheet.data.therapist && !sheet.data.therapists && <Notice>치료사 목록에 이 계정이 연결되지 않아 볼 수 있는 수업이 없어요. 기관 관리자에게 연결을 요청하세요.</Notice>}
      <T bold style={{ textAlign: "center" }}>{`${sheet.data?.therapist ? `${sheet.data.therapist} · ` : ""}${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월 수업일정표${view === "pay" ? "(결제)" : ""}`}</T>
      <ScrollView horizontal style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.white }}>
        <View>
          <View style={{ flexDirection: "row", backgroundColor: C.amberBg }}>
            <View style={{ width: 52, borderRightWidth: 1, borderColor: C.border }} />
            {times.map((t) => (
              <View key={t} style={{ width: COL, padding: 4, borderRightWidth: 1, borderColor: C.border, alignItems: "center" }}>
                <Text style={{ fontSize: 12, color: C.ink }}>{hm(t)}</Text><Text style={{ fontSize: 11, color: C.red }}>~ {hm(plusMinutes(t, config.session_minutes))}</Text>
              </View>))}
          </View>
          {days.map((d, i) => (
            <View key={d} style={{ flexDirection: "row", borderTopWidth: i > 0 && isoDay(d) < isoDay(days[i - 1]) ? 2 : 1, borderColor: i > 0 && isoDay(d) < isoDay(days[i - 1]) ? C.inkDark : C.border }}>
              <View style={{ width: 52, padding: 4, backgroundColor: "#fde7d4", borderRightWidth: 1, borderColor: C.border, justifyContent: "center" }}>
                <Text style={{ fontSize: 12, color: C.ink, textAlign: "center" }}>{`${Number(d.slice(8))} ${dow(d)}`}</Text>
              </View>
              {times.map((t) => {
                const who = cells.get(`${d}|${t}`) ?? [];
                const mine = editing && who.includes(childId);
                return (
                  <Pressable key={t} disabled={!editing && !(view === "pay" && !draft && who.length > 0)}
                    onPress={() => (editing ? toggle({ date: d, start: t }) : who[0] && pick(who[0]))}
                    style={{ width: COL, minHeight: 36, padding: 3, borderRightWidth: 1, borderColor: C.border, backgroundColor: mine ? C.accentSoft : "transparent" }}>
                    {who.map((cid, j) => (
                      <Text key={cid + j} numberOfLines={1} style={{ fontSize: 12, color: cid === childId && view === "pay" ? C.accentDark : "#9f1239", fontWeight: cid === childId && view === "pay" ? "700" : "400" }}>{name(cid)}</Text>))}
                  </Pressable>);
              })}
            </View>))}
        </View>
      </ScrollView>
    </View>
  );
}
