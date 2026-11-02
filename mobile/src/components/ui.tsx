import { useState, type ReactNode } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { iso, monthLabel, parse, plusDays, plusMonths, dayLabel, toTime } from "@/lib/dates";
import { errText } from "@/lib/api";

// Same palette as the web app (frontend/src/index.css): warm paper ground, terracotta accent.
export const C = {
  white: "#fffdf9", bg: "#fcf8f2", paper: "#f6eee4", line: "#ece2d5", border: "#ddcfbf", muted: "#a8998b", sub: "#7f7064", text2: "#6b5c50", ink: "#4a3d35", inkDark: "#2e2520",
  accent: "#c85a36", accentDark: "#a93b20", accentSoft: "#fdeee6", accentLine: "#f9dccd",
  amberBg: "#fbefd6", amberText: "#744e1d", greenBg: "#e6f1e4", greenText: "#2f6b33", redBg: "#fdecea", redText: "#a1271b", red: "#c0392b", slateBg: "#ece2d5", slateText: "#4f4239",
};
export type Tone = "slate" | "amber" | "green" | "red" | "indigo";
const TONE: Record<Tone, [string, string]> = { slate: [C.slateBg, C.slateText], amber: [C.amberBg, C.amberText], green: [C.greenBg, C.greenText], red: [C.redBg, C.redText], indigo: [C.accentSoft, C.accentDark] };

/** A scrolling screen body with pull-to-refresh. */
export function Screen({ children, onRefresh, refreshing = false, style }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[{ padding: 16, paddingBottom: 48, gap: 14 }, style]} keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.accent]} /> : undefined}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export const T = ({ children, style, muted, small, bold, numberOfLines, selectable }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; small?: boolean; bold?: boolean; numberOfLines?: number; selectable?: boolean }) =>
  <Text numberOfLines={numberOfLines} selectable={selectable} style={[{ color: muted ? C.sub : C.ink, fontSize: small ? 12 : 15, lineHeight: small ? 17 : 22 }, bold && { fontWeight: "700" }, style]}>{children}</Text>;

export const H = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <View style={{ gap: 4 }}>
    <Text style={{ fontSize: 20, fontWeight: "700", color: C.inkDark }}>{children}</Text>
    {sub ? <T small muted>{sub}</T> : null}
  </View>
);

export function Button({ title, onPress, variant = "primary", disabled, loading, icon, small, style }: {
  title: string; onPress?: () => void; variant?: "primary" | "outline" | "ghost" | "danger" | "ink"; disabled?: boolean; loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap; small?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const bg = { primary: C.accent, outline: "transparent", ghost: "transparent", danger: C.red, ink: C.ink }[variant];
  const fg = variant === "outline" || variant === "ghost" ? C.ink : "#fff";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        variant === "outline" && { borderWidth: 1, borderColor: C.border }, style]}>
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Ionicons name={icon} size={small ? 14 : 17} color={fg} /> : null}
      {!!title && <Text style={{ color: fg, fontWeight: "700", fontSize: small ? 13 : 15 }}>{title}</Text>}
    </Pressable>
  );
}
export const IconButton = ({ icon, onPress, label, color = C.ink, disabled }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string; color?: string; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ padding: 6, borderRadius: 99, opacity: disabled ? 0.4 : pressed ? 0.5 : 1 })}>
    <Ionicons name={icon} size={20} color={color} />
  </Pressable>
);

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <View style={{ gap: 6 }}>
    <Text style={{ fontSize: 13, color: C.text2 }}>{label}</Text>
    {children}
    {hint ? <T small muted>{hint}</T> : null}
  </View>
);
export const Input = (p: TextInputProps) => (
  <TextInput placeholderTextColor={C.muted} {...p}
    style={[s.field, p.multiline && { minHeight: 92, textAlignVertical: "top", paddingTop: 10 }, p.editable === false && { opacity: 0.6 }, p.style]} />
);
export const TextField = ({ label, hint, ...p }: TextInputProps & { label: string; hint?: string }) => <Field label={label} hint={hint}><Input {...p} /></Field>;

