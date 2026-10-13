import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import policy from "../content/privacy-policy.md?raw";
import Footer from "../components/Footer";

/** Public page (no sign-in required). Source: src/content/privacy-policy.md */
export default function Privacy() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <a href="/" className="font-bold text-indigo-700">SLP AI</a>
          <a href="/" className="text-sm text-slate-500 hover:text-slate-800">서비스로 돌아가기</a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <article className="policy-markdown rounded-2xl border border-slate-200 bg-white p-6 md:p-10">
          <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}>{policy}</ReactMarkdown>
        </article>
        <Footer className="mt-6" privacyLink={false} />
      </main>
    </div>
  );
}
