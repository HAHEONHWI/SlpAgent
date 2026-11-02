import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// Minimal .xlsx reader/writer on fflate's synchronous zip (React Native has no Web Workers, which the web app's
// read-/write-excel-file use for larger files). Enough for the children list import and the attendance export.

const decode = (t: string) => t.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, (_, n, d, h) =>
  d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" } as Record<string, string>)[n.toLowerCase()]);
const encode = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");
const colIndex = (ref: string) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colName = (i: number): string => (i >= 26 ? colName(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** Excel date serial (1900 system) -> local Date. */
const fromSerial = (n: number) => { const d = new Date(Math.round((n - 25569) * 86400 * 1000)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

/** First worksheet of an .xlsx as rows of cells (string, number, boolean, Date or null). */
export function readXlsxRows(bytes: Uint8Array): unknown[][] {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("엑셀(.xlsx) 파일이 아니에요.");
  const files = unzipSync(bytes, { filter: (f) => /\.(xml|rels)$/.test(f.name) });
  const read = (p: string) => (files[p] ? strFromU8(files[p]) : "");
  // First sheet in workbook order.
  const wb = read("xl/workbook.xml"), rels = read("xl/_rels/workbook.xml.rels");
  const rid = attr(wb.match(/<sheet\s[^>]*>/)?.[0] ?? "", "r:id");
  const target = rid ? attr(rels.match(new RegExp(`<Relationship\\s[^>]*Id="${rid}"[^>]*>`))?.[0] ?? "", "Target") : undefined;
  const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : Object.keys(files).filter((k) => k.startsWith("xl/worksheets/sheet")).sort()[0];
  const sheet = read(path ?? "");
  if (!sheet) throw new Error("시트를 찾지 못했어요.");
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  // Which cell styles are dates (built-in formats 14–22, 45–47, or a custom format with y/m/d).
  const styles = read("xl/styles.xml");
  const custom = new Map([...styles.matchAll(/<numFmt\s[^>]*>/g)].map((m) => [Number(attr(m[0], "numFmtId")), decode(attr(m[0], "formatCode") ?? "")]));
  const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const dateStyle = [...xfs.matchAll(/<xf\s[^>]*?\/?>/g)].map((m) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[ymd]/i.test((custom.get(id) ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, ""));
  });
  const rows: unknown[][] = [];
  for (const r of sheet.matchAll(/<row\s[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const at = Number(attr(r[0], "r") ?? rows.length + 1) - 1;
    const row: unknown[] = [];
    for (const c of (r[1] ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c ${c[1]}>`, body = c[2] ?? "", t = attr(tag, "t"), v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const i = colIndex(attr(tag, "r") ?? colName(row.length));
      row[i] = t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? texts(body) : t === "str" ? decode(v ?? "") : t === "b" ? v === "1"
        : v == null ? null : dateStyle[Number(attr(tag, "s") ?? 0)] ? fromSerial(Number(v)) : Number(v);
    }
    rows[at] = Array.from(row, (x) => x ?? null);
  }
  return Array.from(rows, (x) => x ?? []);
}

export type SheetSpec = { name: string; rows: (string | number | null | undefined)[][]; widths?: number[] };

/** Build an .xlsx: the first row of each sheet is bold and frozen. */
export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  const sheetXml = ({ rows, widths }: SheetSpec) => {
    const cols = widths?.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      if (v == null || v === "") return "";
      const ref = `${colName(ci)}${ri + 1}`, st = ri === 0 ? ' s="1"' : "";
      return typeof v === "number" ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${encode(v)}</t></is></c>`;
    }).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
  };
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sh, i) => `<sheet name="${encode(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`),
  };
  sheets.forEach((sh, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sh)); });
  return zipSync(files, { level: 6 });
}
