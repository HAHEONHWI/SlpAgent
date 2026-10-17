import type { Me } from "./me";

export type MenuItem = { to: string; label: string; desc: string; child?: boolean; show?: (me: Me | undefined) => boolean };
export type MenuGroup = { id: string; title: string; items: MenuItem[] };

const adminOnly = (me: Me | undefined) => me?.role === "admin";
const canWrite = (me: Me | undefined) => me?.role === "admin" || me?.role === "therapist";

export const HOME: MenuItem = { to: "/", label: "대시보드", desc: "담당 아동 수 · 승인 대기 AI 초안 · AI 참고 검사 서류" };
export const ACCOUNT: MenuItem = { to: "/account", label: "내 계정", desc: "비밀번호 변경 · 회원 탈퇴" };
// Grouped so the everyday screens are short to find. `child` marks screens that need a selected child.
export const GROUPS: MenuGroup[] = [
  { id: "daily", title: "매일", items: [
    { to: "/schedule", label: "일정 관리", desc: "주간 시간표 · 날짜별 일정 · 기관 휴무일" },
    { to: "/attendance", label: "출결 관리", desc: "일별 출결 · 보강 · 장기결강" },
    { to: "/sessions", label: "수업 기록", child: true, desc: "기록 작성 · 녹음 파일로 기록 만들기" },
    { to: "/class-records", label: "수업 기록 조회", desc: "달별 수업 · 출결 · 기록 통합 조회" },
    { to: "/children", label: "아동 관리", desc: "등록 · 엑셀 일괄 등록 · 휴지통" },
  ] },
  { id: "care", title: "아동 평가·치료", items: [
    { to: "/analysis", label: "통합 발달 분석", child: true, desc: "회기·관찰 기록 기반 AI 초안 · 승인 이력" },
    { to: "/behavior", label: "행동분석", child: true, desc: "ABC 관찰 기록 · 관찰 목록" },
    { to: "/vocabulary", label: "어휘 발달 관리", child: true, desc: "수용/표현 어휘 · 습득 차트" },
    { to: "/plans", label: "치료계획", child: true, desc: "장·단기 목표 · 버전 승인" },
    { to: "/progress", label: "발달 진행도 분석", child: true, desc: "활동별 정반응률 추이" },
  ] },
  { id: "ai", title: "AI", items: [
    { to: "/ai", label: "AI 대화", desc: "언어치료 지식 · 임상 대화 모드" },
    { to: "/activities", label: "치료활동 생성", child: true, show: canWrite, desc: "조건 입력 → AI 초안 → 승인/반려" },  // 보조(읽기 전용)는 만들 수 없음
    { to: "/knowledge", label: "AI 지식자료실", desc: "검사 서류 등 AI 참고자료 · 키워드 검색" },
  ] },
  { id: "admin", title: "행정", items: [
    { to: "/voucher", label: "바우처·문서 생성", child: true, desc: "월별 집계 · DOCX/PDF/HWPX 출력" },
    { to: "/settlement", label: "정산", show: (me) => !!me?.can_settle, desc: "월별 바우처 · 본인부담금 · 유료 수업" },  // 기관 관리자와 회계 담당만
    { to: "/notices", label: "공지사항", desc: "사이트 공지 · 기관 공지" },
    { to: "/settings", label: "기관 설정", show: adminOnly, desc: "단가 · 치료사 · 회계 담당 · 감사로그" },
  ] },
];

export const matches = (to: string, pathname: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/"));
/** The menu group and item of a path, for the page header kicker. */
export const findMenu = (pathname: string) => {
  for (const g of GROUPS) { const it = g.items.find((i) => matches(i.to, pathname)); if (it) return { group: g, item: it }; }
  return null;
};
export const roleLabel = (me: Me | undefined) => !me?.role ? "" : me.role === "admin" ? "기관 관리자"
  : me.role === "therapist" ? (me.can_settle ? "치료사 · 회계 담당" : "치료사") : me.role === "assistant" ? "보조 (읽기 전용)" : me.role;
