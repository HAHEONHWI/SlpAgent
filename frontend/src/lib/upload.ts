import { getToken } from "./auth";

/** Resumable upload (Google Cloud Storage resumable protocol; the dev server implements the same Content-Range flow).
 * Sends 8 MiB pieces (a multiple of 256 KiB, as GCS requires), reports progress, and after a dropped connection asks
 * the server how much arrived ("bytes *\/size" -> 308 + Range) and continues from there. */
const PIECE = 8 * 1024 * 1024;
const MAX_RETRIES = 5;

export type UploadTarget = { kind: "gcs" | "local"; url: string };

function put(url: string, body: Blob | null, range: string, auth: string | null, onProgress?: (loaded: number) => void, signal?: AbortSignal) {
  return new Promise<{ status: number; range: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Range", range);
    if (auth) xhr.setRequestHeader("Authorization", auth); // only for our own API, never for the storage URL
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range") });
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

const received = (range: string | null) => (range ? Number(range.split("-")[1]) + 1 : 0);

export async function resumableUpload(target: UploadTarget, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  const url = target.kind === "local" ? `/api${target.url}` : target.url;
  const auth = target.kind === "local" ? `Bearer ${await getToken()}` : null;
  const size = file.size;
  let offset = 0;
  let retries = 0;
  while (offset < size) {
    const end = Math.min(offset + PIECE, size);
    try {
      const r = await put(url, file.slice(offset, end), `bytes ${offset}-${end - 1}/${size}`, auth, (loaded) => onProgress((offset + loaded) / size), signal);
      if (r.status === 308) offset = received(r.range);
      else if (r.status >= 200 && r.status < 300) offset = size;
      else throw new Error(`upload failed (${r.status})`);
      retries = 0;
    } catch (e) {
      if ((e as Error).name === "AbortError" || ++retries > MAX_RETRIES) throw e;
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** retries));
      const status = await put(url, null, `bytes */${size}`, auth, undefined, signal).catch(() => null); // where did we stop?
      if (status?.status === 308) offset = received(status.range);
      else if (status && status.status >= 200 && status.status < 300) offset = size;
    }
    onProgress(offset / size);
  }
}
