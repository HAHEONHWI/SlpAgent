import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, History, Megaphone, Menu, X, BookOpen, Brain, CalendarDays, ClipboardList, FileText, LayoutDashboard, LineChart, ListChecks, NotebookPen, Settings, Sparkles, Stethoscope, Users, Library, LogOut, UserCheck, UserCog, Wallet } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useChild } from "../lib/child";
import { useMe } from "../lib/me";
import { seenAt, useNotices } from "../lib/notices";
import { ageLabel } from "../lib/api";
import BrandLogo from "./BrandLogo";
import Footer from "./Footer";
import ChildPicker from "./ChildPicker";
import { Button, Select } from "./ui";

const MENU: { to: string; label: string; icon: typeof LayoutDashboard; soon?: boolean; settle?: boolean }[] = [
  { to: "/", label: "대시보드", icon: LayoutDashboard },
  { to: "/ai", label: "AI 대화", icon: Sparkles },
  { to: "/children", label: "아동 관리", icon: Users },
  { to: "/assessments", label: "발달검사 관리", icon: ClipboardList },
  { to: "/analysis", label: "통합 발달 분석", icon: Brain },
  { to: "/behavior", label: "행동분석", icon: Stethoscope },
  { to: "/vocabulary", label: "어휘 발달 관리", icon: BookOpen },
  { to: "/plans", label: "치료계획", icon: ListChecks },
  { to: "/activities", label: "치료활동 생성", icon: Sparkles },
  { to: "/sessions", label: "수업 기록", icon: NotebookPen },
  { to: "/class-records", label: "수업 기록 조회", icon: History },
  { to: "/progress", label: "발달 진행도 분석", icon: LineChart },
  { to: "/voucher", label: "바우처·문서 생성", icon: FileText },
  { to: "/knowledge", label: "AI 지식자료실", icon: Library },
  { to: "/schedule", label: "일정 관리", icon: CalendarDays },
  { to: "/attendance", label: "출결 관리", icon: UserCheck },
  { to: "/settlement", label: "정산", icon: Wallet, settle: true },  // 기관 관리자와 회계 담당만
  { to: "/notices", label: "공지사항", icon: Megaphone },
  { to: "/settings", label: "기관 설정", icon: Settings },
];

export default function Layout() {
  const { pathname } = useLocation();
  const isAiRoute = pathname === "/ai";
  const { label, logout } = useAuth();
  const me = useMe().data;
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [pathname]); // close the mobile menu after navigating
  const notices = useNotices().data ?? [];
  const seen = seenAt(me?.uid); // re-read on every render (route changes), so visiting 공지사항 clears the badge
  const unread = pathname === "/notices" ? 0 : notices.filter((n) => n.created_at > seen).length;
  const { childId, child, children, setChildId } = useChild();
  const menu = MENU.filter((m) => !m.settle || me?.can_settle);
  return (
    <div className="flex h-dvh overflow-hidden bg-slate-50 print:block print:h-auto print:overflow-visible print:bg-white">
      <aside className="sticky top-0 hidden print:!hidden h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <Link to="/" title="메인으로" className="block px-4 py-3"><BrandLogo className="mx-auto w-40" /></Link>
        <nav aria-label="주요 메뉴" className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {menu.map(({ to, label, icon: I, soon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? "bg-indigo-50 font-semibold text-indigo-800" : "text-slate-600 hover:bg-slate-100"}`}>
              <I size={16} /> <span className="flex-1">{label}</span>{soon && <span className="text-[10px] text-slate-400">준비중</span>}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-4 py-3 text-left text-xs text-slate-500">
          <a href="/privacy" target="_blank" rel="noopener" className="hover:text-slate-800">개인정보처리방침</a>
          <p className="mt-1 text-[11px] text-slate-400">© {new Date().getFullYear()} SLP AI</p>
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex print:hidden shrink-0 items-center gap-2 border-b border-slate-200 bg-white/90 px-2 py-2.5 backdrop-blur sm:gap-3 sm:px-4">
          <button className="shrink-0 rounded-md p-1.5 text-slate-600 hover:bg-slate-100 md:hidden" onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={menuOpen} aria-controls="mobile-menu">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <Link to="/" title="메인으로" className="shrink-0 md:hidden"><BrandLogo className="w-11 sm:w-14" /></Link>
          <ChildPicker className="w-[min(14rem,38vw)] sm:w-64" value={childId} onChange={setChildId} emptyLabel="아동 선택 안 함 (일반 모드)" aria-label="아동 선택" />
          {child && <span className="hidden text-sm text-slate-500 sm:inline">{ageLabel(child.age_months)}</span>}
          <div className="ml-auto flex min-w-0 items-center gap-1.5 text-sm text-slate-500 sm:gap-3">
            <Link to="/notices" title="공지사항" className="relative shrink-0 rounded-md p-1.5 hover:bg-slate-100 hover:text-slate-800">
              <Bell size={16} />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
              <span className="sr-only">공지사항{unread > 0 ? ` (새 공지 ${unread}개)` : ""}</span>
            </Link>
            {me?.org_name && <span className="hidden max-w-40 truncate font-medium text-slate-700 xl:inline">{me.org_name}</span>}
            <Link to="/account" title="내 계정" className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 hover:bg-slate-100 hover:text-slate-800"><UserCog size={15} /><span className="hidden max-w-44 truncate lg:inline">{me?.email ?? label}</span><span className="sr-only">내 계정</span></Link>
            <Button variant="ghost" className="shrink-0 px-2 sm:px-3" onClick={logout}><LogOut size={14} /><span className="sr-only sm:not-sr-only">로그아웃</span></Button>
          </div>
        </header>
        {menuOpen && (
          <div className="fixed inset-0 top-[3.25rem] z-20 bg-slate-900/30 md:hidden print:hidden" onClick={() => setMenuOpen(false)}>
            <nav id="mobile-menu" aria-label="주요 메뉴" className="max-h-full overflow-y-auto border-b border-slate-200 bg-white p-3 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <Link to="/" className="mb-2 flex items-center gap-2 px-1"><BrandLogo className="w-16" />{me?.org_name && <span className="truncate text-sm font-medium text-slate-700">{me.org_name}</span>}</Link>
              <div className="grid grid-cols-3 gap-1.5">
                {menu.map(({ to, label, icon: I }) => (
                  <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) =>
                    `flex flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-center text-xs leading-tight transition-colors ${isActive ? "bg-indigo-50 font-semibold text-indigo-800" : "text-slate-600 hover:bg-slate-100"}`}>
                    <I size={18} /><span className="[word-break:keep-all]">{label}</span>
                  </NavLink>))}
              </div>
              <a href="/privacy" target="_blank" rel="noopener" className="mt-3 block px-1 text-xs text-slate-500">개인정보처리방침</a>
            </nav>
          </div>)}
        <main className={isAiRoute
          ? "flex min-h-0 flex-1 flex-col overflow-hidden p-2 sm:p-3"
          : "mx-auto min-h-0 w-full max-w-6xl flex-1 overflow-y-auto p-4 md:p-6 print:max-w-none print:overflow-visible print:p-0"}>
          <Outlet />
          {!isAiRoute && <Footer className="mt-10 pb-2" />}
        </main>
      </div>
    </div>
  );
}
