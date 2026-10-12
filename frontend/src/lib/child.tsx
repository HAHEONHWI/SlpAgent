import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Child } from "./api";
import { useMe } from "./me";

type Ctx = { childId: string | null; child: Child | null; children: Child[]; setChildId: (id: string | null) => void };
const C = createContext<Ctx>(null!);
export const useChild = () => useContext(C);

export function ChildProvider({ children: kids }: { children: ReactNode }) {
  const me = useMe();
  const [childId, set] = useState<string | null>(() => localStorage.getItem("childId"));
  const q = useQuery({ queryKey: ["children"], queryFn: () => api<Child[]>("/children"), enabled: me.data?.status === "active" });
  const list = q.data ?? [];
  const child = list.find((c) => c.id === childId) ?? null;
  const setChildId = (id: string | null) => { set(id); id ? localStorage.setItem("childId", id) : localStorage.removeItem("childId"); };
  return <C.Provider value={{ childId: child ? childId : null, child, children: list, setChildId }}>{kids}</C.Provider>;
}
