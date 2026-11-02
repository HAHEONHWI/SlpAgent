import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { ageLabel, api, errText } from "@/lib/api";
import { useChild } from "@/lib/child";
import { canWrite, useMe } from "@/lib/me";
import { RequireChild } from "@/components/ChildPicker";
import { ApprovedHistory, DraftView, Proposals, type Draft } from "@/components/Drafts";
import Markdown from "@/components/Markdown";
import { Badge, Button, C, Checkbox, IconButton, Input, Notice, Row, Screen, Segmented, Sheet, T, Tabs, TextField, s } from "@/components/ui";

type Source = { citation: string; document: string; page: number | string | null; test_code?: string | null; item_ids?: string[] };
type Attachment = { name: string; type: string };
type Msg = { role: "user" | "assistant"; text: string; sources?: Source[]; attachments?: Attachment[]; reference_status?: "used" | "not_found" | "error" | null };
type Mode = "knowledge" | "clinical";
type Conversation = { id: string; title: string; mode: Mode; child_id: string | null; updated_at: string };
type ConversationDetail = { id: string; title: string; mode: Mode; child_id: string | null; messages: Msg[] };
type ChatReply = { conversation_id: string; mode: Mode; text: string; proposals: string[]; sources: Source[]; attachments: Attachment[]; reference_status: "used" | "not_found" | "error" };
type PickedFile = { uri: string; name: string; mimeType: string; size: number };
type SendInput = { message: string; mode: Mode; allowDrafts: boolean; conversationId: string | null; selectedChildId: string | null; files: PickedFile[]; privacyConfirmed: boolean };

const attachmentPrompt = "첨부한 자료를 요약하고 언어재활 관련 핵심 내용을 알려 주세요.";
const examplePrompts = ["수용언어와 표현언어의 차이를 쉬운 예시로 설명해줘", "조음과 음운의 차이와 평가할 때 보는 점을 알려줘", "SELSI와 PRES의 검사 대상 연령을 정리해줘", "공동주의와 의사소통 의도의 관계를 설명해줘"];
const clinicalPrompts = ["관찰 기록을 바탕으로 초기 임상 의견 초안을 작성해줘", "최근 회기에서 확인된 변화와 추가로 관찰할 점을 정리해줘"];
const ACCEPT = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain", "text/markdown", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/x-hwp", "application/haansofthwp", "application/vnd.hancom.hwp", "application/hwp+zip", "application/octet-stream"];
const EXT = /\.(pdf|png|jpe?g|webp|txt|md|csv|docx|hwp|hwpx)$/i;

export default function AI() {
  const writable = canWrite(useMe().data);
  const { childId } = useChild();
  const [tab, setTab] = useState<"chat" | "activities" | "review">("chat");
  return (
    <View style={{ flex: 1 }}>
      <Tabs value={tab} onChange={setTab} items={[["chat", "AI 대화"], ...(writable ? [["activities", "치료활동 생성"] as ["activities", string]] : []), ["review", "검토 대기"]]} />
      {tab === "chat" ? <Chat /> : tab === "activities" ? <Screen><RequireChild>{(id) => <Activities childId={id} />}</RequireChild></Screen>
        : <Screen><Proposals childId={childId} /></Screen>}
    </View>
  );
}