export function Select<V extends string>({ value, options, onChange, placeholder = "선택", disabled, label, title }: {
  value: V | ""; options: [V, string][]; onChange: (v: V) => void; placeholder?: string; disabled?: boolean; label?: string; title?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(([v]) => v === value)?.[1];
  const box = (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={label ?? title ?? placeholder} disabled={disabled} onPress={() => setOpen(true)} style={[s.field, s.row, disabled && { opacity: 0.6 }]}>
        <Text style={{ flex: 1, color: current ? C.ink : C.muted, fontSize: 15 }} numberOfLines={1}>{current ?? placeholder}</Text>
        <Ionicons name="chevron-down" size={16} color={C.sub} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={title ?? label ?? placeholder}>
        {options.map(([v, l]) => (
          <Pressable key={v || "_"} onPress={() => { onChange(v); setOpen(false); }} style={({ pressed }) => [s.option, v === value && { backgroundColor: C.accentSoft }, pressed && { backgroundColor: C.paper }]}>
            <Text style={{ fontSize: 16, color: C.ink, fontWeight: v === value ? "700" : "400" }}>{l}</Text>
          </Pressable>))}
      </Sheet>
    </>
  );
  return label ? <Field label={label}>{box}</Field> : box;
}

/** Date or time field: the Android system picker; `optional` adds a clear button. */
export function DateField({ label, value, onChange, mode = "date", optional, placeholder }: {
  label?: string; value: string; onChange: (v: string) => void; mode?: "date" | "time"; optional?: boolean; placeholder?: string;
}) {
  const [iosOpen, setIosOpen] = useState(false);
  const asDate = () => (mode === "date" ? (value ? parse(value) : new Date()) : (() => { const d = new Date(); if (value) { const [h, m] = value.split(":").map(Number); d.setHours(h, m, 0, 0); } return d; })());
  const apply = (e: DateTimePickerEvent, d?: Date) => { if (e.type === "set" && d) onChange(mode === "date" ? iso(d) : toTime(d)); };
  const open = () => Platform.OS === "android"
    ? DateTimePickerAndroid.open({ value: asDate(), mode, is24Hour: true, onChange: apply })
    : setIosOpen(true);
  const shown = !value ? (placeholder ?? (mode === "date" ? "날짜 선택" : "시간 선택")) : mode === "date" ? dayLabel(value) : value;
  const box = (
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={label ?? shown} onPress={open} style={[s.field, s.row, { flex: 1 }]}>
        <Ionicons name={mode === "date" ? "calendar-outline" : "time-outline"} size={16} color={C.sub} />
        <Text style={{ color: value ? C.ink : C.muted, fontSize: 15 }}>{shown}</Text>
      </Pressable>
      {optional && !!value && <IconButton icon="close-circle" label="지우기" color={C.muted} onPress={() => onChange("")} />}
      {iosOpen && (
        <Sheet visible onClose={() => setIosOpen(false)} title={label ?? ""}>
          <DateTimePicker value={asDate()} mode={mode} display="spinner" onChange={(e, d) => d && onChange(mode === "date" ? iso(d) : toTime(d))} />
          <Button title="확인" onPress={() => setIosOpen(false)} />
        </Sheet>)}
    </View>
  );
  return label ? <Field label={label}>{box}</Field> : box;
}

/** ‹ 2026년 11월 › */
export const MonthNav = ({ value, onChange }: { value: string; onChange: (m: string) => void }) => (
  <View style={[s.row, { justifyContent: "space-between" }]}>
    <IconButton icon="chevron-back" label="이전 달" onPress={() => onChange(plusMonths(value, -1))} />
    <Text style={{ fontSize: 17, fontWeight: "700", color: C.inkDark }}>{monthLabel(value)}</Text>
    <IconButton icon="chevron-forward" label="다음 달" onPress={() => onChange(plusMonths(value, 1))} />
  </View>
);
/** ‹ 2026. 11. 2. (월) › — tap the date to pick any day. */
export const DayNav = ({ value, onChange }: { value: string; onChange: (d: string) => void }) => (
  <View style={[s.row, { justifyContent: "space-between" }]}>
    <IconButton icon="chevron-back" label="전날" onPress={() => onChange(plusDays(value, -1))} />
    <Pressable onPress={() => DateTimePickerAndroid.open({ value: parse(value), mode: "date", onChange: (e, d) => e.type === "set" && d && onChange(iso(d)) })}>
      <Text style={{ fontSize: 17, fontWeight: "700", color: C.inkDark }}>{dayLabel(value)}</Text>
    </Pressable>
    <IconButton icon="chevron-forward" label="다음날" onPress={() => onChange(plusDays(value, 1))} />
  </View>
);

export const Checkbox = ({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) => (
  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => onChange(!checked)}
    style={[s.row, { alignItems: "flex-start", opacity: disabled ? 0.5 : 1 }]}>
    <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={checked ? C.accent : C.sub} />
    <View style={{ flex: 1 }}>{typeof label === "string" ? <T>{label}</T> : label}</View>
  </Pressable>
);

/** Pill segmented choice; the chosen option fills with the accent (or ink, via `tone`). */
export function Segmented<V extends string>({ value, onChange, items, tone, disabled }: { value: V | ""; onChange: (v: V) => void; items: [V, string][]; tone?: (v: V) => "accent" | "ink"; disabled?: boolean }) {
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", borderWidth: 1, borderColor: C.border, borderRadius: 99, overflow: "hidden", alignSelf: "flex-start" }}>
      {items.map(([v, l], i) => {
        const on = v === value;
        return (
          <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: on }} disabled={disabled} onPress={() => onChange(v)}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderLeftWidth: i ? 1 : 0, borderColor: C.border, opacity: disabled ? 0.45 : 1,
              backgroundColor: on ? (tone?.(v) === "ink" ? C.ink : C.accent) : "transparent" }}>
            <Text style={{ color: on ? "#fff" : C.ink, fontSize: 14, fontWeight: on ? "700" : "400" }}>{l}</Text>
          </Pressable>);
      })}
    </View>
  );
}

