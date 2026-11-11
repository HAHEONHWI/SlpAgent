import { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errText } from "@/lib/api";
import { useChild } from "@/lib/child";
import { md, monthLabel, today } from "@/lib/dates";
import { refreshSchedules } from "@/lib/hooks";
import { useMe } from "@/lib/me";
import { shareXlsx } from "@/lib/share";
import { EXTRA, PAY, PAY_LABEL, type EffectivePay, type Extra, type Pay } from "@/lib/extraClass";
import { ChildPicker } from "@/components/ChildPicker";
import EditClassSheet, { type Cls } from "@/components/EditClassForm";
import { Badge, Button, C, Card, DateField, DayNav, Empty, IconButton, Input, Loading, MonthNav, Notice, Row, Screen, Segmented, Select, T, Tabs, TextField, confirm, type Tone } from "@/components/ui";

type State = { status: string | null; auto: boolean; reason: string | null };
type Mark = { status: string; minutes_late?: number | null; note?: string | null };
type RowT = { schedule_id: string; child_id: string; date: string; start: string; end: string; therapist: string; attendance: Mark | null; state: State;
  moved_to: { date: string; start: string } | null; moved_from: string | null; extra?: Extra | null; source?: string | null; pay?: EffectivePay | null; pay_auto?: boolean };
type Summary = { child_id: string; scheduled: number; present: number; late: number; absent: number; excused: number; makeup: number;
  auto: number; upcoming: number; moved: number; rate_pct: number | null };
type Closure = { date: string; reason: string | null; classes: number };
type Absence = { id: string; child_id: string; start: string; end: string; reason: string | null };
type Rec = { date: string; start: string; end: string; status: string | null; auto: boolean; reason: string | null; extra?: Extra | null; pay?: EffectivePay | null };

const ST: Record<string, [string, Tone]> = {
  present: ["출석", "green"], late: ["지각", "amber"], absent: ["결석", "red"], excused: ["사유결석", "slate"], makeup: ["보강", "indigo"],
  moved: ["옮김", "slate"], cancelled: ["취소", "slate"],
};

