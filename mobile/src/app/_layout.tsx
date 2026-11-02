import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ChildProvider } from "@/lib/child";
import { useMe } from "@/lib/me";
import { C } from "@/components/ui";

SplashScreen.preventAutoHideAsync().catch(() => {});
// Refetch on return to the app, like the web app's window-focus refetch.
AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));

export default function Root() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <ChildProvider>
            <StatusBar style="dark" />
            <Nav />
          </ChildProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Nav() {
  const { ready, signedIn } = useAuth();
  const me = useMe();
  // login: no session · gate: signed in but not an active organization member (or /me failed) · app: everything else
  const state = !ready ? null : !signedIn ? "login" : me.isLoading ? null : me.data?.status === "active" ? "app" : "gate";
  useEffect(() => { if (state) SplashScreen.hideAsync().catch(() => {}); }, [state]);
  if (!state) return null; // the splash screen stays up meanwhile
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: C.bg }, headerTintColor: C.inkDark, headerTitleStyle: { fontWeight: "700" }, headerShadowVisible: false, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Protected guard={state === "app"}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="children" options={{ title: "아동 관리" }} />
        <Stack.Screen name="account" options={{ title: "내 계정" }} />
      </Stack.Protected>
      <Stack.Protected guard={state === "login"}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={state === "gate"}>
        <Stack.Screen name="signup" options={{ title: "기관 가입 신청" }} />
      </Stack.Protected>
    </Stack>
  );
}