/** Screen-level tabs with an accent underline, scrolling sideways when they don't fit. */
export function Tabs<V extends string>({ value, onChange, items }: { value: V; onChange: (v: V) => void; items: [V, string][] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, borderBottomWidth: 1, borderColor: C.line, backgroundColor: C.bg }}>
      {items.map(([v, l]) => (
        <Pressable key={v} accessibilityRole="tab" accessibilityState={{ selected: v === value }} onPress={() => onChange(v)}
          style={{ paddingHorizontal: 16, height: 46, justifyContent: "center", borderBottomWidth: 3, borderColor: v === value ? C.accent : "transparent" }}>
          <Text style={{ fontWeight: "700", fontSize: 15, color: v === value ? C.accent : C.ink }}>{l}</Text>
        </Pressable>))}
    </ScrollView>
  );
}

export const Card = ({ title, action, children, style }: { title?: ReactNode; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[s.card, style]}>
    {(title || action) ? (
      <View style={[s.row, { justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.line }]}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: C.inkDark, flexShrink: 1 }}>{title}</Text>{action}
      </View>) : null}
    <View style={{ padding: 16, gap: 12 }}>{children}</View>
  </View>
);
export const Badge = ({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) => (
  <View style={{ backgroundColor: TONE[tone][0], borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start" }}>
    <Text style={{ color: TONE[tone][1], fontSize: 12, fontWeight: "600" }}>{children}</Text>
  </View>
);
export const Notice = ({ tone = "amber", children }: { tone?: "amber" | "red" | "green"; children: ReactNode }) => (
  <View style={{ borderRadius: 14, padding: 12, backgroundColor: tone === "red" ? C.redBg : tone === "green" ? C.greenBg : C.accentSoft }}>
    {typeof children === "string" ? <Text style={{ color: tone === "red" ? C.redText : tone === "green" ? C.greenText : C.ink, fontSize: 14, lineHeight: 20 }}>{children}</Text> : children}
  </View>
);
export const ErrorNotice = ({ error }: { error: unknown }) => (error ? <Notice tone="red">{errText(error)}</Notice> : null);
export const Empty = ({ children }: { children: ReactNode }) => <Text style={{ textAlign: "center", color: C.muted, paddingVertical: 28, fontSize: 14 }}>{children}</Text>;
export const Loading = ({ label = "불러오는 중…" }: { label?: string }) => (
  <View style={[s.row, { justifyContent: "center", paddingVertical: 24 }]}><ActivityIndicator color={C.accent} /><T muted>{label}</T></View>
);
export const Row = ({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) => <View style={[s.row, { gap, flexWrap: "wrap" }, style]}>{children}</View>;
export const Divider = () => <View style={{ height: 1, backgroundColor: C.line }} />;

/** Bottom sheet modal. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(46,37,32,.35)" }} onPress={onClose} accessibilityLabel="닫기" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: C.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 12, maxHeight: "92%" }}>
          <View style={[s.row, { justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.line }]}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: C.inkDark, flex: 1 }} numberOfLines={1}>{title}</Text>
            <IconButton icon="close" label="닫기" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Yes/no confirmation dialog. */
export const confirm = (title: string, message = "", ok = "확인", destructive = false) => new Promise<boolean>((resolve) =>
  Alert.alert(title, message, [{ text: "취소", style: "cancel", onPress: () => resolve(false) }, { text: ok, style: destructive ? "destructive" : "default", onPress: () => resolve(true) }],
    { cancelable: true, onDismiss: () => resolve(false) }));

export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 99, paddingHorizontal: 16, minHeight: 44 },
  btnSmall: { paddingHorizontal: 12, minHeight: 34 },
  field: { minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.paper, paddingHorizontal: 12, fontSize: 15, color: C.ink },
  option: { paddingHorizontal: 12, paddingVertical: 14, borderRadius: 12 },
  card: { backgroundColor: C.white, borderRadius: 22, overflow: "hidden", shadowColor: "#4a3d35", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
});