function Chat() {
  const { childId, child, setChildId } = useChild();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("knowledge");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [allowDrafts, setAllowDrafts] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const list = useRef<FlatList<Msg>>(null);
  const conversations = useQuery({ queryKey: ["ai-dialogue-conversations"], queryFn: () => api<Conversation[]>("/ai/dialogue/conversations") });
  const detail = useQuery({ queryKey: ["ai-dialogue-conversation", conversationId], queryFn: () => api<ConversationDetail>(`/ai/dialogue/conversations/${conversationId}`), enabled: !!conversationId });
  const selected = conversations.data?.find((c) => c.id === conversationId);
  const reset = () => { setInput(""); setFiles([]); setPrivacyConfirmed(false); setAllowDrafts(false); };

  useEffect(() => { setAllowDrafts(false); }, [childId]);
  useEffect(() => { setMsgs([]); setLoadedId(null); }, [conversationId]);
  useEffect(() => {
    if (conversationId && detail.data?.id === conversationId && loadedId !== conversationId) { setMsgs(detail.data.messages); setLoadedId(conversationId); }
  }, [conversationId, detail.data, loadedId]);
  // A clinical conversation belongs to one child: switching the child leaves it.
  useEffect(() => { if (selected?.mode === "clinical" && selected.child_id !== childId) { setConversationId(null); reset(); } }, [childId, selected]);

  const send = useMutation({
    mutationFn: ({ message, mode: m, allowDrafts: drafts, conversationId: activeId, selectedChildId, files: att, privacyConfirmed: confirmed }: SendInput) => {
      if (att.length) {
        const form = new FormData();
        form.append("message", message);
        form.append("mode", m);
        form.append("allow_drafts", String(drafts));
        if (activeId) form.append("conversation_id", activeId);
        else if (selectedChildId) form.append("child_id", selectedChildId);
        form.append("privacy_confirmed", String(confirmed));
        att.forEach((f) => form.append("files", { uri: f.uri, name: f.name, type: f.mimeType } as unknown as Blob));
        return api<ChatReply>("/ai/dialogue", { method: "POST", body: form, long: true });
      }
      return api<ChatReply>("/ai/dialogue", { method: "POST", long: true, json: { message, mode: m, allow_drafts: drafts, conversation_id: activeId, child_id: activeId ? undefined : selectedChildId } });
    },
    onSuccess: (r, v) => {
      const stillOpen = v.mode === mode && (v.conversationId ? conversationId === v.conversationId : conversationId === null && (mode === "knowledge" || childId === v.selectedChildId));
      qc.invalidateQueries({ queryKey: ["ai-dialogue-conversations"] });
      qc.invalidateQueries({ queryKey: ["ai-dialogue-conversation", r.conversation_id] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      if (!stillOpen) return;
      if (!v.conversationId) setConversationId(r.conversation_id); // the new conversation then loads from the server
      setMsgs((m) => [...m, { role: "assistant", text: r.text, sources: r.sources, reference_status: r.reference_status }]);
      setFiles([]); setPrivacyConfirmed(false); setAllowDrafts(false); setUploadError("");
    },
    onError: (_e, v) => setInput(v.message),
  });

  const pickFiles = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ACCEPT, multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return;
    const next = r.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType || "application/octet-stream", size: a.size ?? 0 }));
    const combined = [...files, ...next];
    if (next.some((f) => !EXT.test(f.name))) setUploadError("PDF, 이미지, DOCX, HWP/HWPX, TXT·MD·CSV 파일만 첨부할 수 있습니다.");
    else if (combined.length > 4) setUploadError("파일은 한 번에 4개까지 첨부할 수 있습니다.");
    else if (combined.some((f) => f.size > 10 * 1024 * 1024)) setUploadError("파일 하나는 10MB 이하여야 합니다.");
    else if (combined.reduce((sum, f) => sum + f.size, 0) > 20 * 1024 * 1024) setUploadError("첨부 파일 전체 크기는 20MB 이하여야 합니다.");
    else { setFiles(combined); setAllowDrafts(false); setPrivacyConfirmed(false); setUploadError(""); }
  };

  const submit = (text?: string) => {
    const message = (text ?? input).trim() || (files.length ? attachmentPrompt : "");
    if (!message || send.isPending || (files.length > 0 && !privacyConfirmed)) return;
    if (mode === "clinical" && !childId) return setUploadError("임상 대화는 위쪽에서 아동을 먼저 선택하세요.");
    const userMsg: Msg = { role: "user", text: message, attachments: files.map((f) => ({ name: f.name, type: f.mimeType })) };
    setMsgs((m) => [...m, userMsg]);
    send.mutate({ message, mode, allowDrafts: mode === "clinical" && allowDrafts, conversationId, selectedChildId: mode === "clinical" ? childId : null, files, privacyConfirmed });
    setInput("");
  };

  const switchMode = (m: Mode) => { setMode(m); setConversationId(null); setMsgs([]); reset(); };
  const empty = msgs.length === 0 && !detail.isLoading;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[s.row, { paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderColor: C.line }]}>
        <Segmented value={mode} disabled={send.isPending} onChange={switchMode} items={[["knowledge", "언어치료 지식"], ["clinical", "임상 대화"]]} />
        <View style={{ flex: 1 }} />
        <IconButton icon="time-outline" label="대화 기록" onPress={() => setHistoryOpen(true)} />
        <IconButton icon="add-circle-outline" label="새 대화" disabled={send.isPending} onPress={() => { setConversationId(null); setMsgs([]); reset(); }} />
      </View>
      {mode === "clinical" && (
        <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
          <Badge tone={child ? "indigo" : "slate"}>{child ? `아동별 · ${child.alias} ${child.display_name}` : "아동 미선택 · 위쪽에서 아동을 고르세요"}</Badge>
        </View>)}
      <FlatList ref={list} data={msgs} keyExtractor={(_, i) => `${conversationId ?? "draft"}-${i}`} style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 18, flexGrow: 1 }} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => <ChatMessage message={item} />}
        ListEmptyComponent={empty ? (
          <View style={{ flex: 1, justifyContent: "center", gap: 12 }}>
            <View style={{ alignItems: "center", gap: 6 }}>
              <Ionicons name="sparkles" size={28} color={C.accent} />
              <Text style={{ fontSize: 18, fontWeight: "700", color: C.inkDark, textAlign: "center" }}>{mode === "knowledge" ? "궁금한 언어치료 개념을 물어보세요" : "어떤 기록을 살펴볼까요?"}</Text>
              <T small muted style={{ textAlign: "center" }}>{mode === "knowledge" ? "수용·표현언어, 조음·음운, 어휘, 구문, 화용과 검사 원리를 설명합니다. 기관 자료 근거와 일반 지식을 구분합니다. 아동 기록은 사용하지 않습니다." : "선택 아동의 기록을 바탕으로 치료사 검토용 초안을 작성합니다. 관찰 근거와 한계를 확인하세요."}</T>
            </View>
            {(mode === "knowledge" ? examplePrompts : clinicalPrompts).map((p) => (
              <Pressable key={p} onPress={() => setInput(p)} style={({ pressed }) => ({ borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, backgroundColor: pressed ? C.paper : C.white })}>
                <T small>{p}</T>
              </Pressable>))}
          </View>) : detail.isLoading ? <ActivityIndicator color={C.accent} /> : undefined}
        ListFooterComponent={send.isPending ? <Row><ActivityIndicator color={C.accent} /><T small muted>자료를 확인하고 답변을 작성하고 있습니다…</T></Row>
          : detail.error ? <Notice tone="red">{`대화를 불러오지 못했습니다: ${errText(detail.error)}`}</Notice> : undefined} />
      <View style={{ borderTopWidth: 1, borderColor: C.line, backgroundColor: C.white, padding: 10, gap: 8 }}>
        {mode === "clinical" && child && <Checkbox checked={allowDrafts} disabled={send.isPending || files.length > 0} onChange={setAllowDrafts} label={<T small>이번 질문에서 임상 초안 생성 허용 (기록 반영은 별도 승인)</T>} />}
        {send.error && <Notice tone="red">{errText(send.error)}</Notice>}
        {(!!uploadError || (files.length > 0 && !privacyConfirmed)) && <Notice>{uploadError || "파일에서 아동 이름·연락처를 가명 처리했거나 포함되지 않았는지 확인해 주세요."}</Notice>}
        {files.length > 0 && (
          <>
            <Row gap={6}>{files.map((f, i) => (
              <View key={`${f.name}-${i}`} style={[s.row, { backgroundColor: C.paper, borderRadius: 10, paddingLeft: 8, gap: 2 }]}>
                <Ionicons name="document-text-outline" size={14} color={C.sub} /><Text numberOfLines={1} style={{ maxWidth: 160, fontSize: 12, color: C.ink }}>{f.name}</Text>
                <IconButton icon="close" label={`${f.name} 제거`} onPress={() => { setFiles(files.filter((_, j) => j !== i)); setPrivacyConfirmed(false); }} />
              </View>))}</Row>
            <Checkbox checked={privacyConfirmed} onChange={setPrivacyConfirmed} label={<T small>파일에 아동 이름·연락처가 없거나 가명 처리했습니다. 원본 파일은 앱 대화 저장소에 저장되지 않으며, 답변 생성을 위해 AI 서비스로 전송됩니다.</T>} />
          </>)}
        <View style={[s.row, { alignItems: "flex-end" }]}>
          <IconButton icon="attach" label="파일 첨부" disabled={send.isPending} onPress={pickFiles} />
          <View style={{ flex: 1 }}><Input multiline value={input} onChangeText={setInput} placeholder="질문을 입력하세요" style={{ minHeight: 44, maxHeight: 140, paddingTop: 11 }} accessibilityLabel="메시지 입력" /></View>
          <Pressable accessibilityRole="button" accessibilityLabel="메시지 전송" onPress={() => submit()}
            disabled={send.isPending || (!input.trim() && !files.length) || (files.length > 0 && !privacyConfirmed)}
            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 99, backgroundColor: C.accent, alignItems: "center", justifyContent: "center",
              opacity: send.isPending || (!input.trim() && !files.length) || (files.length > 0 && !privacyConfirmed) ? 0.4 : pressed ? 0.7 : 1 })}>
            <Ionicons name="arrow-up" size={22} color="#fff" />
          </Pressable>
        </View>
        <T small muted style={{ textAlign: "center", fontSize: 11 }}>아동 이름·연락처는 가명 처리해 주세요. 진단 요청은 치료사 검토용 초기 임상 의견으로 작성됩니다.</T>
      </View>

      <Sheet visible={historyOpen} onClose={() => setHistoryOpen(false)} title="대화 기록">
        {conversations.isLoading && <T small muted>대화 불러오는 중…</T>}
        {conversations.error && <Notice tone="red">{errText(conversations.error)}</Notice>}
        {!conversations.isLoading && !conversations.data?.length && <T small muted>아직 대화가 없습니다.</T>}
        {conversations.data?.map((item) => (
          <Pressable key={item.id} disabled={send.isPending} onPress={() => {
            setHistoryOpen(false);
            if (item.mode === "clinical") setChildId(item.child_id);
            setMode(item.mode); setConversationId(item.id); reset();
          }} style={({ pressed }) => [s.option, { backgroundColor: conversationId === item.id ? C.accentSoft : pressed ? C.paper : "transparent" }]}>
            <Text numberOfLines={1} style={{ fontSize: 15, color: C.ink, fontWeight: conversationId === item.id ? "700" : "400" }}>{item.title}</Text>
            <T small muted>{`${item.mode === "knowledge" ? "언어치료 지식" : "임상 대화"} · ${item.updated_at.slice(0, 10)}`}</T>
          </Pressable>))}
      </Sheet>
    </View>
  );
}

