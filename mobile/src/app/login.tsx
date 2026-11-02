import { useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthError, FIREBASE_ENABLED, useAuth } from "@/lib/auth";
import { PRIVACY_POLICY_VERSION, WEB_URL } from "@/lib/config";
import { Button, C, Card, Checkbox, Notice, Screen, Segmented, T, TextField } from "@/components/ui";

export const PENDING_SIGNUP = "pendingSignup";

export default function Login() {
  const { login, signup, resetPassword } = useAuth();
  const [tab, setTab] = useState<"login" | "signup" | "reset">("login");
  const [sent, setSent] = useState("");
  const [f, setF] = useState({ email: "", password: "", password2: "", org_name: "", therapist_name: "" });
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<{ title: string; detail: string } | null>(null), [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const run = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true);
    try { await fn(); }
    catch (x: any) { setErr(x instanceof AuthError ? { title: x.title, detail: x.message } : { title: "다시 확인해 주세요", detail: x?.message ?? "" }); }
    finally { setBusy(false); }
  };
  const doSignup = () => run(async () => {
    if (f.password !== f.password2) throw new Error("비밀번호가 서로 다릅니다.");
    if (!f.org_name.trim() || !f.therapist_name.trim()) throw new Error("기관명과 치료사 이름을 입력해 주세요.");
    if (!agree) throw new Error("개인정보 수집·이용에 동의해야 가입할 수 있습니다.");
    // The signup request is sent after sign-in by the approval gate, which survives this screen unmounting.
    await AsyncStorage.setItem(PENDING_SIGNUP, JSON.stringify({ org_name: f.org_name.trim(), therapist_name: f.therapist_name.trim(), privacy_policy_version: PRIVACY_POLICY_VERSION }));
    await signup(f.email.trim(), f.password);
  });
  const alert = err && (
    <Notice tone="red"><Text style={{ fontWeight: "700", color: C.redText }}>{err.title}</Text>{!!err.detail && <Text style={{ color: C.redText }}>{err.detail}</Text>}</Notice>);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen style={{ paddingTop: 24 }}>
        <View style={{ alignItems: "center" }}>
          <Image source={require("../../assets/icon.png")} style={{ width: 200, height: 120 }} resizeMode="cover" accessibilityLabel="SLP AI" />
          <T muted small>언어재활사를 위한 AI 기록·일정 도우미</T>
        </View>
        {!FIREBASE_ENABLED && <Notice tone="red">앱 설정(EXPO_PUBLIC_FIREBASE_*)이 없어 로그인할 수 없어요.</Notice>}
        <Card>
          <View style={{ alignItems: "center" }}>
            <Segmented value={tab === "reset" ? "login" : tab} onChange={(t) => { setTab(t); setErr(null); setSent(""); }} items={[["login", "로그인"], ["signup", "회원가입"]]} />
          </View>
          {tab === "reset" ? (sent ? (
            <>
              <Notice tone="green">{`${sent}(으)로 가입된 계정이 있으면 비밀번호 재설정 링크를 보냈어요. 몇 분 안에 오지 않으면 스팸함도 확인해 주세요.`}</Notice>
              <Button title="로그인으로 돌아가기" onPress={() => { setTab("login"); setSent(""); }} />
            </>) : (
            <>
              <T bold>비밀번호 찾기</T>
              <T small muted>가입한 아이디(이메일)를 입력하면 새 비밀번호를 정하는 링크를 메일로 보내 드려요.</T>
              <TextField label="아이디 (이메일)" value={f.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
              {alert}
              <Button title={busy ? "보내는 중…" : "재설정 메일 보내기"} loading={busy} disabled={!f.email.trim()}
                onPress={() => run(async () => { await resetPassword(f.email.trim()); setSent(f.email.trim()); })} />
              <Button variant="ghost" title="로그인으로 돌아가기" onPress={() => { setTab("login"); setErr(null); }} />
            </>)
          ) : tab === "login" ? (
            <>
              <TextField label="아이디 (이메일)" value={f.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="username" />
              <TextField label="비밀번호" value={f.password} onChangeText={set("password")} secureTextEntry autoComplete="current-password" textContentType="password"
                onSubmitEditing={() => run(() => login(f.email.trim(), f.password))} />
              {alert}
              <Button title="로그인" loading={busy} disabled={!f.email.trim() || !f.password} onPress={() => run(() => login(f.email.trim(), f.password))} />
              <Button variant="ghost" title="비밀번호를 잊으셨나요?" onPress={() => { setTab("reset"); setErr(null); }} />
            </>
          ) : (
            <>
              <TextField label="아이디 (이메일)" value={f.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
              <TextField label="비밀번호 (6자 이상)" value={f.password} onChangeText={set("password")} secureTextEntry autoComplete="new-password" />
              <TextField label="비밀번호 확인" value={f.password2} onChangeText={set("password2")} secureTextEntry autoComplete="new-password" />
              <TextField label="기관명" value={f.org_name} onChangeText={set("org_name")} maxLength={80} />
              <TextField label="치료사(본인) 이름" value={f.therapist_name} onChangeText={set("therapist_name")} maxLength={40} />
              <Checkbox checked={agree} onChange={setAgree} label={
                <T small>(필수) <Text style={{ color: C.accentDark, textDecorationLine: "underline" }} onPress={() => Linking.openURL(`${WEB_URL}/privacy`)}>개인정보처리방침</Text>을 확인했으며 개인정보 수집·이용에 동의합니다. AI 기능 사용 시 입력 내용이 OpenAI(미국)로 전송될 수 있습니다.</T>} />
              <Notice>가입 후 사이트 관리자가 승인해야 사용할 수 있습니다.</Notice>
              {alert}
              <Button title="가입 신청" loading={busy} disabled={!f.email.trim() || f.password.length < 6} onPress={doSignup} />
            </>
          )}
        </Card>
        <Pressable onPress={() => Linking.openURL(`${WEB_URL}/privacy`)}><Text style={{ textAlign: "center", color: C.sub, fontSize: 13 }}>개인정보처리방침</Text></Pressable>
      </Screen>
    </SafeAreaView>
  );
}
