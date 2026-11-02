import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { RecordingPresets, requestNotificationPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type RecordingOptions } from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import { ageLabel, errText } from "@/lib/api";
import { useChild } from "@/lib/child";
import { clock, today } from "@/lib/dates";
import { useClassSlot } from "@/lib/hooks";
import { canWrite, useMe } from "@/lib/me";
import { CONSENT_TEXT, EXT, MAX_HOURS, MAX_MB, PROCESSOR_TEXT, dropPending, loadPending, mb, putPending, submitRecording, type Kind, type Pending } from "@/lib/recordings";
import { ChildRow, ChildSheet, useChildSections } from "@/components/ChildPicker";
import { JobList, Progress } from "@/components/RecordingJobs";
import { Button, C, Card, Checkbox, DateField, Empty, Input, Notice, Row, Screen, Segmented, T, TextField, confirm, s } from "@/components/ui";

// Speech only: mono AAC at 64 kbps keeps a 3-hour class near 90 MB (the server limit is 200 MB) and uploads quickly.
const PRESET: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, directory: "document" };
const LIMIT_MS = MAX_HOURS * 3600 * 1000;

/** 녹음 탭: 아이 고르기 → 녹음(또는 파일) → 올리기 → AI 초안 검토·승인 → 아동 기록. */
export default function Record() {
  const me = useMe().data;
  const { children, childId, setChildId } = useChild();
  const qc = useQueryClient();
  const recorder = useAudioRecorder(PRESET);
  const rec = useAudioRecorderState(recorder, 500);
  const [phase, setPhase] = useState<"idle" | "recording" | "paused">("idle");
  const [kind, setKind] = useState<Kind>("session");
  const [form, setForm] = useState({ date: today(), start: "", end: "", counselor: "" });
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState<{ id: string; progress: number } | null>(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState(false);
  // The child is fixed while a recording is running, even if the header picker changes.
  const [lockedChild, setLockedChild] = useState<string | null>(null);
  const target = lockedChild ?? childId;
  const myName = (me?.therapist_name ?? me?.name ?? "").trim();
  const writable = canWrite(me);

  const reload = useCallback(() => { loadPending().then(setPending); }, []);
  useFocusEffect(reload);
  useEffect(() => setForm((f) => ({ ...f, counselor: f.counselor || myName })), [myName]);
  // 날짜를 고르면 그날 시간표의 수업 시간·담당을 채운다 (수업이 없는 날은 시간을 비운다)
  useClassSlot(target, form.date, (sl) => setForm((f) => ({ ...f, start: sl?.start ?? "", end: sl?.end ?? "", counselor: sl?.therapist || f.counselor })));

  // Stop at the server's 3-hour limit.
  const durationMs = rec.durationMillis ?? 0;
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => { if (phase !== "idle" && durationMs >= LIMIT_MS) stopRef.current(); }, [durationMs, phase]);
  useEffect(() => () => { deactivateKeepAwake("recording"); }, []);
  // Coming back from the background: refresh the job list and the clock.
  useEffect(() => { const sub = AppState.addEventListener("change", (st) => st === "active" && reload()); return () => sub.remove(); }, [reload]);

  const start = async () => {
    setErr("");
    if (!target) return setErr("아이를 먼저 골라 주세요.");
    if (!consent) return setErr("녹음 동의를 확인해 주세요.");
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return setErr("마이크 권한이 필요해요. 휴대폰 설정 › 앱 › SLP AI › 권한에서 마이크를 허용해 주세요.");
    // Android 13+: the "recording" notification keeps the recorder alive while the screen is off.
    if (Platform.OS === "android") await requestNotificationPermissionsAsync().catch(() => null);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true, shouldPlayInBackground: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      await activateKeepAwakeAsync("recording");
      setLockedChild(target);
      setPhase("recording");
    } catch (e) { setErr(`녹음을 시작하지 못했어요: ${errText(e)}`); }
  };
  const pause = () => { recorder.pause(); setPhase("paused"); };
  const resume = () => { recorder.record(); setPhase("recording"); };
  const stop = async () => {
    try {
      await recorder.stop();
      deactivateKeepAwake("recording");
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, shouldPlayInBackground: false });
      const uri = recorder.uri;
      setPhase("idle");
      if (!uri || !lockedChild) throw new Error("녹음 파일을 찾지 못했어요.");
      const file = new File(uri);
      const p: Pending = { id: String(Date.now()), uri, filename: `녹음_${form.date}_${Date.now()}.m4a`, size: file.size, contentType: "audio/mp4", ownFile: true,
        childId: lockedChild, kind, date: form.date, start: form.start, end: form.end, counselor: form.counselor.trim() || myName, durationMs, createdAt: new Date().toISOString() };
      setLockedChild(null);
      await putPending(p);
      reload();
      upload(p);
    } catch (e) { setErr(errText(e)); setPhase("idle"); setLockedChild(null); }
  };
  stopRef.current = stop;

  const upload = async (p: Pending) => {
    setErr("");
    if (!p.counselor.trim()) return setErr("담당 치료사 이름을 넣어 주세요.");
    setUploading({ id: p.id, progress: 0 });
    try {
      await submitRecording(p, (progress) => setUploading({ id: p.id, progress }));
      await dropPending(p);
      setConsent(false);
    } catch (e) { setErr(`올리지 못했어요. 녹음은 휴대폰에 남아 있으니 ‘다시 올리기’를 눌러 주세요. (${errText(e)})`); }
    finally { setUploading(null); reload(); qc.invalidateQueries({ queryKey: ["recordings", p.childId] }); }
  };

  const fromFile = async () => {
    setErr("");
    if (!target) return setErr("아이를 먼저 골라 주세요.");
    if (!consent) return setErr("녹음 동의를 확인해 주세요.");
    const r = await DocumentPicker.getDocumentAsync({ type: ["audio/*", "video/mp4"], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const ext = a.name.slice(a.name.lastIndexOf(".")).toLowerCase();
    if (!EXT.includes(ext)) return setErr(`지원하지 않는 형식입니다 (${ext || "확장자 없음"})`);
    const size = a.size ?? new File(a.uri).size;
    if (size > MAX_MB * 1024 * 1024) return setErr(`${MAX_MB}MB 이하 파일만 올릴 수 있습니다.`);
    // The picker's copy sits in the cache, which Android may clear before a retry: keep our own copy until it is uploaded.
    const kept = new File(Paths.document, `picked-${Date.now()}${ext}`);
    try { await new File(a.uri).copy(kept); } catch (e) { return setErr(`파일을 읽지 못했어요: ${errText(e)}`); }
    const p: Pending = { id: String(Date.now()), uri: kept.uri, filename: a.name, size, contentType: a.mimeType || "application/octet-stream", ownFile: true,
      childId: target, kind, date: form.date, start: form.start, end: form.end, counselor: form.counselor.trim() || myName, createdAt: new Date().toISOString() };
    await putPending(p);
    reload();
    upload(p);
  };

  if (!writable) return <Screen><Notice>보조(읽기 전용) 계정은 녹음 기록을 만들 수 없어요. 기록 탭에서 수업 기록을 볼 수 있어요.</Notice></Screen>;
  const recording = phase !== "idle";
  const child = children.find((c) => c.id === target);

  return (
    <Screen onRefresh={() => { reload(); if (target) qc.invalidateQueries({ queryKey: ["recordings", target] }); }}>
      {!target ? <PickChild onPick={setChildId} /> : (
        <>
          <Card>
            <Row style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <View style={{ flex: 1 }}>
                <T small muted>녹음할 아이</T>
                <Text style={{ fontSize: 22, fontWeight: "800", color: C.inkDark }}>{child?.display_name ?? "선택한 아이"}</Text>
                <T small muted>{[child?.alias, ageLabel(child?.age_months)].filter(Boolean).join(" · ")}</T>
              </View>
              {!recording && <Button small variant="outline" title="바꾸기" onPress={() => setPick(true)} />}
            </Row>
            <ChildSheet visible={pick} value={childId} onPick={(id) => id && setChildId(id)} onClose={() => setPick(false)} />
          </Card>

          <Card title="기록 정보">
            <Segmented value={kind} onChange={setKind} disabled={recording} items={[["session", "치료 회기"], ["consultation", "보호자 상담"]]} />
            <DateField label="날짜" value={form.date} onChange={(date) => setForm({ ...form, date })} />
            <Row style={{ flexWrap: "nowrap" }}>
              <View style={{ flex: 1 }}><DateField label="시작 (선택)" mode="time" optional value={form.start} onChange={(v) => setForm({ ...form, start: v })} /></View>
              <View style={{ flex: 1 }}><DateField label="종료 (선택)" mode="time" optional value={form.end} onChange={(v) => setForm({ ...form, end: v })} /></View>
            </Row>
            <TextField label="담당 치료사" value={form.counselor} onChangeText={(v) => setForm({ ...form, counselor: v })} maxLength={40} />
            <Checkbox checked={consent} onChange={setConsent} disabled={recording} label={<T small>{CONSENT_TEXT}</T>} />
            <T small muted>{PROCESSOR_TEXT}</T>
          </Card>

          <Card>
            <View style={{ alignItems: "center", gap: 10, paddingVertical: 8 }}>
              <Text style={{ fontSize: 44, fontWeight: "300", color: recording ? C.accent : C.ink, fontVariant: ["tabular-nums"] }}>{clock(recording ? durationMs : 0)}</Text>
              <T small muted>{phase === "recording" ? "녹음 중 · 화면을 꺼도 계속 녹음돼요" : phase === "paused" ? "일시정지됨" : `최대 ${MAX_HOURS}시간 · 수업이 끝나면 정지를 누르세요`}</T>
              {!recording ? (
                <Pressable accessibilityRole="button" accessibilityLabel="녹음 시작" onPress={start} disabled={!!uploading}
                  style={({ pressed }) => ({ width: 92, height: 92, borderRadius: 99, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", opacity: uploading ? 0.4 : pressed ? 0.8 : 1 })}>
                  <Ionicons name="mic" size={42} color="#fff" />
                </Pressable>
              ) : (
                <Row gap={18} style={{ justifyContent: "center" }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={phase === "paused" ? "이어서 녹음" : "일시정지"} onPress={phase === "paused" ? resume : pause}
                    style={{ width: 70, height: 70, borderRadius: 99, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={phase === "paused" ? "mic" : "pause"} size={30} color={C.ink} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="정지하고 올리기" onPress={stop}
                    style={{ width: 92, height: 92, borderRadius: 99, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="stop" size={38} color="#fff" />
                  </Pressable>
                </Row>
              )}
              {recording && <T small muted>정지하면 바로 올리고 받아쓰기를 시작해요.</T>}
            </View>
            {!recording && <Button variant="ghost" icon="folder-open-outline" title="녹음 파일에서 올리기" disabled={!!uploading} onPress={fromFile} />}
            {!!err && <Notice tone="red">{err}</Notice>}
          </Card>
        </>
      )}

      {pending.length > 0 && (
        <Card title="올리지 못한 녹음">
          <T small muted>휴대폰에 남아 있는 녹음이에요. 인터넷이 연결되면 다시 올려 주세요.</T>
          {pending.map((p) => (
            <View key={p.id} style={{ gap: 6, paddingVertical: 6, borderTopWidth: 1, borderColor: C.line }}>
              <T bold>{`${p.date} · ${p.kind === "session" ? "치료 회기" : "보호자 상담"}`}</T>
              <T small muted>{[p.durationMs ? clock(p.durationMs) : null, mb(p.size), p.counselor].filter(Boolean).join(" · ")}</T>
              {uploading?.id === p.id ? (
                <View style={{ gap: 4 }}><Progress value={uploading.progress} /><T small muted>{`업로드 ${Math.round(uploading.progress * 100)}% · 연결이 끊기면 이어서 올립니다.`}</T></View>
              ) : (
                <Row>
                  <Button small title="다시 올리기" disabled={!!uploading || recording} onPress={() => upload(p)} />
                  <Button small variant="ghost" title="삭제" disabled={!!uploading} onPress={async () => {
                    if (await confirm("이 녹음을 지울까요?", "휴대폰에서 지워지고 되돌릴 수 없어요.", "삭제", true)) { await dropPending(p); reload(); }
                  }} />
                </Row>)}
            </View>))}
        </Card>)}

      {target && <JobList childId={target} />}
    </Screen>
  );
}

function PickChild({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const sections = useChildSections(q);
  const { loading } = useChild();
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: C.inkDark }}>누구의 수업을 녹음할까요?</Text>
      <T small muted>아이를 고르면 오늘 시간표의 수업 시간과 담당 치료사가 자동으로 채워져요.</T>
      <Input value={q} onChangeText={setQ} placeholder="이름·코드·초성 검색" autoCorrect={false} />
      {sections.map((sec) => (
        <View key={sec.title} style={[s.card, { padding: 6 }]}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: C.sub, paddingHorizontal: 12, paddingTop: 8 }}>{sec.title}</Text>
          {sec.data.map((c) => <ChildRow key={c.id} c={c} big onPress={() => onPick(c.id)} />)}
        </View>))}
      {!sections.length && <Empty>{loading ? "불러오는 중…" : q ? `‘${q}’에 맞는 아동이 없어요` : "등록된 아동이 없어요. 메뉴 › 아동 관리에서 먼저 등록하세요."}</Empty>}
    </View>
  );
}
