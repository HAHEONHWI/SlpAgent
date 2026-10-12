import { useState } from "react";
import { DEV_LOGIN, FIREBASE_ENABLED, useAuth } from "../lib/auth";
import BrandLogo from "../components/BrandLogo";
import { Button, Card, Input, Label, Notice, Select } from "../components/ui";

export const PENDING_SIGNUP = "pendingSignup";

export default function Login() {
  const { login, signup, devLogin } = useAuth();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [f, setF] = useState({ email: "", password: "", password2: "", org_name: "", therapist_name: "" });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [org, setOrg] = useState("demo"), [role, setRole] = useState("therapist");
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const run = async (fn: () => Promise<void>) => { setErr(""); setBusy(true); try { await fn(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } };

  const doSignup = () => run(async () => {
    if (f.password !== f.password2) throw new Error("비밀번호가 서로 다릅니다.");
    // The signup request is sent after sign-in by the approval gate, which survives this screen unmounting.
    sessionStorage.setItem(PENDING_SIGNUP, JSON.stringify({ org_name: f.org_name.trim(), therapist_name: f.therapist_name.trim() }));
    if (FIREBASE_ENABLED) await signup(f.email.trim(), f.password);
    else devLogin("-", "none", f.email.split("@")[0] || "new-user");
  });

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm">
        <BrandLogo className="mx-auto mb-4 w-44" />
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(["login", "signup"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setErr(""); }} className={`rounded-md py-1.5 ${tab === t ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}>{t === "login" ? "로그인" : "회원가입"}</button>))}
        </div>
        {tab === "login" ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => login(f.email.trim(), f.password)); }}>
            <Label label="아이디 (이메일)"><Input type="email" value={f.email} onChange={set("email")} required autoComplete="username" /></Label>
            <Label label="비밀번호"><Input type="password" value={f.password} onChange={set("password")} required autoComplete="current-password" /></Label>
            {err && <Notice tone="red">{err}</Notice>}
            <Button className="w-full" disabled={busy || !FIREBASE_ENABLED}>로그인</Button>
          </form>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); doSignup(); }}>
            <Label label="아이디 (이메일)"><Input type="email" value={f.email} onChange={set("email")} required autoComplete="username" /></Label>
            <Label label="비밀번호 (6자 이상)"><Input type="password" minLength={6} value={f.password} onChange={set("password")} required autoComplete="new-password" /></Label>
            <Label label="비밀번호 확인"><Input type="password" minLength={6} value={f.password2} onChange={set("password2")} required autoComplete="new-password" /></Label>
            <Label label="기관명"><Input value={f.org_name} onChange={set("org_name")} maxLength={80} required /></Label>
            <Label label="치료사(본인) 이름"><Input value={f.therapist_name} onChange={set("therapist_name")} maxLength={40} required /></Label>
            <Notice>가입 후 사이트 관리자가 승인해야 사용할 수 있습니다.</Notice>
            {err && <Notice tone="red">{err}</Notice>}
            <Button className="w-full" disabled={busy}>가입 신청</Button>
          </form>
        )}
        {/* import.meta.env.DEV is a build-time constant, so production builds drop this block entirely. */}
        {import.meta.env.DEV && DEV_LOGIN && (
          <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
            <Notice>개발 모드 전용 로그인입니다(프로덕션 빌드에서는 제거됨). 백엔드를 AUTH_MODE=dev로 실행해야 합니다.</Notice>
            <Label label="기관 ID"><Input value={org} onChange={(e) => setOrg(e.target.value)} /></Label>
            <Label label="역할"><Select value={role} onChange={(e) => setRole(e.target.value)}><option>therapist</option><option>admin</option><option>assistant</option><option value="site_admin">site_admin (사이트 관리자)</option></Select></Label>
            <Button variant="outline" className="w-full" onClick={() => devLogin(role === "site_admin" ? "-" : org, role, role === "site_admin" ? "site-admin" : "dev-user")}>개발용 로그인</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
