import AppKit
import Foundation
import PDFKit
import Vision

struct ExtractedPage: Decodable {
    let page: Int
    let needs_ocr: Bool
}

struct ExtractedDocument: Decodable {
    let source: String
    let pages: [ExtractedPage]
}

struct OCRLine: Encodable {
    let text: String
    let confidence: Float
    let needs_review: Bool
    let box: [Double]
}

struct OCRPage: Encodable {
    let page: Int
    let text: String
    let ocr_completed: Bool
    let needs_ocr: Bool
    let needs_review: Bool
    let review_reasons: [String]
    let average_confidence: Double?
    let lines: [OCRLine]
    let image: String
}

struct OCRDocument: Encodable {
    let source: String
    let pages: [OCRPage]
}

struct ReportEntry {
    let source: String
    let page: OCRPage
}

func htmlEscape(_ value: String) -> String {
    value.replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
        .replacingOccurrences(of: "\"", with: "&quot;")
}

func safeName(_ value: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
    return value.unicodeScalars.map { allowed.contains($0) ? String($0) : "_" }.joined()
}

func pageImage(_ page: PDFPage, output: URL, pageNumber: Int) throws -> CGImage {
    let bounds = page.bounds(for: .mediaBox)
    let size = CGSize(width: max(1, bounds.width * 2), height: max(1, bounds.height * 2))
    let image = page.thumbnail(of: size, for: .mediaBox)
    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
          let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else {
        throw NSError(domain: "OCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not render PDF page"])
    }
    try png.write(to: output, options: .atomic)
    return cgImage
}

func recognize(_ image: CGImage) throws -> [OCRLine] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["ko-KR", "en-US"]
    try VNImageRequestHandler(cgImage: image).perform([request])
    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return OCRLine(text: candidate.string, confidence: candidate.confidence,
                       needs_review: candidate.confidence < 0.75,
                       box: [Double(box.minX), Double(box.minY), Double(box.width), Double(box.height)])
    }
}

func process(pdfURL: URL, extractionURL: URL, outputRoot: URL) throws -> [ReportEntry] {
    let source = pdfURL.lastPathComponent
    let extracted = try JSONDecoder().decode(ExtractedDocument.self, from: Data(contentsOf: extractionURL))
    let flaggedPages = Set(extracted.pages.filter(\.needs_ocr).map(\.page))
    guard !flaggedPages.isEmpty else { return [] }
    guard let pdf = PDFDocument(url: pdfURL) else {
        throw NSError(domain: "OCR", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not open PDF: \(source)"])
    }

    let slug = safeName((source as NSString).deletingPathExtension)
    let imageDirectory = outputRoot.appendingPathComponent("images", isDirectory: true)
    try FileManager.default.createDirectory(at: imageDirectory, withIntermediateDirectories: true)
    var pages: [OCRPage] = []
    var entries: [ReportEntry] = []

    for number in flaggedPages.sorted() {
        guard let pdfPage = pdf.page(at: number - 1) else { continue }
        let imageName = "\(slug)-p\(String(format: "%04d", number)).png"
        let imageURL = imageDirectory.appendingPathComponent(imageName)
        let cgImage = try pageImage(pdfPage, output: imageURL, pageNumber: number)
        let lines = try recognize(cgImage)
        let text = lines.map(\.text).joined(separator: "\n")
        let average = lines.isEmpty ? nil : Double(lines.map(\.confidence).reduce(0, +)) / Double(lines.count)
        let xStarts = Set(lines.map { Int($0.box[0] * 10) })
        var reasons = ["ocr_output_requires_human_review"]
        if lines.contains(where: \.needs_review) { reasons.append("low_confidence_lines") }
        if xStarts.count >= 4 && lines.count >= 12 { reasons.append("table_or_columns_suspected") }
        let result = OCRPage(page: number, text: text, ocr_completed: !lines.isEmpty, needs_ocr: lines.isEmpty,
                             needs_review: true, review_reasons: reasons, average_confidence: average,
                             lines: lines, image: "images/\(imageName)")
        pages.append(result)
        entries.append(ReportEntry(source: source, page: result))
    }

    let document = OCRDocument(source: source, pages: pages)
    let jsonURL = outputRoot.appendingPathComponent("\(slug).json")
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    try encoder.encode(document).write(to: jsonURL, options: .atomic)
    return entries
}

func makeReport(_ entries: [ReportEntry], at url: URL) throws {
    var sections = ""
    for entry in entries {
        let body = entry.page.lines.map { line in
            let marker = line.needs_review ? " <strong>needs_review</strong>" : ""
            return "<p>\(htmlEscape(line.text)) <small>confidence \(String(format: "%.2f", line.confidence))\(marker)</small></p>"
        }.joined()
        sections += """
        <section><h2>\(htmlEscape(entry.source)) · p. \(entry.page.page) · \(entry.page.review_reasons.joined(separator: ", "))</h2>
          <div class="pair"><img src="\(htmlEscape(entry.page.image))" alt="\(htmlEscape(entry.source)) page \(entry.page.page)"><div class="text">\(body.isEmpty ? "<p>OCR text not found.</p>" : body)</div></div>
        </section>
        """
    }
    let html = """
    <!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OCR local review</title><style>
    body{font:15px system-ui,sans-serif;margin:24px;color:#202124}section{border-top:1px solid #ddd;padding:16px 0 28px}
    h1{font-size:22px}h2{font-size:16px}.pair{display:grid;grid-template-columns:minmax(320px,1fr) minmax(320px,1fr);gap:16px;align-items:start}
    img{width:100%;height:auto;border:1px solid #bbb}.text{max-height:90vh;overflow:auto;padding:8px 14px;background:#f7f7f7}
    small{color:#777;margin-left:8px}strong{color:#a22}@media(max-width:800px){.pair{grid-template-columns:1fr}}
    </style><body><h1>OCR local review</h1><p>OCR output is unapproved. Review every page and table against its image before clinical use.</p>\(sections)</body></html>
    """
    try html.write(to: url, atomically: true, encoding: .utf8)
}

guard CommandLine.arguments.count == 4 else {
    fputs("Usage: swift ocr_scans.swift <reference-docs> <extracted-json-dir> <output-dir>\n", stderr)
    exit(2)
}

let referenceDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let extractedDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
let imageDirectory = outputDirectory.appendingPathComponent("images", isDirectory: true)
try FileManager.default.createDirectory(at: imageDirectory, withIntermediateDirectories: true)
let files = try FileManager.default.contentsOfDirectory(at: referenceDirectory, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension.lowercased() == "pdf" }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }
var allEntries: [ReportEntry] = []
for file in files {
    let json = extractedDirectory.appendingPathComponent("\((file.lastPathComponent as NSString).deletingPathExtension).json")
    guard FileManager.default.fileExists(atPath: json.path) else { continue }
    allEntries += try process(pdfURL: file, extractionURL: json, outputRoot: outputDirectory)
}
try makeReport(allEntries, at: outputDirectory.appendingPathComponent("index.html"))
let success = allEntries.filter { $0.page.ocr_completed }.count
let needsReview = allEntries.filter { $0.page.needs_review }.count
print("OCR pages: \(allEntries.count); text found: \(success); needs_review: \(needsReview); report: \(outputDirectory.appendingPathComponent("index.html").path)")
