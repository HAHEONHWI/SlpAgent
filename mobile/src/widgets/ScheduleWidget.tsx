"use no memo";
import { FlexWidget, ListWidget, TextWidget, type FlexWidgetStyle, type WidgetInfo } from "react-native-android-widget";
import { scheduleUri, upcomingClasses, type WidgetClass, type WidgetState } from "./model";

const C = { ink: "#202124", sub: "#626973", line: "#E9EBEE", accent: "#A93B20", soft: "#FFF4EF", white: "#FFFFFF" } as const;
const rowStyle: FlexWidgetStyle = { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "match_parent" };
const dateLabel = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 (${"일월화수목금토"[new Date(`${date}T12:00:00`).getDay()]})`;
const open = (date: string, id?: string) => ({ clickAction: "OPEN_URI", clickActionData: { uri: scheduleUri(date, id) } });

function ClassRow({ item, date, next, now }: { item: WidgetClass; date: string; next: boolean; now: string }) {
  return <FlexWidget {...open(date, item.id)} accessibilityLabel={`${dateLabel(date)} ${item.start}–${item.end} ${item.name} 수업 열기`} style={{ ...rowStyle, paddingHorizontal: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: next ? C.soft : C.white, borderBottomWidth: next ? 0 : 1, borderColor: C.line }}>
    <TextWidget text={`${item.start}–${item.end}`} style={{ fontSize: 14, color: next ? C.accent : C.ink, fontWeight: next ? "bold" : "normal" }} />
    {next && <TextWidget text={item.start <= now ? "진행 중" : "다음"} style={{ fontSize: 11, color: C.accent, marginHorizontal: 4 }} />}
    <TextWidget text={item.name} maxLines={1} truncate="END" style={{ fontSize: 15, color: C.ink, fontWeight: next ? "bold" : "normal" }} />
  </FlexWidget>;
}

export function ScheduleWidget({ state, info }: { state: WidgetState; info: Pick<WidgetInfo, "widgetName" | "width" | "height"> }) {
  const compact = info.widgetName === "ScheduleCompact";
  const short = compact && info.height < 200;
  const ready = state.kind === "ready" ? state : null;
  const upcoming = ready ? upcomingClasses(ready.rows, ready.updatedAt) : [];
  const next = upcoming[0];
  const label = state.kind === "message" ? state.message : `${dateLabel(state.date)} 오늘 일정 ${state.rows.length}개${next ? `, 다음 수업 ${next.start}–${next.end} ${next.name}` : ""}, 일정 열기`;
  return <FlexWidget {...open(state.date)} accessibilityLabel={label} style={{ width: "match_parent", height: "match_parent", backgroundColor: C.white, borderRadius: 24, padding: 14 }}>
    <FlexWidget style={rowStyle}>
      <TextWidget text={short ? dateLabel(state.date) : compact ? "SLP AI" : "오늘 일정"} style={{ fontSize: short ? 16 : 18, fontWeight: "bold", color: C.ink }} />
      <TextWidget text="새로고침" clickAction="REFRESH" accessibilityLabel="일정 새로고침" style={{ paddingVertical: 15, paddingLeft: 10, fontSize: 12, color: C.sub }} />
    </FlexWidget>
    {!short && <FlexWidget style={{ ...rowStyle, marginBottom: 8 }}>
      <TextWidget text={dateLabel(state.date)} style={{ fontSize: 12, color: C.sub }} />
      {ready && <TextWidget text={`오늘 ${ready.rows.length}개`} style={{ fontSize: 12, color: C.sub }} />}
    </FlexWidget>}
    {state.kind === "message" ? <FlexWidget style={{ flex: 1, width: "match_parent", justifyContent: "center" }}><TextWidget text={state.message} style={{ fontSize: 14, color: C.sub }} /></FlexWidget>
      : compact ? <FlexWidget style={{ flex: 1, width: "match_parent", justifyContent: "center" }}>
        {next ? <FlexWidget {...open(state.date, next.id)} accessibilityLabel={`${next.start}–${next.end} ${next.name} 수업 열기`} style={{ backgroundColor: C.soft, borderRadius: 14, padding: short ? 8 : 10, width: "match_parent" }}>
          <TextWidget text={next.start <= state.updatedAt ? "진행 중" : "다음 수업"} style={{ fontSize: 12, color: C.accent }} />
          <FlexWidget style={{ ...rowStyle, marginTop: 4 }}>
            <TextWidget text={`${next.start}–${next.end}`} style={{ fontSize: info.width < 300 ? 18 : 22, fontWeight: "bold", color: C.ink }} />
            <TextWidget text={next.name} style={{ fontSize: 16, color: C.ink }} />
          </FlexWidget>
        </FlexWidget> : <TextWidget text={state.rows.length ? "오늘 수업을 모두 마쳤어요" : "오늘 수업이 없어요"} style={{ fontSize: 15, color: C.sub }} />}
        {!short && upcoming[1] && <TextWidget text={`이후 ${upcoming[1].start}  ${upcoming[1].name}`} style={{ marginTop: 8, fontSize: 12, color: C.sub }} />}
      </FlexWidget> : state.rows.length ? <ListWidget style={{ width: "match_parent", height: Math.max(48, info.height - 134) }}>
        {state.rows.map(item => <ClassRow key={item.id} item={item} date={state.date} next={item.id === next?.id} now={state.updatedAt} />)}
      </ListWidget> : <FlexWidget style={{ flex: 1, justifyContent: "center" }}><TextWidget text="오늘 수업이 없어요" style={{ fontSize: 15, color: C.sub }} /></FlexWidget>}
    {ready && <FlexWidget {...open(state.date)} accessibilityLabel={`${dateLabel(state.date)} 날짜별 일정 열기`} style={{ ...rowStyle, marginTop: 8 }}>
      <TextWidget text={`${short ? `오늘 ${ready.rows.length}개 · ` : ""}${ready.updatedAt} 기준`} style={{ fontSize: 11, color: C.sub }} />
      <TextWidget text="일정 열기 ›" style={{ fontSize: 12, color: C.sub }} />
    </FlexWidget>}
  </FlexWidget>;
}
