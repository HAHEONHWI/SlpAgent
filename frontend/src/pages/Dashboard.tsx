import { useQuery } from "@tanstack/react-query";
import { BookOpen, CalendarDays, ClipboardList, Sparkles, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useChild } from "../lib/child";
import { useMe } from "../lib/me";
import { errText } from "../lib/hooks";
import { Badge, Card, Notice } from "../components/ui";

type ClassRecord = {
  date: string; start: string | null; end: string | null; child_id: string; therapist: string | null;
  schedule_id: string | null; makeup: boolean; state: { status: string | null };
  sessions: unknown[]; consultations: unknown[]; recordings: unknown[];
};
type Schedule = { id: string; date: string; start: string; end: string; child_id: string; therapist: string; status: string; moved_from?: string | null };

const monthAfter = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
const dateLabel = (date: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long",
}).format(new Date(`${date}T12:00:00+09:00`));
const hasRecord = (r: ClassRecord) => r.sessions.length > 0 || r.consultations.length > 0 || r.recordings.length > 0;
const notHeld = ["absent", "excused", "moved", "cancelled"];

export default function Dashboard() {
  const { children } = useChild();
  const me = useMe().data;
  const childScope = children.map((c) => c.id).sort().join("|");
  const now = new Date();
  const day = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const clock = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const currentMonth = day.slice(0, 7);
  const nextMonth = monthAfter(currentMonth);
  const therapist = me?.role === "therapist" ? me.therapist_name : undefined;
  const scopeReady = me?.role !== "therapist" || !!therapist;
  const params = new URLSearchParams({ month: currentMonth });
  if (therapist) params.set("therapist", therapist);
  const agenda = useQuery({
    queryKey: ["dashboard-class-records", me?.uid, childScope, currentMonth, me?.role, therapist],
    queryFn: () => api<ClassRecord[]>(`/class-records?${params}`),
    enabled: !!me?.uid && scopeReady,
  });
  const pending = useQuery({
    queryKey: ["dashboard-proposals", me?.uid, childScope],
    queryFn: () => api<unknown[]>("/proposals"),
    enabled: !!me?.uid,
  });
  const todayClasses = (agenda.data ?? []).filter((r) => r.date === day && r.schedule_id && r.state.status !== "moved")
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  const missingLogs = (agenda.data ?? []).filter((r) => r.schedule_id && !hasRecord(r) && !notHeld.includes(r.state.status ?? "")
    && (r.date < day || (r.date === day && !!r.end && r.end <= clock)));
  const upcomingThisMonth = [...(agenda.data ?? [])].filter((r) => r.date > day && r.schedule_id && r.state.status !== "moved")
    .sort((a, b) => `${a.date} ${a.start ?? ""}`.localeCompare(`${b.date} ${b.start ?? ""}`))[0];
  // shortcut: next lookup checks one month ahead, extend if clinics schedule farther ahead.
  const needNextMonth = !!agenda.data && !todayClasses.length && !upcomingThisMonth;
  const nextSchedules = useQuery({
    queryKey: ["dashboard-next-schedule", me?.uid, childScope, nextMonth, me?.role, therapist],
    queryFn: () => api<Schedule[]>(`/schedules?month=${nextMonth}`),
    enabled: needNextMonth,
  });
  const nextMonthSchedule = (nextSchedules.data ?? []).filter((s) => s.date > day && s.status !== "cancelled" && s.status !== "moved"
    && (me?.role !== "therapist" || s.therapist === therapist))
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))[0];
  const canWrite = me?.role === "admin" || me?.role === "therapist";
  const actions = canWrite ? [
    { title: "치료일지 작성", description: "오늘 진행한 치료 기록", to: "/sessions", Icon: ClipboardList },
    { title: "AI 초안 검토", description: "생성된 초안 확인·승인", to: "/ai", Icon: Sparkles },
    { title: "수업 기록 조회", description: "달별 수업과 치료 기록", to: "/class-records", Icon: BookOpen },
    { title: "아동 관리", description: "아동 정보와 치료 이력", to: "/children", Icon: Users },
  ] : [
    { title: "수업 기록 조회", description: "달별 수업과 치료 기록", to: "/class-records", Icon: BookOpen },
    { title: "AI 대화", description: "언어치료 지식 대화", to: "/ai", Icon: Sparkles },
    { title: "일정 관리", description: "기관 일정과 시간표 확인", to: "/schedule", Icon: CalendarDays },
    { title: "아동 관리", description: "아동 정보와 치료 이력", to: "/children", Icon: Users },
  ];
  const metrics = [
    { label: "오늘 치료", value: agenda.data ? todayClasses.length : "–", unit: "건" },
    { label: "미작성 일지", value: agenda.data ? missingLogs.length : "–", unit: "건" },
    { label: "AI 승인 대기", value: pending.data?.length ?? "–", unit: "건" },
  ];

  return (
    <div className="space-y-8">
      <header className="rounded-3xl bg-indigo-50 p-6 shadow-sm md:p-8">
        <p className="text-sm font-semibold text-indigo-700">{dateLabel(day)}</p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight md:text-[40px]">오늘도 좋은 하루 보내세요.</h1>
        <p className="mt-2 text-sm text-slate-600 md:text-base">오늘 예정된 치료와 처리할 업무를 확인하세요.</p>
        <p className="mt-5 text-sm text-slate-600">{me?.role === "admin" ? "기관 아동" : me?.role === "therapist" ? "담당 아동" : "등록 아동"} <b className="text-slate-900">{children.length}명</b></p>
      </header>

      <section aria-label="오늘의 업무 현황" className="grid gap-3 sm:grid-cols-3">
        {metrics.map((item) => (
          <article key={item.label} className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="text-sm text-slate-600">{item.label}</h2>
            <p className="mt-3 flex items-baseline gap-2"><span className="text-5xl font-semibold leading-none tracking-[-.04em] text-indigo-700">{item.value}</span><span className="text-sm text-slate-500">{item.unit}</span></p>
          </article>))}
      </section>

      <Card title="오늘의 치료 일정" action={<Link to="/schedule" className="text-sm font-semibold text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">전체 일정 보기</Link>}>
        {!scopeReady ? <p className="py-6 text-center text-sm text-slate-500">계정을 기관 치료사 목록에 연결하면 담당 일정이 표시됩니다.</p>
          : agenda.isLoading ? <p className="py-6 text-center text-sm text-slate-500">오늘 일정을 불러오는 중…</p>
          : agenda.error ? <Notice tone="red">오늘 일정을 불러오지 못했습니다: {errText(agenda.error)}</Notice>
          : todayClasses.length ? <ul className="divide-y divide-slate-200">
            {todayClasses.map((r, index) => {
              const child = children.find((c) => c.id === r.child_id);
              return <li key={r.schedule_id ?? `${r.child_id}-${index}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4 first:pt-0 last:pb-0">
                <span className="w-28 shrink-0 text-sm tabular-nums text-slate-600">{r.start ?? "시간 미정"}{r.end ? `–${r.end}` : ""}</span>
                <span className="min-w-0 flex-1 font-semibold">{child?.alias ?? "아동"}<span className="ml-2 text-sm font-normal text-slate-500">치료 수업</span></span>
                {me?.role === "admin" && r.therapist && <span className="text-sm text-slate-500">{r.therapist}</span>}
                {r.makeup && <Badge tone="indigo">보강</Badge>}
                {r.state.status === "absent" && <Badge tone="red">결석</Badge>}
                {r.state.status === "excused" && <Badge>사유결석</Badge>}
              </li>;
            })}
          </ul>
          : upcomingThisMonth || nextMonthSchedule ? (() => {
            const item = upcomingThisMonth ?? nextMonthSchedule!;
            const child = children.find((c) => c.id === item.child_id);
            return <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold text-indigo-700">다음 예정 치료</p>
              <p className="mt-2 font-semibold">{dateLabel(item.date)} · {item.start}{item.end ? `–${item.end}` : ""}</p>
              <p className="mt-1 text-sm text-slate-600">{child?.alias ?? "아동"} · 치료 수업</p>
            </div>;
          })()
          : needNextMonth && nextSchedules.isLoading ? <p className="py-6 text-center text-sm text-slate-500">다음 일정을 확인하는 중…</p>
          : nextSchedules.error ? <Notice tone="red">다음 일정을 불러오지 못했습니다: {errText(nextSchedules.error)}</Notice>
          : <p className="py-6 text-center text-sm text-slate-500">오늘과 이후 예정된 치료 일정이 없습니다.</p>}
      </Card>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-xl font-semibold md:text-2xl">빠른 업무 실행</h2><p className="mt-1 text-sm text-slate-500">자주 쓰는 기능으로 바로 이동하세요.</p></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {actions.map(({ title, description, to, Icon }) => (
            <Link key={to} to={to} className="group flex min-h-32 items-start gap-3 rounded-3xl bg-white p-5 shadow-sm transition-colors hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-indigo-100 text-indigo-700"><Icon size={19} /></span>
              <span><span className="block font-semibold">{title}</span><span className="mt-1 block text-sm text-slate-500">{description}</span></span>
            </Link>))}
        </div>
      </section>

      {(pending.error || (me?.role === "therapist" && !me.therapist_name)) && (
        <Notice tone={pending.error ? "red" : "amber"}>
          {pending.error ? `AI 초안 현황을 불러오지 못했습니다: ${errText(pending.error)}` : "치료사 계정을 기관에 연결해야 업무 현황을 볼 수 있습니다."}
        </Notice>)}
    </div>
  );
}
