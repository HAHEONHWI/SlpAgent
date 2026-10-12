import { useState } from "react";
import { DEV_LOGIN, useAuth } from "../lib/auth";
import { Button, Card, Input, Label, Notice, Select } from "../components/ui";

export default function Login() {
  const { login, devLogin } = useAuth();
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [err, setErr] = useState("");
  const [org, setOrg] = useState("demo"), [role, setRole] = useState("therapist");
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card title="SLP Agent 로그인" className="w-full max-w-sm">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setErr(""); try { await login(email, pw); } catch (x: any) { setErr(x.message); } }}>
          <Label label="이메일"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Label>
          <Label label="비밀번호"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Label>
          {err && <Notice tone="red">{err}</Notice>}
          <Button className="w-full">로그인</Button>
        </form>
        {DEV_LOGIN && (
          <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
            <Notice>개발 모드 전용 로그인입니다(프로덕션 빌드에서는 제거됨). 백엔드를 AUTH_MODE=dev로 실행해야 합니다.</Notice>
            <Label label="기관 ID"><Input value={org} onChange={(e) => setOrg(e.target.value)} /></Label>
            <Label label="역할"><Select value={role} onChange={(e) => setRole(e.target.value)}><option>therapist</option><option>admin</option><option>assistant</option></Select></Label>
            <Button variant="outline" className="w-full" onClick={() => devLogin(org, role)}>개발용 로그인</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
