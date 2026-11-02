import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword, EmailAuthProvider, getAuth, getReactNativePersistence, initializeAuth, onIdTokenChanged,
  reauthenticateWithCredential, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updatePassword, type Auth, type User,
} from "firebase/auth";
import { FIREBASE } from "./config";

// Same Firebase project as the web app; the session survives app restarts through AsyncStorage.
const fbAuth: Auth | null = (() => {
  if (!FIREBASE.apiKey) return null;
  if (getApps().length) return getAuth(getApp());
  const a = initializeAuth(initializeApp(FIREBASE), { persistence: getReactNativePersistence(AsyncStorage) });
  a.languageCode = "ko"; // password-reset emails in Korean
  return a;
})();
export const FIREBASE_ENABLED = !!fbAuth;
export const CHILD_KEY = "childId";

let currentUser: User | null = null;
/** force=true fetches a fresh ID token so newly granted claims (org/role after approval) take effect. */
export const getToken = async (force = false) => (currentUser ? currentUser.getIdToken(force) : null);

type Ctx = {
  ready: boolean; signedIn: boolean; label: string;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  refresh: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** Re-checks the signed-in user's password before a sensitive action (password change, withdrawal). */
  confirmPassword: (password: string) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  logout: () => void;
};
const C = createContext<Ctx>(null!);
export const useAuth = () => useContext(C);

/** Sign-in errors shown to people: a short title and what to do next. Raw Firebase codes are never displayed. */
export class AuthError extends Error {
  constructor(public title: string, detail: string) { super(detail); }
}
const CHECK = ["로그인 정보가 맞지 않아요", "아이디(이메일)와 비밀번호를 다시 확인해 주세요."] as [string, string];
const KO_ERRORS: Record<string, [string, string]> = {
  "auth/invalid-credential": CHECK, "auth/invalid-login-credentials": CHECK, "auth/wrong-password": CHECK, "auth/user-not-found": CHECK,
  "auth/user-disabled": ["사용이 정지된 계정이에요", "기관 관리자나 사이트 관리자에게 계정 재개를 요청해 주세요."],
  "auth/too-many-requests": ["잠시 후 다시 시도해 주세요", "로그인 시도가 많아 보안을 위해 잠시 막혔어요. 몇 분 뒤에 다시 시도해 주세요."],
  "auth/network-request-failed": ["인터넷 연결을 확인해 주세요", "네트워크에 연결되지 않아 로그인하지 못했어요."],
  "auth/missing-password": ["비밀번호를 입력해 주세요", "비밀번호 칸이 비어 있어요."],
  "auth/invalid-email": ["아이디 형식을 확인해 주세요", "아이디는 이메일 주소 형식이어야 해요. (예: name@example.com)"],
  "auth/email-already-in-use": ["이미 가입된 아이디예요", "로그인 탭에서 로그인하거나 다른 이메일로 가입해 주세요."],
  "auth/weak-password": ["비밀번호가 너무 짧아요", "비밀번호는 6자 이상으로 정해 주세요."],
  "auth/requires-recent-login": ["다시 로그인해 주세요", "보안을 위해 로그아웃 후 다시 로그인한 다음 시도해 주세요."],
  "auth/missing-email": ["이메일을 입력해 주세요", "가입할 때 쓴 아이디(이메일)를 입력해 주세요."],
  "auth/operation-not-allowed": ["지금은 로그인할 수 없어요", "서비스 설정 문제예요. 사이트 관리자에게 알려 주세요."],
};
const friendly = (e: any, what = "로그인하지 못했어요") => {
  const [title, detail] = KO_ERRORS[e?.code] ?? [what, "잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 알려 주세요."];
  return new AuthError(title, detail);
};
const need = () => { if (!fbAuth) throw new AuthError("앱 설정이 없어요", "Firebase 설정(EXPO_PUBLIC_FIREBASE_*)을 넣고 다시 빌드해 주세요."); return fbAuth; };

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(!fbAuth);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!fbAuth) return;
    return onIdTokenChanged(fbAuth, (u) => { currentUser = u; setUser(u); setReady(true); });
  }, []);

  const value: Ctx = {
    ready, signedIn: !!user, label: user?.email ?? "",
    login: async (e, p) => { try { await signInWithEmailAndPassword(need(), e, p); } catch (x) { throw x instanceof AuthError ? x : friendly(x); } },
    signup: async (e, p) => { try { await createUserWithEmailAndPassword(need(), e, p); } catch (x) { throw x instanceof AuthError ? x : friendly(x); } },
    refresh: async () => { if (user) await user.getIdToken(true); },
    resetPassword: async (email) => {
      try { await sendPasswordResetEmail(need(), email); }
      catch (x: any) { if (x?.code !== "auth/user-not-found") throw x instanceof AuthError ? x : friendly(x, "메일을 보내지 못했어요"); } // never reveal whether an account exists
    },
    confirmPassword: async (password) => {
      if (!user) return;
      try { await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? "", password)); }
      catch (x: any) {
        if (["auth/invalid-credential", "auth/wrong-password", "auth/invalid-login-credentials"].includes(x?.code)) throw new AuthError("비밀번호가 맞지 않아요", "현재 비밀번호를 다시 확인해 주세요.");
        throw friendly(x, "본인 확인에 실패했어요");
      }
    },
    changePassword: async (current, next) => {
      await value.confirmPassword(current);
      if (!user) return;
      try { await updatePassword(user, next); } catch (x) { throw friendly(x, "비밀번호를 바꾸지 못했어요"); }
    },
    // Clear cached server data so nothing from this account is shown to the next one on this phone.
    logout: () => { AsyncStorage.removeItem(CHILD_KEY); qc.clear(); if (fbAuth) signOut(fbAuth); },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
