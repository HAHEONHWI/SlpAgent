import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, type Child } from "./api";
import { CHILD_KEY } from "./auth";
import { useMe } from "./me";

type Ctx = { childId: string | null; child: Child | null; children: Child[]; loading: boolean; setChildId: (id: string | null) => void };
const C = createContext<Ctx>(null!);
export const useChild = () => useContext(C);

/** The selected child, shared by every screen and remembered across launches (like the web top-bar picker). */
export function ChildProvider({ children: kids }: { children: ReactNode }) {
  const me = useMe();
  const [childId, set] = useState<string | null>(null);
  useEffect(() => { AsyncStorage.getItem(CHILD_KEY).then((v) => v && set(v)).catch(() => {}); }, []);
  const q = useQuery({ queryKey: ["children"], queryFn: () => api<Child[]>("/children"), enabled: me.data?.status === "active" });
  const list = q.data ?? [];
  const child = list.find((c) => c.id === childId) ?? null;
  const setChildId = (id: string | null) => { set(id); (id ? AsyncStorage.setItem(CHILD_KEY, id) : AsyncStorage.removeItem(CHILD_KEY)).catch(() => {}); };
  return <C.Provider value={{ childId: child ? childId : null, child, children: list, loading: q.isLoading, setChildId }}>{kids}</C.Provider>;
}
