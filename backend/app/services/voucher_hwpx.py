"""발달재활 서비스 제공 기록지 (HWPX) filler.

The form has three pages and is filled without changing its formatting:
  1. 기록지: month in the title, child, and up to five visits per sheet (date, start, end, therapist).
     More than five visits -> the sheet is repeated (one more page per five visits).
  2. 별지: one row per visit with the date and what was done (five per page; the page repeats as needed).
  3. 서비스 일정표: the month's calendar with "언어재활(9:50~10:40)" on visit days, plus visit days, count and cost.

HWPX is a ZIP of XML. Everything here edits the XML as text so namespaces, entry order, compression and every
style reference stay as they are. Edited cells reuse the cell's own paragraph and run tags (paraPrIDRef /
charPrIDRef) and drop the line-layout cache (hp:linesegarray) so 한글 lays the text out again.
"""
from __future__ import annotations

import calendar
import io
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "data" / "hwpx" / "voucher_template.hwpx"
SECTION = "Contents/section0.xml"
PER_SHEET = 5  # visit columns on page 1
OTHER_ROWS = 3  # 기타사항 rows on page 1

_LINESEG = re.compile(r"<hp:linesegarray>.*?</hp:linesegarray>", re.S)
_ADDR = re.compile(r'<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"/>')
_SPAN = re.compile(r'<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"/>')


class VoucherError(ValueError):
    pass


@dataclass
class Visit:
    day: date
    start: str  # "HH:MM"
    end: str
    therapist: str = ""
    content: str = ""


@dataclass
class VoucherInput:
    org_name: str
    child_name: str
    birth_date: date | None
    year: int
    month: int
    visits: list[Visit] = field(default_factory=list)
    written_on: date | None = None  # 작성일자 on page 3; default: last day of the month
    teacher: str = ""  # 교사명 / 담당 on page 3; default: the therapist with the most visits
    unit_price: int | None = None  # 원/회; None keeps the template's price
    copay: int | None = None  # 본인부담금; None leaves it blank
    phone: str | None = None  # None keeps the template's phone
    service: str = "언어재활"
    other: list[tuple[str, str]] = field(default_factory=list)  # 기타사항 (일자, 내용): 수업일 변경, 결강, 장기결강


# ---- XML helpers -----------------------------------------------------------------------------------

def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _spans(xml: str, tag: str) -> list[tuple[int, int, int]]:
    """(start, end, depth) of every <tag>…</tag> (or self-closing) in document order, nesting-aware."""
    tok = re.compile(rf"<{tag}(?=[\s/>])[^>]*>|</{tag}>")
    stack, out = [], []
    for m in tok.finditer(xml):
        t = m.group(0)
        if t.startswith("</"):
            s, d = stack.pop()
            out.append((s, m.end(), d))
        elif t.endswith("/>"):
            out.append((m.start(), m.end(), len(stack)))
        else:
            stack.append((m.start(), len(stack)))
    return sorted(out)


def _text(xml: str) -> str:
    return "".join(re.findall(r"<hp:t>([^<]*)</hp:t>", xml))


def _hm(hhmm: str) -> str:
    h, m = hhmm.split(":")
    return f"{int(h)}:{m}"


def _md(d: date) -> str:
    return f"{d.month}/{d.day}"


def _dotted(d: date, trailing_dot: bool = True) -> str:
    return f"{d.year}. {d.month}. {d.day}." if trailing_dot else f"{d.year}. {d.month}. {d.day}"


class Table:
    """One <hp:tbl> as a string; cells are addressed by (row, col) of their top-left corner."""

    def __init__(self, xml: str):
        self.xml = xml

    def _cells(self) -> dict[tuple[int, int], tuple[int, int]]:
        tbls = _spans(self.xml, "hp:tbl")
        nested = [(s, e) for s, e, d in tbls if d > 0]
        out = {}
        for s, e, _ in _spans(self.xml, "hp:tc"):
            if any(ns <= s and e <= ne for ns, ne in nested):
                continue
            m = _own_addr(self.xml[s:e])
            out[(m[1], m[0])] = (s, e)
        return out

    def text(self, row: int, col: int) -> str:
        s, e = self._cells()[(row, col)]
        return _text(self.xml[s:e])

    def set(self, row: int, col: int, value: str) -> None:
        s, e = self._cells()[(row, col)]
        self.xml = self.xml[:s] + set_cell_text(self.xml[s:e], value) + self.xml[e:]


