import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import * as model from "../src/widgets/model.ts";

test("a delayed update from the previous session cannot overwrite a freshly refreshed widget", async () => {
  // Given: the native bridge is unavailable in Node; control its asynchronous completion order.
  const require = createRequire(import.meta.url);
  const arrived = Array.from({ length: 3 }, () => Promise.withResolvers());
  const writes = [];
  let requests = 0;
  const info = { widgetName: "ScheduleCompact", widgetId: 1, width: 320, height: 180 };
  const native = {
    getWidgetInfo: async name => name === info.widgetName ? [info] : [],
    requestWidgetUpdateById: async ({ renderWidget }) => {
      const gate = Promise.withResolvers();
      arrived[requests++].resolve(gate);
      await gate.promise;
      writes.push(renderWidget(info).props.state);
    },
  };
  const api = async path => {
    if (path === "/me") return { status: "active", org_id: "test-org", therapist_name: "가상 교사" };
    if (path === "/children") return [{ id: "c1", display_name: "가상아동" }];
    return [{ id: "s1", child_id: "c1", date: "2026-11-10", start: "09:00", end: "09:40", therapist: "가상 교사", status: "scheduled" }];
  };
  const source = readFileSync(new URL("../src/widgets/task.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const load = name => {
    switch (name) {
      case "react-native": return { Platform: { OS: "android" } };
      case "react-native-android-widget": return native;
      case "../lib/api": return { api, ApiError: class extends Error {} };
      case "../lib/auth": return { getSessionUser: async () => ({ uid: "qa-user" }) };
      case "../lib/dates": return { today: () => "2026-11-10", toTime: () => "08:35" };
      case "./ScheduleWidget": return { ScheduleWidget: () => null };
      case "./model": return model;
      default: return require(name);
    }
  };
  new Function("require", "module", "exports", compiled)(load, module, module.exports);
  const service = module.exports;

  // When: logout clears the widget, a new refresh succeeds, then the old bridge call completes last.
  const old = service.refreshScheduleWidgets();
  const oldGate = await arrived[0].promise;
  const clear = service.clearScheduleWidgets();
  const clearGate = await arrived[1].promise;
  const fresh = service.refreshScheduleWidgets();
  const freshGate = await arrived[2].promise;
  clearGate.resolve();
  await clear;
  freshGate.resolve();
  await fresh;
  oldGate.resolve();
  await old;

  // Then: only the clear and current-session refresh reach the home-screen widget.
  assert.equal(writes.length, 2);
  assert.equal(writes.at(-1).kind, "ready");
  assert.equal(writes.at(-1).rows[0].name, "가상아동");
});
