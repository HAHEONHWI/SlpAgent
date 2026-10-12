import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";
import Children from "./pages/Children";
import Assessments from "./pages/Assessments";
import Behavior from "./pages/Behavior";
import Vocabulary from "./pages/Vocabulary";
import Plans from "./pages/Plans";
import Sessions from "./pages/Sessions";
import Progress from "./pages/Progress";
import Voucher from "./pages/Voucher";
import Pending from "./pages/Pending";
import Settings from "./pages/Settings";
import Schedule from "./pages/Schedule";
import Knowledge from "./pages/Knowledge";
import Analysis from "./pages/Analysis";
import Activities from "./pages/Activities";

export default function App() {
  const { ready, signedIn } = useAuth();
  if (!ready) return null;
  if (!signedIn) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="chat" element={<Chat />} />
        <Route path="children" element={<Children />} />
        <Route path="assessments" element={<Assessments />} />
        <Route path="analysis" element={<Analysis />} />
        <Route path="behavior" element={<Behavior />} />
        <Route path="vocabulary" element={<Vocabulary />} />
        <Route path="plans" element={<Plans />} />
        <Route path="activities" element={<Activities />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="progress" element={<Progress />} />
        <Route path="parents" element={<Pending title="보호자 상담" note="상담 기록을 저장하는 백엔드 API가 아직 없습니다(문서 생성기는 parent_consultations를 읽기만 함). 상담자료 초안은 AI 채팅(아동 선택)에서 요청할 수 있습니다." />} />
        <Route path="voucher" element={<Voucher />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
