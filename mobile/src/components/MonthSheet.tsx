import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errText } from "@/lib/api";
import { dow, hm, plusMinutes, today } from "@/lib/dates";
import { refreshSchedules } from "@/lib/hooks";
import { canWrite, useMe } from "@/lib/me";
import EditClassSheet, { type Cls } from "./EditClassForm";
import { Button, C, Checkbox, Loading, MonthNav, Notice, Row, Segmented, Select, Sheet as ModalSheet, T, confirm } from "./ui";

type Slot = { date: string; start: string };
type Lesson = Cls & { child_id: string; can_edit: boolean; revision: string };
type Plan = { child_id: string; mode: "actual" | "manual" | "unset"; slots: Slot[]; can_edit: boolean; revision: string | null };
type Sheet = { reserved?: (Slot & { end: string })[]; aliases?: Record<string, string>; therapist: string; therapists: string[] | null; can_edit: boolean; default_same_as_actual: boolean; names: Record<string, string>; classes: Lesson[]; plans: Plan[] };
type Draft = { childId: string; month: string; same: boolean; slots: Slot[]; revision: string | null };
type Preference = { therapist: string; same_as_actual: boolean; revision: string | null };
type Data = { config: { session_minutes: number; days: number[] }; morning: string[]; afternoon: string[] };

const isoDay = (d: string) => new Date(d + "T00:00:00").getDay() || 7;
const daysOf = (month: string, keep: number[]) => {
  const [y, m] = month.split("-").map(Number), last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).filter((d) => keep.includes(isoDay(d)));
};
const sorted = (s: Slot[]) => [...s].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
const COL = 74;

