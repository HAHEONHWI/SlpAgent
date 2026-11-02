import { useEffect, useRef, useState } from "react";
import { Linking, Text } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, errText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PRIVACY_POLICY_VERSION, WEB_URL } from "@/lib/config";
import { useMe } from "@/lib/me";
import { Withdraw, LogoutButton } from "@/components/Account";
import { Badge, Button, C, Card, Checkbox, Loading, Notice, Row, Screen, T, TextField } from "@/components/ui";
import { PENDING_SIGNUP } from "./login";

type Pending = { org_name: string; therapist_name: string; privacy_policy_version?: string };

/** Signed in, but not yet an approved organization member (or /me failed). */
export default function SignupGate() {
  const { refresh, label } = useAuth();
  const qc = useQueryClient();
  const meQ = useMe();
  const me = meQ.data;
  const [stored, setStored] = useState<Pending | null | undefined>(undefined);
  useEffect(() => { AsyncStorage.getItem(PENDING_SIGNUP).then((v) => { try { setStored(v ? JSON.parse(v) : null); } catch { setStored(null); } }); }, []);
  const [f, setF] = useState({ org_name: "", therapist_name: "" });
  const [agree, setAgree] = useState(false);
  useEffect(() => { if (stored !== undefined) setF({ org_name: stored?.org_name ?? me?.signup?.org_name ?? "", therapist_name: stored?.therapist_name ?? me?.signup?.therapist_name ?? "" }); }, [stored, me?.signup]);
  const recheck = async () => { await refresh(); await qc.invalidateQueries({ queryKey: ["me"] }); };
  const submit = useMutation({
    mutationFn: (body: Pending) => api("/signup", { method: "POST", json: body }),
    onSuccess: () => { AsyncStorage.removeItem(PENDING_SIGNUP); qc.invalidateQueries({ queryKey: ["me"] }); },
  });
  // Finish a signup started on the login screen (the account now exists, the request does not yet).
  const sent = useRef(false);
  useEffect(() => {
    if (me?.status === "none" && stored?.org_name && stored?.therapist_name && !sent.current) { sent.current = true; submit.mutate(stored); }
  }, [me?.status, stored]); // eslint-disable-line react-hooks/exhaustive-deps
  // Approved but this token predates the new claims: fetch a fresh token once.
  useEffect(() => { if (me?.status === "approved") recheck(); }, [me?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen onRefresh={recheck}>
      <T muted small>{me?.email ?? label}</T>
      {meQ.error ? (
        <Card title="계정 정보를 불러오지 못했어요">
          <Notice tone="red">{errText(meQ.error)}</Notice>
          <Button title="다시 시도" onPress={() => meQ.refetch()} />
        </Card>
      ) : !me ? <Loading /> : me.status === "site_admin" ? (
        <Card title="사이트 관리자 계정">
          <Notice>사이트 관리(가입 승인·전체 통계)는 웹에서만 할 수 있어요. 앱은 기관 치료사·관리자 계정으로 로그인해 주세요.</Notice>
          <Button variant="outline" title="웹 열기" onPress={() => Linking.openURL(WEB_URL)} />
        </Card>
      ) : me.status === "pending" ? (
        <Card title="승인 대기">
          <Row><Badge tone="amber">승인 대기</Badge><T small>{me.signup?.org_name} · {me.signup?.therapist_name}</T></Row>
          <Notice>사이트 관리자가 가입을 승인하면 바로 사용할 수 있습니다. 승인 후 아래 버튼을 누르세요.</Notice>
          <Button title="승인 여부 확인" onPress={recheck} />
        </Card>
      ) : me.status === "approved" ? (
        <Card title="승인됨">
          <Notice tone="green">승인되었습니다. 화면이 바뀌지 않으면 로그아웃 후 다시 로그인하세요.</Notice>
          <Button title="다시 확인" onPress={recheck} />
        </Card>
      ) : (
        <Card title="기관 가입 신청">
          {me.status === "rejected" && <Notice tone="red">{`가입이 거절되었습니다. 사유: ${me.signup?.reason ?? "-"}. 내용을 고쳐 다시 신청할 수 있습니다.`}</Notice>}
          <TextField label="기관명" value={f.org_name} onChangeText={(v) => setF({ ...f, org_name: v })} maxLength={80} />
          <TextField label="치료사(본인) 이름" value={f.therapist_name} onChangeText={(v) => setF({ ...f, therapist_name: v })} maxLength={40} />
          <Checkbox checked={agree} onChange={setAgree} label={
            <T small>(필수) <Text style={{ color: C.accentDark, textDecorationLine: "underline" }} onPress={() => Linking.openURL(`${WEB_URL}/privacy`)}>개인정보처리방침</Text>에 동의합니다.</T>} />
          {submit.error && <Notice tone="red">{errText(submit.error)}</Notice>}
          <Button title="가입 신청" loading={submit.isPending} disabled={!agree || !f.org_name.trim() || !f.therapist_name.trim()}
            onPress={() => submit.mutate({ org_name: f.org_name.trim(), therapist_name: f.therapist_name.trim(), privacy_policy_version: PRIVACY_POLICY_VERSION })} />
        </Card>
      )}
      <LogoutButton />
      {me && me.status !== "site_admin" && <Withdraw />}
    </Screen>
  );
}