function ChatMessage({ message }: { message: Msg }) {
  if (message.role === "user") return (
    <View style={{ alignSelf: "flex-end", maxWidth: "88%", backgroundColor: C.paper, borderRadius: 18, padding: 12, gap: 6 }}>
      {!!message.attachments?.length && <Row gap={4}>{message.attachments.map((a, i) => <Badge key={i}>{`📎 ${a.name}`}</Badge>)}</Row>}
      <T selectable>{message.text}</T>
    </View>);
  return (
    <View style={{ gap: 8 }}>
      <Row gap={6}><Ionicons name="sparkles" size={14} color={C.accent} /><T small muted>SLP AI</T></Row>
      <Markdown text={message.text} />
      {!!message.sources?.length && (
        <View style={{ backgroundColor: C.paper, borderRadius: 12, padding: 10, gap: 6 }}>
          <T small bold>참고한 기관 자료</T>
          {message.sources.map((src) => (
            <T key={`${src.citation}-${src.document}-${src.page}`} small><Text style={{ fontWeight: "700", color: C.accentDark }}>{src.citation} </Text>
              {`${src.document} · p.${src.page ?? "확인 필요"}${src.test_code ? ` · ${src.test_code}` : ""}`}</T>))}
        </View>)}
      {message.reference_status === "not_found" && <T small muted>기관 등록 자료에서 직접 근거를 찾지 못했습니다. 답변은 일반 지식 또는 추론을 포함할 수 있습니다.</T>}
      {message.reference_status === "error" && <T small style={{ color: C.amberText }}>기관 자료 검색에 실패했습니다. 아래 답변에서 자료 근거를 확인하지 못했습니다.</T>}
    </View>);
}