export default function Attendance() {
  const { children } = useChild();
  const qc = useQueryClient();
  const [day, setDay] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [tab, setTab] = useState<"day" | "month" | "long" | "closed">("day");
  const isAdmin = useMe().data?.role === "admin";
  const closed = useQuery({ queryKey: ["attendance", "closures"], queryFn: () => api<Closure[]>("/attendance/closures") });
  const closure = closed.data?.find((c) => c.date === day);
  const refresh = () => refreshSchedules(qc);
  const who = (id: string) => { const c = children.find((x) => x.id === id); return c ? `${c.display_name} · ${c.alias}` : "–"; };
  const roll = useQuery({ queryKey: ["attendance", "day", day], queryFn: () => api<RowT[]>(`/attendance/day?on=${day}`), enabled: tab === "day" });
  const summary = useQuery({ queryKey: ["attendance", "summary", month], queryFn: () => api<Summary[]>(`/attendance/summary?month=${month}`), enabled: tab === "month" });
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState("");
  const exportXlsx = async () => {
    setExporting(true); setExportError("");
    try {
      const rows = summary.data ?? [];
      const recs = await Promise.all(rows.map((s) => api<{ records: Rec[] }>(`/children/${s.child_id}/attendance?month=${month}`)));
      const totals = [["아동", "수업", "출석", "(자동)", "지각", "결석", "사유결석", "옮김", "남은 수업", "출석률(%)"],
        ...rows.map((s) => [who(s.child_id), s.scheduled, s.present + s.makeup, s.auto, s.late, s.absent, s.excused, s.moved, s.upcoming, s.rate_pct])];
      const classes = [["날짜", "시간", "아동", "구분", "결제", "출결", "사유"],
        ...rows.flatMap((s, i) => recs[i].records.map((r) => [r.date, `${r.start}–${r.end}`, who(s.child_id), r.extra ? EXTRA[r.extra] : "정규", r.pay ? PAY_LABEL[r.pay] : "-",
          r.status ? `${ST[r.status]?.[0] ?? r.status}${r.auto && r.status === "present" ? " (자동)" : ""}` : "예정", r.reason]))
          .sort((x, y) => `${x[0]}${x[1]}`.localeCompare(`${y[0]}${y[1]}`))];
      await shareXlsx(`출결_${month}.xlsx`, [
        { name: "월별 현황", rows: totals, widths: [22, ...Array(9).fill(9)] },
        { name: "수업별 출결", rows: classes, widths: [12, 13, 22, 16, 8, 12, 30] },
      ]);
    } catch (e) { setExportError(errText(e)); } finally { setExporting(false); }
  };
  const count = (k: string) => (roll.data ?? []).filter((r) => r.state.status === k).length;

  return (
    <View style={{ flex: 1 }}>
      <Tabs value={tab} onChange={setTab} items={[["day", "일별 출결"], ["month", "월별 현황"], ["long", "장기결강"], ["closed", "전체 휴강"]]} />
      <Screen onRefresh={() => qc.invalidateQueries({ queryKey: ["attendance"] })}>
        {tab === "day" && (
          <>
            <DayNav value={day} onChange={setDay} />
            <Row><Badge>기본 출석 처리 · 예외만 기록</Badge>{!!roll.data?.length && <T small muted>{`결석 ${count("absent")} · 사유결석 ${count("excused")} · 지각 ${count("late")}`}</T>}</Row>
            {closure && <Notice>{`이 날은 치료실 전체 휴강이에요${closure.reason ? ` (${closure.reason})` : ""}. 수업 ${closure.classes}개가 취소되어 출결·정산·바우처 서류에서 빠졌어요. ‘전체 휴강’ 탭에서 되돌릴 수 있어요.`}</Notice>}
            {roll.isLoading ? <Loading /> : !roll.data?.length ? <Empty>이 날짜에 수업이 없습니다.</Empty> : roll.data.map((r) => <RollRow key={r.schedule_id} r={r} who={who(r.child_id)} onDone={refresh} />)}
            {roll.error && <Notice tone="red">{errText(roll.error)}</Notice>}
            <AddClass day={day} onDone={refresh} />
            <T small muted>수업은 따로 체크하지 않으면 출석으로 처리돼요. 결석·사유결석·지각, 보강(수업 옮기기)만 기록하세요. 출결은 바우처 서류와 정산에 자동 반영됩니다.</T>
          </>)}
        {tab === "long" && <Absences who={who} onDone={refresh} />}
        {tab === "closed" && <Closures list={closed.data ?? []} isAdmin={isAdmin} onDone={refresh} />}
        {tab === "month" && (
          <>
            <MonthNav value={month} onChange={setMonth} />
            <Button variant="outline" icon="share-outline" title={exporting ? "만드는 중…" : "엑셀로 내보내기"} disabled={!summary.data?.length} loading={exporting} onPress={exportXlsx} />
            {exportError ? <Notice tone="red">{exportError}</Notice> : null}
            {summary.isLoading ? <Loading /> : !summary.data?.length ? <Empty>이 달의 수업이 없습니다.</Empty> : summary.data.map((s) => (
              <Card key={s.child_id} title={who(s.child_id)} action={s.rate_pct == null ? <T muted>–</T> : <Badge tone={s.rate_pct >= 90 ? "green" : s.rate_pct >= 75 ? "amber" : "red"}>{`${s.rate_pct}%`}</Badge>}>
                <Row gap={14}>
                  {([["수업", s.scheduled], ["출석", s.present + s.makeup], ["(자동)", s.auto], ["지각", s.late], ["결석", s.absent], ["사유결석", s.excused], ["옮김", s.moved], ["남은 수업", s.upcoming]] as [string, number][]).map(([l, v]) => (
                    <View key={l} style={{ alignItems: "center", minWidth: 52 }}>
                      <T small muted>{l}</T><T bold style={l === "결석" && v ? { color: C.redText } : undefined}>{String(v)}</T>
                    </View>))}
                </Row>
              </Card>))}
            <T small muted>{`${monthLabel(month)} · 출석에는 따로 체크하지 않아 자동으로 출석 처리된 수업(자동)이 포함돼요. 출석률 = (출석+지각) ÷ (출석+지각+결석). 사유결석·장기결강은 빼고 계산합니다.`}</T>
          </>)}
      </Screen>
    </View>
  );
}

