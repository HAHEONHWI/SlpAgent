import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileText, MessageSquarePlus, Paperclip, Send, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { errText } from "../lib/hooks";
import { Badge, Button, Notice, Select, Textarea } from "../components/ui";

type Source = { citation: string; document: string; page: number | string | null; test_code?: string | null; item_ids?: string[] };
type Attachment = { name: string; type: string };
type Msg = { role: "user" | "assistant"; text: string; sources?: Source[]; attachments?: Attachment[]; reference_status?: "used" | "not_found" | "error" | null };
type DialogueMode = "knowledge" | "clinical";
type Conversation = { readonly id: string; readonly title: string; readonly mode: DialogueMode; readonly child_id: string | null; readonly updated_at: string };
type ConversationDetail = { readonly id: string; readonly title: string; readonly mode: DialogueMode; readonly child_id: string | null; readonly messages: Msg[] };
type ChatReply = { readonly conversation_id: string; readonly mode: DialogueMode; readonly text: string; readonly proposals: string[]; readonly sources: Source[]; readonly attachments: Attachment[]; readonly reference_status: "used" | "not_found" | "error" };
type SendInput = { readonly message: string; readonly mode: DialogueMode; readonly allowDrafts: boolean; readonly conversationId: string | null; readonly selectedChildId: string | null; readonly files: File[]; readonly privacyConfirmed: boolean };

const attachmentPrompt = "첨부한 자료를 요약하고 언어재활 관련 핵심 내용을 알려 주세요.";
const examplePrompts = [
  "수용언어와 표현언어의 차이를 쉬운 예시로 설명해줘",
  "조음과 음운의 차이와 평가할 때 보는 점을 알려줘",
  "SELSI와 PRES의 검사 대상 연령을 정리해줘",
  "공동주의와 의사소통 의도의 관계를 설명해줘",
] as const;
const clinicalPrompts = [
  "관찰 기록을 바탕으로 초기 임상 의견 초안을 작성해줘",
  "최근 회기에서 확인된 변화와 추가로 관찰할 점을 정리해줘",
] as const;

