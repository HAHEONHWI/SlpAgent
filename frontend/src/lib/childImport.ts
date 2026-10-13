/** Reading a children list from a spreadsheet. Everything here runs in the browser: a 주민번호-style
 * "YYMMDD-N" cell is reduced to the birth date and sex, and the digit itself is never sent or stored. */
export type ImportRow = { line: number; alias: string; display_name: string; birth_date: string; sex: "남" | "여" | null; therapist: string | null; error: string | null };

const COLUMNS = {
  name: /대상자명|아동명|아동\s*이름|^이름$|성명/,
  birth: /생년월일|주민/,
  code: /아이\s*코드|가명|코드/,
  therapist: /지정\s*제공\s*인력|제공\s*인력|담당|치료사|선생/,
  sex: /성별/,
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** "210405-3" -> 2021-04-05, 남. 1/2/5/6 = 1900s, 3/4/7/8 = 2000s; odd = 남, even = 여. */
export function parseBirth(v: unknown): { birth: string | null; sex: "남" | "여" | null } {
  if (v instanceof Date && !isNaN(+v)) return { birth: isoDate(v.getFullYear(), v.getMonth() + 1, v.getDate()), sex: null };
  const s = String(v ?? "").replace(/\s/g, "");
  let m = s.match(/^(\d{2})(\d{2})(\d{2})(?:-?(\d))?/);
  if (m && !/^\d{8}/.test(s)) {
    const g = m[4] ? Number(m[4]) : null;
    const yy = Number(m[1]);
    const century = g == null ? (yy <= new Date().getFullYear() % 100 ? 2000 : 1900) : [3, 4, 7, 8].includes(g) ? 2000 : [1, 2, 5, 6].includes(g) ? 1900 : null;
    if (century == null) return { birth: null, sex: null };
    return { birth: isoDate(century + yy, Number(m[2]), Number(m[3])), sex: g == null ? null : g % 2 ? "남" : "여" };
  }
  m = s.match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})/);
  return { birth: m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : null, sex: null };
}

const sexOf = (v: unknown): "남" | "여" | null => {
  const s = String(v ?? "").trim().toUpperCase();
  return /^(남|남자|M|MALE)$/.test(s) ? "남" : /^(여|여자|F|FEMALE)$/.test(s) ? "여" : null;
};

export async function readRows(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
  }
  if (/\.xls$/i.test(file.name)) throw new Error("예전 엑셀 형식(.xls)은 읽을 수 없어요. 엑셀에서 ‘다른 이름으로 저장 → .xlsx’로 바꿔 올려 주세요.");
  const { readSheet } = await import("read-excel-file/browser");
  return (await readSheet(file)) as unknown[][];
}

export function toChildren(rows: unknown[][], existingCodes: string[]): { rows: ImportRow[]; missing: string[] } {
  const headerAt = rows.slice(0, 10).findIndex((r) => r.some((c) => COLUMNS.name.test(String(c ?? "").trim())));
  if (headerAt < 0) return { rows: [], missing: ["대상자명(이름)"] };
  const head = rows[headerAt].map((c) => String(c ?? "").trim());
  const col = (re: RegExp, skip: number[] = []) => head.findIndex((h, i) => !skip.includes(i) && re.test(h));
  const name = col(COLUMNS.name), birth = col(COLUMNS.birth), therapist = col(COLUMNS.therapist), sex = col(COLUMNS.sex);
  const code = col(COLUMNS.code, [name, birth, therapist]);
  const missing = [birth < 0 && "생년월일"].filter(Boolean) as string[];
  if (missing.length) return { rows: [], missing };
  const used = new Set(existingCodes.map((c) => c.toLowerCase()));
  let auto = 1;
  const nextCode = () => { while (used.has(`c-${String(auto).padStart(3, "0")}`)) auto++; return `C-${String(auto++).padStart(3, "0")}`; };
  const out: ImportRow[] = [];
  rows.slice(headerAt + 1).forEach((r, i) => {
    const display_name = String(r[name] ?? "").trim();
    if (!display_name) return; // blank line
    const b = parseBirth(r[birth]);
    let alias = code >= 0 ? String(r[code] ?? "").trim() : "";
    if (!alias) alias = nextCode();
    used.add(alias.toLowerCase());
    const t = therapist >= 0 ? String(r[therapist] ?? "").trim() : "";
    out.push({
      line: headerAt + i + 2, alias: alias.slice(0, 40), display_name: display_name.slice(0, 40), birth_date: b.birth ?? "",
      sex: b.sex ?? (sex >= 0 ? sexOf(r[sex]) : null), therapist: t ? t.slice(0, 20) : null,
      error: !b.birth ? "생년월일을 읽지 못했어요" : b.birth > new Date().toISOString().slice(0, 10) ? "생년월일이 미래예요" : null,
    });
  });
  return { rows: out, missing: [] };
}
