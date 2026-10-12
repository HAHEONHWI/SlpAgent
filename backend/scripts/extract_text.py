"""Extract page-preserving text from text-based PDFs into extracted/<name>.json.
Pages with <30 chars are flagged needs_ocr (never auto-filled)."""
import json, sys, pathlib, pymupdf

src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
out.mkdir(exist_ok=True)
for f in sorted(src.glob("*")):
    if f.suffix.lower() != ".pdf":
        continue
    doc = pymupdf.open(f)
    pages = []
    for i, p in enumerate(doc, 1):
        t = p.get_text().strip()
        pages.append({"page": i, "text": t, "needs_ocr": len(t) < 30})
    (out / (f.stem + ".json")).write_text(json.dumps({"source": f.name, "pages": pages}, ensure_ascii=False, indent=1))
    print(f.name, len(pages), "pages,", sum(p["needs_ocr"] for p in pages), "need OCR")
