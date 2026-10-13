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

/** Sign-in errors shown to people: a short title and what to do next. Raw Firebase codes are never displayed. */
export class AuthError extends Error {
  constructor(public title: string, detail: string) { super(detail); }
}
const KO_ERRORS: Record<string, [string, string]> = {
  "auth/invalid-credential": ["로그인 정보가 맞지 않아요", "아이디(이메일)와 비밀번호를 다시 확인해 주세요."],
  "auth/invalid-login-credentials": ["로그인 정보가 맞지 않아요", "아이디(이메일)와 비밀번호를 다시 확인해 주세요."],
  "auth/wrong-password": ["로그인 정보가 맞지 않아요", "아이디(이메일)와 비밀번호를 다시 확인해 주세요."],
  "auth/user-not-found": ["로그인 정보가 맞지 않아요", "아이디(이메일)와 비밀번호를 다시 확인해 주세요."],
  "auth/user-disabled": ["사용이 정지된 계정이에요", "기관 관리자나 사이트 관리자에게 계정 재개를 요청해 주세요."],
  "auth/too-many-requests": ["잠시 후 다시 시도해 주세요", "로그인 시도가 많아 보안을 위해 잠시 막혔어요. 몇 분 뒤에 다시 시도해 주세요."],
  "auth/network-request-failed": ["인터넷 연결을 확인해 주세요", "네트워크에 연결되지 않아 로그인하지 못했어요."],
  "auth/missing-password": ["비밀번호를 입력해 주세요", "비밀번호 칸이 비어 있어요."],
  "auth/invalid-email": ["아이디 형식을 확인해 주세요", "아이디는 이메일 주소 형식이어야 해요. (예: name@example.com)"],
  "auth/email-already-in-use": ["이미 가입된 아이디예요", "로그인 탭에서 로그인하거나 다른 이메일로 가입해 주세요."],
  "auth/weak-password": ["비밀번호가 너무 짧아요", "비밀번호는 6자 이상으로 정해 주세요."],
  "auth/operation-not-allowed": ["지금은 로그인할 수 없어요", "서비스 설정 문제예요. 사이트 관리자에게 알려 주세요."],
};
const friendly = (e: any) => {
  const [title, detail] = KO_ERRORS[e?.code] ?? ["로그인하지 못했어요", "잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 알려 주세요."];
  return new AuthError(title, detail);
};

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
    devLogin: (org, role, uid = "dev-user") => {
      if (!import.meta.env.DEV) return; // build-time constant: production bundles contain no dev-token code
      const t = `dev:${org}:${role}:${uid}`; sessionStorage.setItem("devToken", t); setDev(t);
    },
    refresh: async () => { if (user) await user.getIdToken(true); },
    // Clear cached server data so nothing from this account is shown to the next one in this browser.
    logout: () => { sessionStorage.removeItem("devToken"); localStorage.removeItem("childId"); setDev(null); qc.clear(); if (fbAuth) signOut(fbAuth); },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
