import type { ReactNode } from "react";
import { useChild } from "../lib/child";
import { Notice } from "./ui";

export default function RequireChild({ children }: { children: (childId: string) => ReactNode }) {
  const { childId, child } = useChild();
  if (!childId || !child) return <Notice>상단에서 아동을 선택하세요.</Notice>;
  return <>{children(childId)}</>;
}
