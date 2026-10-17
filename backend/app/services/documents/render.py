import html
import io
import os
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from .. import billing
from . import hwpx


TITLES = {
    "service_record": "발달재활 서비스 제공 기록지",
    "schedule": "서비스 일정표",
    "progress_report": "치료 경과보고서",
    "assessment_summary": "평가 결과 요약서",
    "parent_consultation": "보호자 상담기록",
}


class DocumentFontNotConfigured(ValueError):
    pass


def _value(value):
    return "수기 입력" if value is None or value == "" else str(value)


def _minutes(row):
    return billing.minutes_between(row["start"], row["end"])


def _money(amount):
    return "수기 입력" if amount is None else f"{amount:,}원"


def _sections(kind: str, data: dict) -> list[tuple[str, list[str] | None, list[list[str]] | str]]:
    child = data["child"]
    sessions = data.get("sessions", [])
    billing_summary = data.get("billing", {})
    if kind == "service_record":
        rows = [[s["date"], _minutes(s), s["start"], s["end"], _value(s.get("therapist")), s.get("status", "")]
                for s in sessions]
        return [
            ("이용자", None, f"제공기관명: {_value(data.get('organization', {}).get('name'))} · 성명: {_value(child.get('display_name'))} · 생년월일: {_value(child.get('birth_date'))} · 제공월: {data['month']}"),
            ("월별 서비스 제공 내역", ["일자", "분", "시작", "종료", "담당자", "상태"], rows),
            ("제공시간 및 이용금액", ["항목", "계산 결과"], [
                ["총 제공시간(분)", str(billing_summary.get("total_minutes", 0))],
                ["바우처 시간(분)", _value(billing_summary.get("voucher_minutes"))],
                ["추가 구매 시간(분)", _value(billing_summary.get("additional_minutes"))],
                ["총 이용금액", _money(billing_summary.get("total_amount"))],
            ]),
            ("승인 및 확인", ["항목", "기재"], [["승인일자", "수기 입력"], ["승인번호", "수기 입력"],
                                               ["이용자 서명", "수기 입력"], ["관리자 서명", "수기 입력"],
                                               ["보호자 서명", "수기 입력"], ["이용자 상태 및 치료 결과", "수기 입력"],
                                               ["별지 첨부", "수기 입력"]]),
        ]
    if kind == "schedule":
        rows = [[s["date"], s["start"], s["end"], _minutes(s), _value(s.get("therapist")), s.get("status", "")]
                for s in data.get("schedules", [])]
        return [("일정", ["일자", "시작", "종료", "분", "담당자", "상태"], rows)]
    if kind == "progress_report":
        goal_rows = [[g.get("kind", ""), g.get("text", ""), g.get("measure", ""), g.get("criterion", ""), g.get("status", "")]
                     for plan in data.get("plans", []) for g in plan.get("goals", [])]
        session_rows = [[s["date"], s.get("status", ""), "; ".join(a.get("name", "") for a in s.get("activities", [])),
                         "; ".join(s.get("observed_behaviors", []))] for s in sessions]
        return [("아동", None, f"가명 코드: {_value(child.get('alias'))} · 기간: {data['month']}"),
                ("치료목표", ["종류", "목표", "측정", "기준", "상태"], goal_rows),
                ("회기 기록", ["일자", "상태", "활동", "관찰"], session_rows),
                ("월 집계", ["회기 수", "제공시간(분)"], [[str(data["billing"].get("session_count", 0)),
                                                            str(data["billing"].get("total_minutes", 0))]])]
    if kind == "assessment_summary":  # legacy: no longer created; kept so drafts made before 검사 removal still approve
        rows = [[a["test_code"], a["assessed_on"], str(a.get("age_months_at_test", "")),
                 _value(a.get("raw_total")), a.get("derived_scores", {}).get("status", "norm_unavailable"),
                 "; ".join(f"{i.get('item_id')}: {i.get('response')}" for i in a.get("items", []))]
                for a in data.get("assessments", [])]
        return [("검사 결과", ["검사", "검사일", "검사 당시 월령", "입력 원점수", "규준 상태", "문항 응답"], rows),
                ("해석 제한", None, "공식 규준표가 제공되지 않은 검사는 표준점수·발달연령·백분위를 산출하지 않았습니다.")]
    if kind == "parent_consultation":
        rows = [[r.get("date", ""),
                 f"{r['start']}-{r['end']}" if r.get("start") and r.get("end") else "",
                 _value(r.get("counselor")), ", ".join(r.get("participants") or []),
                 ", ".join(r.get("topics") or []), r.get("summary") or "",
                 r.get("guidance_given") or "", r.get("follow_up") or ""]
                for r in sorted(data.get("consultations", []), key=lambda c: (c.get("date", ""), c.get("start") or ""))]
        return [("상담 기록", ["일자", "시간", "상담자", "참석자", "주제", "상담 내용", "안내 사항", "후속 확인"], rows),
                ("서명", None, "상담자: 수기 입력 · 보호자: 수기 입력")]
    raise ValueError(f"unsupported document type: {kind}")


