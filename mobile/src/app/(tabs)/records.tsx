import { useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api, errText } from "@/lib/api";
import { useChild } from "@/lib/child";
import { dow, md, today } from "@/lib/dates";
import { useClassSlot, useCreate, useRecords, useTherapists } from "@/lib/hooks";
import { canWrite, useMe } from "@/lib/me";
import { SECTIONS } from "@/lib/recordings";
import { ChildPicker, RequireChild } from "@/components/ChildPicker";
import { Badge, Button, C, Card, Checkbox, DateField, Empty, IconButton, Input, Loading, MonthNav, Notice, Row, Screen, Select, T, Tabs, TextField, type Tone } from "@/components/ui";

type Consultation = { id: string; date: string; start: string | null; end: string | null; minutes: number | null; counselor: string; participants: string[]; topics: string[];
  summary: string; guidance_given: string | null; follow_up: string | null; created_at: string; session_summary?: string | null; parent_concerns?: string[] | null;
  home_activities?: string[] | null; transcript?: string | null; source?: string };
type Session = { id: string; date: string; start: string; end: string; minutes: number; therapist: string; status: string; activities: { name: string; correct: number; trials: number; prompt_level?: string | null }[];
  activity_accuracy: { accuracy_pct: number | null }[]; utterances: string[]; observed_behaviors: string[]; created_at: string };
type RecRecord = { id: string; kind: string; date: string; start: string | null; end: string | null; counselor: string; sections: Record<string, string>; transcript: string | null; duration_seconds: number | null };
type A = { name: string; correct: string; trials: string; prompt_level: string };
const blankA: A = { name: "", correct: "", trials: "", prompt_level: "" };
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const UNCONFIRMED = "확인되지 않음";
const SEC = Object.fromEntries(SECTIONS);

export default function Records() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"write" | "browse">("write");
  return (
    <View style={{ flex: 1 }}>
      <Tabs value={tab} onChange={setTab} items={[["write", "수업 기록"], ["browse", "수업 기록 조회"]]} />
      <Screen onRefresh={() => ["consultations", "sessions", "recording-records", "class-records"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))}>
        {tab === "write" ? <RequireChild>{(id) => <Sessions childId={id} />}</RequireChild> : <ClassRecords onOpen={() => setTab("write")} />}
      </Screen>
    </View>
  );
}

/** 수업 기록: after each class the therapist writes what was done and what was told to the parent. Activity accuracy /
 *  utterances are optional details saved as a session record. */
