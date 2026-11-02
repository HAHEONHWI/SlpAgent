import AsyncStorage from "@react-native-async-storage/async-storage";
import { File } from "expo-file-system";
import { api, ApiError } from "./api";
import { resumableUpload, type UploadTarget } from "./upload";
import type { Tone } from "@/components/ui";

// Recording jobs: same API and wording as frontend/src/components/RecordingConsultation.tsx.
export type Kind = "session" | "consultation";
export type Job = {
  id: string; status: string; kind: Kind; meta: { date: string; counselor: string; start?: string | null; end?: string | null }; filename: string; upload_size: number;
  original_size?: number; compressed_size?: number; duration_seconds?: number; chunk_count?: number; chunks_done?: number;
  chunks_failed?: number; wait_reason?: string | null; wait_until?: string | null; fallback_chunks?: number;
  error?: { reason: string; message: string } | null; draft_id?: string | null; created_at: string;
};
export type Draft = { id: string; kind: string; status: string; payload: { job_id: string; sections: Record<string, string>; chunks_failed?: number } };

export const MAX_MB = 200;
export const MAX_HOURS = 3;
export const EXT = [".m4a", ".mp3", ".wav", ".webm", ".ogg", ".flac", ".mp4", ".aac", ".mpeg", ".mpga"];
export const SECTIONS: [string, string][] = [["goals", "오늘의 치료 목표"], ["activities", "진행한 활동"], ["child_responses", "아동의 주요 반응"],
  ["spontaneous_speech", "자발 발화 및 의사소통 특징"], ["therapist_prompting", "치료사의 촉진과 피드백"],
  ["parent_communication", "보호자 상담 및 전달 사항"], ["home_activities", "가정 연계 활동"], ["next_plan", "다음 회기 계획"]];
export const STATUS: Record<string, [string, Tone]> = {
  uploading: ["업로드 중", "slate"], queued: ["대기열", "slate"], transcribing: ["받아쓰는 중", "indigo"], waiting: ["대기 중", "amber"],
  merging: ["합치는 중", "indigo"], summarizing: ["요약 중", "indigo"], draft_ready: ["검토 대기", "amber"], approved: ["기록 반영됨", "green"], rejected: ["반려됨", "slate"], failed: ["실패", "red"], cancelled: ["취소됨", "slate"],
};
export const WAIT: Record<string, string> = {
  groq_quota: "무료 받아쓰기 한도에 도달해 다음 시간대에 이어서 처리합니다.", groq_rate_limited: "받아쓰기 요청이 많아 잠시 후 이어서 처리합니다.",
  groq_unavailable: "받아쓰기 서비스가 일시적으로 응답하지 않아 다시 시도합니다.", fallback_unavailable: "예비 받아쓰기도 일시적으로 사용할 수 없어 다시 시도합니다.",
  retry_backoff: "잠시 후 다시 시도합니다.", stt_not_available: "받아쓰기 서비스를 사용할 수 없어 대기합니다.",
};
// 처리 단계 표시: 업로드 → 압축·분할 → 받아쓰기 → 요약 (상태에서 어느 단계인지 계산)
export const STEPS = ["업로드", "압축·분할", "받아쓰기", "요약"];
export const STEP_AT: Record<string, number> = { uploading: 0, queued: 1, transcribing: 2, waiting: 2, merging: 2, summarizing: 3, draft_ready: 3, approved: 4, rejected: 4 };
export const FINISHED = ["draft_ready", "approved", "rejected", "failed", "cancelled"];
export const CONSENT_TEXT = "(필수) 녹음 대상자(보호자·법정대리인)에게 녹음과 외부 음성 인식 서비스 전송에 대한 동의를 받았습니다.";
export const PROCESSOR_TEXT = "녹음은 Groq(미국)에서 받아쓰고, 한도 초과·장애 시 관리자가 허용한 경우 OpenRouter(미국, 데이터 비보관)를 씁니다. 요약은 OpenAI(미국)에서 합니다. 원본 녹음은 처리 중에만 임시 보관 후 삭제됩니다.";
export const mb = (b?: number) => (b ? `${(b / 1024 / 1024).toFixed(1)}MB` : "-");
export const mins = (sec?: number) => (sec ? `${Math.round(sec / 60)}분` : "-");

/** A recording kept on the phone until its upload finishes, so a dropped connection never loses a class. */
export type Pending = {
  id: string; uri: string; filename: string; size: number; contentType: string; ownFile: boolean;
  childId: string; kind: Kind; date: string; start: string; end: string; counselor: string; durationMs?: number; createdAt: string;
  job?: { id: string; upload: UploadTarget };
};
const KEY = "pendingRecordings";
export const loadPending = async (): Promise<Pending[]> => { try { return JSON.parse((await AsyncStorage.getItem(KEY)) ?? "[]"); } catch { return []; } };
const savePending = (rows: Pending[]) => AsyncStorage.setItem(KEY, JSON.stringify(rows));
export const putPending = async (p: Pending) => savePending([...(await loadPending()).filter((x) => x.id !== p.id), p]);
export async function dropPending(p: Pending) {
  await savePending((await loadPending()).filter((x) => x.id !== p.id));
  if (p.ownFile) { try { const f = new File(p.uri); if (f.exists) f.delete(); } catch { /* already gone */ } }
}

/** Create the job (with consent), upload the file resumably, then queue it for transcription. Reuses an earlier job's
 * upload session when retrying, and starts a new job if that session is gone. */
export async function submitRecording(p: Pending, onProgress: (f: number) => void): Promise<Job> {
  const create = async () => {
    const created = await api<{ job: Job; upload: UploadTarget }>(`/children/${p.childId}/recordings`, { method: "POST", json: {
      filename: p.filename, size: p.size, content_type: p.contentType, kind: p.kind, date: p.date,
      start: p.start && p.end ? p.start : null, end: p.start && p.end ? p.end : null, counselor: p.counselor, consent: true } });
    const job = { id: created.job.id, upload: created.upload };
    await putPending({ ...p, job });
    return job;
  };
  let job = p.job;
  if (job) {
    try { await resumableUpload(job.upload, p.uri, onProgress, true); }
    catch { job = undefined; }
  }
  if (!job) { job = await create(); await resumableUpload(job.upload, p.uri, onProgress); }
  try {
    return await api<Job>(`/recordings/${job.id}/complete`, { method: "POST" });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409 && p.job)) throw e;
    // An earlier attempt may have completed already (its reply was lost); otherwise start over once with a fresh job.
    const earlier = await api<Job>(`/recordings/${job.id}`).catch(() => null);
    if (earlier && earlier.status !== "uploading") return earlier;
    const fresh = await create(); await resumableUpload(fresh.upload, p.uri, onProgress);
    return api<Job>(`/recordings/${fresh.id}/complete`, { method: "POST" });
  }
}