function AddClass({ day, onDone }: { day: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const empty: { child_id: string; start: string; extra: Extra } = { child_id: "", start: "", extra: "voucher" };
  const [f, setF] = useState(empty);
  const add = useMutation({
    mutationFn: () => api("/schedules", { method: "POST", json: { child_id: f.child_id, date: day, start: f.start, extra: f.extra } }),
    onSuccess: () => { setF(empty); setOpen(false); onDone(); },
  });
  if (!open) return <Button icon="add" title="수업 추가" onPress={() => { add.reset(); setOpen(true); }} />;
  return (
    <Card title={`수업 추가 (${md(day)})`} action={<IconButton icon="close" label="닫기" onPress={() => setOpen(false)} />}>
      <Segmented value={f.extra} onChange={(extra) => setF({ ...f, extra })} items={(Object.keys(EXTRA) as Extra[]).map((k) => [k, EXTRA[k]] as [Extra, string])} />
      <ChildPicker value={f.child_id || null} onChange={(id) => setF({ ...f, child_id: id ?? "" })} />
      <DateField label="시작 시간" mode="time" value={f.start} onChange={(start) => setF({ ...f, start })} />
      <T small muted>월간 일정표에서 ‘실제 일정과 동일’을 저장하면 담당 아동별로 매달 처음 5회가 바우처로 잡혀요. 따로 결제 일정을 저장한 아동은 그 날짜를 따르고, 둘 다 없으면 자동 분류를 보류해요.</T>
      {add.error && <Notice tone="red">{errText(add.error)}</Notice>}
      <Button title="추가" loading={add.isPending} disabled={!f.child_id || !f.start} onPress={() => add.mutate()} />
    </Card>
  );
}

function RollRow({ r, who, onDone }: { r: RowT; who: string; onDone: () => void }) {
  const [note, setNote] = useState(""), [late, setLate] = useState(""), [editing, setEditing] = useState<Cls | null>(null);
  const [moving, setMoving] = useState(false), [to, setTo] = useState({ date: "", start: r.start, reason: "" });
  const mark = useMutation({
    mutationFn: (status: string) => api(`/schedules/${r.schedule_id}/attendance`, { method: "PUT", json: { status, minutes_late: status === "late" && late ? Number(late) : null, note: note.trim() || null } }),
    onSuccess: () => { setNote(""); setLate(""); onDone(); },
  });
  const clear = useMutation({ mutationFn: () => api(`/schedules/${r.schedule_id}/attendance`, { method: "DELETE" }), onSuccess: onDone });
  const move = useMutation({ mutationFn: () => api(`/schedules/${r.schedule_id}/move`, { method: "POST", json: { date: to.date, start: to.start, reason: to.reason.trim() || null } }), onSuccess: () => { setMoving(false); onDone(); } });
  const unmove = useMutation({ mutationFn: () => api(`/schedules/${r.schedule_id}/unmove`, { method: "POST" }), onSuccess: onDone });
  const pay = useMutation({ mutationFn: (v: string) => api(`/schedules/${r.schedule_id}/pay`, { method: "PUT", json: { pay: v || null } }), onSuccess: onDone });
  const st = r.state.status;
  const err = mark.error || clear.error || move.error || unmove.error || pay.error;
  const badge = st === "moved" ? <Badge>{`옮김 → ${r.moved_to ? `${md(r.moved_to.date)} ${r.moved_to.start}` : "?"}`}</Badge>
    : st ? <Badge tone={ST[st]?.[1]}>{`${ST[st]?.[0] ?? st}${st === "late" && r.attendance?.minutes_late ? ` ${r.attendance.minutes_late}분` : ""}${r.state.auto && st === "present" ? " (자동)" : ""}`}</Badge>
    : <Badge>예정</Badge>;
  const controls = st !== "moved" && !(r.state.auto && st === "excused");
  const choice = (v: string) => (v === "present" ? r.attendance && clear.mutate() : mark.mutate(v));
  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <T bold>{`${r.start}–${r.end}`}</T>
        <Row gap={4}>{r.moved_from && <Badge tone="indigo">보강</Badge>}{r.extra && <Badge>추가</Badge>}{badge}</Row>
      </Row>
      <T bold style={{ fontSize: 17 }}>{who}</T>
      <Row><T small muted>{r.therapist}</T>{r.state.reason && <T small muted>{r.state.reason}</T>}</Row>
      {r.pay && <Select label="결제 구분" value={r.pay === "pending" ? "" : r.pay} placeholder="결제 미설정" disabled={pay.isPending} options={(Object.keys(PAY) as Pay[]).map((k) => [k, PAY[k]] as [Pay, string])} onChange={(v) => pay.mutate(v)} />}
      {r.pay === "pending" && <T small muted>담당 치료사의 내 계정에서 ‘내 결제 설정’을 저장하거나, 월간 일정표의 ‘결제 일정’에서 아동별 날짜를 지정해 주세요.</T>}
      {controls && (
        <>
          <Segmented value={(st && ["present", "absent", "excused", "late"].includes(st) && !(r.state.auto && st !== "present") ? st : "") as "present"}
            disabled={mark.isPending || clear.isPending} onChange={choice} tone={(v) => (v === "present" ? "ink" : "accent")}
            items={[["present", "출석"], ["absent", "결석"], ["excused", "사유결석"], ["late", "지각"]]} />
          <Row style={{ flexWrap: "nowrap" }}>
            <View style={{ flex: 2 }}><Input placeholder="사유 (예: 감기)" maxLength={200} value={note} onChangeText={setNote} accessibilityLabel="사유" /></View>
            <View style={{ flex: 1 }}><Input placeholder="지각 분" keyboardType="number-pad" value={late} onChangeText={(v) => setLate(v.replace(/\D/g, ""))} accessibilityLabel="지각 분" /></View>
          </Row>
          <T small muted>사유·지각 분을 먼저 적고 결석·사유결석·지각을 누르세요.</T>
          <Row>
            {r.attendance && <Button small variant="ghost" icon="arrow-undo" title="기본(출석)으로" disabled={clear.isPending} onPress={() => clear.mutate()} />}
            {!r.attendance && !r.moved_from && <Button small variant="outline" title="보강 잡기" onPress={() => { move.reset(); setMoving(!moving); }} />}
            {r.source !== "timetable" && <Button small variant="ghost" title="시간 수정" onPress={() => setEditing({ id: r.schedule_id, date: r.date, start: r.start, end: r.end, extra: r.extra, pay: r.pay })} />}
          </Row>
        </>)}
      {st === "moved" && <Button small variant="ghost" icon="arrow-undo" title="옮기기 취소" disabled={unmove.isPending} onPress={() => unmove.mutate()} />}
      {moving && (
        <View style={{ gap: 10, backgroundColor: C.paper, borderRadius: 16, padding: 12 }}>
          <DateField label="보강 날짜" value={to.date} onChange={(date) => setTo({ ...to, date })} />
          <DateField label="시작 시간" mode="time" value={to.start} onChange={(start) => setTo({ ...to, start })} />
          <TextField label="사유 (선택)" maxLength={200} value={to.reason} onChangeText={(reason) => setTo({ ...to, reason })} />
          <Row><Button small title="옮기기" loading={move.isPending} disabled={!to.date || !to.start} onPress={() => move.mutate()} /><Button small variant="ghost" title="취소" onPress={() => setMoving(false)} /></Row>
        </View>)}
      {err && <Notice tone="red">{errText(err)}</Notice>}
      <EditClassSheet c={editing} onClose={() => setEditing(null)} onDone={onDone} />
    </Card>
  );
}