function Sessions({ childId }: { childId: string }) {
  const writable = canWrite(useMe().data);
  const consultations = useRecords<Consultation>(childId, "consultations");
  const sessions = useRecords<Session>(childId, "sessions");
  const recordings = useQuery({ queryKey: ["recording-records", childId], queryFn: () => api<RecRecord[]>(`/children/${childId}/recording-records`) });
  const saveConsult = useCreate(childId, "consultations");
  const saveSession = useCreate(childId, "sessions");
  const therapists = useTherapists();
  const blank = { date: today(), start: "", end: "", counselor: "", summary: "", guidance_given: "", follow_up: "", topics: "", participants: "", utterances: "", behaviors: "" };
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false), [details, setDetails] = useState(false);
  const [acts, setActs] = useState<A[]>([{ ...blankA }]);
  const [err, setErr] = useState(""), [saved, setSaved] = useState(false);
  // 날짜를 고르면 그날 시간표의 수업 시간·담당을 채운다
  useClassSlot(childId, f.date, (sl) => setF((x) => ({ ...x, start: sl?.start ?? "", end: sl?.end ?? "", counselor: sl?.therapist || x.counselor })));
  const set = (k: keyof typeof blank) => (v: string) => setF({ ...f, [k]: v });
  const upd = (i: number, k: keyof A, v: string) => setActs(acts.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  const filledActs = acts.filter((a) => a.name.trim());
  const hasDetails = filledActs.length > 0 || !!f.utterances.trim() || !!f.behaviors.trim();

  const submit = async () => {
    setErr(""); setSaved(false);
    if (!f.counselor.trim() || !f.summary.trim()) return setErr("담당 치료사와 수업 내용을 넣어 주세요.");
    if (hasDetails && (!f.start || !f.end)) return setErr("활동·발화·관찰을 함께 저장하려면 시작·종료 시간을 넣어 주세요.");
    try {
      await saveConsult.mutateAsync({ date: f.date, start: f.start || null, end: f.end || null, counselor: f.counselor, participants: csv(f.participants), topics: csv(f.topics),
        summary: f.summary, guidance_given: f.guidance_given || null, follow_up: f.follow_up || null });
      if (hasDetails) await saveSession.mutateAsync({ date: f.date, start: f.start, end: f.end, therapist: f.counselor, status: "completed",
        utterances: lines(f.utterances), observed_behaviors: lines(f.behaviors),
        activities: filledActs.map((a) => ({ name: a.name.trim(), correct: Number(a.correct || 0), trials: Number(a.trials || 0), prompt_level: a.prompt_level || null })) });
      setF({ ...blank, date: f.date, counselor: f.counselor, start: f.start, end: f.end }); setActs([{ ...blankA }]); setDetails(false); setSaved(true); setOpen(false);
    } catch (e) { setErr(errText(e)); }
  };

  // one timeline: written records, session records and approved recording records, newest day first
  const recs = recordings.data ?? [];
  const days = [...new Set([...(consultations.data ?? []).map((c) => c.date), ...(sessions.data ?? []).map((s) => s.date), ...recs.map((r) => r.date)])].sort().reverse();
  const busy = saveConsult.isPending || saveSession.isPending;
  return (
    <>
      {saved && <Notice tone="green">기록을 저장했어요.</Notice>}
      {writable && (!open ? <Button icon="create-outline" title="수업 기록 쓰기" onPress={() => { setOpen(true); setSaved(false); }} /> : (
        <Card title="수업 기록 쓰기" action={<IconButton icon="close" label="닫기" onPress={() => setOpen(false)} />}>
          <DateField label="날짜" value={f.date} onChange={set("date")} />
          <Row style={{ flexWrap: "nowrap" }}>
            <View style={{ flex: 1 }}><DateField label="시작 (선택)" mode="time" optional value={f.start} onChange={set("start")} /></View>
            <View style={{ flex: 1 }}><DateField label="종료 (선택)" mode="time" optional value={f.end} onChange={set("end")} /></View>
          </Row>
          {therapists.length
            ? <Select label="담당 치료사" value={f.counselor} options={[...new Set([...therapists, ...(f.counselor ? [f.counselor] : [])])].map((t) => [t, t] as [string, string])} onChange={set("counselor")} />
            : <TextField label="담당 치료사" value={f.counselor} onChangeText={set("counselor")} />}
          <TextField label="수업 내용" multiline value={f.summary} onChangeText={set("summary")} placeholder="오늘 한 활동과 아동의 반응" />
          <TextField label="보호자에게 안내한 내용 (선택)" multiline value={f.guidance_given} onChangeText={set("guidance_given")} placeholder="가정에서 할 활동, 전달 사항" />
          <TextField label="다음 수업·후속 조치 (선택)" multiline value={f.follow_up} onChangeText={set("follow_up")} />
          <TextField label="주제 (쉼표 구분, 선택)" value={f.topics} onChangeText={set("topics")} placeholder="예: 발음, 어휘" />
          <TextField label="참여자 (쉼표 구분, 선택)" value={f.participants} onChangeText={set("participants")} placeholder="예: 어머니" />
          <Pressable onPress={() => setDetails(!details)} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name={details ? "chevron-down" : "chevron-forward"} size={16} color={C.ink} /><T bold>활동 행</T><T small muted>정확도·발화·관찰 (선택)</T>
          </Pressable>
          {details && (
            <>
              {acts.map((a, i) => (
                <View key={i} style={{ gap: 6, padding: 10, borderRadius: 14, backgroundColor: C.paper }}>
                  <Input placeholder="활동 내용" value={a.name} onChangeText={(v) => upd(i, "name", v)} />
                  <Row style={{ flexWrap: "nowrap" }}>
                    <View style={{ flex: 1 }}><Input placeholder="정반응" keyboardType="number-pad" value={a.correct} onChangeText={(v) => upd(i, "correct", v.replace(/\D/g, ""))} /></View>
                    <View style={{ flex: 1 }}><Input placeholder="전체 시행" keyboardType="number-pad" value={a.trials} onChangeText={(v) => upd(i, "trials", v.replace(/\D/g, ""))} /></View>
                    <View style={{ flex: 1 }}><Input placeholder="촉진" value={a.prompt_level} onChangeText={(v) => upd(i, "prompt_level", v)} /></View>
                  </Row>
                </View>))}
              <Button small variant="outline" title="행 추가" onPress={() => setActs([...acts, { ...blankA }])} />
              <TextField label="아동의 실제 발화 (줄바꿈 구분)" multiline value={f.utterances} onChangeText={set("utterances")} />
              <TextField label="관찰 행동 (줄바꿈 구분)" multiline value={f.behaviors} onChangeText={set("behaviors")} />
              <T small muted>활동 정확도는 발달 분석·경과 그래프에 쓰여요. 저장하려면 시작·종료 시간이 필요해요.</T>
            </>)}
          {!!err && <Notice tone="red">{err}</Notice>}
          <Button title={busy ? "저장 중…" : "기록 저장"} loading={busy} onPress={submit} />
        </Card>))}

      <T bold style={{ fontSize: 18 }}>지난 수업 기록</T>
      {consultations.error || sessions.error ? <Notice tone="red">{errText(consultations.error || sessions.error)}</Notice>
        : !days.length ? <Empty>{consultations.isLoading || sessions.isLoading ? "불러오는 중…" : "수업 기록이 없습니다."}</Empty>
        : days.map((d) => {
          const cs = (consultations.data ?? []).filter((c) => c.date === d);
          const ss = (sessions.data ?? []).filter((x) => x.date === d);
          const rs = recs.filter((r) => r.date === d);
          const first = cs[0] ?? null;
          const time = first?.start ? `${first.start}${first.end ? `–${first.end}` : ""}` : ss[0] ? `${ss[0].start}–${ss[0].end}` : "";
          return (
            <Card key={d} title={`${md(d)} (${dow(d)})${time ? ` ${time}` : ""}`} action={<T small muted>{first?.counselor ?? ss[0]?.therapist ?? rs[0]?.counselor}</T>}>
              {cs.map((c) => <ConsultView key={c.id} c={c} />)}
              {ss.map((x) => (
                <View key={x.id} style={{ backgroundColor: C.paper, borderRadius: 14, padding: 10, gap: 2 }}>
                  <T small muted>{`활동 기록 ${x.start}–${x.end} (${x.minutes}분)`}</T>
                  {x.activities.map((a, i) => <T key={i} small>{`${a.name}: ${a.correct}/${a.trials} (${x.activity_accuracy[i]?.accuracy_pct ?? "-"}%)${a.prompt_level ? ` · 촉진: ${a.prompt_level}` : ""}`}</T>)}
                  {x.utterances.length > 0 && <T small muted>{`발화: ${x.utterances.join(" / ")}`}</T>}
                  {x.observed_behaviors.length > 0 && <T small muted>{`관찰: ${x.observed_behaviors.join(" / ")}`}</T>}
                </View>))}
              {rs.map((r) => (
                <View key={r.id} style={{ gap: 6 }}>
                  <Row><Badge>{`${r.kind === "session" ? "회기" : "상담"} 녹음 기록`}</Badge><Badge tone="green">녹음 기반 · 치료사 승인</Badge></Row>
                  {SECTIONS.map(([k, label]) => (
                    <View key={k}><T small bold>{label}</T><T style={r.sections[k] === UNCONFIRMED || !r.sections[k] ? { color: C.muted } : undefined}>{r.sections[k] || UNCONFIRMED}</T></View>))}
                  {r.transcript && <Fold label={`녹취록${r.duration_seconds ? ` (${Math.round(r.duration_seconds / 60)}분)` : ""}`} text={r.transcript} />}
                </View>))}
            </Card>);
        })}
    </>
  );
}