export default function Chat() {
  const { childId, child, setChildId } = useChild();
  const qc = useQueryClient();
  const [mode, setMode] = useState<DialogueMode>("knowledge");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [allowDrafts, setAllowDrafts] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const conversations = useQuery({ queryKey: ["ai-dialogue-conversations"], queryFn: () => api<Conversation[]>("/ai/dialogue/conversations") });
  const detail = useQuery({
    queryKey: ["ai-dialogue-conversation", conversationId],
    queryFn: () => api<ConversationDetail>(`/ai/dialogue/conversations/${conversationId}`),
    enabled: Boolean(conversationId),
  });
  const selectedConversation = conversations.data?.find((item) => item.id === conversationId);

  useEffect(() => { setAllowDrafts(false); }, [childId]);

  useEffect(() => {
    if (!conversationId) {
      setMsgs([]);
      setLoadedConversationId(null);
      return;
    }
    setMsgs([]);
    setLoadedConversationId(null);
  }, [conversationId]);

  useEffect(() => {
    if (conversationId && detail.data?.id === conversationId && loadedConversationId !== conversationId) {
      setMsgs(detail.data.messages);
      setLoadedConversationId(conversationId);
    }
  }, [conversationId, detail.data, loadedConversationId]);

  useEffect(() => {
    if (selectedConversation?.mode === "clinical" && selectedConversation.child_id !== childId) {
      setConversationId(null);
      setFiles([]);
      setPrivacyConfirmed(false);
      setAllowDrafts(false);
    }
  }, [childId, selectedConversation]);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (scrollArea.current) {
      scrollArea.current.scrollTo({ top: scrollArea.current.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
    }
  }, [msgs, detail.isFetching]);

  const send = useMutation({
    mutationFn: ({ message, mode: dialogueMode, allowDrafts: draftsAllowed, conversationId: activeId, selectedChildId, files: attachments, privacyConfirmed: confirmed }: SendInput) => {
      if (attachments.length) {
        const form = new FormData();
        form.append("message", message);
        form.append("mode", dialogueMode);
        form.append("allow_drafts", String(draftsAllowed));
        if (activeId) form.append("conversation_id", activeId);
        else if (selectedChildId) form.append("child_id", selectedChildId);
        form.append("privacy_confirmed", String(confirmed));
        attachments.forEach((file) => form.append("files", file));
        return api<ChatReply>("/ai/dialogue", { method: "POST", body: form, long: true });
      }
      return api<ChatReply>("/ai/dialogue", {
        method: "POST", long: true,
        json: { message, mode: dialogueMode, allow_drafts: draftsAllowed, conversation_id: activeId, child_id: activeId ? undefined : selectedChildId },
      });
    },
    onSuccess: (r, variables) => {
      const stillOpen = variables.mode === mode && (variables.conversationId ? conversationId === variables.conversationId : conversationId === null && (mode === "knowledge" || childId === variables.selectedChildId));
      qc.invalidateQueries({ queryKey: ["ai-dialogue-conversations"] });
      qc.invalidateQueries({ queryKey: ["ai-dialogue-conversation", r.conversation_id] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      if (!stillOpen) return;
      if (!variables.conversationId) setConversationId(r.conversation_id);
      setMsgs((messages) => [...messages, {
        role: "assistant", text: r.text, sources: r.sources, reference_status: r.reference_status,
      }]);
      setFiles([]);
      setPrivacyConfirmed(false);
      setAllowDrafts(false);
      setUploadError("");
    },
    onError: (_error, variables) => {
      setInput(variables.message);
    },
  });

  const selectFiles = (selection: FileList | null) => {
    if (!selection?.length) return;
    const next = Array.from(selection);
    const combined = [...files, ...next];
    if (combined.length > 4) setUploadError("파일은 한 번에 4개까지 첨부할 수 있습니다.");
    else if (combined.some((file) => file.size > 10 * 1024 * 1024)) setUploadError("파일 하나는 10MB 이하여야 합니다.");
    else if (combined.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) setUploadError("첨부 파일 전체 크기는 20MB 이하여야 합니다.");
    else {
      setFiles(combined);
      setAllowDrafts(false);
      setPrivacyConfirmed(false);
      setUploadError("");
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((selected) => selected.filter((_, itemIndex) => itemIndex !== index));
    setPrivacyConfirmed(false);
  };

  const submit = () => {
    const message = input.trim() || (files.length ? attachmentPrompt : "");
    if (!message || send.isPending || (files.length > 0 && !privacyConfirmed)) return;
    setMsgs((messages) => [...messages, { role: "user", text: message, attachments: files.map((file) => ({ name: file.name, type: file.type })) }]);
    send.mutate({ message, mode, allowDrafts: mode === "clinical" && allowDrafts, conversationId, selectedChildId: mode === "clinical" ? childId : null, files, privacyConfirmed });
    setInput("");
  };

  return (
    <div className="relative mx-auto flex min-h-0 w-full max-w-[116rem] flex-1 flex-col">
      <div className="mb-3 shrink-0 md:hidden">
        <Button variant="outline" type="button" aria-controls="conversation-history" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>대화 기록</Button>
      </div>
      <div className={`grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3 md:grid-cols-[13rem_minmax(0,1fr)] ${mode === "clinical" ? "2xl:grid-cols-[13rem_minmax(0,1fr)_18rem]" : ""}`}>
        <aside id="conversation-history" aria-label="대화 기록" onKeyDown={(event) => { if (event.key === "Escape") setHistoryOpen(false); }} className={`${historyOpen ? "flex" : "hidden"} absolute bottom-0 left-0 top-12 z-20 w-52 min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:static md:flex md:h-full md:w-auto`}>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div><h2 className="text-sm font-semibold">대화 기록</h2><p className="mt-0.5 text-xs text-slate-500">이전 AI 대화</p></div>
            <div className="flex items-center gap-1"><Button variant="ghost" type="button" aria-label="새 대화" title="새 대화" disabled={send.isPending}
              onClick={() => { setHistoryOpen(false); setConversationId(null); setMsgs([]); setInput(""); setFiles([]); setPrivacyConfirmed(false); setAllowDrafts(false); }}>
              <MessageSquarePlus size={16} />
            </Button><button type="button" aria-label="대화 기록 닫기" onClick={() => setHistoryOpen(false)} className="rounded-md p-2 text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 md:hidden"><X size={16} /></button></div>
          </div>
          <nav aria-label="대화 목록" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {conversations.isLoading && <p className="px-2 py-3 text-xs text-slate-400">대화 불러오는 중…</p>}
            {conversations.data?.map((item) => (
              <button key={item.id} type="button" aria-current={conversationId === item.id ? "page" : undefined}
                disabled={send.isPending} onClick={() => {
                  setHistoryOpen(false);
                  if (item.mode === "clinical") setChildId(item.child_id);
                  setMode(item.mode);
                  setAllowDrafts(false);
                  setConversationId(item.id);
                  setInput("");
                  setFiles([]);
                  setPrivacyConfirmed(false);
                }}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50 ${conversationId === item.id ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600"}`}>
                <span className="block truncate">{item.title}</span>
                <span className="mt-1 block text-[11px] text-slate-500">{item.mode === "knowledge" ? "언어치료 지식" : "임상 대화"}</span>
              </button>
            ))}
            {conversations.error && <p className="px-2 py-3 text-xs text-red-600">{errText(conversations.error)}</p>}
            {!conversations.isLoading && !conversations.error && conversations.data?.length === 0 &&
              <p className="px-2 py-3 text-xs text-slate-400">아직 대화가 없습니다.</p>}
          </nav>
        </aside>

        <section aria-label="SLP AI 대화" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 md:px-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><Sparkles size={17} className="text-indigo-600" /><h1 className="text-base font-semibold tracking-tight">{mode === "knowledge" ? "언어치료 지식 Q&A" : "임상 AI 대화"}</h1><Badge tone="indigo">AI 학습 제외</Badge></div>
              <p className="mt-1 text-xs text-slate-500">{mode === "knowledge" ? "기초 개념과 검사 원리를 묻고, 기관 자료의 근거를 확인하세요. 아동 기록은 사용하지 않습니다." : "선택 아동의 기록을 바탕으로 치료사 검토용 초안을 작성합니다."}</p>
              <p className="mt-1 text-xs text-slate-500">OpenAI API 데이터 공유 비활성화 기준입니다. 데이터 보관 정책은 별도입니다.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-600">대화 모드
                <Select value={mode} disabled={send.isPending} aria-label="대화 모드" onChange={(event) => {
                  const next = event.target.value;
                  if (next !== "knowledge" && next !== "clinical") return;
                  setMode(next); setConversationId(null); setMsgs([]); setInput(""); setFiles([]); setPrivacyConfirmed(false); setAllowDrafts(false);
                }}>
                  <option value="knowledge">언어치료 지식</option><option value="clinical">임상 대화</option>
                </Select>
              </label>
              {mode === "clinical" && <Badge tone={child ? "indigo" : "slate"}>{child ? `아동별 · ${child.alias}` : "아동 미선택"}</Badge>}
            </div>
          </header>

          <div ref={scrollArea} aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
            {conversationId && detail.isLoading && <p className="py-8 text-center text-sm text-slate-400">대화 불러오는 중…</p>}
            {detail.error && <Notice tone="red">대화를 불러오지 못했습니다: {errText(detail.error)}</Notice>}
            {msgs.length === 0 && !detail.isLoading && <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center py-6">
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700"><Sparkles size={22} /></div>
                <h2 className="text-xl font-semibold tracking-tight">{mode === "knowledge" ? "궁금한 언어치료 개념을 물어보세요" : "어떤 기록을 살펴볼까요?"}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{mode === "knowledge" ? "수용·표현언어, 조음·음운, 어휘, 구문, 화용과 검사 원리를 설명합니다. 기관 자료 근거와 일반 지식을 구분합니다." : "아동 기록의 관찰 근거와 한계를 확인하고, 필요한 초안을 검토하세요."}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(mode === "knowledge" ? examplePrompts : clinicalPrompts).map((prompt) => <button key={prompt} type="button" onClick={() => setInput(prompt)}
                  className="rounded-lg border border-slate-200 px-4 py-3 text-left text-sm text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">{prompt}</button>)}
              </div>
            </div>}
            <div className="mx-auto max-w-3xl space-y-7">
              {msgs.map((message, index) => <ChatMessage key={`${conversationId ?? "draft"}-${index}`} message={message} />)}
              {send.isPending && <div className="flex items-center gap-2 text-sm text-slate-500"><Sparkles size={15} className="text-indigo-600" />자료를 확인하고 답변을 작성하고 있습니다…</div>}
            </div>
          </div>

          <footer className="shrink-0 border-t border-slate-100 bg-white px-3 py-3 md:px-5">
            {mode === "clinical" && child && <label className="mb-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={allowDrafts} disabled={send.isPending || files.length > 0} onChange={(event) => setAllowDrafts(event.target.checked)} className="accent-indigo-600" />
              이번 질문에서 임상 초안 생성 허용 (기록 반영은 별도 승인)
            </label>}
            {send.error && <div className="mb-2"><Notice tone="red">{errText(send.error)}</Notice></div>}
            {(uploadError || (files.length > 0 && !privacyConfirmed)) && <div className="mb-2"><Notice>{uploadError || "파일에서 아동 이름·연락처를 가명 처리했거나 포함되지 않았는지 확인해 주세요."}</Notice></div>}
            {files.length > 0 && <div className="mb-2 flex flex-wrap gap-2">
              {files.map((file, index) => <span key={`${file.name}-${index}`} className="inline-flex max-w-full items-center gap-2 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700">
                <FileText size={14} className="shrink-0 text-slate-500" /><span className="max-w-56 truncate">{file.name}</span>
                <button type="button" aria-label={`${file.name} 제거`} onClick={() => removeFile(index)} className="rounded p-0.5 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"><X size={14} /></button>
              </span>)}
            </div>}
            {files.length > 0 && <label className="mb-2 flex items-start gap-2 text-xs leading-5 text-slate-600">
              <input type="checkbox" checked={privacyConfirmed} onChange={(event) => setPrivacyConfirmed(event.target.checked)} className="mt-1 accent-indigo-600" />
              파일에 아동 이름·연락처가 없거나 가명 처리했습니다. 원본 파일은 앱 대화 저장소에 저장되지 않으며, 답변 생성을 위해 AI 서비스로 전송됩니다.
            </label>}
            <form className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-600"
              onSubmit={(event) => { event.preventDefault(); submit(); }}>
              <input ref={fileInput} className="sr-only" type="file" multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.docx,.hwp,.hwpx" aria-label="파일 선택" onChange={(event) => selectFiles(event.target.files)} />
              <Button type="button" variant="ghost" aria-label="파일 첨부" title="파일 첨부" disabled={send.isPending} onClick={() => fileInput.current?.click()}>
                <Paperclip size={17} />
              </Button>
              <Textarea className="min-h-11 max-h-40 flex-1 resize-y border-0 px-2 py-2 focus:ring-0" value={input}
                onChange={(event) => setInput(event.target.value)} placeholder="질문을 입력하세요. PDF, 이미지, DOCX, HWP/HWPX, TXT를 지원합니다."
                aria-label="메시지 입력" onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault(); submit();
                  }
                }} />
              <Button type="submit" aria-label="메시지 전송" disabled={send.isPending || (!input.trim() && files.length === 0) || (files.length > 0 && !privacyConfirmed)}>
                <Send size={15} /><span className="hidden sm:inline">전송</span>
              </Button>
            </form>
            <p className="mt-2 text-center text-[11px] leading-4 text-slate-500">아동 이름·연락처는 가명 처리해 주세요. Enter 전송 · Shift+Enter 줄바꿈 · 진단 요청은 치료사 검토용 초기 임상 의견으로 작성됩니다.</p>
          </footer>
        </section>
        {mode === "clinical" && <aside className="hidden min-h-0 2xl:block" aria-label="치료사 검토 대기">
          <Proposals childId={childId} />
        </aside>}
      </div>
      {mode === "clinical" && <details className="mt-3 max-h-[40dvh] shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm 2xl:hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">승인 대기 초안 검토</summary>
        <div className="border-t border-slate-100 p-4"><Proposals childId={childId} /></div>
      </details>}
    </div>
  );
}

