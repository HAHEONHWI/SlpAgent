import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import clsx from "clsx";
import { Bell, ChevronDown, CircleUser, LogOut } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useChild } from "../lib/child";
import { useMe } from "../lib/me";
import { seenAt, useNotices } from "../lib/notices";
import { GROUPS, HOME, matches, roleLabel } from "../lib/menu";
import Footer from "./Footer";
import ChildPicker from "./ChildPicker";

const pill = "flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm sm:gap-2 sm:px-[18px] sm:text-[15px] font-semibold tracking-[-.01em] transition-colors";

export default function Layout() {
  const { pathname } = useLocation();
  const isAiRoute = pathname === "/ai";
  const { label, logout } = useAuth();
  const me = useMe().data;
  const [open, setOpen] = useState<string | null>(null);  // the group whose menu panel is showing
  useEffect(() => { setOpen(null); }, [pathname]);  // close the menu panel after navigating
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  const notices = useNotices().data ?? [];
  const seen = seenAt(me?.uid); // re-read on every render (route changes), so visiting 공지사항 clears the badge
  const unread = pathname === "/notices" ? 0 : notices.filter((n) => n.created_at > seen).length;
  const { childId, setChildId } = useChild();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.show || i.show(me)) })).filter((g) => g.items.length);
  const openGroup = groups.find((g) => g.id === open);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 print:block print:h-auto print:overflow-visible print:bg-white">
      <header className="relative z-40 shrink-0 bg-slate-50 print:hidden">
        <div className="flex h-16 items-center gap-2 px-3 sm:gap-4 sm:px-4 md:px-8">
          <Link to="/" title="메인으로" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap text-xl font-semibold tracking-[-.02em] text-slate-900">
            <span className="block size-[18px] rounded-full bg-indigo-600" aria-hidden /><span className="hidden sm:inline">SLP AI</span>
          </Link>
          <ChildPicker variant="header" className="min-w-0 flex-1 sm:flex-none md:ml-6 sm:w-[300px]" value={childId} onChange={setChildId} emptyLabel="아동 선택 안 함 (일반 모드)" aria-label="아동 선택" />
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 text-sm sm:gap-2 lg:gap-4">
            <Link to="/notices" title="공지사항" className="relative grid size-10 shrink-0 place-items-center rounded-full text-slate-900 hover:bg-slate-100">
              <Bell size={20} />
              {unread > 0 && <span className="absolute right-0 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-indigo-600 px-1 text-[11px] font-semibold text-slate-50">{unread > 9 ? "9+" : unread}</span>}
              <span className="sr-only">공지사항{unread > 0 ? ` (새 공지 ${unread}개)` : ""}</span>
            </Link>
            {me?.org_name && (
              <span className="hidden max-w-48 flex-col text-right leading-tight xl:flex">
                <span className="truncate font-semibold">{me.org_name}</span>
                <span className="truncate text-[11px] text-slate-500">{roleLabel(me)}</span>
              </span>)}
            <Link to="/account" title={me?.email ?? label ?? "내 계정"} className="inline-flex shrink-0 items-center gap-2 rounded-full border-slate-300 p-2 font-semibold hover:bg-slate-900/[.06] md:border md:px-3.5 md:py-1.5">
              <CircleUser size={16} /><span className="sr-only md:not-sr-only">내 계정</span>
            </Link>
            <button type="button" onClick={logout} className="inline-flex shrink-0 items-center gap-1.5 rounded-full p-2 font-semibold hover:bg-slate-100 md:px-3 md:py-1.5">
              <LogOut size={16} /><span className="sr-only md:not-sr-only">로그아웃</span>
            </button>
          </div>
        </div>
        <nav aria-label="주요 메뉴" className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 px-3 py-2.5 sm:px-4 md:px-8 [scrollbar-width:none]">
          <NavLink to={HOME.to} end className={({ isActive }) => clsx(pill, isActive ? "bg-indigo-100 text-indigo-700" : "text-slate-900 hover:bg-slate-100")}>{HOME.label}</NavLink>
          {groups.map((g) => {
            const here = g.items.some((i) => matches(i.to, pathname)), shown = open === g.id;
            return (
              <button key={g.id} type="button" onClick={() => setOpen(shown ? null : g.id)} aria-expanded={shown} aria-controls="menu-panel"
                className={clsx(pill, here ? "bg-indigo-100 text-indigo-700" : shown ? "bg-slate-100 text-indigo-700" : "text-slate-900 hover:bg-slate-100")}>
                {g.title}<ChevronDown size={14} strokeWidth={2.5} className={clsx("transition-transform", shown && "rotate-180")} />
              </button>);
          })}
        </nav>
        {openGroup && <>
          <div className="fixed inset-0 -z-10" onClick={() => setOpen(null)} aria-hidden />
          <div id="menu-panel" className="absolute inset-x-3 top-[calc(100%+6px)] max-h-[calc(100dvh-140px)] overflow-y-auto rounded-[28px] bg-slate-50 shadow-lg sm:inset-x-4 md:inset-x-8">
            <div className="flex flex-col md:flex-row">
              <div className="shrink-0 bg-slate-100 px-6 py-4 md:w-[200px] md:py-5">
                <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-indigo-700">메뉴</div>
                <h3 className="mt-1.5 text-xl font-semibold leading-tight md:text-[25px]">{openGroup.title}</h3>
              </div>
              {openGroup.items.map((it) => (
                <NavLink key={it.to} to={it.to} className={({ isActive }) => clsx("flex min-w-0 flex-col items-start gap-1 border-b border-slate-200 px-5 py-4 text-slate-900 transition-colors last:border-b-0 md:max-w-[260px] md:flex-1 md:basis-0 md:border-b-0 md:border-r md:pb-6 md:pt-5", isActive ? "bg-indigo-100" : "hover:bg-slate-100")}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold">
                    <span className="whitespace-nowrap">{it.label}</span>
                    {it.child && <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-normal text-indigo-800">아동 선택</span>}
                  </span>
                  <span className="text-xs leading-[1.45] text-slate-900/70 [word-break:keep-all]">{it.desc}</span>
                  <span className="mt-auto hidden pt-2 text-[11px] tracking-[.04em] text-slate-500 md:block">{it.to}</span>
                </NavLink>))}
            </div>
            <div className="border-t border-slate-200 px-6 py-2.5 text-xs text-slate-500">
              <a href="/privacy" target="_blank" rel="noopener" className="text-slate-500 hover:text-slate-900">개인정보처리방침</a>
            </div>
          </div>
        </>}
      </header>
      <main className={isAiRoute
        ? "flex min-h-0 flex-1 flex-col overflow-hidden p-2 sm:p-3"
        : "min-h-0 w-full flex-1 overflow-y-auto print:overflow-visible"}>
        {isAiRoute ? <Outlet /> : (
          <div className="mx-auto w-full max-w-[1440px] px-4 pb-10 pt-7 md:px-8 md:pt-10 print:max-w-none print:p-0">
            <Outlet />
            <Footer className="mt-14" />
          </div>)}
      </main>
    </div>
  );
}
