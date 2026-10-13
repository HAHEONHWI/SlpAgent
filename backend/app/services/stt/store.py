"""Object storage for recordings: private GCS bucket in production, a local directory in development.
Originals live under original/, chunks under tmp/; both are deleted by the job (and by a bucket lifecycle rule)."""
import shutil
from pathlib import Path


class LocalStore:
    kind = "local"

    def __init__(self, root: str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("invalid key")
        return p

    def size(self, key: str) -> int | None:
        p = self._path(key)
        return p.stat().st_size if p.exists() else None

    def download(self, key: str, dst: Path) -> None:
        shutil.copyfile(self._path(key), dst)

    def upload(self, src: Path, key: str) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, p)

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def write_range(self, key: str, offset: int, data: bytes) -> int:
        """Local stand-in for a resumable upload: append bytes at `offset`; returns bytes now stored."""
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        current = p.stat().st_size if p.exists() else 0
        if offset != current:
            raise ValueError(f"expected offset {current}")
        with p.open("ab") as f:
            f.write(data)
        return current + len(data)


class GcsStore:
    kind = "gcs"

    def __init__(self, bucket: str):
        from google.cloud import storage
        self.bucket = storage.Client().bucket(bucket)

    def size(self, key: str) -> int | None:
        blob = self.bucket.get_blob(key)
        return blob.size if blob else None

    def download(self, key: str, dst: Path) -> None:
        self.bucket.blob(key).download_to_filename(str(dst))

    def upload(self, src: Path, key: str) -> None:
        self.bucket.blob(key).upload_from_filename(str(src), content_type="audio/mpeg")

    def delete(self, key: str) -> None:
        from google.api_core.exceptions import NotFound
        try:
            self.bucket.blob(key).delete()
        except NotFound:
            pass

    def upload_session(self, key: str, content_type: str, size: int, origin: str | None) -> str:
        """Resumable upload session URL the browser PUTs to directly (no API key, scoped to this one object)."""
        blob = self.bucket.blob(key)
        blob.cache_control = "private, no-store"
        return blob.create_resumable_upload_session(content_type=content_type, size=size, origin=origin)


def get_store():
    from ...config import get_settings
    s = get_settings()
    return GcsStore(s.recordings_bucket) if s.recordings_bucket else LocalStore(s.local_recordings_dir)
