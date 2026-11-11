import { Platform } from "react-native";
import { getWidgetInfo, requestWidgetUpdateById, type WidgetInfo, type WidgetTaskHandlerProps } from "react-native-android-widget";
import { ApiError, api } from "../lib/api";
import { getSessionUser } from "../lib/auth";
import { today, toTime } from "../lib/dates";
import type { Me } from "../lib/me";
import { ScheduleWidget } from "./ScheduleWidget";
import { WIDGET_NAMES, WidgetDataError, widgetClasses, type WidgetState } from "./model";

let generation = 0;
class WidgetUpdateSuperseded extends Error {}
const message = (text: string): WidgetState => ({ kind: "message", date: today(), message: text });
const signedOut = () => message("앱에서 로그인해 주세요");
export const invalidateWidgetRequests = () => { generation += 1; };

async function loadState(): Promise<WidgetState> {
  const day = today();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);
  try {
    const user = await getSessionUser();
    if (!user) return signedOut();
    const me = await api<Me>("/me", { signal: controller.signal });
    if (me.status !== "active" || !me.org_id) return message("기관 가입 상태를 앱에서 확인해 주세요");
    const therapist = (me.therapist_name ?? me.name ?? "").trim();
    if (!therapist) return message("기관 관리자에게 치료사 이름 연결을 요청해 주세요");
    const [schedules, children] = await Promise.all([
      api<unknown>(`/schedules?month=${day.slice(0, 7)}`, { signal: controller.signal }),
      api<unknown>("/children", { signal: controller.signal }),
    ]);
    if ((await getSessionUser())?.uid !== user.uid) return signedOut();
    if (today() !== day) return message("날짜가 바뀌었어요. 새로고침해 주세요");
    return { kind: "ready", date: day, updatedAt: toTime(new Date()), rows: widgetClasses({ schedules, children, date: day, therapist }) };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return message("로그인·기관 권한을 앱에서 확인해 주세요");
    if (error instanceof WidgetDataError) return message("일정을 읽지 못했어요. 앱에서 확인해 주세요");
    if (error instanceof Error) return message("연결을 확인하고 새로고침해 주세요");
    throw error;
  } finally { clearTimeout(timeout); }
}

const installed = async () => (await Promise.all(WIDGET_NAMES.map(name => getWidgetInfo(name)))).flat();
async function publish(infos: readonly WidgetInfo[], state: WidgetState, version: number) {
  if (version !== generation) return;
  await Promise.all(infos.map(async info => {
    try {
      await requestWidgetUpdateById({
        widgetName: info.widgetName, widgetId: info.widgetId,
        renderWidget: current => {
          // The SDK awaits native lookup before rendering; cancel instead of overwriting a newer session.
          if (version !== generation) throw new WidgetUpdateSuperseded();
          return <ScheduleWidget info={current} state={state} />;
        },
      });
    } catch (error) {
      if (error instanceof WidgetUpdateSuperseded) return;
      throw error;
    }
  }));
}

export async function clearScheduleWidgets() {
  invalidateWidgetRequests();
  const version = generation;
  if (Platform.OS === "android") await publish(await installed(), signedOut(), version);
}

export async function refreshScheduleWidgets() {
  if (Platform.OS !== "android") return;
  const version = generation;
  const infos = await installed();
  if (!infos.length) return;
  await publish(infos, await loadState(), version);
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === "WIDGET_DELETED") return;
  const version = generation;
  props.renderWidget(<ScheduleWidget info={props.widgetInfo} state={message("일정을 불러오는 중…")} />);
  const state = await loadState();
  if (version === generation) props.renderWidget(<ScheduleWidget info={props.widgetInfo} state={state} />);
}
