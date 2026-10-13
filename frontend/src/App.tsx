import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import SignupGate from "./pages/SignupGate";
import { useMe } from "./lib/me";
import { Button, Notice } from "./components/ui";

// Pages load on demand so the first screen does not pull in charts and every form.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Chat = lazy(() => import("./pages/Chat"));
const Children = lazy(() => import("./pages/Children"));
const Assessments = lazy(() => import("./pages/Assessments"));
const Behavior = lazy(() => import("./pages/Behavior"));
const Vocabulary = lazy(() => import("./pages/Vocabulary"));
const Plans = lazy(() => import("./pages/Plans"));
const Sessions = lazy(() => import("./pages/Sessions"));
const Progress = lazy(() => import("./pages/Progress"));
const Voucher = lazy(() => import("./pages/Voucher"));
const Parents = lazy(() => import("./pages/Parents"));
const Settings = lazy(() => import("./pages/Settings"));
const Schedule = lazy(() => import("./pages/Schedule"));
const Knowledge = lazy(() => import("./pages/Knowledge"));
const Analysis = lazy(() => import("./pages/Analysis"));
const Activities = lazy(() => import("./pages/Activities"));
const Platform = lazy(() => import("./pages/Platform"));

const page = (el: React.ReactNode) => <Suspense fallback={<p className="text-sm text-slate-400">불러오는 중…</p>}>{el}</Suspense>;

export default function App() {
  const { ready, signedIn, logout } = useAuth();
  const me = useMe();
  if (!ready) return null;
  if (!signedIn) return <Login />;
  if (me.isLoading) return <p className="p-6 text-sm text-slate-400">계정 확인 중…</p>;
  if (me.error || !me.data) return <div className="mx-auto max-w-md space-y-3 p-6"><Notice tone="red">계정 정보를 불러오지 못했습니다: {String((me.error as Error)?.message ?? "")}</Notice><Button variant="outline" onClick={logout}>로그아웃</Button></div>;
  // Site admins manage signups and see aggregate counts only; they never get the clinical screens.
  if (me.data.status === "site_admin") return page(<Platform />);
  if (me.data.status !== "active") return <SignupGate me={me.data} />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={page(<Dashboard />)} />
        <Route path="ai" element={page(<Chat />)} />
        <Route path="children" element={page(<Children />)} />
        <Route path="assessments" element={page(<Assessments />)} />
        <Route path="analysis" element={page(<Analysis />)} />
        <Route path="behavior" element={page(<Behavior />)} />
        <Route path="vocabulary" element={page(<Vocabulary />)} />
        <Route path="plans" element={page(<Plans />)} />
        <Route path="activities" element={page(<Activities />)} />
        <Route path="sessions" element={page(<Sessions />)} />
        <Route path="progress" element={page(<Progress />)} />
        <Route path="parents" element={page(<Parents />)} />
        <Route path="voucher" element={page(<Voucher />)} />
        <Route path="knowledge" element={page(<Knowledge />)} />
        <Route path="schedule" element={page(<Schedule />)} />
        <Route path="settings" element={page(<Settings />)} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
