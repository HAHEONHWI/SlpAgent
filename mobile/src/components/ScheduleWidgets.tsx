import { useState } from "react";
import { Platform } from "react-native";
import { requestPinWidget } from "react-native-android-widget";
import type { WidgetName } from "@/widgets/model";
import { Button, Card, Notice, T } from "./ui";

export function ScheduleWidgets() {
  const [error, setError] = useState("");
  if (Platform.OS !== "android") return null;
  const add = async (widgetName: WidgetName) => {
    setError("");
    try {
      if (!await requestPinWidget({ widgetName })) setError("홈 화면을 길게 누른 뒤 위젯 › SLP AI에서 추가해 주세요.");
    } catch (e) {
      if (e instanceof Error) setError("위젯을 추가하지 못했어요. 홈 화면의 위젯 목록에서 SLP AI를 골라 주세요.");
      else throw e;
    }
  };
  return <Card title="홈 화면 일정 위젯">
    <T small muted>본인의 오늘 수업과 아동 이름 전체를 표시해요. 수업을 누르면 앱의 날짜별 일정이 열려요.</T>
    <Button variant="outline" title="다음 수업 위젯 추가 (4×2)" icon="time-outline" onPress={() => add("ScheduleCompact")} />
    <Button variant="outline" title="오늘 일정 위젯 추가 (4×4)" icon="calendar-outline" onPress={() => add("ScheduleAgenda")} />
    <T small muted>자동 갱신은 약 30분 간격이에요. 즉시 반영하려면 위젯의 새로고침을 눌러 주세요. Android 절전 상태에서는 늦어질 수 있어요.</T>
    {!!error && <Notice tone="red">{error}</Notice>}
  </Card>;
}
