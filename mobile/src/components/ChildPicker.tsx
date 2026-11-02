import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ageLabel, type Child } from "@/lib/api";
import { useChild } from "@/lib/child";
import { useMe } from "@/lib/me";
import { C, Empty, Field, Input, Sheet, s } from "./ui";

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
/** "가나다" -> "ㄱㄴㄷ" so typing initial consonants finds a child. */
const initials = (t: string) => [...t].map((ch) => { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch; }).join("");
const norm = (t: string) => t.replace(/\s/g, "").toLowerCase();

/** Children grouped like the web picker: my own first, then by teacher (가나다), unassigned last; filtered by name, code, 초성 or teacher. */
export function useChildSections(q: string) {
  const { children } = useChild();
  const me = useMe().data;
  const myName = (me?.therapist_name ?? me?.name ?? "").trim();
  return useMemo(() => {
    const k = norm(q);
    const hits = !k ? children : children.filter((c) => {
      const name = norm(c.display_name), code = norm(c.alias);
      return name.includes(k) || code.includes(k) || initials(name).includes(k) || norm(c.therapist ?? "").includes(k);
    });
    const teacher = (c: Child) => (c.therapist ?? "").trim();
    const group = (c: Child) => (myName && teacher(c) === myName ? "내 아동" : teacher(c) || "담당 없음");
    const rank = (g: string) => (g === "내 아동" ? 0 : g === "담당 없음" ? 2 : 1);
    const map = new Map<string, Child[]>();
    for (const c of hits) map.set(group(c), [...(map.get(group(c)) ?? []), c]);
    return [...map.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, "ko"))
      .map(([title, data]) => ({ title, data: data.sort((a, b) => a.display_name.localeCompare(b.display_name, "ko") || a.alias.localeCompare(b.alias)) }));
  }, [children, q, myName]);
}

export const ChildRow = ({ c, selected, onPress, big }: { c: Child; selected?: boolean; onPress: () => void; big?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={`${c.display_name} ${c.alias}`} onPress={onPress}
    style={({ pressed }) => [s.row, { paddingVertical: big ? 16 : 12, paddingHorizontal: 12, borderRadius: 14, backgroundColor: selected ? C.accentSoft : pressed ? C.paper : "transparent" }]}>
    <View style={{ width: big ? 44 : 34, height: big ? 44 : 34, borderRadius: 99, backgroundColor: selected ? C.accent : C.paper, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: selected ? "#fff" : C.ink, fontWeight: "700", fontSize: big ? 18 : 15 }}>{c.display_name[0]}</Text>
    </View>
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: big ? 18 : 16, fontWeight: "700", color: C.inkDark }}>{c.display_name}</Text>
      <Text style={{ fontSize: 13, color: C.sub }}>{[c.alias, ageLabel(c.age_months)].filter(Boolean).join(" · ")}</Text>
    </View>
    {selected && <Ionicons name="checkmark-circle" size={22} color={C.accent} />}
  </Pressable>
);

/** Searchable child list in a bottom sheet. */
export function ChildSheet({ visible, value, onPick, onClose, emptyLabel }: { visible: boolean; value: string | null; onPick: (id: string | null) => void; onClose: () => void; emptyLabel?: string }) {
  const [q, setQ] = useState("");
  const sections = useChildSections(q);
  const pick = (id: string | null) => { onPick(id); setQ(""); onClose(); };
  return (
    <Sheet visible={visible} onClose={onClose} title="아동 선택">
      <Input value={q} onChangeText={setQ} placeholder="이름·코드·초성 검색" autoCorrect={false} />
      {emptyLabel && !q && <Pressable onPress={() => pick(null)} style={[s.option, value === null && { backgroundColor: C.accentSoft }]}><Text style={{ fontWeight: "700", color: C.ink }}>{emptyLabel}</Text></Pressable>}
      {sections.map((sec) => (
        <View key={sec.title}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: C.sub, paddingHorizontal: 12, paddingTop: 10 }}>{sec.title}</Text>
          {sec.data.map((c) => <ChildRow key={c.id} c={c} selected={c.id === value} onPress={() => pick(c.id)} />)}
        </View>))}
      {!sections.length && <Empty>{q ? `‘${q}’에 맞는 아동이 없어요` : "등록된 아동이 없어요"}</Empty>}
    </Sheet>
  );
}

/** Form field that opens the child sheet. */
export function ChildPicker({ value, onChange, label = "아동", emptyLabel }: { value: string | null; onChange: (id: string | null) => void; label?: string; emptyLabel?: string }) {
  const { children } = useChild();
  const [open, setOpen] = useState(false);
  const c = children.find((x) => x.id === value);
  return (
    <Field label={label}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} 선택`} onPress={() => setOpen(true)} style={[s.field, s.row]}>
        <Text style={{ flex: 1, color: c ? C.ink : C.muted, fontSize: 15 }} numberOfLines={1}>{c ? `${c.display_name} · ${c.alias}` : emptyLabel ?? "아동 선택"}</Text>
        <Ionicons name="chevron-down" size={16} color={C.sub} />
      </Pressable>
      <ChildSheet visible={open} value={value} onPick={onChange} onClose={() => setOpen(false)} emptyLabel={emptyLabel} />
    </Field>
  );
}

/** The app-wide selected child (header pill), like the web top-bar picker. */
export function SelectedChildButton() {
  const { child, setChildId, childId } = useChild();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="아동 선택" onPress={() => setOpen(true)}
        style={[s.row, { backgroundColor: child ? C.accentSoft : C.paper, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, marginRight: 12, maxWidth: 190 }]}>
        <Ionicons name="person-circle-outline" size={18} color={child ? C.accent : C.sub} />
        <Text numberOfLines={1} style={{ color: C.ink, fontWeight: "700", fontSize: 14, flexShrink: 1 }}>{child ? child.display_name : "아동 선택"}</Text>
        <Ionicons name="chevron-down" size={14} color={C.sub} />
      </Pressable>
      <ChildSheet visible={open} value={childId} onPick={setChildId} onClose={() => setOpen(false)} emptyLabel="선택 안 함" />
    </>
  );
}

/** Child-scoped screens: a list to pick from when nothing is selected yet. */
export function RequireChild({ children }: { children: (childId: string) => React.ReactNode }) {
  const { childId, child, setChildId } = useChild();
  const sections = useChildSections("");
  if (childId && child) return <>{children(childId)}</>;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: C.inkDark }}>아동을 먼저 선택하세요</Text>
      <Text style={{ fontSize: 13, color: C.sub }}>이 화면은 선택한 아동을 기준으로 동작해요. 위쪽 아동 버튼에서도 바꿀 수 있어요.</Text>
      {sections.map((sec) => (
        <View key={sec.title}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: C.sub, paddingHorizontal: 12, paddingTop: 10 }}>{sec.title}</Text>
          {sec.data.map((c) => <ChildRow key={c.id} c={c} onPress={() => setChildId(c.id)} />)}
        </View>))}
      {!sections.length && <Empty>등록된 아동이 없어요. 아동 관리에서 먼저 등록하세요.</Empty>}
    </View>
  );
}
