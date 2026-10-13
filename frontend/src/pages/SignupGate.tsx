import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Me } from "../lib/me";
import { errText } from "../lib/hooks";
import BrandLogo from "../components/BrandLogo";
import Footer from "../components/Footer";
import { Badge, Button, Card, Input, Label, Notice } from "../components/ui";
import { PENDING_SIGNUP } from "./Login";
import { PRIVACY_POLICY_VERSION } from "../lib/privacy";
import { Withdraw } from "./Account";

/** Shown to signed-in accounts that are not yet an approved organization member. */
export default function SignupGate({ me }: { me: Me }) {
  const { logout, refresh, label } = useAuth();
  const qc = useQueryClient();
  const stored = (() => { try { return JSON.parse(sessionStorage.getItem(PENDING_SIGNUP) || "null"); } catch { return null; } })();
  const [f, setF] = useState({ org_name: stored?.org_name ?? me.signup?.org_name ?? "", therapist_name: stored?.therapist_name ?? me.signup?.therapist_name ?? "" });
  const recheck = async () => { await refresh(); await qc.invalidateQueries({ queryKey: ["me"] }); };
  const submit = useMutation({
    mutationFn: (body: { org_name: string; therapist_name: string; privacy_policy_version?: string }) => api("/signup", { method: "POST", json: body }),
    onSuccess: () => { sessionStorage.removeItem(PENDING_SIGNUP); qc.invalidateQueries({ queryKey: ["me"] }); },
  });
  // Finish a signup started on the login screen (the account now exists, the request does not yet).
  const sent = useRef(false);
  useEffect(() => {
    if (me.status === "none" && stored?.org_name && stored?.therapist_name && !sent.current) { sent.current = true; submit.mutate(stored); }
  }, [me.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Approved but this token predates the new claims: fetch a fresh token once.
  useEffect(() => { if (me.status === "approved") recheck(); }, [me.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card title="기관 가입 신청" className="w-full max-w-md" action={<Button variant="ghost" onClick={logout}>로그아웃</Button>}>
        <BrandLogo className="mx-auto mb-3 w-36" />
        <p className="mb-3 text-sm text-slate-500">{me.email ?? label}</p>
        {me.status === "pending" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2"><Badge tone="amber">승인 대기</Badge><span className="text-sm">{me.signup?.org_name} · {me.signup?.therapist_name}</span></div>
            <Notice>사이트 관리자가 가입을 승인하면 바로 사용할 수 있습니다. 승인 후 아래 버튼을 누르세요.</Notice>
            <Button onClick={recheck}>승인 여부 확인</Button>
          </div>
        )}
        {me.status === "approved" && (
          <div className="space-y-3">
            <Badge tone="green">승인됨</Badge>
            <Notice>승인되었습니다. 화면이 바뀌지 않으면 로그아웃 후 다시 로그인하세요.{import.meta.env.DEV && label.startsWith("dev:") && me.signup?.org_id && <> (개발 모드: 기관 ID <code>{me.signup.org_id}</code>, 역할 admin으로 개발용 로그인)</>}</Notice>
            <Button onClick={recheck}>다시 확인</Button>
          </div>
        )}
        {(me.status === "none" || me.status === "rejected") && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit.mutate({ org_name: f.org_name.trim(), therapist_name: f.therapist_name.trim(), privacy_policy_version: PRIVACY_POLICY_VERSION }); }}>
            {me.status === "rejected" && <Notice tone="red">가입이 거절되었습니다. 사유: {me.signup?.reason}. 내용을 고쳐 다시 신청할 수 있습니다.</Notice>}
            <Label label="기관명"><Input value={f.org_name} onChange={(e) => setF({ ...f, org_name: e.target.value })} maxLength={80} required /></Label>
            <Label label="치료사(본인) 이름"><Input value={f.therapist_name} onChange={(e) => setF({ ...f, therapist_name: e.target.value })} maxLength={40} required /></Label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" required />
              <span>(필수) <a href="/privacy" target="_blank" rel="noopener" className="text-indigo-700 underline">개인정보처리방침</a>에 동의합니다.</span>
            </label>
            {submit.error && <Notice tone="red">{errText(submit.error)}</Notice>}
            <Button disabled={submit.isPending}>{submit.isPending ? "신청 중…" : "가입 신청"}</Button>
          </form>
        )}
      </Card>
      <div className="mt-4 w-full max-w-md"><Withdraw /></div>
      <Footer className="mt-4" />
    </div>
  );
}