def _own_addr(tc: str) -> tuple[int, int]:
    """(col, row) of a cell. Its own hp:cellAddr follows its subList, so it is the last one in the cell."""
    m = list(_ADDR.finditer(tc))[-1]
    return int(m.group(1)), int(m.group(2))


def set_cell_text(tc: str, value: str) -> str:
    """Replace a cell's paragraphs with `value` (newline = new paragraph), keeping the first paragraph's
    paragraph/run style. Nested tables in the cell are dropped (the calendar's old 30/31 overlays)."""
    subs = [(s, e) for s, e, d in _spans(tc, "hp:subList") if d == 0]
    s, e = subs[0]
    open_end = tc.index(">", s) + 1
    inner = tc[open_end:e - len("</hp:subList>")]
    p_open = re.search(r"<hp:p(?=[\s>])[^>]*>", inner).group(0)
    r = re.search(r"<hp:run(?=[\s/>])[^>]*?/?>", inner)
    r_open = (r.group(0)[:-2].rstrip() + ">") if r and r.group(0).endswith("/>") else (r.group(0) if r else '<hp:run charPrIDRef="0">')
    lines = str(value).split("\n") if value else [""]
    body = "".join(f"{p_open}{r_open}{f'<hp:t>{_esc(ln)}</hp:t>' if ln else ''}</hp:run></hp:p>" for ln in lines)
    return tc[:open_end] + body + tc[e - len("</hp:subList>"):]


class Doc:
    def __init__(self, xml: str):
        self.xml = xml

    def tables(self) -> list[tuple[int, int]]:
        return [(s, e) for s, e, d in _spans(self.xml, "hp:tbl") if d == 0]

    def find(self, *needles: str) -> int:
        """Index of the first top-level table whose text contains every needle."""
        for i, (s, e) in enumerate(self.tables()):
            t = _text(self.xml[s:e])
            if all(n in t for n in needles):
                return i
        raise VoucherError(f"양식에서 표를 찾지 못했습니다: {needles}")

    def edit(self, index: int, fn) -> None:
        s, e = self.tables()[index]
        t = Table(self.xml[s:e])
        fn(t)
        self.xml = self.xml[:s] + t.xml + self.xml[e:]

    def replace_text(self, pattern: str, repl: str) -> None:
        new, n = re.subn(pattern, repl, self.xml, count=1)
        if not n:
            raise VoucherError(f"양식에서 문구를 찾지 못했습니다: {pattern}")
        self.xml = new


# ---- the three pages -----------------------------------------------------------------------------

TITLE1 = r"(<hp:t>발달재활 서비스 제공 기록지 \()\s*[^)<]*?월\s*(\)</hp:t>)"
TITLE3 = r"(<hp:t>서비스 일정표 \()\s*[^)<]*?월\s*(\)</hp:t>)"


def _paragraphs(xml: str) -> list[tuple[int, int]]:
    """Top-level body paragraphs of the section."""
    return [(s, e) for s, e, d in _spans(xml, "hp:p") if d == 0]


def _fill_sheet(doc: Doc, data: VoucherInput, visits: list[Visit], other: list[tuple[str, str]]) -> None:
    def info(t: Table):
        t.set(0, 2, f" {data.org_name}")
        t.set(1, 2, data.child_name)
        t.set(2, 2, _dotted(data.birth_date) if data.birth_date else "")
    doc.edit(doc.find("제공기관명", "생년월일"), info)

    def services(t: Table):
        for i in range(PER_SHEET):
            v = visits[i] if i < len(visits) else None
            t.set(0, 4 + i, _md(v.day) if v else "/")
            t.set(2, 4 + i, _hm(v.start) if v else "")
            t.set(3, 4 + i, _hm(v.end) if v else "")
            t.set(4, 4 + i, v.therapist if v else "")
    doc.edit(doc.find("시작시간", "담당재활사"), services)

    def approvals(t: Table):
        for i in range(PER_SHEET):
            t.set(1 + i, 0, _md(visits[i].day) if i < len(visits) else "/")
        for i in range(OTHER_ROWS):  # 일자 | 기타사항 rows under the 승인 rows
            o = other[i] if i < len(other) else ("", "")
            t.set(7 + i, 0, o[0])
            t.set(7 + i, 1, o[1])
    doc.edit(doc.find("승인번호", "기타사항"), approvals)


