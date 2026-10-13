import { useQuery } from "@tanstack/react-query";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { api } from "../lib/api";
import { errText } from "../lib/hooks";
import { Card, Notice } from "./ui";

// Requests would hit production data, so "Try it out" stays visible but can never be pressed.
const readOnly = () => ({
  wrapComponents: {
    TryItOutButton: () => () => <button className="btn try-out__btn" disabled title="운영 환경에서는 실행할 수 없습니다" style={{ opacity: 0.4, cursor: "not-allowed" }}>Try it out</button>,
  },
});

/** Site admin: API reference (the spec is served to site admins only; production has no public /docs). */
export default function ApiDocs() {
  const spec = useQuery({ queryKey: ["platform", "openapi"], queryFn: () => api<object>("/platform/openapi.json"), staleTime: Infinity });
  return (
    <Card title="API 문서">
      {spec.error ? <Notice tone="red">{errText(spec.error)}</Notice>
        : !spec.data ? <p className="text-sm text-slate-400">불러오는 중…</p>
        : <SwaggerUI spec={spec.data} plugins={[readOnly]} docExpansion="none" defaultModelsExpandDepth={-1} />}
    </Card>
  );
}
