import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth, onIdTokenChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";

const cfg = import.meta.env.VITE_FIREBASE_API_KEY
  ? { apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID }
  : null;
const fbAuth = cfg ? getAuth(initializeApp(cfg)) : null;
export const FIREBASE_ENABLED = !!fbAuth;
// Dev-token login exists only in `vite dev` (stripped from production builds). With Firebase configured it is
// offered only when VITE_DEV_LOGIN=1, for running against a backend in AUTH_MODE=dev.
export const DEV_LOGIN = import.meta.env.DEV && (!cfg || import.meta.env.VITE_DEV_LOGIN === "1");

let tokenGetter: (force?: boolean) => Promise<string | null> = async () => null;
export const getToken = (force = false) => tokenGetter(force);

type Ctx = {
  ready: boolean; signedIn: boolean; label: string;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  devLogin: (org: string, role: string, uid?: string) => void;
  refresh: () => Promise<void>;
  logout: () => void;
};
const C = createContext<Ctx>(null!);
export const useAuth = () => useContext(C);

const KO_ERRORS: Record<string, string> = {
  "auth/invalid-credential": "아이디 또는 비밀번호가 올바르지 않습니다.",
  "auth/email-already-in-use": "이미 가입된 아이디(이메일)입니다.",
  "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
  "auth/invalid-email": "아이디는 이메일 형식이어야 합니다.",
  "auth/operation-not-allowed": "Firebase 콘솔에서 이메일/비밀번호 로그인이 아직 켜지지 않았습니다.",
  "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
};
const friendly = (e: any) => new Error(KO_ERRORS[e?.code] ?? e?.message ?? "로그인 오류");

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [dev, setDev] = useState<string | null>(() => (DEV_LOGIN ? sessionStorage.getItem("devToken") : null));

  useEffect(() => {
    if (!fbAuth) { setReady(true); return; }
    return onIdTokenChanged(fbAuth, (u) => { setUser(u); setReady(true); });
  }, []);
  // force=true fetches a fresh ID token so newly granted claims (org/role after approval) take effect.
  tokenGetter = async (force = false) => (dev ? dev : user ? user.getIdToken(force) : null);

  const value: Ctx = {
    ready, signedIn: !!(dev || user), label: dev ? "dev: " + dev.split(":").slice(1, 3).join("/") : user?.email ?? "",
    login: async (e, p) => {
      if (!fbAuth) throw new Error("Firebase 설정(VITE_FIREBASE_*)이 없습니다");
      try { await signInWithEmailAndPassword(fbAuth, e, p); } catch (x) { throw friendly(x); }
    },
    signup: async (e, p) => {
      if (!fbAuth) throw new Error("Firebase 설정(VITE_FIREBASE_*)이 없습니다");
      try { await createUserWithEmailAndPassword(fbAuth, e, p); } catch (x) { throw friendly(x); }
    },
    devLogin: (org, role, uid = "dev-user") => { const t = `dev:${org}:${role}:${uid}`; sessionStorage.setItem("devToken", t); setDev(t); },
    refresh: async () => { if (user) await user.getIdToken(true); },
    // Clear cached server data so nothing from this account is shown to the next one in this browser.
    logout: () => { sessionStorage.removeItem("devToken"); localStorage.removeItem("childId"); setDev(null); qc.clear(); if (fbAuth) signOut(fbAuth); },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