def _fill_pages_1(xml: str, data: VoucherInput) -> str:
    """Page 1 for the first five visits; for each further five, a copy of page 1 on its own page."""
    paras = _paragraphs(xml)
    texts = [_text(xml[s:e]) for s, e in paras]
    p2 = next(i for i, t in enumerate(texts) if t.strip() == "※ 별지")  # not the 별지첨부 cell on page 1
    sheet_xml = xml[paras[0][0]:paras[p2][0]]
    chunks = [data.visits[i:i + PER_SHEET] for i in range(0, max(len(data.visits), 1), PER_SHEET)] or [[]]
    # 기타사항: three lines per sheet; anything left over joins the last line of the last sheet
    lines = list(data.other)
    room = OTHER_ROWS * len(chunks)
    if len(lines) > room:
        tail = lines[room - 1:]
        lines = lines[:room - 1] + [(tail[0][0], " / ".join([tail[0][1]] + [f"{d} {t}".strip() for d, t in tail[1:]]))]
    others = [lines[k * OTHER_ROWS:(k + 1) * OTHER_ROWS] for k in range(len(chunks))]

    def filled(chunk: list[Visit], first: bool, other: list[tuple[str, str]]) -> str:
        part = sheet_xml
        if not first:  # a copy: no section/column definitions, starts a new page
            part = re.sub(r"<hp:secPr\b.*?</hp:secPr>", "", part, count=1, flags=re.S)
            part = re.sub(r"<hp:ctrl>\s*<hp:colPr\b[^>]*/>\s*</hp:ctrl>", "", part, count=1, flags=re.S)
            part = re.sub(r'pageBreak="0"', 'pageBreak="1"', part, count=1)
        d = Doc(part)
        _fill_sheet(d, data, chunk, other)
        d.replace_text(TITLE1, rf"\g<1> {data.month}월 \g<2>")
        return _LINESEG.sub("", d.xml) if not first else d.xml

    body = "".join(filled(c, i == 0, others[i]) for i, c in enumerate(chunks))
    return xml[:paras[0][0]] + body + xml[paras[p2][0]:]


def _fill_sheet_2(doc: Doc, data: VoucherInput, visits: list[Visit]) -> None:
    spaced = " ".join(data.child_name.replace(" ", ""))
    doc.replace_text(r"(<hp:t>\s*대상아동:)[^<]*(</hp:t>)", rf"\g<1> {spaced}.\g<2>" if spaced else r"\g<1> \g<2>")
    # the 별지 table: 승인일자 + 결과, without the 승인번호 column of page 1
    i = next(j for j, (s, e) in enumerate(doc.tables())
             if "승인일자" in _text(doc.xml[s:e]) and "승인번호" not in _text(doc.xml[s:e]))

    def rows(t: Table):
        for r in range(1, PER_SHEET + 1):
            v = visits[r - 1] if r <= len(visits) else None
            t.set(r, 0, _md(v.day) if v else "")
            t.set(r, 1, v.content.strip() if v else "")
    doc.edit(i, rows)


def _fill_pages_2(xml: str, data: VoucherInput) -> str:
    """The 별지 table is an inline object (it cannot split across pages) with five tall rows that fill the page,
    so each further five visits get their own copy of the whole 별지 page."""
    paras = _paragraphs(xml)
    texts = [_text(xml[s:e]) for s, e in paras]
    h = next(i for i, t in enumerate(texts) if t.strip() == "※ 별지")
    t = next(i for i in range(h, len(paras)) if "<hp:tbl" in xml[paras[i][0]:paras[i][1]])
    block = xml[paras[h][0]:paras[t][1]]
    chunks = [data.visits[i:i + PER_SHEET] for i in range(0, max(len(data.visits), 1), PER_SHEET)]
    out = []
    for k, chunk in enumerate(chunks):
        d = Doc(block)
        _fill_sheet_2(d, data, chunk)
        out.append(d.xml if k == 0 else _LINESEG.sub("", d.xml))  # the heading already starts a new page
    return xml[:paras[h][0]] + "".join(out) + xml[paras[t][1]:]


