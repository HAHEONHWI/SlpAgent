"""HWP export uses a real converter and an independent reader when installed."""

import io
import shutil
import subprocess
import tempfile
import zipfile
from unittest.mock import Mock

import pytest
import syhwp

from app.services import hwp
from tests.conftest import H


@pytest.fixture
def converter() -> str:
    executable = shutil.which("hwp")
    if executable is None:
        pytest.skip("install hwp-cli v1.3.1 to run HWP integration tests")
    return executable


@pytest.mark.parametrize("days,table_count", [([], 8), ([6, 13, 20, 27], 8), ([1, 6, 8, 13, 15, 20, 22, 27, 29], 12)])
def test_hwp_download_preserves_visits_and_merged_tables(client, child, converter, tmp_path, days, table_count):
    visits = [{"date": f"2026-10-{day:02}", "start": "09:50", "end": "10:40",
               "therapist": "테스트치료사", "content": f"합성 {day}일 수업 내용"} for day in days]

    response = client.post(f"/children/{child['id']}/voucher-hwpx", headers=H(),
                           json={"format": "hwp", "months": [{"month": "2026-10", "visits": visits}]})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/x-hwp"
    assert response.headers["content-disposition"].endswith("%ED%85%8C%EC%8A%A4%ED%8A%B8%EC%95%84%EB%8F%99-10%EC%9B%94.hwp")
    path = tmp_path / "voucher.hwp"
    path.write_bytes(response.content)
    document = syhwp.open(path)
    assert "테스트아동" in document.text and "서비스 일정표 ( 10월 )" in document.text
    assert len(document.tables) == table_count
    assert document.tables[0].cells[0].col_span == 2
    for day in days:
        assert document.text.count(f"합성 {day}일 수업 내용") == 1


@pytest.mark.parametrize("months,names", [
    (["2026-10", "2026-11"], ["테스트아동-10월.hwp", "테스트아동-11월.hwp"]),
    (["2025-10", "2026-10"], ["테스트아동-10월(2025).hwp", "테스트아동-10월(2026).hwp"]),
])
def test_hwp_month_bundle_contains_readable_files(client, child, converter, tmp_path, months, names):
    response = client.post(f"/children/{child['id']}/voucher-hwpx", headers=H(),
                           json={"format": "hwp", "months": [{"month": month} for month in months]})

    assert response.status_code == 200 and response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as bundle:
        assert bundle.namelist() == names
        for name in names:
            path = tmp_path / name
            path.write_bytes(bundle.read(name))
            assert "테스트아동" in syhwp.extract_text(path)


def test_hwp_download_reports_missing_converter_and_cleans_up(client, child, monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", "")
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))

    response = client.post(f"/children/{child['id']}/voucher-hwpx", headers=H(),
                           json={"format": "hwp", "months": [{"month": "2026-10"}]})

    assert response.status_code == 503
    assert "HWP 변환기가 설치되지 않았습니다" in response.json()["detail"]
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("error", [subprocess.TimeoutExpired("hwp", 30), subprocess.CalledProcessError(1, "hwp")])
def test_hwp_conversion_reports_process_failure_and_cleans_up(monkeypatch, tmp_path, error):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(hwp.subprocess, "run", Mock(side_effect=error))

    with pytest.raises(hwp.HwpConversionError, match="HWP 변환에 실패"):
        hwp.convert(b"synthetic input")

    assert list(tmp_path.iterdir()) == []


def test_hwp_conversion_rejects_non_hwp_output(monkeypatch, tmp_path):
    executable = tmp_path / "hwp"
    executable.write_text('#!/bin/sh\nprintf "PKbad" > "$4"\n')
    executable.chmod(0o700)
    monkeypatch.setenv("PATH", str(tmp_path))

    with pytest.raises(hwp.HwpConversionError, match="HWP 변환 결과가 올바르지 않습니다"):
        hwp.convert(b"synthetic input")


@pytest.mark.parametrize("headers,status", [(H("orgB"), 404), (H(role="assistant"), 403)])
def test_hwp_download_keeps_child_and_role_permissions(client, child, headers, status):
    response = client.post(f"/children/{child['id']}/voucher-hwpx", headers=headers,
                           json={"format": "hwp", "months": [{"month": "2026-10"}]})

    assert response.status_code == status


def test_voucher_rejects_unknown_format(client, child):
    response = client.post(f"/children/{child['id']}/voucher-hwpx", headers=H(),
                           json={"format": "exe", "months": [{"month": "2026-10"}]})

    assert response.status_code == 422
