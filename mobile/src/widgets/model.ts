export const WIDGET_NAMES = ["ScheduleCompact", "ScheduleAgenda"] as const;
export type WidgetName = typeof WIDGET_NAMES[number];
export type WidgetClass = { readonly id: string; readonly start: string; readonly end: string; readonly name: string };
export type WidgetState =
  | { readonly kind: "ready"; readonly date: string; readonly updatedAt: string; readonly rows: readonly WidgetClass[] }
  | { readonly kind: "message"; readonly date: string; readonly message: string };
type Schedule = { readonly id: string; readonly child_id: string; readonly date: string; readonly start: string; readonly end: string; readonly status: string; readonly therapist: string };
type Child = { readonly id: string; readonly display_name: string };

export class WidgetDataError extends Error {}
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const time = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const schedule = (v: unknown): v is Schedule => record(v) && typeof v.id === "string" && typeof v.child_id === "string" &&
  typeof v.date === "string" && time(v.start) && time(v.end) && v.end > v.start && typeof v.status === "string" &&
  (typeof v.therapist === "string");
const child = (v: unknown): v is Child => record(v) && typeof v.id === "string" && typeof v.display_name === "string";

/** Only today's assigned classes and child display names cross into the home screen, never notes or aliases. */
export function widgetClasses(input: { readonly schedules: unknown; readonly children: unknown; readonly date: string; readonly therapist: string }): readonly WidgetClass[] {
  if (!Array.isArray(input.schedules) || !Array.isArray(input.children) || !input.children.every(child)) throw new WidgetDataError("Invalid widget response");
  const children = new Map(input.children.map(c => [c.id, c.display_name]));
  return input.schedules.filter(schedule).filter(s => s.date === input.date && s.status === "scheduled" &&
    s.therapist.trim() === input.therapist && children.has(s.child_id))
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .map(s => ({ id: s.id, start: s.start, end: s.end, name: children.get(s.child_id)?.trim() || "아동" }));
}

export const upcomingClasses = (rows: readonly WidgetClass[], now: string) => rows.filter(row => row.end > now);
export const scheduleUri = (date: string, id?: string) => `slpai://schedule?view=dated&date=${encodeURIComponent(date)}${id ? `&scheduleId=${encodeURIComponent(id)}` : ""}`;
