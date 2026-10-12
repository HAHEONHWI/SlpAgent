import json
import re
import sys
from pathlib import Path
import pymupdf


SOURCES = {
    "PRES": "pres검사지.pdf",
    "SELSI": "검사지 - 영,유아 언어발달 검사(SELSI).pdf",
    "EASIC": "EASIC검사지.pdf",
    "KOSECT": "구문의미 이해력 검사.pdf",
}


def read_source(directory: Path, filename: str) -> dict:
    path = directory / f"{Path(filename).stem}.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("source") != filename:
        raise ValueError(f"source filename mismatch: {path}")
    return document


def text_items(pages: list[dict], page_numbers: set[int], language: str, source: str, options=None) -> list[dict]:
    items = []
    age_range = None
    for page in pages:
        if page["page"] not in page_numbers:
            continue
        lines = page.get("text", "").splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            age = re.fullmatch(r"(\d{1,2})\s*[-～~]\s*(\d{1,2})(?:\s*개월)?", line)
            if age:
                age_range = f"{age.group(1)}-{age.group(2)}개월"
            match = re.fullmatch(r"(\d{1,2})[.)]?", line)
            if match:
                number = int(match.group(1))
                next_line = next((value.strip() for value in lines[i + 1:] if value.strip()), "")
                if 1 <= number <= 57 and next_line and not re.fullmatch(r"\d{1,2}", next_line):
                    items.append({
                        "item_id": f"{language}-{number:02d}-p{page['page']}",
                        "source_item_number": str(number),
                        "domain": language,
                        "age_range": age_range,
                        "prompt": next_line,
                        "response_options": list(options or []),
                        "source": {"file": source, "page": page["page"]},
                        "needs_review": True,
                    })
                    i += 2
                    continue
            i += 1
    return items


def numbered_checklist(pages: list[dict], page_numbers: set[int], prefix: str, source: str) -> list[dict]:
    items = []
    age_range = None
    domain = "확인 필요"
    number_occurrences: dict[int, int] = {}
    for page in pages:
        if page["page"] not in page_numbers:
            continue
        for line in page.get("text", "").splitlines():
            heading = re.search(r"<([^<>]+)>", line)
            if heading and not re.match(r"\s*\d+[.)]", line):
                domain = heading.group(1).strip()
            age = re.search(r"\((\d{1,2})\s*[-～~]\s*(\d{1,2})\s*mo\)", line, re.I)
            if age:
                age_range = f"{age.group(1)}-{age.group(2)}개월"
            match = re.match(r"\s*(\d{1,2})[.)]\s*(\S.*)$", line)
            if not match:
                continue
            source_number = int(match.group(1))
            occurrence = number_occurrences.get(source_number, 0) + 1
            number_occurrences[source_number] = occurrence
            prompt = match.group(2).strip()
            age_match = re.search(r"\((\d{1,2})\s*[-～~]\s*(\d{1,2})\s*mo\)", prompt, re.I)
            item_age = f"{age_match.group(1)}-{age_match.group(2)}개월" if age_match else age_range
            items.append({
                "item_id": f"{prefix}-row-{len(items) + 1:02d}",
                "source_item_number": str(source_number),
                "domain": domain,
                "age_range": item_age,
                "prompt": prompt,
                "response_options": ["성취", "출현", "미발달"],
                "source": {"file": source, "page": page["page"]},
                "needs_review": True,
            })
    return items


def pres_domain_map(pdf_path: Path) -> dict[tuple[int, int], str]:
    result = {}
    pdf = pymupdf.open(pdf_path)
    categories = ("인지·의미론", "음운·구문론", "화용론")
    for page_number in (2, 3):
        page = pdf[page_number - 1]
        cells = [drawing["rect"] for drawing in page.get_drawings()
                 if drawing.get("fill") and drawing["rect"].x0 >= 420]
        starts = sorted({round(cell.x0, 1) for cell in cells})
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                text = "".join(span["text"] for span in line["spans"])
                match = re.match(r"\s*(\d{1,2})\.", text)
                if not match:
                    continue
                center_y = (line["bbox"][1] + line["bbox"][3]) / 2
                row = [cell for cell in cells if cell.y0 - 2 <= center_y <= cell.y1 + 2]
                category_cells = [cell for cell in row if any(abs(cell.x0 - start) < 1 for start in starts)]
                if category_cells:
                    start = category_cells[0].x0
                    index = min(range(len(starts)), key=lambda i: abs(starts[i] - start))
                    if index < len(categories):
                        result[(page_number, int(match.group(1)))] = categories[index]
    pdf.close()
    return result


