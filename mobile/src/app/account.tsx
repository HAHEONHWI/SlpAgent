import { Linking } from "react-native";
import * as Application from "expo-application";
import { useMe, roleLabel } from "@/lib/me";
import { WEB_URL } from "@/lib/config";
import { ChangePassword, LogoutButton, Withdraw } from "@/components/Account";
import { Button, Card, Screen, T } from "@/components/ui";

export default function Account() {
  const me = useMe().data;
  return (
    <Screen>
      <Card title="계정">
        <T bold>{me?.therapist_name ?? me?.name ?? me?.email}</T>
        <T muted small>{[me?.email, me?.org_name, roleLabel(me)].filter(Boolean).join(" · ")}</T>
        <LogoutButton />
      </Card>
      <Card title="웹에서만 하는 일">
        <T small muted>바우처 서류·정산·기관 설정·발달 분석 같은 행정 화면은 PC 웹에서 이용해 주세요.</T>
        <Button variant="outline" icon="open-outline" title="웹 열기" onPress={() => Linking.openURL(`${WEB_URL}/dashboard`)} />
        <Button variant="ghost" title="개인정보처리방침" onPress={() => Linking.openURL(`${WEB_URL}/privacy`)} />
      </Card>
      <ChangePassword />
      <Withdraw />
      <T small muted style={{ textAlign: "center" }}>{`SLP AI ${Application.nativeApplicationVersion ?? ""} (${Application.nativeBuildVersion ?? ""})`}</T>
    </Screen>
  );
}