const SECTIONS: [string, string][] = [["purpose", "활동 목적"], ["materials", "준비물"], ["sequence", "진행 순서"], ["modeling_examples", "언어적 모델링 예시"],
  ["response_elicitation", "반응 유도 방법"], ["difficulty_adjustments", "난이도 조절"], ["measurement", "수행 측정 방법"], ["parent_linkage", "보호자 연계 활동"]];
const split = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

/** 치료활동 생성: conditions -> AI draft -> approve/reject. */
function Activities({ childId }: { childId: string }) {
  const { child } = useChild();
  const [f, setF] = useState({ goal_area: "", current_level: "", preferences: "", materials: "", time_minutes: "30", prompting_level: "" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const run = useMutation({
    mutationFn: () => api<Draft>(`/children/${childId}/activities/generate`, { method: "POST", long: true, json: {
      goal_area: f.goal_area, current_level: f.current_level, preferences: split(f.preferences), materials: split(f.materials),
      time_minutes: Number(f.time_minutes), prompting_level: f.prompting_level } }),
    onSuccess: setDraft,
  });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const ok = f.goal_area.trim() && f.current_level.trim() && f.prompting_level.trim() && Number(f.time_minutes) >= 1 && Number(f.time_minutes) <= 180;
  return (
    <>
      <T small muted>{`아동 연령: ${ageLabel(child?.age_months)} (생년월일에서 자동 계산)`}</T>
      <TextField label="목표 영역" value={f.goal_area} onChangeText={set("goal_area")} placeholder="예: 2음절 단어 모방" />
      <TextField label="현재 수행 수준" multiline value={f.current_level} onChangeText={set("current_level")} placeholder="예: 모델 제시 시 5회 중 2회 모방" />
      <TextField label="선호 활동 (쉼표 구분)" value={f.preferences} onChangeText={set("preferences")} />
      <TextField label="준비물 (쉼표 구분)" value={f.materials} onChangeText={set("materials")} />
      <Row style={{ flexWrap: "nowrap" }}>
        <View style={{ flex: 1 }}><TextField label="치료시간(분)" keyboardType="number-pad" value={f.time_minutes} onChangeText={(v) => set("time_minutes")(v.replace(/\D/g, ""))} /></View>
        <View style={{ flex: 1 }}><TextField label="촉진 수준" value={f.prompting_level} onChangeText={set("prompting_level")} placeholder="예: 모델링" /></View>
      </Row>
      {run.error && <Notice tone="red">{errText(run.error)}</Notice>}
      <Button icon="sparkles" title={run.isPending ? "생성 중…" : "AI 활동 초안 생성"} loading={run.isPending} disabled={!ok} onPress={() => { setDraft(null); run.mutate(); }} />
      {draft ? <DraftView draft={draft} sections={SECTIONS} onDone={() => setDraft(null)} />
        : <View style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: C.border, borderRadius: 20, padding: 20 }}><T small muted>조건을 입력하고 생성하면 활동 초안이 여기에 표시됩니다. 승인 전에는 저장되지 않습니다.</T></View>}
      <ApprovedHistory path={`/children/${childId}/therapy-activities`} sections={SECTIONS} kindLabel="치료활동" />
    </>
  );
}