function ChatMessage({ message }: { message: Msg }) {
  if (message.role === "user") return <article className="ml-auto max-w-[92%] rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-900 md:max-w-[85%]">
    {message.attachments && message.attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-2">
      {message.attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs text-slate-600">
        <FileText size={13} /><span className="max-w-48 truncate">{attachment.name}</span>
      </span>)}
    </div>}
    <p className="whitespace-pre-wrap break-words">{message.text}</p>
  </article>;

  return <article className="max-w-3xl break-words text-sm leading-7 text-slate-800">
    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500"><Sparkles size={14} className="text-indigo-600" />SLP AI</div>
    <div className="chat-markdown">
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
        h1: ({ children }) => <h1 className="mb-3 mt-6 text-xl font-semibold leading-tight text-slate-900">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-semibold leading-tight text-slate-900">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold text-slate-900">{children}</h3>,
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
        blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-slate-300 pl-3 text-slate-600">{children}</blockquote>,
        table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
        th: ({ children }) => <th className="border-b border-slate-300 px-2 py-2 font-semibold">{children}</th>,
        td: ({ children }) => <td className="border-b border-slate-200 px-2 py-2 align-top">{children}</td>,
        a: ({ children }) => <span>{children}</span>,
        img: ({ alt }) => <span className="text-xs text-slate-500">{alt ? `[이미지: ${alt}]` : "[외부 이미지 표시 안 함]"}</span>,
        code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[13px]">{children}</code>,
        pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-5 text-slate-50">{children}</pre>,
      }}>{message.text}</ReactMarkdown>
    </div>
    {message.sources && message.sources.length > 0 && <section aria-label="참고한 기관 자료" className="mt-4 rounded-lg bg-slate-50 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-600"><BookOpen size={14} />참고한 기관 자료</div>
      <div className="flex flex-wrap gap-2">
        {message.sources.map((source) => <span key={`${source.citation}-${source.document}-${source.page}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs text-slate-700">
          <b className="font-semibold text-indigo-700">{source.citation}</b>
          <span className="max-w-52 truncate">{source.document}</span>
          <span className="shrink-0 text-slate-500">p.{source.page ?? "확인 필요"}</span>
          {source.test_code && <span className="shrink-0 text-slate-500">· {source.test_code}</span>}
        </span>)}
      </div>
    </section>}
    {message.reference_status === "not_found" && <p className="mt-3 text-xs text-slate-500">기관 등록 자료에서 직접 근거를 찾지 못했습니다. 답변은 일반 지식 또는 추론을 포함할 수 있습니다.</p>}
    {message.reference_status === "error" && <p className="mt-3 text-xs text-amber-800">기관 자료 검색에 실패했습니다. 아래 답변에서 자료 근거를 확인하지 못했습니다.</p>}
  </article>;
}

function Proposals({ childId }: { childId: string | null }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["proposals", childId], queryFn: () => api<any[]>(`/proposals${childId ? `?child_id=${childId}` : ""}`) });
  const done = () => { qc.invalidateQueries({ queryKey: ["proposals"] }); qc.invalidateQueries(); };
  const approve = useMutation({ mutationFn: (id: string) => api(`/proposals/${id}/approve`, { method: "POST" }), onSuccess: done });
  const reject = useMutation({ mutationFn: (id: string) => api(`/proposals/${id}/reject`, { method: "POST" }), onSuccess: done });
  const [edit, setEdit] = useState<Record<string, string>>({});
  const save = useMutation({ mutationFn: ({ id, payload }: any) => api(`/proposals/${id}`, { method: "PUT", json: { payload } }), onSuccess: () => { setEdit({}); done(); } });
  return (
    <section className="flex max-h-[32rem] min-h-[12rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm 2xl:h-full 2xl:max-h-none 2xl:min-h-0">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div><h2 className="text-sm font-semibold">검토 대기</h2><p className="mt-0.5 text-xs text-slate-500">승인 전 초안 {data.length}건</p></div>
        <Badge tone={data.length ? "amber" : "slate"}>{data.length}</Badge>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {data.length === 0 && <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">대기 중인 초안이 없습니다.</p>}
        {data.map((p) => {
          const text = edit[p.id] ?? JSON.stringify(p.payload, null, 2);
          let valid = true; try { JSON.parse(text); } catch { valid = false; }
          return (
            <article key={p.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <div className="mb-2 flex items-center justify-between"><Badge tone="amber">{p.kind}</Badge><span className="text-[11px] text-slate-500">미승인</span></div>
              <Textarea className="min-h-32 font-mono text-xs" value={text} onChange={(e) => setEdit({ ...edit, [p.id]: e.target.value })} />
              {!valid && <p className="text-xs text-red-600">JSON 형식 오류</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button disabled={!valid || edit[p.id] === undefined} variant="outline" onClick={() => save.mutate({ id: p.id, payload: JSON.parse(text) })}>수정 저장</Button>
                <Button disabled={edit[p.id] !== undefined} onClick={() => approve.mutate(p.id)}>승인</Button>
                <Button variant="ghost" onClick={() => reject.mutate(p.id)}>반려</Button>
              </div>
              {edit[p.id] !== undefined && <p className="mt-1 text-[11px] text-slate-500">수정 후 '수정 저장'을 먼저 눌러야 승인할 수 있습니다.</p>}
            </article>
          );
        })}
      </div>
      {(approve.error || reject.error || save.error) && <div className="shrink-0 border-t border-slate-100 p-3"><Notice tone="red">{errText(approve.error || reject.error || save.error)}</Notice></div>}
    </section>
  );
}
