"""발달재활 서비스 제공 기록지 HWPX: filled from schedules/attendance/notes, never breaking the template."""
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from app.services import voucher_hwpx as vh
from tests.conftest import H

HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"


def _section(content: bytes) -> str:
    return zipfile.ZipFile(io.BytesIO(content)).read(vh.SECTION).decode()


def _tables(xml: str) -> list[list[list[str]]]:
    root = ET.fromstring(xml)
    top = [t for t in root.iter(HP + "tbl")]
    return [[["".join(x.text or "" for x in tc.iter(HP + "t")) for tc in tr.findall(HP + "tc")] for tr in t.findall(HP + "tr")] for t in top]


def _visits(month: int, days: list[int]) -> list[vh.Visit]:
    return [vh.Visit(date(2026, month, d), "09:50", "10:40", "김치료", f"FAKE {d}일 활동") for d in days]


def test_render_keeps_package_and_fills_three_pages():
    data = vh.VoucherInput("테스트기관", "가나다", date(2020, 8, 10), 2026, 8, _visits(8, [4, 11, 19, 25, 26]), unit_price=52000)
    out = vh.render(data)
    src, dst = zipfile.ZipFile(io.BytesIO(vh.TEMPLATE.read_bytes())), zipfile.ZipFile(io.BytesIO(out))
    assert [i.filename for i in dst.infolist()] == [i.filename for i in src.infolist()]  # same entries, same order
    assert [i.compress_type for i in dst.infolist()] == [i.compress_type for i in src.infolist()]
    assert dst.infolist()[0].filename == "mimetype" and dst.read("mimetype") == src.read("mimetype")
    for name in src.namelist():
        if name != vh.SECTION:
            assert dst.read(name) == src.read(name)  # only the section changes
    xml = _section(out)
    ET.fromstring(xml)
    assert "발달재활 서비스 제공 기록지 ( 8월 )" in xml and "서비스 일정표 ( 8월 )" in xml and "대상아동: 가 나 다." in xml
    t = _tables(xml)
    assert t[0][1][-1] == "가나다" and t[0][2][-1] == "2020. 8. 10."
    schedule_info = next(x for x in t if x and x[0][0] == "사회복지서비스관리번호")
    assert schedule_info[0][1] == "8001" and schedule_info[1][3] == "2026. 7. 31"
    assert t[1][0][1:] == ["8/4", "8/11", "8/19", "8/25", "8/26"] and t[1][2][-5:] == ["9:50"] * 5 and t[1][4][-1] == "김치료"
    assert [r[1] for r in t[3][1:6]] == [f"FAKE {d}일 활동" for d in (4, 11, 19, 25, 26)]
    cal = next(x for x in t if x and x[0][0] == "일")
    assert len(cal) == 1 + 2 * 6  # August 2026 spans six weeks
    assert cal[1][12] == "1" and cal[11][2] == "31" and cal[11][0] == "30"
    assert cal[2] == [""] * 7 and cal[4][2] == "언어재활(9:50~10:40)"  # 8/4: Tuesday of week 2 (7 merged day cells)
    provider = next(x for x in t if x and x[0][0] == "서비스 제공기관명")
    assert provider[1][2:] == ["김치료", "언어재활", "매월 5회", "4,11,19,25,26"]
    cost = next(x for x in t if x and x[0][0] == "서비스 종류")
    assert cost[1][:4] == ["언어재활", "52,000원", "5", "260,000원"]


def test_more_than_five_visits_repeat_pages_and_months_differ():
    out = vh.render(vh.VoucherInput("기관", "가나", None, 2026, 10, _visits(10, [1, 6, 8, 13, 15, 20, 22, 27, 29])))
    xml = _section(out)
    assert xml.count("발달재활 서비스 제공 기록지 ( 10월 )") == 2 and xml.count("<hp:secPr") == 1
    assert len(re.findall(r"<hp:t>\s*※ 별지</hp:t>", xml)) == 2  # the 별지 page repeats too
    t = _tables(xml)
    sheets = [x for x in t if x and x[0][0].strip().startswith("월 / 일")]
    assert [s[0][1:] for s in sheets] == [["10/1", "10/6", "10/8", "10/13", "10/15"], ["10/20", "10/22", "10/27", "10/29", "/"]]
    feb = _tables(_section(vh.render(vh.VoucherInput("기관", "가나", None, 2026, 2, _visits(2, [3])))))
    assert len(next(x for x in feb if x and x[0][0] == "일")) == 1 + 2 * 4  # Feb 2026: four weeks
    empty = _section(vh.render(vh.VoucherInput("기관", "가나", None, 2026, 11, [])))
    ET.fromstring(empty)


