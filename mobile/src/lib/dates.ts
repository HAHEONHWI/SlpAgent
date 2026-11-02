// Local-calendar date helpers. Dates travel as "YYYY-MM-DD", months as "YYYY-MM", times as "HH:MM".
const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const parse = (s: string) => new Date(s + "T00:00:00");
export const plusDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const plusMonths = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const monday = (s: string) => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const DOW = "일월화수목금토";
export const dow = (s: string) => DOW[parse(s).getDay()];
export const dayLabel = (s: string) => `${Number(s.slice(0, 4))}. ${Number(s.slice(5, 7))}. ${Number(s.slice(8, 10))}. (${dow(s)})`;
export const monthLabel = (m: string) => `${Number(m.slice(0, 4))}년 ${Number(m.slice(5, 7))}월`;
/** "14:30" -> "2:30" (12-hour without am/pm, like the paper timetable). */
export const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return `${h > 12 ? h - 12 : h}:${pad(m)}`; };
export const plusMinutes = (s: string, min: number) => { const [h, m] = s.split(":").map(Number); const t = h * 60 + m + min; return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`; };
export const toTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const clock = (ms: number) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); return `${h ? `${h}:` : ""}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };
