import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";

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

const page = (el: React.ReactNode) => <Suspense fallback={<p className="text-sm text-slate-400">불러오는 중…</p>}>{el}</Suspense>;

export default function App() {
  const { ready, signedIn } = useAuth();
  if (!ready) return null;
  if (!signedIn) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={page(<Dashboard />)} />
        <Route path="chat" element={page(<Chat />)} />
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
