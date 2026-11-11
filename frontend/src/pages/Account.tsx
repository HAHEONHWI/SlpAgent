import { useState } from "react";
import { AuthError, useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useMe } from "../lib/me";
import { Button, Card, Input, Label, Notice, PageTitle } from "../components/ui";
import { LoginAlert } from "./Login";
import PaymentSettings from "../components/PaymentSettings";

type Err = { title: string; detail: string } | null;
const asErr = (x: any): Err => x instanceof AuthError ? { title: x.title, detail: x.message }
  : /last organization admin/.test(x?.message ?? "") ? { title: "기관의 마지막 관리자예요", detail: "사이트 관리자에게 다른 사람을 기관 관리자로 지정해 달라고 요청한 뒤 탈퇴해 주세요." }
  : { title: "처리하지 못했어요", detail: "잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 알려 주세요." };

export default function Account() {
  const me = useMe().data;
  return (
    <>
      <PageTitle title="내 계정" sub={me?.email ?? undefined} />
      <div className="max-w-xl space-y-4">
        <PaymentSettings />
        <ChangePassword />
        <Withdraw />
      </div>
    </>
  );
}

function ChangePassword() {
  const { changePassword } = useAuth();
  const [f, setF] = useState({ current: "", next: "", next2: "" });
  const [err, setErr] = useState<Err>(null), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const submit = async () => {
    setErr(null); setDone(false);
    if (f.next !== f.next2) return setErr({ title: "새 비밀번호가 서로 달라요", detail: "새 비밀번호와 확인 칸을 똑같이 입력해 주세요." });
    setBusy(true);
    try { await changePassword(f.current, f.next); setDone(true); setF({ current: "", next: "", next2: "" }); }
    catch (x) { setErr(asErr(x)); } finally { setBusy(false); }
  };
  return (
    <Card title="비밀번호 변경">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Label label="현재 비밀번호"><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required autoComplete="current-password" /></Label>
        <Label label="새 비밀번호 (6자 이상)"><Input type="password" minLength={6} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required autoComplete="new-password" /></Label>
        <Label label="새 비밀번호 확인"><Input type="password" minLength={6} value={f.next2} onChange={(e) => setF({ ...f, next2: e.target.value })} required autoComplete="new-password" /></Label>
        {err && <LoginAlert {...err} />}
        {done && <p role="status" className="text-sm text-green-700">비밀번호를 바꿨어요.</p>}
        <Button disabled={busy}>{busy ? "바꾸는 중…" : "비밀번호 바꾸기"}</Button>
      </form>
    </Card>
  );
}

/** 회원 탈퇴: re-check the password, delete the account on the server, then sign out. */
export function Withdraw() {
  const { confirmPassword, logout } = useAuth();
  const [open, setOpen] = useState(false), [pw, setPw] = useState(""), [ok, setOk] = useState(false);
  const [err, setErr] = useState<Err>(null), [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null); setBusy(true);
    try { await confirmPassword(pw); await api("/me", { method: "DELETE" }); logout(); }
    catch (x) { setErr(asErr(x)); setBusy(false); }
  };
  return (
    <Card title="회원 탈퇴">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">계정을 지우면 이 아이디로 더는 로그인할 수 없어요.</p>
          <Button variant="outline" onClick={() => setOpen(true)}>탈퇴하기</Button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Notice tone="red">
            탈퇴하면 로그인 계정과 가입 정보가 바로 지워지고 되돌릴 수 없어요. 작성한 아동·회기 기록은 기관의 자료라서 기관에 그대로 남아요.
            기관의 마지막 관리자라면 먼저 다른 사람이 관리자가 되어야 해요.
          </Notice>
          <Label label="본인 확인을 위해 비밀번호를 입력해 주세요"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="current-password" /></Label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ok} onChange={(e) => setOk(e.target.checked)} required /><span>위 내용을 확인했고 탈퇴에 동의합니다.</span></label>
          {err && <LoginAlert {...err} />}
          <div className="flex gap-2">
            <Button variant="danger" disabled={busy || !ok}>{busy ? "탈퇴 처리 중…" : "탈퇴"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setOpen(false); setErr(null); setPw(""); setOk(false); }}>취소</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
