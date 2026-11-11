import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Linking, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errText } from "@/lib/api";
import { useChild } from "@/lib/child";
import { md, today, dow } from "@/lib/dates";
import { refreshSchedules } from "@/lib/hooks";
import { useMe } from "@/lib/me";
import { EXTRA, PAY_LABEL, payTone, type EffectivePay, type Extra } from "@/lib/extraClass";
import Timetable from "@/components/Timetable";
import MonthSheet from "@/components/MonthSheet";
import EditClassSheet, { type Cls } from "@/components/EditClassForm";
import { ChildPicker } from "@/components/ChildPicker";
import { Badge, Button, C, Card, DateField, Empty, IconButton, MonthNav, Notice, Row, Screen, Select, Sheet, T, Tabs, TextField, confirm } from "@/components/ui";

type ScheduleRow = { id: string; child_id: string; date: string; start: string; end: string; therapist: string; status: string;
  moved_from?: string | null;
  pay: EffectivePay; extra?: Extra | null; timetable_entry_id?: string | null; timetable_date?: string | null; note?: string | null };
type Holiday = { date: string; name: string; scope?: "site" | "org" | "closure" };

export default function Schedule() {
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ view?: string; date?: string; scheduleId?: string }>();
  const on = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : undefined;
  const [view, setView] = useState<"week" | "month" | "dated">(params.view === "dated" ? "dated" : "week");
  const [widgetOpen, setWidgetOpen] = useState(0);
  useEffect(() => { if (params.view === "dated") setView("dated"); }, [params.view, params.date, params.scheduleId]);
  useEffect(() => {
    // Repeated widget taps keep the same URL parameters, but must reset manually changed tabs/months.
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (url.startsWith("slpai://schedule?view=dated&")) {
        setView("dated");
        setWidgetOpen(opened => opened + 1);
      }
    });
    return () => subscription.remove();
  }, []);
  return (
    <View style={{ flex: 1 }}>
      <Tabs value={view} onChange={setView} items={[["week", "주간 시간표"], ["month", "월간 일정표"], ["dated", "날짜별 일정"]]} />
      <Screen onRefresh={() => refreshSchedules(qc, ["timetable", "holidays"])}>
        {view === "week" ? <Timetable /> : view === "month" ? <MonthSheet /> : <DatedSchedule key={`${on}:${params.scheduleId}:${widgetOpen}`} on={on} selectedId={params.scheduleId} />}
        <OrgHolidays />
      </Screen>
    </View>
  );
}

