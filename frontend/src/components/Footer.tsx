import clsx from "clsx";

const START = 2026;

/** Copyright line shown at the bottom of every screen. */
export default function Footer({ className, privacyLink = true }: { className?: string; privacyLink?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className={clsx("text-center text-xs text-slate-400 print:hidden", className)}>
      <p>
        © {year > START ? `${START}–${year}` : START} SLP AI. All rights reserved.
        {privacyLink && <> · <a href="/privacy" target="_blank" rel="noopener" className="underline hover:text-slate-700">개인정보처리방침</a></>}
      </p>
    </footer>
  );
}
