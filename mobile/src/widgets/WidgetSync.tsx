import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { clearScheduleWidgets, invalidateWidgetRequests, refreshScheduleWidgets } from "./task";

/** Foreground changes update both sizes; Android also refreshes them while the app is closed. */
export function WidgetSync({ identity }: { identity: string | null }) {
  const qc = useQueryClient();
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = (error: unknown) => { if (error instanceof Error) console.warn("Schedule widget update failed", error.name); else throw error; };
    if (!identity) { void clearScheduleWidgets().catch(report); return; }
    invalidateWidgetRequests();
    const refresh = () => { void refreshScheduleWidgets().catch(report); };
    const queue = () => { clearTimeout(timer); timer = setTimeout(refresh, 300); };
    refresh();
    const app = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    const unsubscribe = qc.getQueryCache().subscribe(event => {
      if (event.type === "updated" && event.action.type === "invalidate" &&
        ["schedules", "month-sheet", "timetable", "attendance", "children", "holidays"].includes(String(event.query.queryKey[0]))) queue();
    });
    return () => { clearTimeout(timer); app.remove(); unsubscribe(); invalidateWidgetRequests(); };
  }, [identity, qc]);
  return null;
}