def test_api_uses_schedules_attendance_and_notes(client, child):
    cid = child["id"]
    mk = lambda d, s: client.post("/schedules", headers=H(), json={"child_id": cid, "date": d, "start": s, "end": "10:30" if s == "09:50" else "11:20", "therapist": "김치료"}).json()
    a, b, c = mk("2026-10-06", "09:50"), mk("2026-10-13", "09:50"), mk("2026-10-20", "10:40")
    client.put(f"/schedules/{b['id']}/attendance", headers=H(), json={"status": "absent"})
    client.post(f"/schedules/{c['id']}/cancel", headers=H())
    sess = client.post(f"/children/{cid}/sessions", headers=H(), json={"date": "2026-10-06", "start": "09:50", "end": "10:30", "therapist": "김치료"}).json()
    client.post(f"/sessions/{sess['id']}/note", headers=H(), json={"text": "FAKE 노트"})
    v = client.get(f"/children/{cid}/voucher-visits?month=2026-10", headers=H()).json()
    assert [(x["date"], x["start"], x["end"], x["content"]) for x in v["visits"]] == [("2026-10-06", "09:50", "10:40", "FAKE 노트")]
    r = client.post(f"/children/{cid}/voucher-hwpx", headers=H(), json={"months": [{"month": "2026-10"}]})
    assert r.status_code == 200 and "filename*=UTF-8''" in r.headers["content-disposition"]
    assert "%ED%85%8C%EC%8A%A4%ED%8A%B8%EC%95%84%EB%8F%99-10%EC%9B%94.hwpx" in r.headers["content-disposition"]  # 테스트아동-10월.hwpx
    api_xml = _section(r.content)
    assert "FAKE 노트" in api_xml
    schedule_info = next(x for x in _tables(api_xml) if x and x[0][0] == "사회복지서비스관리번호")
    assert schedule_info[0][1] == "8001" and schedule_info[1][3] == "2026. 9. 30"
    multi = client.post(f"/children/{cid}/voucher-hwpx", headers=H(), json={"months": [
        {"month": "2026-10"}, {"month": "2026-11", "visits": [{"date": "2026-11-03", "start": "09:50", "end": "10:40", "content": "수정함"}]}]})
    names = zipfile.ZipFile(io.BytesIO(multi.content)).namelist()
    assert names == ["테스트아동-10월.hwpx", "테스트아동-11월.hwpx"]
    bad = client.post(f"/children/{cid}/voucher-hwpx", headers=H(), json={"months": [{"month": "2026-11", "visits": [{"date": "2026-12-01", "start": "09:50", "end": "10:40"}]}]})
    assert bad.status_code == 422
    assert client.post(f"/children/{cid}/voucher-hwpx", headers=H(role="assistant"), json={"months": [{"month": "2026-10"}]}).status_code == 403
    assert client.get(f"/children/{cid}/voucher-visits?month=2026-10", headers=H("orgB")).status_code == 404


def test_other_notes_fill_the_gitasahang_rows():
    other = [("10/13", "수업일 변경 → 10/15 보강"), ("10/20", "결강 (독감)"), ("10/26~11/8", "장기결강 (입원)"), ("10/30", "추가 메모")]
    xml = _section(vh.render(vh.VoucherInput("기관", "가나", None, 2026, 10, _visits(10, [6, 15]), other=other)))
    approvals = next(x for x in _tables(xml) if x and x[0][:2] == ["승인일자", "승인번호"])
    assert approvals[7:10] == [["10/13", "수업일 변경 → 10/15 보강"], ["10/20", "결강 (독감)"], ["10/26~11/8", "장기결강 (입원) / 10/30 추가 메모"]]


def test_schedule_written_date_for_january_uses_previous_year():
    xml = _section(vh.render(vh.VoucherInput("기관", "가나", None, 2026, 1, [])))
    schedule_info = next(x for x in _tables(xml) if x and x[0][0] == "사회복지서비스관리번호")
    assert schedule_info[0][1] == "8001" and schedule_info[1][3] == "2025. 12. 31"


def test_repeated_pages_keep_layout_without_stale_edited_cell_lines():
    content = vh.render(vh.VoucherInput("기관", "가나다", None, 2026, 10, _visits(10, [1, 6, 8, 13, 15, 20])))
    root = ET.fromstring(_section(content))

    headings = [p for p in root if "발달재활 서비스 제공 기록지" in "".join(p.itertext())
                or "".join(p.itertext()).strip() == "※ 별지"]
    assert len(headings) == 4
    assert all(p.find(HP + "linesegarray") is not None for p in headings)
    edited = [p for p in root.iter(HP + "p") if any(t.text == "가나다" for t in p.findall(".//" + HP + "t"))
              and p.find(".//" + HP + "tbl") is None]
    assert len(edited) >= 2
    assert all(p.find(HP + "linesegarray") is None for p in edited)
