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

export type Field = "name" | "birth" | "code" | "therapist" | "sex";
export type Mapping = Record<Field, number>; // column index, -1 = not used
export const FIELD_LABEL: Record<Field, string> = { name: "이름", birth: "생년월일", code: "아이코드", therapist: "담당 치료사", sex: "성별" };

/** Find the header row and guess which column holds what; the user can correct the guess. */
export function detect(rows: unknown[][]): { headerAt: number; head: string[]; map: Mapping } | null {
  const headerAt = rows.slice(0, 10).findIndex((r) => r.some((c) => COLUMNS.name.test(String(c ?? "").trim())));
  if (headerAt < 0) return null;
  const head = rows[headerAt].map((c) => String(c ?? "").trim());
  const taken: number[] = [];
  const col = (re: RegExp) => { const i = head.findIndex((h, j) => !taken.includes(j) && re.test(h)); if (i >= 0) taken.push(i); return i; };
  // most specific first, so "아이코드" is never mistaken for the name or birth column and vice versa
  const name = col(COLUMNS.name), birth = col(COLUMNS.birth), therapist = col(COLUMNS.therapist), sex = col(COLUMNS.sex), code = col(COLUMNS.code);
  return { headerAt, head, map: { name, birth, code, therapist, sex } };
}

export function toChildren(rows: unknown[][], headerAt: number, map: Mapping, existingCodes: string[]): ImportRow[] {
  const used = new Set(existingCodes.map((c) => c.trim().toLowerCase()));
  let auto = 1;
  // Placeholder codes start with "임시" so they are never confused with the clinic's own codes (D-01, B-01, ...).
  const nextCode = () => { while (used.has(`임시-${String(auto).padStart(3, "0")}`)) auto++; return `임시-${String(auto++).padStart(3, "0")}`; };
  const cell = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  const out: ImportRow[] = [];
  rows.slice(headerAt + 1).forEach((r, i) => {
    const display_name = cell(r, map.name);
    if (!display_name) return; // blank line
    const b = parseBirth(map.birth >= 0 ? r[map.birth] : "");
    let alias = cell(r, map.code);
    if (!alias) alias = nextCode();
    used.add(alias.toLowerCase());
    const t = cell(r, map.therapist);
    out.push({
      line: headerAt + i + 2, alias: alias.slice(0, 40), display_name: display_name.slice(0, 40), birth_date: b.birth ?? "",
      sex: b.sex ?? (map.sex >= 0 ? sexOf(r[map.sex]) : null), therapist: t ? t.slice(0, 20) : null,
      error: !b.birth ? "생년월일을 읽지 못했어요" : b.birth > new Date().toISOString().slice(0, 10) ? "생년월일이 미래예요" : null,
    });
  });
  return out;
}
