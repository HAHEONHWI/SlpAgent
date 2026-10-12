import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, onIdTokenChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";

const cfg = import.meta.env.VITE_FIREBASE_API_KEY
  ? { apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID }
  : null;
const fbAuth = cfg ? getAuth(initializeApp(cfg)) : null;
// Dev-token login exists only in `vite dev`; it is stripped from production builds.
export const DEV_LOGIN = import.meta.env.DEV && !cfg;

let tokenGetter: () => Promise<string | null> = async () => null;
export const getToken = () => tokenGetter();

type Ctx = { ready: boolean; signedIn: boolean; login: (a: string, b: string) => Promise<void>; devLogin: (org: string, role: string) => void; logout: () => void; label: string };
const C = createContext<Ctx>(null!);
export const useAuth = () => useContext(C);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [dev, setDev] = useState<string | null>(() => (DEV_LOGIN ? sessionStorage.getItem("devToken") : null));

  useEffect(() => {
    if (!fbAuth) { setReady(true); return; }
    return onIdTokenChanged(fbAuth, (u) => { setUser(u); setReady(true); });
  }, []);
  tokenGetter = async () => (dev ? dev : user ? user.getIdToken() : null);

  const value: Ctx = {
    ready, signedIn: !!(dev || user), label: dev ? "dev: " + dev.split(":").slice(1, 3).join("/") : user?.email ?? "",
    login: async (e, p) => { if (!fbAuth) throw new Error("Firebase 설정(VITE_FIREBASE_*)이 없습니다"); await signInWithEmailAndPassword(fbAuth, e, p); },
    devLogin: (org, role) => { const t = `dev:${org}:${role}:dev-user`; sessionStorage.setItem("devToken", t); setDev(t); },
    logout: () => { sessionStorage.removeItem("devToken"); setDev(null); if (fbAuth) signOut(fbAuth); },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