function DatedSchedule({ on, selectedId }: { on?: string; selectedId?: string }) {
  const { children, childId } = useChild();
  const qc = useQueryClient();
  const [month, setMonth] = useState((on ?? today()).slice(0, 7));
  const [filterDay, setFilterDay] = useState(on);
  const blank = { child_id: childId ?? "", date: "", start: "", end: "", therapist: "", note: "", extra: "voucher" as Extra };
  const [f, setF] = useState(blank), [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ["schedules", month], queryFn: () => api<ScheduleRow[]>(`/schedules?month=${month}`) });
  const rows = (list.data ?? []).filter(row => !filterDay || row.date === filterDay);
  const refresh = () => refreshSchedules(qc);
  const create = useMutation({ mutationFn: () => api("/schedules", { method: "POST", json: { ...f, end: f.end || null, therapist: f.therapist.trim() || null, note: f.note || null } }),
    onSuccess: () => { refresh(); setF({ ...blank, child_id: f.child_id }); setAdding(false); } });
  const [editing, setEditing] = useState<Cls | null>(null);
  const [moving, setMoving] = useState<ScheduleRow | null>(null);
  const [destination, setDestination] = useState({ date: "", start: "", reason: "" });
  const move = useMutation({ mutationFn: () => api(`/schedules/${moving!.id}/move`, { method: "POST", json: destination }),
    onSuccess: () => { setMoving(null); refresh(); } });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/schedules/${id}/cancel`, { method: "POST" }), onSuccess: refresh });
  const childLabel = (id: string) => { const c = children.find((x) => x.id === id); return c ? [c.display_name, c.alias].filter(Boolean).join(" · ") : "-"; };
  return (
    <>
      <T small muted>주간 시간표의 수업이 자동으로 들어와요. 여기서 수정한 날짜·시간·메모는 해당 수업에만 적용되며, 고정 주간 시간표는 유지됩니다. 사비 수업은 바우처 서류에서 빠집니다. 같은 치료사 또는 같은 아동의 겹치는 시간은 등록되지 않습니다.</T>
      {!adding ? <Button icon="add" title="수업 추가" onPress={() => { create.reset(); setAdding(true); }} /> : (
        <Card title="수업 추가" action={<IconButton icon="close" label="닫기" onPress={() => setAdding(false)} />}>
          <Select label="수업 구분" value={f.extra} options={Object.entries(EXTRA) as [Extra, string][]} onChange={(extra) => setF({ ...f, extra })} />
          <ChildPicker value={f.child_id || null} onChange={(id) => setF({ ...f, child_id: id ?? "" })} />
          <DateField label="날짜" value={f.date} onChange={(date) => setF({ ...f, date })} />
          <Row style={{ flexWrap: "nowrap" }}>
            <View style={{ flex: 1 }}><DateField label="시작" mode="time" value={f.start} onChange={(start) => setF({ ...f, start })} /></View>
            <View style={{ flex: 1 }}><DateField label="종료 (선택)" mode="time" optional value={f.end} onChange={(end) => setF({ ...f, end })} /></View>
          </Row>
          <TextField label="치료사 (비우면 담당)" value={f.therapist} onChangeText={(therapist) => setF({ ...f, therapist })} />
          <TextField label="메모" value={f.note} onChangeText={(note) => setF({ ...f, note })} />
          {create.error && <Notice tone="red">{errText(create.error)}</Notice>}
          <Button title="추가" loading={create.isPending} disabled={!f.child_id || !f.date || !f.start} onPress={() => create.mutate()} />
        </Card>)}
      <MonthNav value={month} onChange={next => { setMonth(next); setFilterDay(undefined); }} />
      {filterDay && <Row><T bold>{filterDay} 일정</T><Button small variant="ghost" title="이 달 전체 보기" onPress={() => setFilterDay(undefined)} /></Row>}
      <Card>
        {!rows.length ? <Empty>{list.isLoading ? "불러오는 중…" : filterDay ? "이 날짜에 등록된 일정이 없습니다." : "이 달에 등록된 일정이 없습니다."}</Empty> : rows.map((r) => (
          <View key={r.id} style={{ gap: 4, paddingBottom: 10, borderBottomWidth: 1, borderColor: C.line, backgroundColor: r.id === selectedId ? C.accentSoft : undefined }}>
            <Row>
              <T bold>{`${md(r.date)} (${dow(r.date)}) ${r.start}–${r.end}`}</T>
              <Badge tone={payTone(r.pay)}>{PAY_LABEL[r.pay]}</Badge>
              <Badge tone={r.status === "scheduled" ? "indigo" : "slate"}>{r.status === "scheduled" ? "예정" : r.status === "moved" ? "보강 이동" : "삭제됨"}</Badge>
              {r.moved_from && <Badge>보강</Badge>}
              {r.timetable_date && <Badge>개별 수정</Badge>}
            </Row>
            <T>{`${childLabel(r.child_id)} · ${r.therapist}`}</T>
            {!!r.note && <T small muted>{r.note}</T>}
            {r.status === "scheduled" && (
              <Row>
                <Button small variant="outline" title="수정" onPress={() => setEditing(r)} />
                {!r.moved_from && <Button small variant="outline" title="보강 잡기" onPress={() => { move.reset(); setDestination({ date: "", start: r.start, reason: "" }); setMoving(r); }} />}
                <Button small variant="ghost" title="삭제" disabled={cancel.isPending} onPress={async () => {
                  if (await confirm("이 수업을 삭제할까요?", `${childLabel(r.child_id)}\n${r.date} ${r.start}~${r.end}\n해당 회차가 월간 일정표와 출결·정산에서 빠집니다.`, "수업 삭제", true)) cancel.mutate(r.id);
                }} />
              </Row>)}
          </View>))}
        {cancel.error && <Notice tone="red">{errText(cancel.error)}</Notice>}
      </Card>
      <EditClassSheet c={editing} onClose={() => setEditing(null)} onDone={refresh} />
      <Sheet visible={!!moving} onClose={() => { if (!move.isPending) setMoving(null); }} title="보강 잡기">
        {moving && <><T>{`${childLabel(moving.child_id)} · ${moving.date} ${moving.start}~${moving.end}`}</T>
          <DateField label="보강 날짜" value={destination.date} onChange={date => setDestination({ ...destination, date })} />
          <DateField label="보강 시작" mode="time" value={destination.start} onChange={start => setDestination({ ...destination, start })} />
          <TextField label="변경 사유" maxLength={200} value={destination.reason} onChangeText={reason => setDestination({ ...destination, reason })} />
          {move.error && <Notice tone="red">{errText(move.error)}</Notice>}
          <Button title="보강 저장" disabled={!destination.date || !destination.start} loading={move.isPending} onPress={() => move.mutate()} />
        </>}
      </Sheet>
    </>
  );
}

/** 기관 휴무일: the organization admin sets them; everyone else sees them. 전체 휴무일 come from the site admin. */
function OrgHolidays() {
  const isAdmin = useMe().data?.role === "admin";
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["holidays"], queryFn: () => api<Holiday[]>("/org/holidays") });
  const [f, setF] = useState({ date: "", name: "" });
  const save = useMutation({
    mutationFn: (rows: Holiday[]) => api<Holiday[]>("/org/holidays", { method: "PUT", json: { holidays: rows } }),
    onSuccess: () => { setF({ date: "", name: "" }); refreshSchedules(qc, ["holidays", "timetable"]); },
  });
  const all = list.data ?? [];
  const rows = all.filter((h) => h.scope === "org").map(({ date, name }) => ({ date, name })); // only the organization's own ones are saved here
  const upcoming = all.filter((h) => h.date >= today().slice(0, 7));
  return (
    <Card title="기관 휴무일">
      {isAdmin && (
        <>
          <DateField label="날짜" value={f.date} onChange={(date) => setF({ ...f, date })} />
          <TextField label="이름" maxLength={40} placeholder="예: 한글날, 원내 행사" value={f.name} onChangeText={(name) => setF({ ...f, name })} />
          <Button small title="추가" loading={save.isPending} disabled={!f.date} onPress={() => save.mutate([...rows, { date: f.date, name: f.name.trim() || "휴무" }])} />
        </>)}
      {!upcoming.length ? <Empty>등록된 휴무일이 없습니다.</Empty> : upcoming.map((h) => (
        <Row key={h.date} style={{ flexWrap: "nowrap" }}>
          <T bold>{md(h.date)}</T><View style={{ flex: 1 }}><T>{h.name}</T></View>
          {h.scope === "site" ? <Badge tone="indigo">전체</Badge> : h.scope === "closure" ? <Badge tone="amber">출결 관리에서 정함</Badge>
            : isAdmin && <IconButton icon="trash-outline" color={C.red} label={`${h.name} 삭제`} onPress={() => save.mutate(rows.filter((x) => x.date !== h.date))} />}
        </Row>))}
      <T small muted>{`휴무일에는 주간 시간표 수업이 생기지 않고, 이미 생긴 수업 중 출결을 기록하지 않은 것은 빠져요. ‘전체’ 휴무일은 사이트 관리자가 모든 기관에 정한 날이에요.${isAdmin ? "" : " 기관 휴무일은 기관 관리자가 정해요."}`}</T>
      {save.error && <Notice tone="red">{errText(save.error)}</Notice>}
    </Card>
  );
}