function PaymentSetting({ account, locked }: { account: string; locked: boolean }) {
  const qc = useQueryClient();
  const key = ["payment-settings", account];
  const settings = useQuery({ queryKey: key, queryFn: () => api<Preference>("/me/payment-settings") });
  const [draft, setDraft] = useState<Preference | null>(null);
  const save = useMutation({
    mutationFn: (d: Preference) => api<Preference>("/me/payment-settings", { method: "PUT", json: { same_as_actual: d.same_as_actual, expected_revision: d.revision } }),
    onSuccess: (saved) => { qc.setQueryData(key, saved); setDraft(null); refreshSchedules(qc); },
    onError: (error) => { if (error instanceof ApiError && error.status === 409) { setDraft(null); void settings.refetch(); } },
  });
  const current = settings.data;
  const close = () => { if (!save.isPending) setDraft(null); };
  return <>
    <T bold>내 결제 설정</T>
    {current && <Row>
      <T small muted>{current.same_as_actual ? "실제 일정과 동일 · 처음 5회 바우처" : "실제 일정 자동 적용 꺼짐"}</T>
      <Button small variant="outline" title="내 설정 변경" disabled={locked || settings.isFetching} onPress={() => { save.reset(); setDraft(current); }} />
    </Row>}
    {settings.isLoading && <Loading />}
    {settings.error && <Notice tone="red">{errText(settings.error)}</Notice>}
    {!draft && save.error && <Notice tone="red">{errText(save.error)}</Notice>}
    <ModalSheet visible={!!draft} onClose={close} title="내 결제 설정">
      {draft && <>
        <T>{draft.therapist} 선생님이 저장한 달부터 매달 적용돼요. 아동별로 따로 저장한 결제 일정이 우선해요.</T>
        <Checkbox label="실제 일정과 동일 · 아동별 매달 앞 5회만 바우처로 계산" checked={draft.same_as_actual} disabled={save.isPending}
          onChange={(same_as_actual) => setDraft({ ...draft, same_as_actual })} />
        <T small muted>체크하면 해당 월의 바우처 대상 수업 중 6회째부터 사비로 잡혀요. 체크를 해제하면 별도 일정이 없는 아동의 자동 분류를 보류해요.</T>
        {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
        <Row>
          <Button small title="설정 저장" loading={save.isPending} disabled={draft.same_as_actual === current?.same_as_actual}
            onPress={async () => { if (await confirm("내 결제 설정을 저장할까요?", draft.same_as_actual ? "이번 달부터 실제 일정의 첫 5회를 바우처로 계산해요." : "이번 달부터 실제 일정 자동 적용을 해제해요.", "저장")) save.mutate(draft); }} />
          <Button small variant="ghost" title="취소" disabled={save.isPending} onPress={close} />
        </Row>
      </>}
    </ModalSheet>
  </>;
}

/** 월간 수업일정표, one teacher at a time: rows = days, columns = time slots (scroll sideways). 실제 = the teacher's classes,
 *  결제 = the dates each child's 바우처 서류 claims (실제와 동일: the first 5 classes; otherwise the 결제 날짜 entered here). */
export default function MonthSheet() {
  const qc = useQueryClient();
  const me = useMe().data;
  const writable = canWrite(me);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [view, setView] = useState<"actual" | "pay">("actual");
  const [slot, setSlot] = useState<Slot | null>(null), [newChild, setNewChild] = useState("");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [teacher, setTeacher] = useState<string | null>(null); // null = the server's default (admin: own name or first)
  const [childId, setChildId] = useState(""), [draft, setDraft] = useState<Draft | null>(null);
  const tt = useQuery({ queryKey: ["timetable"], queryFn: () => api<Data>("/timetable") });
  const q = new URLSearchParams({ month, ...(teacher !== null && { therapist: teacher }) });
  const sheet = useQuery({ queryKey: ["month-sheet", me?.org_id, me?.uid, q.toString()], queryFn: () => api<Sheet>(`/month-sheet?${q}`), enabled: !!me });
  const name = (id: string) => sheet.data?.names[id] ?? "?";
  const plan = sheet.data?.plans.find((p) => p.child_id === childId);
  const actual = useMemo(() => sheet.data?.classes ?? [], [sheet.data]);
  const add = useMutation({
    mutationFn: (where: Slot) => api("/schedules/month-sheet", { method: "POST", json: { ...where, child_id: newChild, therapist: sheet.data?.therapist } }),
    onSuccess: () => { setSlot(null); refreshSchedules(qc); },
    onError: () => { void sheet.refetch(); },
  });
  const openSlot = (date: string, start: string) => { setNewChild(""); add.reset(); setSlot({ date, start }); };
  const available = (sheet.data?.plans ?? []).filter(p => p.can_edit);
  const reserved = view === "actual" ? sheet.data?.reserved ?? [] : [];
  const save = useMutation({
    mutationFn: (d: Draft) => api(`/children/${d.childId}/pay-plan?month=${d.month}`, { method: "PUT", json: { same_as_actual: d.same, slots: d.same ? [] : d.slots, expected_revision: d.revision } }),
    onSuccess: () => { setDraft(null); refreshSchedules(qc); },
    onError: (error) => { if (error instanceof ApiError && error.status === 409) { setDraft(null); void sheet.refetch(); } },
  });

  // Each cell's names: 결제 view shows the open draft in place of that child's saved 결제 일정.
  const cells = useMemo(() => {
    const m = new Map<string, { childId: string; lesson?: Lesson }[]>();
    const put = (childId: string, s: Slot, lesson?: Lesson) => { const k = `${s.date}|${s.start}`; m.set(k, [...(m.get(k) ?? []), { childId, lesson }]); };
    if (view === "actual") actual.forEach((s) => put(s.child_id, s, s));
    else for (const p of sheet.data?.plans ?? []) {
      let slots = p.slots;
      if (draft && p.child_id === draft.childId) slots = draft.same ? (p.mode === "actual" ? p.slots : []) : draft.slots;
      slots.forEach((s) => put(p.child_id, s));
    }
    return m;
  }, [view, actual, sheet.data, draft]);

  if (!tt.data) return tt.error ? <Notice tone="red">{errText(tt.error)}</Notice> : <Loading />;
  const { config, morning, afternoon } = tt.data;
  const times = [...new Set([...morning, ...afternoon, ...reserved.map(s => s.start), ...[...cells.keys()].map((k) => k.split("|")[1])])].sort();
  const days = [...new Set([...daysOf(month, config.days.length ? config.days : [1, 2, 3, 4, 5]), ...reserved.map(s => s.date), ...[...cells.keys()].map((k) => k.split("|")[0])])].sort();
  const ownSheet = writable && !!sheet.data?.can_edit;
  const mayEditPlan = ownSheet && !!plan?.can_edit;
  const editing = view === "pay" && !!draft && !draft.same && mayEditPlan;
  const pick = (cid: string) => { setChildId(cid); setDraft(null); save.reset(); };
  const open = () => {
    if (!mayEditPlan || !plan) return;
    save.reset();
    setDraft({ childId, month, same: plan.mode === "actual" && !!sheet.data?.default_same_as_actual, slots: sorted(plan.slots), revision: plan.revision });
  };
  const toggle = (sl: Slot) => draft && setDraft({ ...draft, slots: draft.slots.some((x) => x.date === sl.date && x.start === sl.start)
    ? draft.slots.filter((x) => !(x.date === sl.date && x.start === sl.start)) : sorted([...draft.slots, sl]) });

  return (
    <View style={{ gap: 12 }}>
      <MonthNav value={month} disabled={!!draft} onChange={(m) => { setMonth(m); pick(""); }} />
      {sheet.data?.therapists && <Select label="교사" value={sheet.data.therapist} placeholder="교사 선택" options={sheet.data.therapists.map((t) => [t, t] as [string, string])}
        disabled={!!draft} onChange={(t) => { setTeacher(t); pick(""); }} />}
      <Segmented value={view} onChange={setView} disabled={!!draft} items={[["actual", "실제 일정"], ["pay", "결제 일정"]]} />
      {view === "actual" && ownSheet && <T small muted>빈칸을 눌러 담당 아동의 수업을 추가하고, 이름을 눌러 그날 수업을 수정할 수 있어요.</T>}
      {view === "pay" && (
        <View style={{ gap: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line }}>
          {ownSheet && me && me.therapist_name === sheet.data?.therapist && <PaymentSetting key={me.uid} account={`${me.org_id}/${me.uid}`} locked={!!draft} />}
          <Select label="월별 결제 일정을 볼 아동" value={childId} disabled={!!draft} placeholder="아동 선택" options={(sheet.data?.plans ?? []).map((p) => [p.child_id, name(p.child_id)])} onChange={pick} />
          <T small muted>선택한 아동의 이번 달 바우처 서류와 정산에 사용할 날짜를 확인해요.</T>
          {plan && !draft && (
            <Row>
              <T small muted>{plan.mode === "manual" ? `별도 결제 일정 ${plan.slots.length}회` : plan.mode === "actual" ? "실제 일정과 동일 · 처음 5회" : "결제 미설정"}</T>
              {mayEditPlan && <Button small variant="outline" title="월별 결제 일정 수정" disabled={sheet.isFetching} onPress={open} />}
            </Row>)}
          {childId && draft && (
            <>
              {sheet.data?.default_same_as_actual && <Checkbox checked={draft.same} label="이번 달에도 기본 설정 사용 · 실제 일정과 동일" disabled={save.isPending}
                onChange={(same) => setDraft({ ...draft, same })} />}
              {!draft.same && <T small muted>{`아래 표에서 칸을 눌러 ${name(childId)}의 결제 날짜를 넣고 빼요 · ${draft.slots.length}회`}</T>}
              {draft.same && plan?.mode === "manual" && <T small muted>저장하면 이 아동의 이번 달 수동 일정을 실제 일정으로 대체해요.</T>}
              <Row>
                <Button small title="이 아동의 일정 저장" loading={save.isPending} disabled={!mayEditPlan || (draft.same ? plan?.mode === "actual" || !sheet.data?.default_same_as_actual : !draft.slots.length)}
                  onPress={async () => { if (await confirm(`${name(childId)} · ${month} 결제 일정을 저장할까요?`, draft.same ? "기본 설정의 실제 수업 일정을 사용해요." : `선택한 결제 일정 ${draft.slots.length}회를 적용해요.`, "저장")) save.mutate(draft); }} />
                <Button small variant="ghost" title="취소" disabled={save.isPending} onPress={() => { setDraft(null); save.reset(); }} />
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
                const entries = cells.get(`${d}|${t}`) ?? [];
                const mine = editing && entries.some((e) => e.childId === childId);
                const cellStyle = { width: COL, minHeight: 36, padding: 3, borderRightWidth: 1, borderColor: C.border, backgroundColor: mine ? C.accentSoft : "transparent" };
                if (view === "actual" && !entries.length && ownSheet) {
                  const blocked = reserved.some(s => s.date === d && s.start < plusMinutes(t, config.session_minutes) && t < s.end);
                  if (blocked) return <View key={t} style={cellStyle}><T small muted>예약됨</T></View>;
                  return <Pressable key={t} style={cellStyle} disabled={sheet.isFetching || sheet.isError || !available.length}
                    accessibilityRole="button" accessibilityLabel={`${d} ${t} 수업 추가`} onPress={() => openSlot(d, t)} />;
                }
                if (editing) return (
                  <Pressable key={t} disabled={save.isPending} accessibilityRole="checkbox" accessibilityState={{ checked: mine }} accessibilityLabel={`${d} ${t} ${name(childId)} 결제 수업`}
                    style={cellStyle} onPress={() => toggle({ date: d, start: t })}>
                    <Text style={{ fontSize: 12, color: C.ink }}>{entries.map((e) => name(e.childId)).join("\n")}</Text>
                  </Pressable>);
                return (
                  <View key={t} style={cellStyle}>
                    {entries.map(({ childId: cid, lesson }, index) => {
                      const editLesson = writable && sheet.data?.can_edit && !sheet.isFetching && lesson?.can_edit && lesson.revision;
                      const selectable = view === "pay" && !draft;
                      const title = name(cid);
                      return <Text key={lesson?.id ?? cid + index} numberOfLines={1}
                        accessibilityRole={selectable || editLesson ? "button" : undefined}
                        accessibilityLabel={editLesson ? `${title} ${d} ${t} 수업 수정` : title}
                        onPress={editLesson ? () => setLesson(lesson) : selectable ? () => pick(cid) : undefined}
                        style={{ fontSize: 13, color: C.accentDark, paddingVertical: 4, fontWeight: cid === childId && view === "pay" ? "700" : "400" }}>{title}</Text>;
                    })}
                  </View>);
              })}
            </View>))}
        </View>
      </ScrollView>
      <ModalSheet visible={!!slot} onClose={() => { if (!add.isPending) setSlot(null); }} title="수업 추가">
        {slot && <><T bold>{`${slot.date} ${slot.start}~${plusMinutes(slot.start, config.session_minutes)}`}</T>
          <Select label="등록된 담당 아동" value={newChild} onChange={setNewChild} disabled={add.isPending} placeholder="아동 선택"
            options={available.map(p => [p.child_id, [name(p.child_id), sheet.data?.aliases?.[p.child_id]].filter(Boolean).join(" · ")] as [string, string])} />
          {add.error && <Notice tone="red">{errText(add.error)}</Notice>}
          <Button title="추가" disabled={!newChild || !ownSheet} loading={add.isPending} onPress={() => add.mutate(slot)} /></>}
      </ModalSheet>
      <EditClassSheet monthly c={lesson} onClose={() => setLesson((opened) => opened === lesson ? null : opened)} onDone={() => refreshSchedules(qc)} />
    </View>
  );
}