function ConsultView({ c }: { c: Consultation }) {
  return (
    <View style={{ gap: 4 }}>
      {(c.topics.length > 0 || c.participants.length > 0 || c.source === "recording_ai_approved") && (
        <Row gap={4}>
          {c.topics.map((t) => <Badge key={t} tone="indigo">{t}</Badge>)}
          {c.participants.length > 0 && <T small muted>{`참여: ${c.participants.join(", ")}`}</T>}
          {c.source === "recording_ai_approved" && <Badge>녹음 기반 · 치료사 승인</Badge>}
        </Row>)}
      {c.session_summary && <T><T small bold>수업 요약 </T>{c.session_summary}</T>}
      <T>{c.summary}</T>
      {!!c.parent_concerns?.length && <T><T small bold>보호자 질문·걱정 </T>{c.parent_concerns.join(" · ")}</T>}
      {c.guidance_given && <T><T small bold>보호자 안내 </T>{c.guidance_given}</T>}
      {!!c.home_activities?.length && <T><T small bold>가정 연계 활동 </T>{c.home_activities.join(" · ")}</T>}
      {c.follow_up && <T><T small bold>후속 조치 </T>{c.follow_up}</T>}
      {c.transcript && <Fold label="녹취록" text={c.transcript} />}
    </View>
  );
}

