import { useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errText } from "@/lib/api";
import { Badge, Button, C, Card, Empty, Input, Notice, Row, T } from "./ui";

export type Evidence = { document?: string | null; page?: number | null; item_number?: string | null; evaluation_date?: string | null; request_field?: string | null };
export type Claim = { text: string; evidence: Evidence[] };
export type Draft = { id: string; kind: string; status: string; payload: Record<string, any> };

// ABC/session evidence cites internal record ids as item_number; the date identifies them for a reader.
const RECORD_DOCS = new Set(["ABC 관찰", "회기기록"]);
const evLabel = (e: Evidence) => e.request_field ? `입력: ${e.request_field}`
  : [e.document, e.page && `p.${e.page}`, e.item_number && !RECORD_DOCS.has(e.document ?? "") && `문항 ${e.item_number}`, e.evaluation_date].filter(Boolean).join(" · ");

export function ClaimList({ claims }: { claims: (Claim | string)[] }) {
  if (!claims?.length) return <T small muted>해당 없음</T>;
  return (
    <View style={{ gap: 8 }}>
      {claims.map((c, i) => (
        <View key={i} style={{ gap: 4 }}>
          <T selectable>{typeof c === "string" ? c : c.text}</T>
          <Row gap={4}>{(typeof c === "string" ? [] : c?.evidence ?? []).map((e, j) => <Badge key={j}>{`근거: ${evLabel(e)}`}</Badge>)}</Row>
        </View>))}
    </View>
  );
}

/** Renders an ai_analyses draft section-by-section and offers approve/reject. */
export function DraftView({ draft, sections, onDone }: { draft: Draft; sections: [string, string][]; onDone: () => void }) {
  const qc = useQueryClient();
  const done = () => { qc.invalidateQueries({ queryKey: ["proposals"] }); qc.invalidateQueries({ queryKey: ["approved"] }); onDone(); };
  const approve = useMutation({ mutationFn: () => api(`/proposals/${draft.id}/approve`, { method: "POST" }), onSuccess: done });
  const reject = useMutation({ mutationFn: () => api(`/proposals/${draft.id}/reject`, { method: "POST" }), onSuccess: done });
  return (
    <Card title="AI 초안" action={<Badge tone="indigo">미승인 초안</Badge>}>
      <Notice>AI가 만든 미승인 초안입니다. 진단이 아니며, 근거를 원자료와 대조한 뒤 승인하세요. 수정이 필요하면 ‘검토 대기’에서 내용을 고칠 수 있습니다.</Notice>
      {sections.map(([key, label]) => {
        const v = draft.payload[key];
        if (v === undefined) return null;
        return <View key={key} style={{ gap: 4, borderTopWidth: 1, borderColor: C.line, paddingTop: 10 }}><T small bold style={{ color: C.sub }}>{label}</T><ClaimList claims={Array.isArray(v) ? v : [v]} /></View>;
      })}
      {(approve.error || reject.error) && <Notice tone="red">{errText(approve.error || reject.error)}</Notice>}
      <Button icon="checkmark" title="검토 완료 · 승인" loading={approve.isPending} onPress={() => approve.mutate()} />
      <Button variant="outline" title="반려" loading={reject.isPending} onPress={() => reject.mutate()} />
      <T small muted style={{ textAlign: "center" }}>승인 전에는 기록에 반영되지 않습니다</T>
    </Card>
  );
}

type Approved = { id: string; kind?: string; payload: Record<string, any>; approved_by?: string | null; created_at: string };

/** Read-only list of approved records (e.g. therapy-activities); each expands to its sections. */
export function ApprovedHistory({ path, sections, kindLabel }: { path: string; sections: [string, string][]; kindLabel: string }) {
  const q = useQuery({ queryKey: ["approved", path], queryFn: () => api<Approved[]>(path), retry: false });
  const [open, setOpen] = useState<string | null>(null);
  const items = [...(q.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <Card title="승인된 기록">
      {q.error ? (q.error instanceof ApiError && q.error.status === 404 ? <Notice>서버가 아직 이 기능을 지원하지 않습니다.</Notice> : <Notice tone="red">{errText(q.error)}</Notice>)
        : q.isLoading ? <Empty>불러오는 중…</Empty> : !items.length ? <Empty>승인된 기록이 없습니다.</Empty> : items.map((it) => (
          <View key={it.id} style={{ gap: 8, borderTopWidth: 1, borderColor: C.line, paddingTop: 8 }}>
            <Pressable accessibilityRole="button" onPress={() => setOpen(open === it.id ? null : it.id)}>
              <Row><Badge tone="green">승인됨</Badge><T bold>{kindLabel}</T><T small muted>{it.created_at.slice(0, 16).replace("T", " ")}</T>
                <T small style={{ color: C.accentDark }}>{open === it.id ? "접기" : "펼치기"}</T></Row>
            </Pressable>
            {open === it.id && sections.map(([key, label]) => {
              const v = it.payload?.[key];
              if (v === undefined) return null;
              return <View key={key} style={{ gap: 4 }}><T small bold>{label}</T><ClaimList claims={Array.isArray(v) ? v : [v]} /></View>;
            })}
          </View>))}
    </Card>
  );
}

/** 승인 대기 초안: edit the JSON payload, approve or reject (the web chat's side panel). */
export function Proposals({ childId }: { childId: string | null }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["proposals", childId], queryFn: () => api<Draft[]>(`/proposals${childId ? `?child_id=${childId}` : ""}`) });
  const done = () => qc.invalidateQueries();
  const approve = useMutation({ mutationFn: (id: string) => api(`/proposals/${id}/approve`, { method: "POST" }), onSuccess: done });
  const reject = useMutation({ mutationFn: (id: string) => api(`/proposals/${id}/reject`, { method: "POST" }), onSuccess: done });
  const [edit, setEdit] = useState<Record<string, string>>({});
  const save = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: unknown }) => api(`/proposals/${id}`, { method: "PUT", json: { payload } }), onSuccess: () => { setEdit({}); done(); } });
  return (
    <>
      <T small muted>{`승인 전 초안 ${data.length}건${childId ? " · 선택한 아동" : ""}`}</T>
      {!data.length && <Empty>{isLoading ? "불러오는 중…" : "대기 중인 초안이 없습니다."}</Empty>}
      {data.map((p) => {
        const text = edit[p.id] ?? JSON.stringify(p.payload, null, 2);
        let valid = true; try { JSON.parse(text); } catch { valid = false; }
        return (
          <Card key={p.id} title={p.kind} action={<Badge tone="amber">미승인</Badge>}>
            <Input multiline style={{ minHeight: 180, fontFamily: "monospace", fontSize: 12 }} value={text} onChangeText={(v) => setEdit({ ...edit, [p.id]: v })} />
            {!valid && <Notice tone="red">JSON 형식 오류</Notice>}
            <Row>
              <Button small variant="outline" title="수정 저장" disabled={!valid || edit[p.id] === undefined} onPress={() => save.mutate({ id: p.id, payload: JSON.parse(text) })} />
              <Button small title="승인" disabled={edit[p.id] !== undefined} onPress={() => approve.mutate(p.id)} />
              <Button small variant="ghost" title="반려" onPress={() => reject.mutate(p.id)} />
            </Row>
            {edit[p.id] !== undefined && <T small muted>수정 후 ‘수정 저장’을 먼저 눌러야 승인할 수 있습니다.</T>}
          </Card>);
      })}
      {(approve.error || reject.error || save.error) && <Notice tone="red">{errText(approve.error || reject.error || save.error)}</Notice>}
    </>
  );
}
