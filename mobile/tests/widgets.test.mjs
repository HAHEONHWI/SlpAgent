import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleUri, upcomingClasses, widgetClasses, WidgetDataError } from "../src/widgets/model.ts";

const date = "2026-11-10";
const base = { id: "s1", child_id: "c1", date, start: "09:00", end: "09:40", therapist: "가상 교사", status: "scheduled" };
const kids = [{ id: "c1", display_name: "가상아동" }, { id: "c2", display_name: "예시아동" }];

test("today's widget excludes other therapists, other dates, moved, cancelled and inaccessible children", () => {
  // Given
  const schedules = [base, { ...base, id: "s2", start: "08:00", end: "08:40", therapist: "다른 교사" },
    { ...base, id: "s3", date: "2026-11-11" }, { ...base, id: "s4", status: "moved" },
    { ...base, id: "s5", status: "cancelled" }, { ...base, id: "s6", child_id: "hidden" },
    { ...base, id: "s7", child_id: "c2", start: "08:00", end: "08:40" }];
  // When
  const rows = widgetClasses({ schedules, children: kids, date, therapist: "가상 교사" });
  // Then
  assert.deepEqual(rows.map(row => row.id), ["s7", "s1"]);
  assert.deepEqual(rows.map(row => row.name), ["예시아동", "가상아동"]);
  assert.equal(JSON.stringify(rows).includes("child_id"), false);
});

test("ongoing class remains next until its actual end, then advances", () => {
  // Given
  const rows = widgetClasses({ schedules: [base, { ...base, id: "s2", start: "09:50", end: "10:30" }], children: kids, date, therapist: "가상 교사" });
  // When / Then
  assert.deepEqual(upcomingClasses(rows, "09:20").map(row => row.id), ["s1", "s2"]);
  assert.deepEqual(upcomingClasses(rows, "09:40").map(row => row.id), ["s2"]);
  assert.deepEqual(upcomingClasses(rows, "10:30"), []);
});

test("bad input and invalid intervals never reach the widget", () => {
  // Given / When / Then
  assert.throws(() => widgetClasses({ schedules: {}, children: kids, date, therapist: "가상 교사" }), WidgetDataError);
  const rows = widgetClasses({ schedules: [null, { ...base, start: "25:00" }, { ...base, end: "08:00" }, base], children: kids, date, therapist: "가상 교사" });
  assert.equal(rows.length, 1);
});

test("widgets preserve complete display names, including single-character names, and handle blanks", () => {
  const children = [
    { id: "c1", display_name: " 김가상 ", alias: "private alias", notes: "private note" },
    { id: "c2", display_name: "김" },
    { id: "c3", display_name: " 가상 테스트 아동 " },
    { id: "c4", display_name: "   " },
  ];
  const rows = widgetClasses({ schedules: children.map((c, i) => ({ ...base, id: `s${i}`, child_id: c.id })), children, date, therapist: "가상 교사" });
  assert.deepEqual(rows.map(row => row.name), ["김가상", "김", "가상 테스트 아동", "아동"]);
  assert.equal(JSON.stringify(rows).includes("private"), false);
});

test("widget links preserve the date and encode the selected class identifier", () => {
  const link = new URL(scheduleUri(date, "s/가상?"));
  assert.equal(link.hostname, "schedule");
  assert.equal(link.searchParams.get("view"), "dated");
  assert.equal(link.searchParams.get("date"), date);
  assert.equal(link.searchParams.get("scheduleId"), "s/가상?");
});
