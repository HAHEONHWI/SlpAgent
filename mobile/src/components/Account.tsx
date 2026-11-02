import { useState } from "react";
import { api, errText } from "@/lib/api";
import { AuthError, useAuth } from "@/lib/auth";
import { Button, Card, Notice, T, TextField, confirm } from "./ui";

/** 회원 탈퇴: re-checks the password, then deletes the account on the server (Play policy requires in-app deletion). */
export function Withdraw() {
  const { confirmPassword, logout } = useAuth();
  const [pw, setPw] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const go = async () => {
    if (!(await confirm("회원 탈퇴", "계정을 삭제하면 되돌릴 수 없어요. 탈퇴할까요?", "탈퇴", true))) return;
    setBusy(true); setErr("");
    try { await confirmPassword(pw); await api("/me", { method: "DELETE" }); logout(); }
    catch (e) { setErr(e instanceof AuthError ? `${e.title} — ${e.message}` : errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <Card title="회원 탈퇴">
      <T small muted>로그인 계정을 삭제해요. 기관의 아동 기록은 기관 소유라 남으며, 기관 관리자가 관리해요.</T>
      <TextField label="현재 비밀번호" value={pw} onChangeText={setPw} secureTextEntry autoComplete="current-password" />
      {!!err && <Notice tone="red">{err}</Notice>}
      <Button variant="danger" title="회원 탈퇴" loading={busy} disabled={!pw} onPress={go} />
    </Card>
  );
}

export function ChangePassword() {
  const { changePassword } = useAuth();
  const [f, setF] = useState({ current: "", next: "", next2: "" });
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [done, setDone] = useState(false);
  const go = async () => {
    setErr(""); setDone(false);
    if (f.next !== f.next2) return setErr("새 비밀번호가 서로 다릅니다.");
    if (f.next.length < 6) return setErr("새 비밀번호는 6자 이상이어야 합니다.");
    setBusy(true);
    try { await changePassword(f.current, f.next); setDone(true); setF({ current: "", next: "", next2: "" }); }
    catch (e) { setErr(e instanceof AuthError ? `${e.title} — ${e.message}` : errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <Card title="비밀번호 변경">
      <TextField label="현재 비밀번호" value={f.current} onChangeText={(v) => setF({ ...f, current: v })} secureTextEntry autoComplete="current-password" />
      <TextField label="새 비밀번호 (6자 이상)" value={f.next} onChangeText={(v) => setF({ ...f, next: v })} secureTextEntry autoComplete="new-password" />
      <TextField label="새 비밀번호 확인" value={f.next2} onChangeText={(v) => setF({ ...f, next2: v })} secureTextEntry autoComplete="new-password" />
      {!!err && <Notice tone="red">{err}</Notice>}
      {done && <Notice tone="green">비밀번호를 바꿨어요.</Notice>}
      <Button title="변경" loading={busy} disabled={!f.current || !f.next} onPress={go} />
    </Card>
  );
}

export function LogoutButton() {
  const { logout } = useAuth();
  // The root navigator's guards switch to the login screen once the session is gone.
  return <Button variant="outline" icon="log-out-outline" title="로그아웃" onPress={async () => { if (await confirm("로그아웃할까요?")) logout(); }} />;
}