def _calendar_rows(t: Table, data: VoucherInput, label: dict[int, str]) -> None:
    """Rebuild the month grid: header row, then (date row, content row) per week, using the template's own
    first-week / middle / last-week rows so borders and fonts stay, at the template's total height."""
    def cells(row_xml: str) -> list[str]:
        return [row_xml[s:e] for s, e, d in _spans(row_xml, "hp:tc") if d == 0]

    trs = [t.xml[s:e] for s, e, d in _spans(t.xml, "hp:tr") if d == 0]
    if len(trs) < 6:
        raise VoucherError("달력 표 구조가 예상과 다릅니다")
    heights = [int(re.search(r'<hp:cellSz width="\d+" height="(\d+)"/>', r).group(1)) for r in trs]
    header_h, date_h = heights[0], heights[1]
    body_h = sum(heights[1:])
    date_first, date_mid, date_last = trs[1], trs[3], trs[-3]
    content_mid = trs[4]

    # last week's content row = the template's bottom row (thick bottom border), made one row high
    bottom = [set_cell_text(c, "") for c in cells(trs[-2])]  # also drops the old 30/31 overlay tables
    sunday = [set_cell_text(c, "") for c in cells(trs[-1])]
    if sunday and _own_addr(sunday[0])[0] == 0:
        bottom = sunday[:1] + [c for c in bottom if _own_addr(c)[0] != 0]
    content_last = "<hp:tr>" + "".join(re.sub(r'(<hp:cellSpan colSpan="\d+" rowSpan=")\d+', r"\g<1>1", c) for c in bottom) + "</hp:tr>"

    cal = calendar.Calendar(firstweekday=6)  # weeks start on Sunday like the form
    weeks = cal.monthdayscalendar(data.year, data.month)
    n = len(weeks)
    content_h = max(800, (body_h - n * date_h) // n)

    def build(proto: str, row_addr: int, values: dict[int, str], height: int | None) -> str:
        out = []
        for c in cells(proto):
            col = _own_addr(c)[0]
            c = set_cell_text(c, values.get(col, ""))  # first, so only the cell's own tags remain below
            c = re.sub(r'rowAddr="\d+"', f'rowAddr="{row_addr}"', c)
            if height is not None:
                c = re.sub(r'(<hp:cellSz width="\d+" height=")\d+', rf"\g<1>{height}", c)
            out.append(_LINESEG.sub("", c))
        return "<hp:tr>" + "".join(out) + "</hp:tr>"

    rows = [trs[0]]
    for w, week in enumerate(weeks):
        dproto = date_first if w == 0 else date_last if w == n - 1 else date_mid
        cproto = content_last if w == n - 1 else content_mid
        dates = {2 * i: (str(d) if d else "") for i, d in enumerate(week)}
        texts = {2 * i: label.get(d, "") for i, d in enumerate(week) if d}
        rows.append(build(dproto, 1 + 2 * w, dates, None))
        rows.append(build(cproto, 2 + 2 * w, texts, content_h))
    first_tr = re.search(r"<hp:tr>", t.xml).start()
    last_tr_end = [e for s, e, d in _spans(t.xml, "hp:tr") if d == 0][-1]
    t.xml = t.xml[:first_tr] + "".join(rows) + t.xml[last_tr_end:]
    t.xml = re.sub(r'(<hp:tbl\b[^>]*\browCnt=")\d+', rf"\g<1>{1 + 2 * n}", t.xml, count=1)


def _fill_page_3(doc: Doc, data: VoucherInput) -> None:
    doc.replace_text(TITLE3, rf"\g<1> {data.month}월 \g<2>")
    last_day = date(data.year, data.month, calendar.monthrange(data.year, data.month)[1])
    teacher = data.teacher or _main_therapist(data.visits)

    def head(t: Table):
        t.set(0, 3, data.child_name)
        t.set(1, 1, teacher)
        t.set(1, 3, _dotted(data.written_on or last_day, trailing_dot=False))
    doc.edit(doc.find("사회복지서비스관리번호", "작성일자"), head)

    label: dict[int, str] = {}
    for v in data.visits:
        # two lines like the original: "언어재활" / "(9:50~10:40)"
        label[v.day.day] = "\n".join(filter(None, [label.get(v.day.day), data.service, f"({_hm(v.start)}~{_hm(v.end)})"]))
    cal_index = next(i for i, (s, e) in enumerate(doc.tables())
                     if re.search(r'colCnt="14"', doc.xml[s:s + 600]) and _text(doc.xml[s:e]).startswith("일"))
    doc.edit(cal_index, lambda t: _calendar_rows(t, data, label))

    days = sorted({v.day.day for v in data.visits})
    count = len(data.visits)

    def provider(t: Table):
        t.set(1, 0, data.org_name)
        if data.phone is not None:
            t.set(1, 1, data.phone)
        t.set(1, 2, teacher)
        t.set(1, 3, data.service)
        t.set(1, 4, f"매월 {count}회" if count else "")
        listed = ",".join(str(d) for d in days)
        t.set(1, 5, listed if len(listed) <= 14 else ", ".join(str(d) for d in days))  # long lists wrap at commas
    doc.edit(doc.find("서비스 제공기관명", "제공일"), provider)

    def cost(t: Table):
        price = data.unit_price
        if price is None:
            m = re.search(r"([\d,]+)\s*원", t.text(1, 1))
            price = int(m.group(1).replace(",", "")) if m else None
        t.set(1, 0, data.service)
        t.set(1, 1, f"{price:,}원" if price is not None else "")
        t.set(1, 2, str(count) if count else "")
        t.set(1, 3, f"{price * count:,}원" if price is not None and count else "")
        t.set(1, 4, f"{data.copay:,}원" if data.copay is not None else "")
    doc.edit(doc.find("총서비스단가", "본인부담금"), cost)


def _main_therapist(visits: list[Visit]) -> str:
    names = [v.therapist for v in visits if v.therapist]
    return max(set(names), key=names.count) if names else ""


def _page3_on_new_page(xml: str) -> str:
    """Page 3 used to be pushed down by empty paragraphs, which breaks when page 2 grows. Start it on its own
    page instead and drop the padding (an empty paragraph stays so page 2 ends as before)."""
    paras = _paragraphs(xml)
    texts = [_text(xml[s:e]).strip() for s, e in paras]
    k = next(i for i, t in enumerate(texts) if "서식 9호" in t)
    j = k
    while j > 0 and not texts[j - 1] and "<hp:tbl" not in xml[paras[j - 1][0]:paras[j - 1][1]]:
        j -= 1
    head = re.sub(r'pageBreak="0"', 'pageBreak="1"', xml[paras[k][0]:paras[k][1]], count=1)
    keep = xml[paras[j][0]:paras[j][1]] if j < k else ""
    return xml[:paras[j][0]] + keep + head + xml[paras[k][1]:]


def render(data: VoucherInput, template: bytes | None = None) -> bytes:
    raw = template if template is not None else TEMPLATE.read_bytes()
    data.visits = sorted(data.visits, key=lambda v: (v.day, v.start))
    if any(v.day.year != data.year or v.day.month != data.month for v in data.visits):
        raise VoucherError("다른 달의 회기가 섞여 있습니다")
    zin = zipfile.ZipFile(io.BytesIO(raw))
    xml = zin.read(SECTION).decode("utf-8")
    xml = _page3_on_new_page(xml)
    doc = Doc(xml)
    _fill_page_3(doc, data)
    xml = _fill_pages_2(doc.xml, data)
    xml = _fill_pages_1(xml, data)
    return _repack(zin, {SECTION: xml.encode("utf-8")})


def _repack(zin: zipfile.ZipFile, replace: dict[str, bytes]) -> bytes:
    """Same entries, same order, same compression per entry (mimetype stays first and stored)."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zout:
        for info in zin.infolist():
            data = replace.get(info.filename, zin.read(info.filename))
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            zi.create_system = info.create_system
            zout.writestr(zi, data)
    return out.getvalue()


def filename(child_name: str, month: int) -> str:
    return f"{child_name}-{month}월.hwpx"