/** 치료실 전체 휴강: the whole center cancels a day. Every class that day is cancelled; undoing brings them back. */
function Closures({ list, isAdmin, onDone }: { list: Closure[]; isAdmin: boolean; onDone: () => void }) {
  const [f, setF] = useState({ date: "", reason: "" });
  const add = useMutation({
    mutationFn: () => api<Closure>("/attendance/closures", { method: "POST", json: { date: f.date, reason: f.reason.trim() || null } }),
    onSuccess: () => { setF({ date: "", reason: "" }); onDone(); },
  });
  const undo = useMutation({ mutationFn: (d: string) => api(`/attendance/closures/${d}`, { method: "DELETE" }), onSuccess: onDone });
  return (
    <>
      <T small muted>센터 사정으로 하루 전체 수업을 쉬는 날이에요. 그날의 모든 수업(시간표·추가·보강, 이미 출결을 적은 수업 포함)이 취소되어 출결·정산·바우처 서류에서 빠지고, 바우처 ‘기타사항’에 ‘센터 휴강’이 적혀요. 휴강을 지우면 수업이 원래대로 돌아와요.</T>
      {isAdmin ? (
        <Card title="휴강 등록">
          <DateField label="날짜" value={f.date} onChange={(date) => setF({ ...f, date })} />
          <TextField label="사유" maxLength={100} placeholder="예: 원장 교육, 태풍, 시설 점검" value={f.reason} onChangeText={(reason) => setF({ ...f, reason })} />
          <Button title="휴강 등록" loading={add.isPending} disabled={!f.date}
            onPress={async () => { if (await confirm("전체 휴강", `${f.date} 하루 전체 수업을 휴강으로 처리할까요?`, "휴강 등록", true)) add.mutate(); }} />
        </Card>) : <Notice>전체 휴강은 기관 관리자가 정해요.</Notice>}
      {add.data && <Notice tone="green">{`${add.data.date} 휴강을 등록했어요. 수업 ${add.data.classes}개를 취소했어요.`}</Notice>}
      {!list.length ? <Empty>등록된 전체 휴강이 없습니다.</Empty> : [...list].reverse().map((c) => (
        <Card key={c.date}>
          <Row style={{ justifyContent: "space-between" }}>
            <View><T bold>{c.date}</T><T small muted>{`${c.reason ?? "–"} · 취소된 수업 ${c.classes}개`}</T></View>
            {isAdmin && <Button small variant="ghost" icon="arrow-undo" title="되돌리기" disabled={undo.isPending}
              onPress={async () => { if (await confirm("휴강 되돌리기", `${c.date} 휴강을 지우고 수업을 되돌릴까요?`)) undo.mutate(c.date); }} />}
          </Row>
        </Card>))}
      {(add.error || undo.error) && <Notice tone="red">{errText(add.error || undo.error)}</Notice>}
    </>
  );
}

