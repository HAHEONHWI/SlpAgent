import { useState } from "react";
import { AlertCircle, MailCheck } from "lucide-react";
import { AuthError, DEV_LOGIN, FIREBASE_ENABLED, useAuth } from "../lib/auth";
import { PRIVACY_POLICY_VERSION } from "../lib/privacy";
import BrandLogo from "../components/BrandLogo";
import { Button, Card, Input, Label, Notice, Select } from "../components/ui";

export const PENDING_SIGNUP = "pendingSignup";

export default function Login() {
  const { login, signup, devLogin, resetPassword } = useAuth();
  const [tab, setTab] = useState<"login" | "signup" | "reset">("login");
  const [sent, setSent] = useState("");
  const [f, setF] = useState({ email: "", password: "", password2: "", org_name: "", therapist_name: "" });
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<{ title: string; detail: string } | null>(null), [busy, setBusy] = useState(false);
  const [org, setOrg] = useState("demo"), [role, setRole] = useState("therapist");
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const run = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true);
    try { await fn(); }
    catch (x: any) { setErr(x instanceof AuthError ? { title: x.title, detail: x.message } : { title: "다시 확인해 주세요", detail: x?.message ?? "" }); }
    finally { setBusy(false); }
  };

  const doSignup = () => run(async () => {
    if (f.password !== f.password2) throw new Error("비밀번호가 서로 다릅니다.");
    if (!agree) throw new Error("개인정보 수집·이용에 동의해야 가입할 수 있습니다.");
    // The signup request is sent after sign-in by the approval gate, which survives this screen unmounting.
    sessionStorage.setItem(PENDING_SIGNUP, JSON.stringify({ org_name: f.org_name.trim(), therapist_name: f.therapist_name.trim(), privacy_policy_version: PRIVACY_POLICY_VERSION }));
    if (FIREBASE_ENABLED) await signup(f.email.trim(), f.password);
    else devLogin("-", "none", f.email.split("@")[0] || "new-user");
  });

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm">
        <BrandLogo className="mx-auto mb-4 w-44" />
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(["login", "signup"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setErr(null); setSent(""); }} className={`rounded-md py-1.5 ${tab === t || (t === "login" && tab === "reset") ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}>{t === "login" ? "로그인" : "회원가입"}</button>))}
        </div>
        {tab === "reset" ? (
          sent ? (
            <div className="space-y-3">
              <div role="status" className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
                <MailCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
                <div><p className="text-sm font-semibold">메일을 확인해 주세요</p>
                  <p className="mt-0.5 text-sm text-emerald-800/90"><b>{sent}</b>(으)로 가입된 계정이 있으면 비밀번호 재설정 링크를 보냈어요. 몇 분 안에 오지 않으면 스팸함도 확인해 주세요.</p></div>
              </div>
              <Button className="w-full" onClick={() => { setTab("login"); setSent(""); }}>로그인으로 돌아가기</Button>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await resetPassword(f.email.trim()); setSent(f.email.trim()); }); }}>
              <div><p className="text-sm font-semibold text-slate-800">비밀번호 찾기</p>
                <p className="mt-0.5 text-sm text-slate-500">가입한 아이디(이메일)를 입력하면 새 비밀번호를 정하는 링크를 메일로 보내 드려요.</p></div>
              <Label label="아이디 (이메일)"><Input type="email" value={f.email} onChange={set("email")} required autoComplete="username" autoFocus /></Label>
              {err && <LoginAlert {...err} />}
              <Button className="w-full" disabled={busy || !FIREBASE_ENABLED}>{busy ? "보내는 중…" : "재설정 메일 보내기"}</Button>
              <button type="button" className="w-full text-center text-sm text-slate-500 hover:text-slate-800" onClick={() => { setTab("login"); setErr(null); }}>로그인으로 돌아가기</button>
            </form>)
        ) : tab === "login" ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => login(f.email.trim(), f.password)); }}>
            <Label label="아이디 (이메일)"><Input type="email" value={f.email} onChange={set("email")} required autoComplete="username" /></Label>
            <Label label="비밀번호"><Input type="password" value={f.password} onChange={set("password")} required autoComplete="current-password" /></Label>
            {err && <LoginAlert {...err} />}
            <Button className="w-full" disabled={busy || !FIREBASE_ENABLED}>로그인</Button>
            <button type="button" className="w-full text-center text-sm text-slate-500 hover:text-slate-800" onClick={() => { setTab("reset"); setErr(null); }}>비밀번호를 잊으셨나요?</button>
          </form>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); doSignup(); }}>
            <Label label="아이디 (이메일)"><Input type="email" value={f.email} onChange={set("email")} required autoComplete="username" /></Label>
            <Label label="비밀번호 (6자 이상)"><Input type="password" minLength={6} value={f.password} onChange={set("password")} required autoComplete="new-password" /></Label>
            <Label label="비밀번호 확인"><Input type="password" minLength={6} value={f.password2} onChange={set("password2")} required autoComplete="new-password" /></Label>
            <Label label="기관명"><Input value={f.org_name} onChange={set("org_name")} maxLength={80} required /></Label>
            <Label label="치료사(본인) 이름"><Input value={f.therapist_name} onChange={set("therapist_name")} maxLength={40} required /></Label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
              <span>(필수) <a href="/privacy" target="_blank" rel="noopener" className="text-indigo-700 underline">개인정보처리방침</a>을 확인했으며 개인정보 수집·이용에 동의합니다. AI 기능 사용 시 입력 내용이 OpenAI(미국)로 전송될 수 있습니다.</span>
            </label>
            <Notice>가입 후 사이트 관리자가 승인해야 사용할 수 있습니다.</Notice>
            {err && <LoginAlert {...err} />}
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
      <a href="/privacy" className="mt-3 block text-center text-xs text-slate-500 underline">개인정보처리방침</a>
    </div>
  );
}

export function LoginAlert({ title, detail }: { title: string; detail: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-900">
      <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" aria-hidden />
      <div><p className="text-sm font-semibold">{title}</p>{detail && <p className="mt-0.5 text-sm text-red-800/90">{detail}</p>}</div>
    </div>
  );
}
