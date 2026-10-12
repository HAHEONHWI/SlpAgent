import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export const useRecords = <T = any>(childId: string, kind: string) =>
  useQuery({ queryKey: [kind, childId], queryFn: () => api<T[]>(`/children/${childId}/${kind}`) });

export function useCreate(childId: string, kind: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: unknown) => api(`/children/${childId}/${kind}`, { method: "POST", json }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [kind, childId] }),
  });
}
export const errText = (e: unknown) => (e instanceof Error ? e.message : "");