function Absences({ who, onDone }: { who: (id: string) => string; onDone: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["attendance", "absences"], queryFn: () => api<Absence[]>("/absences") });
  const [f, setF] = useState({ child_id: "", start: "", end: "", reason: "" });
  const done = () => { qc.invalidateQueries({ queryKey: ["attendance", "absences"] }); onDone(); };
  const add = useMutation({ mutationFn: () => api("/absences", { method: "POST", json: { ...f, reason: f.reason.trim() || null } }), onSuccess: () => { setF({ child_id: "", start: "", end: "", reason: "" }); done(); } });
  const remove = useMutation({ mutationFn: (id: string) => api(`/absences/${id}`, { method: "DELETE" }), onSuccess: done });
  return (
    <>
      <Card title="장기결강 등록">
        <ChildPicker value={f.child_id || null} onChange={(id) => setF({ ...f, child_id: id ?? "" })} />
        <Row style={{ flexWrap: "nowrap" }}>
          <View style={{ flex: 1 }}><DateField label="시작일" value={f.start} onChange={(start) => setF({ ...f, start })} /></View>
          <View style={{ flex: 1 }}><DateField label="종료일" value={f.end} onChange={(end) => setF({ ...f, end })} /></View>
        </Row>
        <TextField label="사유" maxLength={200} placeholder="예: 입원, 방학" value={f.reason} onChangeText={(reason) => setF({ ...f, reason })} />
        <Button title="등록" loading={add.isPending} disabled={!f.child_id || !f.start || !f.end || f.end < f.start} onPress={() => add.mutate()} />
        <T small muted>기간 안의 수업은 모두 사유결석으로 처리되고 바우처 서류에서 빠지며, ‘기타사항’에 기간과 사유가 적혀요.</T>
      </Card>
      {list.data?.map((a) => (
        <Card key={a.id}>
          <Row style={{ flexWrap: "nowrap" }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T bold>{who(a.child_id)}</T><T small muted>{`${a.start} ~ ${a.end}${a.reason ? ` · ${a.reason}` : ""}`}</T><Badge>수업 점유 안 함</Badge>
            </View>
            <IconButton icon="trash-outline" color={C.red} label="장기결강 삭제" onPress={async () => { if (await confirm("장기결강을 지울까요?")) remove.mutate(a.id); }} />
          </Row>
        </Card>))}
      {(add.error || remove.error) && <Notice tone="red">{errText(add.error || remove.error)}</Notice>}
    </>
  );
}
