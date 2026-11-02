import { File, FileMode, Paths, UploadType } from "expo-file-system";
import { getToken } from "./auth";
import { API_DIRECT_URL } from "./config";

/** Resumable upload, same protocol as the web client (Google Cloud Storage resumable upload; the dev server implements
 * the same Content-Range flow). Each 8 MiB piece (a multiple of 256 KiB, as GCS requires) is copied to a cache file
 * and sent natively, so a 200 MB recording never sits in JS memory. After a dropped connection it asks the server how
 * much arrived ("bytes *\/size" -> 308 + Range) and continues from there. */
const PIECE = 8 * 1024 * 1024;
const MAX_RETRIES = 5;

export type UploadTarget = { kind: "gcs" | "local"; url: string };

const received = (range: string | undefined | null) => (range ? Number(range.split("-")[1]) + 1 : 0);
const header = (h: Record<string, string> | Headers, name: string) =>
  h instanceof Headers ? h.get(name) : Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];

/** `resume`: an earlier attempt used this target, so first ask how much the server already has. */
export async function resumableUpload(target: UploadTarget, uri: string, onProgress: (fraction: number) => void, resume = false) {
  const url = target.kind === "local" ? `${API_DIRECT_URL}${target.url}` : target.url;
  const auth = async (): Promise<Record<string, string>> => (target.kind === "local" ? { Authorization: `Bearer ${await getToken()}` } : {}); // never for the storage URL
  const source = new File(uri);
  const size = source.size;
  const piece = new File(Paths.cache, `upload-piece-${Date.now()}.bin`);
  let offset = 0;
  let retries = 0;
  if (resume) {
    const status = await fetch(url, { method: "PUT", headers: { "Content-Range": `bytes */${size}`, ...(await auth()) } });
    if (status.status === 308) offset = received(header(status.headers, "range"));
    else if (status.status >= 200 && status.status < 300) offset = size;
    else throw new Error(`upload session expired (${status.status})`);
  }
  const handle = source.open(FileMode.ReadOnly);
  try {
    while (offset < size) {
      const end = Math.min(offset + PIECE, size);
      try {
        handle.offset = offset;
        const bytes = await handle.readBytes(end - offset);
        if (piece.exists) piece.delete();
        piece.create();
        piece.write(bytes);
        const r = await piece.upload(url, {
          httpMethod: "PUT", uploadType: UploadType.BINARY_CONTENT, mimeType: "application/octet-stream",
          headers: { "Content-Range": `bytes ${offset}-${end - 1}/${size}`, ...(await auth()) },
          onProgress: ({ bytesSent }) => onProgress((offset + bytesSent) / size),
        });
        if (r.status === 308) offset = received(header(r.headers, "range"));
        else if (r.status >= 200 && r.status < 300) offset = size;
        else throw new Error(`upload failed (${r.status})`);
        retries = 0;
      } catch (e) {
        if (++retries > MAX_RETRIES) throw new Error("업로드가 계속 끊겨요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
        await new Promise((ok) => setTimeout(ok, 1000 * 2 ** retries));
        const status = await fetch(url, { method: "PUT", headers: { "Content-Range": `bytes */${size}`, ...(await auth()) } }).catch(() => null); // where did we stop?
        if (status?.status === 308) offset = received(header(status.headers, "range"));
        else if (status && status.status >= 200 && status.status < 300) offset = size;
      }
      onProgress(offset / size);
    }
  } finally {
    handle.close();
    if (piece.exists) piece.delete();
  }
}
