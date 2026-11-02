# SLP AI public site design

## 1. Atmosphere and identity

Continue the existing application's warm paper, brown ink and terracotta identity from `frontend/src/index.css`. Use an editorial introduction with readable Korean copy and a clearly labelled fictional workflow example. Keep the existing SLP AI logo.

## 2. Color

Public CSS tokens: `--paper: #fcf8f2`, `--surface: #fffdf9`, `--wash: #f6eee4`, `--ink: #4a3d35`, `--muted: #6b5c50`, `--line: #ddcfbf`, `--accent: #a93b20`, `--accent-hover: #8a2f18`, `--success: #2f5734`, `--success-wash: #e6f1e4`. These are extracted from the existing app palette. Accent identifies the primary action. Neutral rules divide sections. Preserve the application's light theme under both system theme preferences.

## 3. Typography

Use the local Korean system sans-serif stack, avoiding a render-blocking font request. Body 17px/1.8, secondary 15px/1.7, small 13px/1.6, section titles 28–40px/1.3, hero 34–56px/1.25. Weights 400, 500, 600, 700. Korean uses `word-break: keep-all` with an overflow fallback. Headings use balanced wrapping.

## 4. Spacing and layout

4px base unit; spacing tokens 4, 8, 12, 16, 24, 32, 48, 64, 96px. Content width 1160px; page gutters 24px, reducing to 20px on compact screens. Two-column hero and workflow become one column below 800px. A three-column feature list becomes one column. No nested scrollers, fixed-height copy blocks or sticky navigation. Neutral 1px rules; radius 12/20/28px. No shadows or gradients.

Layout: Public introduction — readable introduction followed by product capabilities and answers; content-limiter + split hero + stack; scroll owner: `document.scrollingElement`; anti-patterns: fixed-height text, independent panel scrolling, horizontal overflow, reordered keyboard focus. Spatial reference: https://github.com/changeroa/StyleGallery (content containment); local mechanics: `layout-skill.md`.

Layout: Closing actions — primary start action with a secondary contact link; wrapping cluster; scroll owner: `document.scrollingElement`; anti-patterns: fixed action widths exceeding the container, reordered focus or nested scrolling.

## 5. Components and brief

- Primary action: `서비스 시작하기`, linking to `/login`. The header login link remains a text action.
- Secondary closing action: `문의하기` opens `mailto:contact@heonhwi.dev` through the visitor's configured email app. Show the same public email in the footer and Organization metadata; never send mail automatically.
- Information priorities: what SLP AI does; the therapist's review and approval role; the supported clinical and administrative workflow.
- Required content: brand, service definition, session and recording drafts, treatment plans and activities, schedules and attendance, voucher documents and settlement, organization permissions, approval flow, signup approval, proposed Starter/Pro/Organization pricing, FAQ, privacy link.
- Search intent: identify SLP AI as an AI work assistant for Korean speech-language therapists and organizations. Explain language-therapy records, recording drafts, treatment plans and developmental-rehabilitation voucher records in visible prose and matching metadata. Keep the therapist approval requirement and the existing primary action. Search-result position is external and is not a product claim.
- Public search title: lead with `언어치료 AI 업무 도우미`, followed by the `SLP AI` brand. Keep the description factual and consistent across search/social metadata; retain the Organization and WebSite brand names.
- Pricing proposal: Starter KRW 0/month, Pro KRW 29,000/month per therapist, Organization KRW 99,000/month per organization, VAT included as a proposal. Label as proposed future plans; headcount, usage and entitlements remain to be confirmed. No checkout or automatic charging exists. Do not publish schema.org Offers for an unavailable proposal.
- Left out: unsupported customer counts, invented testimonials, clinical outcome claims, real patient data, tracking scripts and decorative badges.
- Primitives: content limiter, section, neutral divider, text link, primary link, definition list, native FAQ `details`/`summary`. Links have hover, active and focus-visible states. Native FAQ has open/closed and keyboard states. All interactive targets are at least 44px high.
- The workflow illustration is live semantic HTML, labelled as a fictional example. It has no interactive-looking controls.
- Pricing uses three equal comparison articles; Pro has a neutral tonal background, not a promotional badge or accent outline. Collapse to one column below 800px. Every amount displays its KRW/month unit.

## 6. Motion

Only immediate link/FAQ feedback. No scroll animation or arrival gate; all public content is readable without JavaScript. Respect reduced-motion preferences.

## 7. Accessibility

One H1, ordered headings, named navigation and main landmarks, skip link, native keyboard-operable FAQs, visible focus, explicit image dimensions, AA text contrast. Verify 390px and 1440px, both system theme preferences, 200% text/zoom and no JavaScript. Private application markup has `noindex`.

## 8. Implementation and verification

The public source is static `frontend/public/home.html` and `home.css`. After Vite builds, `scripts/prepare-hosting.mjs` retains the SPA as `dist/app.html` and copies the public page to `dist/index.html`: Firebase serves static files before rewrites. Hosting routes application URLs to `/app.html`; dashboard uses `/dashboard`. During Vite development the introduction is `/home.html`; use the Hosting emulator to check production routing. Sitemap contains only public canonical URLs. JSON-LD describes only visible, supported capabilities and FAQ answers. Verify Firebase rewrites, robots rules, metadata, build, browser links and FAQ states. Search engine acceptance is recorded separately from indexing or ranking.
