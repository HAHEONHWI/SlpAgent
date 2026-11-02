"""Convert generated HWPX to HWP locally with the pinned hwp-cli binary."""

import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory


class HwpConversionError(RuntimeError):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def convert(content: bytes) -> bytes:
    """Keep clinical documents local and remove temporary files after conversion."""
    with TemporaryDirectory(prefix="slp-voucher-") as directory:
        source = Path(directory) / "voucher.hwpx"
        target = Path(directory) / "voucher.hwp"
        source.write_bytes(content)
        try:
            # Edited cells already drop stale layout; preserve the rest to avoid extra blank pages.
            subprocess.run(
                ["hwp", "convert", str(source), "-o", str(target), "--preserve-layout", "--strict"],
                check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except FileNotFoundError as error:
            raise HwpConversionError("HWP 변환기가 설치되지 않았습니다. HWPX 형식으로 내려받아 주세요.") from error
        except (subprocess.SubprocessError, OSError) as error:
            raise HwpConversionError("HWP 변환에 실패했습니다. HWPX 형식으로 내려받아 주세요.") from error
        try:
            result = target.read_bytes()
        except OSError as error:
            raise HwpConversionError("HWP 변환 파일을 읽을 수 없습니다.") from error
        if not result.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            raise HwpConversionError("HWP 변환 결과가 올바르지 않습니다.")
        return result