function Fold({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button"><T small style={{ color: C.accentDark }}>{`${open ? "▾" : "▸"} ${label}`}</T></Pressable>
      {open && <View style={{ backgroundColor: C.paper, borderRadius: 12, padding: 10 }}><T small selectable>{text}</T></View>}
    </View>
  );
}

type State = { status: string | null; auto: boolean; reason: string | null };
type CRSession = { id: string; start: string | null; end: string | null; minutes: number | null; activities: { name: string; accuracy_pct?: number | null }[]; utterances: string[]; observed_behaviors: string[]; note: string | null };
type CR = { date: string; start: string | null; end: string | null; child_id: string; therapist: string | null; schedule_id: string | null; makeup: boolean;
  state: State; sessions: CRSession[]; recordings: { id: string; kind: string; sections: Record<string, string> }[]; consultations: Consultation[] };
const ST: Record<string, [string, Tone]> = { present: ["출석", "green"], late: ["지각", "amber"], absent: ["결석", "red"], excused: ["사유결석", "slate"], makeup: ["보강", "indigo"], moved: ["옮김", "slate"] };

/** 수업 기록 조회: a month of classes across children with attendance and the records written for each. */
function ClassRecords({ onOpen }: { onOpen: () => void }) {
  const { children, childId: child, setChildId } = useChild();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [therapist, setTherapist] = useState(""), [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const therapists = useTherapists();
  const q = new URLSearchParams({ month, ...(child ? { child_id: child } : {}), ...(therapist ? { therapist } : {}) });
  const list = useQuery({ queryKey: ["class-records", q.toString()], queryFn: () => api<CR[]>(`/class-records?${q}`) });
  const who = (id: string) => { const c = children.find((x) => x.id === id); return c ? `${c.display_name} · ${c.alias}` : "(삭제된 아동)"; };
  const happened = (r: CR) => !!r.state.status && !["absent", "excused", "moved"].includes(r.state.status);
  const written = (r: CR) => r.consultations.length > 0 || r.sessions.length > 0 || r.recordings.length > 0;
  const rows = (list.data ?? []).filter((r) => !missing || (happened(r) && r.date <= today() && !written(r)));
  const days = [...new Set(rows.map((r) => r.date))];
  const done = (list.data ?? []).filter((r) => happened(r) && r.date <= today());
  return (
    <>
      <MonthNav value={month} onChange={setMonth} />
      <Card>
        <ChildPicker label="아동 (위쪽 선택과 같아요)" value={child} onChange={setChildId} emptyLabel="전체 아동" />
        <Select label="치료사" value={therapist} options={[["", "전체"], ...therapists.map((t) => [t, t] as [string, string])]} onChange={setTherapist} />
        <Checkbox checked={missing} onChange={setMissing} label="기록 없는 수업만" />
        {list.data && <T small>{`지난 수업 ${done.length}개 중 기록 있음 ${done.filter(written).length} · 기록 없음 ${done.filter((r) => !written(r)).length}`}</T>}
      </Card>
      {list.isLoading ? <Loading /> : !rows.length ? <Empty>{missing ? "기록이 빠진 수업이 없어요." : "이 조건의 수업이 없어요."}</Empty> : days.map((d) => (
        <Card key={d} title={`${md(d)} (${dow(d)})${d === today() ? " · 오늘" : ""}`}>
          {rows.filter((r) => r.date === d).map((r) => {
            const key = `${r.date}-${r.child_id}-${r.start}`;
            const st = r.state.status;
            return (
              <View key={key} style={{ borderTopWidth: 1, borderColor: C.line, paddingTop: 8, gap: 6 }}>
                <Pressable onPress={() => setOpen(open === key ? null : key)} accessibilityRole="button" accessibilityState={{ expanded: open === key }} style={{ gap: 4 }}>
                  <Row>
                    <Ionicons name={open === key ? "chevron-down" : "chevron-forward"} size={14} color={C.muted} />
                    <T small muted>{`${r.start ?? ""}${r.end ? `–${r.end}` : ""}`}</T><T bold>{who(r.child_id)}</T><T small muted>{r.therapist ?? ""}</T>
                  </Row>
                  <Row gap={4}>
                    {r.makeup && <Badge tone="indigo">보강</Badge>}
                    {st ? <Badge tone={ST[st]?.[1]}>{`${ST[st]?.[0] ?? st}${r.state.auto && st === "present" ? " (자동)" : ""}`}</Badge> : <Badge>예정</Badge>}
                    {r.consultations.length > 0 && <Badge tone="green">수업 기록</Badge>}
                    {r.sessions.length > 0 && <Badge tone="green">활동 기록</Badge>}
                    {r.sessions.some((x) => x.note) && <Badge tone="green">노트</Badge>}
                    {r.recordings.length > 0 && <Badge tone="green">녹음 기록</Badge>}
                    {!written(r) && happened(r) && r.date <= today() && <Badge tone="amber">기록 없음</Badge>}
                  </Row>
                </Pressable>
                {open === key && (
                  <View style={{ gap: 8, backgroundColor: C.paper, borderRadius: 14, padding: 10 }}>
                    {r.state.reason && <T small muted>{r.state.reason}</T>}
                    {r.consultations.map((c) => <ConsultView key={c.id} c={c} />)}
                    {r.sessions.map((x) => (
                      <View key={x.id} style={{ gap: 2 }}>
                        <T small muted>{`회기 기록 ${x.start ? `${x.start}–${x.end}` : ""}${x.minutes ? ` · ${x.minutes}분` : ""}`}</T>
                        {x.activities.length > 0 && <T small>{`활동 ${x.activities.map((a) => `${a.name}${a.accuracy_pct != null ? ` ${a.accuracy_pct}%` : ""}`).join(", ")}`}</T>}
                        {x.utterances.length > 0 && <T small>{`발화 ${x.utterances.join(" / ")}`}</T>}
                        {x.observed_behaviors.length > 0 && <T small>{`관찰 ${x.observed_behaviors.join(", ")}`}</T>}
                        {x.note && <T small>{x.note}</T>}
                      </View>))}
                    {r.recordings.map((rec) => (
                      <View key={rec.id} style={{ gap: 2 }}>
                        <T small muted>{rec.kind === "consultation" ? "상담 녹음 기록" : "회기 녹음 기록"}</T>
                        {Object.entries(rec.sections).map(([k, v]) => <T key={k} small><T small bold>{`${SEC[k] ?? k} `}</T>{v}</T>)}
                      </View>))}
                    {!written(r) && <T small muted>이 수업의 기록이 아직 없어요.</T>}
                    <Button small variant="outline" title={written(r) ? "수업 기록 보기" : "수업 기록 쓰기"} onPress={() => { setChildId(r.child_id); onOpen(); }} />
                  </View>)}
              </View>);
          })}
        </Card>))}
      {list.error && <Notice tone="red">{errText(list.error)}</Notice>}
    </>
  );
}
