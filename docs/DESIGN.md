# SLP AI public site design

## 1. Atmosphere and identity

Continue the existing application's warm paper, brown ink and terracotta identity from `frontend/src/index.css`. Use an editorial introduction with readable Korean copy and a clearly labelled fictional workflow example. Keep the existing SLP AI logo.

## 2. Color

Public CSS tokens: `--paper: #fcf8f2`, `--surface: #fffdf9`, `--wash: #f6eee4`, `--ink: #4a3d35`, `--muted: #6b5c50`, `--line: #ddcfbf`, `--accent: #a93b20`, `--accent-hover: #8a2f18`, `--success: #2f5734`, `--success-wash: #e6f1e4`. These are extracted from the existing app palette. Only the masking fields use `--redaction: #ffffff` and `--redaction-ink: #111111`, with a neutral hairline. Text selection uses accent background and surface text so it remains visible on the wash. Accent identifies the primary action. Neutral rules divide sections. Preserve the application's light theme under both system theme preferences.

## 3. Typography

Use the local Korean system sans-serif stack, avoiding a render-blocking font request. Body 17px/1.8, secondary 15px/1.7, small 13px/1.6, subheading 20px, section titles 28–40px/1.3, hero introductory line 26–40px and emphasized `하나로.` 44–72px/1.25. Weights 400, 500, 600, 700. Korean uses `word-break: keep-all` with an overflow fallback. Headings use balanced wrapping.

## 4. Spacing and layout

4px base unit; spacing tokens 4, 8, 12, 16, 24, 32, 48, 64, 96px. Content width 1160px; page gutters 24px, reducing to 20px on compact screens. Two-column hero and workflow become one column below 800px. A three-column feature list becomes one column. No nested scrollers, fixed-height copy blocks or sticky navigation. Neutral 1px rules; radius 12/20/28px. No shadows or gradients.