def pres_items(document: dict, source: str, domain_map: dict[tuple[int, int], str] | None = None) -> tuple[list[dict], dict]:
    items = []
    for page_number, language in ((2, "수용언어"), (3, "표현언어")):
        current_age = None
        page = next(p for p in document["pages"] if p["page"] == page_number)
        for line in page["text"].splitlines():
            line = line.strip()
            age = re.fullmatch(r"(\d{2})\s*[-～~]\s*(\d{2})", line)
            if age:
                current_age = f"{age.group(1)}-{age.group(2)}개월"
            match = re.match(r"(\d{1,2})\.\s*(\S.*)$", line)
            if not match:
                continue
            number, prompt = match.group(1), match.group(2).strip()
            items.append({
                "item_id": f"{language}-{int(number):02d}",
                "source_item_number": number,
                "domain": (domain_map or {}).get((page_number, int(number)), "확인 필요"),
                "age_range": current_age,
                "prompt": prompt,
                "response_options": [],
                "source": {"file": source, "page": page_number},
                "needs_review": True,
            })
    reported = {"수용언어": 46, "표현언어": 46}
    observed = {language: sum(item["item_id"].startswith(language + "-") for item in items) for language in reported}
    expected_domains = {"수용언어": {"인지·의미론": 25, "음운·구문론": 15, "화용론": 6},
                        "표현언어": {"인지·의미론": 16, "음운·구문론": 22, "화용론": 8}}
    observed_domains = {language: {domain: sum(item["domain"] == domain and
                                               item["item_id"].startswith(language)
                                               for item in items)
                                   for domain in expected_domains[language]} for language in expected_domains}
    unresolved_domains = {language: {domain: expected - observed_domains[language][domain]
                                     for domain, expected in expected_domains[language].items()}
                          for language in expected_domains}
    return items, {"reported_count": reported, "observed_count": observed,
                   "expected_domain_counts": expected_domains, "observed_domain_counts": observed_domains,
                   "unresolved_domain_counts": unresolved_domains,
                   "unresolved_count": {key: reported[key] - observed[key] for key in reported}}


def build(extracted_dir: Path, reference_dir: Path | None = None) -> dict[str, dict]:
    pres_source = SOURCES["PRES"]
    domain_map = pres_domain_map(reference_dir / pres_source) if reference_dir else None
    pres, pres_check = pres_items(read_source(extracted_dir, pres_source), pres_source, domain_map)

    selsi_source = SOURCES["SELSI"]
    selsi_doc = read_source(extracted_dir, selsi_source)
    selsi = text_items(selsi_doc["pages"], {2, 3}, "수용언어", selsi_source)
    selsi += text_items(selsi_doc["pages"], {4, 5}, "표현언어", selsi_source)

    easic_source = SOURCES["EASIC"]
    easic_doc = read_source(extracted_dir, easic_source)
    easic_specs = [
        ("pre", {1, 2}, 27),
        ("receptive-1", {3, 4}, 27),
        ("expressive-1", {5, 6}, 33),
        ("receptive-2", {7, 8}, 24),
        ("expressive-2", {9, 10}, 33),
    ]
    easic = []
    easic_counts = {}
    for prefix, page_numbers, expected in easic_specs:
        group = numbered_checklist(easic_doc["pages"], page_numbers, prefix, easic_source)
        easic.extend(group)
        source_numbers = [item["source_item_number"] for item in group]
        duplicates = sorted({number for number in source_numbers if source_numbers.count(number) > 1}, key=int)
        easic_counts[prefix] = {"expected_count": expected, "observed_count": len(group),
                                "duplicate_source_numbers": duplicates}

    kosect_source = SOURCES["KOSECT"]
    kosect_doc = read_source(extracted_dir, kosect_source)
    kosect = text_items(kosect_doc["pages"], {2, 3}, "구문의미 이해", kosect_source, ["A", "B", "C"])

    return {
        "PRES": {"items": pres, "source_checks": pres_check},
        "SELSI": {"items": selsi, "source_checks": {"expected_count": 112, "observed_count": len(selsi)}},
        "EASIC": {"items": easic, "source_checks": {"groups": easic_counts, "expected_count": 144,
                                                        "observed_count": len(easic)}},
        "KOSECT": {"items": kosect, "source_checks": {"expected_count": 57, "observed_count": len(kosect)}},
    }


def main() -> None:
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: build_assessment_banks.py <extracted-dir> <output-dir> [reference-docs-dir]")
    extracted_dir, output_dir = map(Path, sys.argv[1:3])
    reference_dir = Path(sys.argv[3]) if len(sys.argv) == 4 else None
    output_dir.mkdir(parents=True, exist_ok=True)
    for code, payload in build(extracted_dir, reference_dir).items():
        document = {"test_code": code, "norm_tables_loaded": False, **payload}
        target = output_dir / f"{code}.json"
        target.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        check = document["source_checks"]
        print(f"{code}: {check}")


if __name__ == "__main__":
    main()
