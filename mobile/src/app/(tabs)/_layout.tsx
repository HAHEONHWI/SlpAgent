import { useState } from "react";
import { Pressable, Text, View, type ColorValue } from "react-native";
import { Tabs } from "expo-router/js-tabs";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SelectedChildButton } from "@/components/ChildPicker";
import { C, IconButton, Sheet, s } from "@/components/ui";
import { roleLabel, useMe } from "@/lib/me";

type Icon = keyof typeof Ionicons.glyphMap;
const icon = (on: Icon, off: Icon) => ({ color, focused }: { color: ColorValue; focused: boolean }) => <Ionicons name={focused ? on : off} size={23} color={color as string} />;

function Menu() {
  const router = useRouter();
  const me = useMe().data;
  const [open, setOpen] = useState(false);
  const go = (to: "/children" | "/account") => { setOpen(false); router.push(to); };
  const item = (label: string, ic: Icon, to: "/children" | "/account") => (
    <Pressable onPress={() => go(to)} style={({ pressed }) => [s.row, s.option, pressed && { backgroundColor: C.paper }]}>
      <Ionicons name={ic} size={22} color={C.ink} /><Text style={{ fontSize: 16, color: C.ink, flex: 1 }}>{label}</Text><Ionicons name="chevron-forward" size={18} color={C.muted} />
    </Pressable>);
  return (
    <>
      <IconButton icon="menu" label="메뉴" onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={me?.org_name ?? "메뉴"}>
        <Text style={{ color: C.sub, fontSize: 13 }}>{[me?.therapist_name ?? me?.email, roleLabel(me)].filter(Boolean).join(" · ")}</Text>
        {item("아동 관리", "people-outline", "/children")}
        {item("내 계정", "person-outline", "/account")}
      </Sheet>
    </>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: C.bg }, headerShadowVisible: false, headerTitleStyle: { fontWeight: "700", color: C.inkDark },
      headerLeft: () => <View style={{ marginLeft: 8 }}><Menu /></View>,
      headerRight: () => <SelectedChildButton />,
      tabBarActiveTintColor: C.accent, tabBarInactiveTintColor: C.sub,
      tabBarStyle: { backgroundColor: C.white, borderTopColor: C.line }, tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
      sceneStyle: { backgroundColor: C.bg },
    }}>
      <Tabs.Screen name="schedule" options={{ title: "일정", headerTitle: "일정 관리", tabBarIcon: icon("calendar", "calendar-outline") }} />
      <Tabs.Screen name="attendance" options={{ title: "출결", headerTitle: "출결 관리", tabBarIcon: icon("checkmark-done-circle", "checkmark-done-circle-outline") }} />
      <Tabs.Screen name="index" options={{ title: "녹음", headerTitle: "녹음으로 기록", tabBarIcon: ({ focused }) => (
        <View style={{ width: 46, height: 46, marginTop: -14, borderRadius: 99, backgroundColor: focused ? C.accent : C.ink, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: C.white }}>
          <Ionicons name="mic" size={24} color="#fff" />
        </View>) }} />
      <Tabs.Screen name="records" options={{ title: "기록", headerTitle: "수업 기록", tabBarIcon: icon("document-text", "document-text-outline") }} />
      <Tabs.Screen name="ai" options={{ title: "AI", headerTitle: "SLP AI", tabBarIcon: icon("sparkles", "sparkles-outline") }} />
    </Tabs>
  );
}
