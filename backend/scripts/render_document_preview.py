import argparse
import os
from pathlib import Path
from types import SimpleNamespace
from app.services import billing
from app.services.documents.render import render_document


def main() -> None:
    parser = argparse.ArgumentParser(description="Render synthetic local DOCX/PDF files for layout review.")
    parser.add_argument("--output-dir", default="../extracted/layout-compare")
    parser.add_argument("--font-path", default=os.getenv("PDF_FONT_PATH", ""))
    args = parser.parse_args()
    sessions = [{"date": "2026-10-10", "start": "10:00", "end": "10:40", "status": "completed",
                 "therapist": "담당 치료사"}]
    data = {"month": "2026-10", "organization": {"name": "샘플 기관"}, "child": {"alias": "QA-01", "display_name": "샘플 이용자",
            "birth_date": "2022-01-01"}, "sessions": sessions, "schedules": [], "plans": [],
            "consultations": [], "billing": billing.monthly_summary(sessions, 40000, 120)}
    settings = SimpleNamespace(pdf_font_path=args.font_path, hwpx_template_path="")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    for file_format in ("docx", "pdf"):
        content, _, extension = render_document("service_record", file_format, data, True, settings)
        path = output_dir / f"service-record-draft.{extension}"
        path.write_bytes(content)
        print(path.resolve())


if __name__ == "__main__":
    main()