def _docx(kind: str, data: dict, draft: bool) -> bytes:
    doc = Document()
    section = doc.sections[0]
    section.top_margin = Inches(0.65)
    section.bottom_margin = Inches(0.65)
    section.header.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    if draft:
        run = section.header.paragraphs[0].add_run("초안 · 치료사 승인 전")
        run.bold = True
        run.font.color.rgb = RGBColor(170, 80, 80)
        run.font.size = Pt(14)
    doc.add_heading(TITLES[kind], 0)
    doc.add_paragraph(f"제공월: {data['month']} · 아동 코드: {_value(data['child'].get('alias'))}")
    for title, headers, content in _sections(kind, data):
        doc.add_heading(title, level=1)
        if headers is None:
            doc.add_paragraph(str(content))
            continue
        table = doc.add_table(rows=1, cols=len(headers))
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        for cell, value in zip(table.rows[0].cells, headers):
            cell.text = value
        rows = content or [["기록 없음"] + [""] * (len(headers) - 1)]
        for row in rows:
            cells = table.add_row().cells
            for cell, value in zip(cells, row):
                cell.text = str(value)
    stream = io.BytesIO()
    doc.save(stream)
    return stream.getvalue()


def _pdf(kind: str, data: dict, draft: bool, font_path: str) -> bytes:
    if not font_path or not os.path.isfile(font_path):
        raise DocumentFontNotConfigured("PDF_FONT_PATH must point to a licensed Korean TTF/TTC font")
    font_name = "SLPAgentKorean"
    if font_name not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(font_name, font_path))
    page_size = A4
    normal = ParagraphStyle("SLPBody", fontName=font_name, fontSize=8, leading=11, wordWrap="CJK")
    heading = ParagraphStyle("SLPHeading", parent=normal, fontSize=12, leading=16, spaceBefore=6, spaceAfter=4)
    title = ParagraphStyle("SLPTitle", parent=normal, fontSize=18, leading=23, alignment=1, spaceAfter=10)
    story = [Paragraph(html.escape(TITLES[kind]), title),
             Paragraph(html.escape(f"제공월: {data['month']} · 아동 코드: {_value(data['child'].get('alias'))}"), normal),
             Spacer(1, 5 * mm)]
    for section_title, headers, content in _sections(kind, data):
        story.append(Paragraph(html.escape(section_title), heading))
        if headers is None:
            story.append(Paragraph(html.escape(str(content)), normal))
            continue
        rows = [[Paragraph(html.escape(str(cell)), normal) for cell in headers]]
        body = content or [["기록 없음"] + [""] * (len(headers) - 1)]
        rows.extend([[Paragraph(html.escape(str(cell)), normal) for cell in row] for row in body])
        table = Table(rows, repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                                   ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e7edf5")),
                                   ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                   ("LEFTPADDING", (0, 0), (-1, -1), 4),
                                   ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
        story.extend([table, Spacer(1, 3 * mm)])
    stream = io.BytesIO()
    def page_mark(canvas, document):
        if draft:
            canvas.saveState()
            canvas.setFillColor(colors.Color(0.65, 0.65, 0.65, alpha=0.25))
            canvas.setFont(font_name, 38)
            canvas.translate(page_size[0] / 2, page_size[1] / 2)
            canvas.rotate(35)
            canvas.drawCentredString(0, 0, "초안")
            canvas.restoreState()
    SimpleDocTemplate(stream, pagesize=page_size, leftMargin=15 * mm, rightMargin=15 * mm,
                      topMargin=18 * mm, bottomMargin=15 * mm).build(story, onFirstPage=page_mark, onLaterPages=page_mark)
    return stream.getvalue()


def render_document(kind: str, format: str, data: dict, draft: bool, settings) -> tuple[bytes, str, str]:
    if kind not in TITLES:
        raise ValueError(f"unsupported document type: {kind}")
    if format == "docx":
        return _docx(kind, data, draft), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"
    if format == "pdf":
        return _pdf(kind, data, draft, settings.pdf_font_path), "application/pdf", "pdf"
    if format == "hwpx":
        summary = data.get("billing", {})
        values = {"month": data["month"], "child_alias": data["child"].get("alias", ""),
                  "child_name": data["child"].get("display_name", ""), "birth_date": data["child"].get("birth_date", ""),
                  "total_minutes": str(summary.get("total_minutes", "")),
                  "voucher_minutes": _value(summary.get("voucher_minutes")),
                  "additional_minutes": _value(summary.get("additional_minutes")),
                  "total_amount": _money(summary.get("total_amount")),
                  "approval_date": "수기 입력", "approval_number": "수기 입력",
                  "signatures": "수기 입력", "status_result": "수기 입력", "appendix": "수기 입력",
                  "draft_watermark": "초안 · 치료사 승인 전" if draft else ""}
        content = hwpx.render(settings.hwpx_template_path, values, {"draft_watermark"})
        return content, "application/vnd.hancom.hwpx", "hwpx"
    raise ValueError(f"unsupported document format: {format}")
