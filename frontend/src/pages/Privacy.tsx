import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import policy from "../content/privacy-policy.md?raw";
import Footer from "../components/Footer";

const pending = "# 문서를 준비 중입니다\n\n이용약관과 환불정책은 확정 후 게시됩니다.";
const documents = { privacy: policy, terms: pending, refund: pending };

/** Public legal documents, available before sign-in. */
export default function Privacy({ kind = "privacy" }: { kind?: keyof typeof documents }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <a href="/" className="inline-flex min-h-11 items-center font-bold text-indigo-700">SLP AI</a>
          <a href="/" className="inline-flex min-h-11 items-center text-sm text-slate-500 hover:text-slate-800">서비스로 돌아가기</a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <article className="policy-markdown rounded-2xl border border-slate-200 bg-white p-6 md:p-10">
          <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}>{documents[kind]}</ReactMarkdown>
        </article>
        <nav aria-label="정책 문서" className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-600">
          {([["terms", "이용약관"], ["privacy", "개인정보처리방침"], ["refund", "환불정책"]] as const).map(([key, label]) => (
            <a key={key} href={`/${key}`} aria-current={kind === key ? "page" : undefined} className="inline-flex min-h-11 items-center underline hover:text-slate-900">{label}</a>
          ))}
        </nav>
        <Footer className="mt-6 text-slate-500" privacyLink={false} />
      </main>
    </div>
  );
}