Layout: Public introduction - show AI, daily records and ERP as one service, then lead with the consultation-to-draft example; content-limiter (https://github.com/changeroa/StyleGallery/blob/main/patterns/containment/content-limiter.md) + split hero + stack; scroll owner: `document.scrollingElement`; anti-patterns: fixed-height copy, nested scrolling, horizontal overflow and reordered keyboard focus.

Layout: Recording, text masking and ERP - pair each explanation with a concrete example, stacked below 800px; split-screen (https://github.com/changeroa/StyleGallery/blob/main/patterns/split-sidebar/split-screen.md); scroll owner: `document.scrollingElement`; anti-patterns: equal emphasis on secondary recording, fixed panel heights and clipped Korean text.

Layout: Recording substeps - preserve the original compact two-column section: introduction on the left, three ordered rows on the right; split-screen (https://github.com/changeroa/StyleGallery/blob/main/patterns/split-sidebar/split-screen.md); scroll owner: `document.scrollingElement`; anti-patterns: separate viewport scenes, extra illustrations, nested scrollers or changed source order. Hero top padding remains 32px on desktop and 24px below 800px.

Layout: Closing actions — primary start action with a secondary contact link; wrapping cluster; scroll owner: `document.scrollingElement`; anti-patterns: fixed action widths exceeding the container, reordered focus or nested scrolling.

## 5. Components and brief

- Primary action: `서비스 시작하기`, linking to `/login`. The header login link remains a text action.
- Secondary closing action: `문의하기` opens `mailto:contact@heonhwi.dev` through the visitor's configured email app. Show the same public email in the footer and Organization metadata; never send mail automatically.
- Information priorities: `AI·일지 작성·ERP까지, 하나로.`; parent-consultation recordings become today's draft, with full-session recordings secondary; AI-assisted planning and organization operations. Review and approval remain beside the draft.
- Required content: brand, service definition, session and recording drafts, treatment plans and activities, schedules and attendance, voucher documents and settlement, organization permissions, approval flow, signup approval, proposed Starter/Pro/Organization pricing, FAQ, privacy link.
- Search intent: identify SLP AI as an AI work assistant for Korean speech-language therapists and organizations. Explain language-therapy records, recording drafts, treatment plans and developmental-rehabilitation voucher records in visible prose and matching metadata. Keep the therapist approval requirement and the existing primary action. Search-result position is external and is not a product claim.
- Public search title: lead with `언어치료 AI 업무 도우미`, followed by the `SLP AI` brand. Keep the description factual and consistent across search/social metadata; retain the Organization and WebSite brand names.
- Pricing proposal: Starter KRW 0/month, Pro KRW 29,000/month per therapist, Organization KRW 99,000/month per organization, VAT included as a proposal. Label as proposed future plans; headcount, usage and entitlements remain to be confirmed. No checkout or automatic charging exists. Do not publish schema.org Offers for an unavailable proposal.
- Left out: unsupported customer counts, invented testimonials, clinical outcome claims, real patient data, tracking scripts and decorative badges.
- Primitives: content limiter, section, neutral divider, text link, primary link, definition list, native FAQ `details`/`summary`. Links have hover, active and focus-visible states. Native FAQ has open/closed and keyboard states. All interactive targets are at least 44px high.
- The consultation-to-draft illustration is live semantic HTML, labelled as a fictional example. Its `검토 완료` button changes the draft status to approved and reveals an approved-record example above the draft with a 600ms fade/lift; the button then replays the effect as `다시 보기`. No clinical API or record is changed. Use the actual recording-section labels and no invented clinical scores.
- Text masking demonstrates a registered child name becoming an alias, and phone/email becoming placeholders. Use fictional data and name the scope `AI 요약용 텍스트`; never imply all sensitive information is detected. Keep detailed audio/attachment processing disclosures in the shared privacy policy, rather than a homepage warning.
- The masking example is a read-only fictional prose prompt with a `보내기` button. When half the button enters the viewport's 48px inset, animate its press, then trigger the local submit handler so the press is visible before masking. Reveal the paragraph above the composer and mask `민지` and `emali@example.com` simultaneously as `X-01` and `[이메일]`, using white fields with black text. The button replays the same masking; manual input cancels a pending automatic press. Do not display an explanatory child-code annotation. It never submits data or calls an AI/API. Reduced motion skips the button animation and shows the masked result immediately; `noscript` provides the final text.
- Sections 01 (`#recording`), 03 (`#features`), and 04 (`#erp`) reveal once as they enter the viewport in document order. Fade and lift their direct content blocks, with the second block slightly delayed. Preserve section backgrounds, layout and source order. All content is visible without JavaScript, under reduced motion, or immediately when keyboard focus enters a section.
- Section 01's compact right-hand list reveals rows `1-1`, `1-2`, `1-3` with delays of 120/480/840ms after the section enters the viewport. Keep the left explanation and existing row content/layout. Do not create standalone step screens. Reduced motion and keyboard focus show every row immediately.
- Apply the same item sequence to section 03's three existing feature columns and section 04's four existing ERP items, in DOM reading order. Use the shared `stagger-list` hook and 360ms spacing between starts; the fourth ERP item starts at 1200ms. Preserve all grid columns, positions, copy and section sizes. Reduced motion and keyboard focus reveal all items immediately.
- FAQ uses one native `details` group named `public-faq`; only one answer can be open. Animate intrinsic block size over 300ms using `::details-content`, `interpolate-size` and discrete content visibility where supported; retain instant native behavior elsewhere and under reduced motion. This bounded layout animation is required for the requested expanding/collapsing answer. Keep summary padding stable. Reference: https://developer.chrome.com/docs/modern-web-guidance/guides/ui-components/accordion.
- Public legal links: `/terms`, `/privacy`, `/refund`; all readable before authentication. Reuse the existing privacy document without changing its consent version. Terms and refund policy are explicitly review drafts; no paid checkout or legal effective date is invented.
- Pricing uses three equal comparison articles; Pro has a neutral tonal background, not a promotional badge or accent outline. Collapse to one column below 800px. Every amount displays its KRW/month unit.

## 6. Motion

Immediate link/FAQ feedback plus viewport-triggered masking and section reveals. Button press 360ms; mask duration 3.2s with no stagger; section reveal 700ms, second content block delay 120ms; sections 01/03/04 item stagger 360ms, starting at 120ms; lift 24px; approved-record reveal 600ms, lift 16px; easing `cubic-bezier(.22, 1, .36, 1)`. The section observer uses a 48px bottom inset and unobserves revealed sections. Animate only opacity and transform; no continuous animation, scroll-linked movement or input gate. All content is readable without JavaScript. Reduced motion makes reveals and masking immediate. The deferred `/home.js` owns these local examples; `/console-warning.js` remains informational.

## 7. Accessibility

One H1, ordered headings, named navigation and main landmarks, skip link, native keyboard-operable FAQs, visible focus, explicit image dimensions, AA text contrast. Verify 390px and 1440px, both system theme preferences, 200% text/zoom and no JavaScript. Private application markup has `noindex`.

## 8. Implementation and verification

The public source is static `frontend/public/home.html` and `home.css`. After Vite builds, `scripts/prepare-hosting.mjs` retains the SPA as `dist/app.html` and copies the public page to `dist/index.html`: Firebase serves static files before rewrites. Hosting routes application URLs to `/app.html`; dashboard uses `/dashboard`. During Vite development the introduction is `/home.html`; use the Hosting emulator to check production routing. Sitemap contains only public canonical URLs. JSON-LD describes only visible, supported capabilities and FAQ answers. Verify Firebase rewrites, robots rules, metadata, build, browser links and FAQ states. Search engine acceptance is recorded separately from indexing or ranking.
