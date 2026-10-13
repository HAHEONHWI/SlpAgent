import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, BookOpen, Brain, CalendarDays, ClipboardList, FileText, HeartHandshake, LayoutDashboard, LineChart, ListChecks, NotebookPen, Settings, Sparkles, Stethoscope, Users, Library, LogOut , UserCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useChild } from "../lib/child";
import { useMe } from "../lib/me";
import { ageLabel } from "../lib/api";
import BrandLogo from "./BrandLogo";
import { Button, Select } from "./ui";

const MENU: { to: string; label: string; icon: typeof LayoutDashboard; soon?: boolean }[] = [
  { to: "/", label: "대시보드", icon: LayoutDashboard },
  { to: "/ai", label: "AI 대화", icon: Sparkles },
  { to: "/children", label: "아동 관리", icon: Users },
  { to: "/assessments", label: "발달검사 관리", icon: ClipboardList },
  { to: "/analysis", label: "통합 발달 분석", icon: Brain },
  { to: "/behavior", label: "행동분석", icon: Stethoscope },
  { to: "/vocabulary", label: "어휘 발달 관리", icon: BookOpen },
  { to: "/plans", label: "치료계획", icon: ListChecks },
  { to: "/activities", label: "치료활동 생성", icon: Sparkles },
  { to: "/sessions", label: "회기별 치료기록", icon: NotebookPen },
  { to: "/progress", label: "발달 진행도 분석", icon: LineChart },
  { to: "/parents", label: "보호자 상담", icon: HeartHandshake },
  { to: "/voucher", label: "바우처·문서 생성", icon: FileText },
  { to: "/knowledge", label: "AI 지식자료실", icon: Library },
  { to: "/schedule", label: "일정 관리", icon: CalendarDays },
  { to: "/attendance", label: "출결 관리", icon: UserCheck },
  { to: "/settings", label: "기관 설정", icon: Settings },
];

export default function Layout() {
  const { pathname } = useLocation();
  const isAiRoute = pathname === "/ai";
  const { label, logout } = useAuth();
  const me = useMe().data;
  const { childId, child, children, setChildId } = useChild();
  return (
    <div className="flex h-dvh overflow-hidden bg-slate-50">
      <aside className="sticky top-0 hidden h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="px-4 py-3"><BrandLogo className="mx-auto w-40" /></div>
        <nav aria-label="주요 메뉴" className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {MENU.map(({ to, label, icon: I, soon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? "bg-indigo-50 font-semibold text-indigo-800" : "text-slate-600 hover:bg-slate-100"}`}>
              <I size={16} /> <span className="flex-1">{label}</span>{soon && <span className="text-[10px] text-slate-400">준비중</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white/90 px-2 py-2.5 backdrop-blur sm:gap-3 sm:px-4">
          <BrandLogo className="w-14 shrink-0 md:hidden" />
          <div className="w-[min(14rem,42vw)] sm:w-64"><Select value={childId ?? ""} onChange={(e) => setChildId(e.target.value || null)} aria-label="아동 선택">
            <option value="">아동 선택 안 함 (일반 모드)</option>
            {children.map((c) => <option key={c.id} value={c.id}>{c.alias} · {c.display_name}</option>)}
          </Select></div>
          {child && <span className="hidden text-sm text-slate-500 sm:inline">{ageLabel(child.age_months)}</span>}
          <div className="ml-auto flex min-w-0 items-center gap-1.5 text-sm text-slate-500 sm:gap-3">
            <Bell size={16} className="hidden shrink-0 sm:block" />
            {me?.org_name && <span className="hidden max-w-40 truncate font-medium text-slate-700 xl:inline">{me.org_name}</span>}
            <span className="hidden max-w-44 truncate lg:inline">{me?.email ?? label}</span>
            <Button variant="ghost" className="shrink-0 px-2 sm:px-3" onClick={logout}><LogOut size={14} /><span className="sr-only sm:not-sr-only">로그아웃</span></Button>
          </div>
        </header>
        <nav aria-label="주요 메뉴" className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1.5 md:hidden">
          {MENU.map(({ to, label, icon: I }) => (
            <NavLink key={to} to={to} end={to === "/"} aria-label={label} title={label} className={({ isActive }) =>
              `inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-xs transition-colors ${isActive ? "bg-indigo-50 font-semibold text-indigo-800" : "text-slate-600 hover:bg-slate-100"}`}>
              <I size={15} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <main className={isAiRoute
          ? "flex min-h-0 flex-1 flex-col overflow-hidden p-2 sm:p-3"
          : "mx-auto min-h-0 w-full max-w-6xl flex-1 overflow-y-auto p-4 md:p-6"}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
