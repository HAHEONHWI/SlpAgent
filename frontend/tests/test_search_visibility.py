import json
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

import pytest


ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "frontend" / "dist"


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.tags = []
        self.text = []
        self.scripts = []
        self.faq_summaries = []
        self._in_faq = False
        self._script = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if tag == "section" and attrs.get("id") == "faq":
            self._in_faq = True
        if tag == "summary" and self._in_faq:
            self.faq_summaries.append(attrs)
        if tag == "script":
            self._script = {"attrs": attrs, "text": ""}

    def handle_data(self, data):
        if self._script is not None:
            self._script["text"] += data
        else:
            self.text.append(data)

    def handle_endtag(self, tag):
        if tag == "section":
            self._in_faq = False
        if tag == "script" and self._script is not None:
            self.scripts.append(self._script)
            self._script = None

    def meta(self, name):
        return next((attrs.get("content", "") for tag, attrs in self.tags
                     if tag == "meta" and attrs.get("name") == name), "")


@pytest.fixture(scope="module")
def homepage():
    # Given: the production build produced by npm run build.
    assert (DIST / "index.html").exists(), "Run cd frontend && npm run build first"
    return Page((DIST / "index.html").read_text())


def test_homepage_is_readable_and_indexable_without_javascript(homepage):
    # When: a crawler parses the root's actual static HTML, before any rewrite.
    headings = [attrs for tag, attrs in homepage.tags if tag == "h1"]
    runtime_scripts = [script for script in homepage.scripts
                       if script["attrs"].get("type") != "application/ld+json"]
    # Then: content and search metadata do not depend on the authenticated SPA.
    assert len(headings) == 1
    assert homepage.meta("description")
    assert "noindex" not in homepage.meta("robots")
    assert [script["attrs"].get("src") for script in runtime_scripts] == [
        "/console-warning.js", "/home.js"]
    assert all("defer" in script["attrs"] for script in runtime_scripts)
    assert any(tag == "main" for tag, _ in homepage.tags)


def test_private_routes_receive_noindex_spa_instead_of_public_metadata():
    # Given: Firebase checks static files before falling back to SPA rewrites.
    hosting = json.loads((ROOT / "firebase.json").read_text())["hosting"]
    # When: a private URL falls through to the configured application HTML.
    fallback = hosting["rewrites"][-1]
    app = Page((DIST / fallback["destination"].lstrip("/")).read_text())
    # Then: private pages are excluded without marking the public homepage noindex.
    assert fallback["source"] == "**"
    assert fallback["destination"] != "/index.html"
    assert "noindex" in app.meta("robots")
    assert any(tag == "div" and attrs.get("id") == "root" for tag, attrs in app.tags)
    assert not any(tag == "link" and attrs.get("rel") == "canonical" for tag, attrs in app.tags)


@pytest.mark.parametrize("agent", ["Googlebot", "Google-InspectionTool", "Google-Extended", "Yeti", "bingbot", "OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "PerplexityBot"])
def test_search_crawlers_can_fetch_introduction_but_not_api(agent):
    # Given: the robots file that will be served from the domain root.
    robots = RobotFileParser()
    robots.parse((DIST / "robots.txt").read_text().splitlines())
    # When: search crawlers request the page, rendering assets, and API.
    allowed = [robots.can_fetch(agent, f"https://slpai.heonhwi.dev{path}")
               for path in ("/", "/home.css", "/brand/slp-ai-logo.png", "/api/children")]
    # Then: public content renders and authenticated data is outside crawl scope.
    assert allowed == [True, True, True, False]


def test_sitemap_and_canonical_use_only_public_production_url(homepage):
    # Given: one canonical production host and the generated sitemap.
    sitemap = ElementTree.parse(DIST / "sitemap.xml")
    canonical = next(attrs["href"] for tag, attrs in homepage.tags
                     if tag == "link" and attrs.get("rel") == "canonical")
    # When: the crawler discovers listed URLs.
    urls = [node.text for node in sitemap.findall(".//{*}loc")]
    # Then: no login, patient, preview, or duplicate Hosting URL is submitted.
    assert urls == [canonical]
    assert urlsplit(canonical).netloc == "slpai.heonhwi.dev"
    assert urlsplit(canonical).path == "/"


def test_structured_faq_matches_visible_questions_and_answers(homepage):
    # Given: structured data and the separately readable page body.
    graph = json.loads(next(script["text"] for script in homepage.scripts
                            if script["attrs"].get("type") == "application/ld+json"))["@graph"]
    faq = next(node for node in graph if node["@type"] == "FAQPage")
    visible_text = " ".join(" ".join(homepage.text).split())
    # When: a search engine compares FAQ markup with the native details elements.
    questions = faq["mainEntity"]
    summaries = homepage.faq_summaries
    # Then: every indexed answer exists on the page and none are fabricated in markup.
    assert len(questions) == len(summaries) > 0
    for question in questions:
        assert question["name"] in visible_text
        assert question["acceptedAnswer"]["text"] in visible_text


def test_local_navigation_and_rendering_assets_have_targets(homepage):
    # Given: the built public page and its local assets.
    ids = {attrs["id"] for _, attrs in homepage.tags if "id" in attrs}
    # When: a visitor follows section links or the browser loads local media and CSS.
    for tag, attrs in homepage.tags:
        target = attrs.get("href", attrs.get("src", ""))
        # Then: section anchors and required static resources resolve in the build.
        if target.startswith("#"):
            assert target[1:] in ids
        elif tag in {"link", "img", "script"} and target.startswith("/"):
            assert (DIST / target.lstrip("/")).is_file()


def test_consultation_recording_leads_the_integrated_service_introduction(homepage):
    text = " ".join(homepage.text)
    assert "AI·일지 작성·ERP까지," in text
    assert text.index("보호자 상담을 녹음하면,") < text.index("수업 전체 녹음도 가능해요.")
    assert "오늘의 일지 초안이 작성돼요." in text
    assert "치료사 확인·수정 후 승인하여 저장" in text
    assert "AI 요약용 텍스트 · 가상 예시" in text


def test_public_legal_documents_are_linked_from_introduction(homepage):
    links = {attrs.get("href") for tag, attrs in homepage.tags if tag == "a"}
    assert {"/terms", "/privacy", "/refund"} <= links


def test_unreviewed_legal_drafts_are_not_in_public_bundle():
    bundles = list((DIST / "assets").glob("*.js"))
    assert bundles
    source = "\n".join(bundle.read_text() for bundle in bundles)
    assert "# SLP AI 이용약관" not in source
    assert "# SLP AI 환불정책" not in source
    assert "법률 검토용 초안" not in source


def test_recording_steps_are_ordered_under_section_one(homepage):
    section = next(attrs for tag, attrs in homepage.tags
                   if tag == "section" and attrs.get("id") == "recording")
    assert "split-section" in section["class"].split()
    assert not any("workflow-stage" in attrs.get("class", "").split()
                   for _, attrs in homepage.tags)
    labels = [part.strip() for part in homepage.text
              if part.strip() in {"1-1", "1-2", "1-3"}]
    assert labels == ["1-1", "1-2", "1-3"]


def test_faq_uses_one_exclusive_native_group(homepage):
    details = [attrs for tag, attrs in homepage.tags if tag == "details"]
    assert len(details) == len(homepage.faq_summaries) > 0
    assert {attrs.get("name") for attrs in details} == {"public-faq"}


def test_feature_and_erp_groups_keep_existing_layout_with_item_reveals(homepage):
    groups = [set(attrs.get("class", "").split()) for tag, attrs in homepage.tags
              if tag == "dl"]
    for name in ("features", "erp-features"):
        assert any({name, "stagger-list"} <= group for group in groups)
    erp = next(attrs for tag, attrs in homepage.tags
               if tag == "section" and attrs.get("id") == "erp")
    assert "split-section" in erp["class"].split()


def test_privacy_consent_versions_still_match_shared_document():
    policy = (ROOT / "frontend/src/content/privacy-policy.md").read_text()
    version = next(line.removeprefix("- 버전: ") for line in policy.splitlines()
                   if line.startswith("- 버전: "))
    for path in ("frontend/src/lib/privacy.ts", "mobile/src/lib/config.ts"):
        assert f'PRIVACY_POLICY_VERSION = "{version}"' in (ROOT / path).read_text()


@pytest.mark.parametrize("entry", ["index.html", "app.html"])
def test_console_warning_is_shared_by_both_public_and_application_entries(entry):
    page = Page((DIST / entry).read_text())
    warnings = [script for script in page.scripts
                if script["attrs"].get("src") == "/console-warning.js"]
    assert len(warnings) == 1
    assert "defer" in warnings[0]["attrs"]
    assert (DIST / "console-warning.js").is_file()


@pytest.mark.parametrize("activation", ["automatic", "manual", "reduced"])
def test_homepage_motion_sequence_and_local_replay(homepage, activation):
    assert any(tag == "button" and "disabled" in attrs
               and attrs.get("type") == "submit" for tag, attrs in homepage.tags)
    assert any(attrs.get("role") == "textbox" and attrs.get("aria-readonly") == "true"
               for _, attrs in homepage.tags)
    assert not any("reveal-pending" in attrs.get("class", "") for _, attrs in homepage.tags)
    script = """
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mode = process.argv[2];
const changes = [], buttonChanges = [], sectionChanges = [], observers = [];
const timers = new Map();
let submit, reviewClick, clicks = 0, prevented = 0;
const button = {disabled: true, classList: {
  add: value => buttonChanges.push(['add', value]),
  remove: value => buttonChanges.push(['remove', value]),
}, click: () => {clicks++; submit({preventDefault: () => prevented++});}};
const output = {hidden: true, offsetWidth: 300, classList: {
  remove: value => changes.push(['remove', value]),
  add: value => changes.push(['add', value]),
}};
const form = {
  querySelector: selector => {assert.equal(selector, 'button'); return button;},
  addEventListener: (name, listener) => {assert.equal(name, 'submit'); submit = listener;},
};
const reviewChanges = [], approvalLabels = [];
const reviewResult = {hidden: true, offsetWidth: 300, classList: {
  remove: value => reviewChanges.push(['remove', value]),
  add: value => reviewChanges.push(['add', value]),
}};
const draftLabel = {textContent: '검토 전 초안', classList: {
  add: value => approvalLabels.push(value),
}};
const reviewButton = {disabled: true, textContent: '검토 완료',
  addEventListener: (name, listener) => {assert.equal(name, 'click'); reviewClick = listener;},
};
const sections = ['recording', 'features', 'erp'].map(id => ({id,
  classList: {add: value => sectionChanges.push([id, value])},
}));
class IntersectionObserver {
  constructor(callback, options) {
    this.callback = callback; this.options = options;
    this.observed = []; this.unobserved = []; this.disconnected = false;
    observers.push(this);
  }
  observe(element) {this.observed.push(element);}
  unobserve(element) {this.unobserved.push(element);}
  disconnect() {this.disconnected = true;}
}
vm.runInNewContext(fs.readFileSync(process.argv[1], 'utf8'), {
  document: {
    querySelector: selector => ({'.mask-demo': form, '.mask-output': output,
      '.review-button': reviewButton, '.review-result': reviewResult, '.draft-label': draftLabel,
    })[selector],
    querySelectorAll: selector => {
      assert.equal(selector, '#recording, #features, #erp'); return sections;
    },
  },
  window: {matchMedia: () => ({matches: mode === 'reduced'})},
  setTimeout: (callback, delay) => {assert.equal(delay, 360); timers.set(1, callback); return 1;},
  clearTimeout: id => timers.delete(id),
  IntersectionObserver,
});
const maskObserver = observers.find(observer => observer.options.threshold === 0.5);
assert.equal(button.disabled, false);
assert.deepEqual(maskObserver.observed, [button]);
assert.equal(maskObserver.options.rootMargin, '0px 0px -48px 0px');
assert.equal(output.hidden, true);
maskObserver.callback([{isIntersecting: false, intersectionRatio: 0}]);
maskObserver.callback([{isIntersecting: true, intersectionRatio: 0.25}]);
assert.equal(output.hidden, true);
assert.equal(changes.length, 0);
assert.equal(timers.size, 0);
maskObserver.callback([{isIntersecting: true, intersectionRatio: 0.5}]);
assert.equal(maskObserver.disconnected, true);
if (mode !== 'reduced') {
  assert.equal(output.hidden, true);
  assert.deepEqual(buttonChanges, [['add', 'is-auto-press']]);
  assert.equal(timers.size, 1);
  if (mode === 'manual') button.click();
  else {const callback = timers.get(1); timers.delete(1); callback();}
}
assert.equal(timers.size, 0);
assert.equal(output.hidden, false);
assert.equal(clicks, 1);
button.click();
button.click();
assert.equal(clicks, 3);
assert.equal(prevented, 3);
assert.deepEqual(changes, [
  ['remove', 'is-masking'], ['add', 'is-masking'],
  ['remove', 'is-masking'], ['add', 'is-masking'],
  ['remove', 'is-masking'], ['add', 'is-masking'],
]);
const revealObserver = observers.find(observer => observer.options.threshold !== 0.5);
assert.equal(revealObserver.options.rootMargin, '0px 0px -48px 0px');
assert.deepEqual(revealObserver.observed, sections);
assert.deepEqual(sectionChanges, sections.map(section => [section.id, 'reveal-pending']));
revealObserver.callback([{target: sections[0], isIntersecting: false}]);
assert.equal(revealObserver.unobserved.length, 0);
for (const section of sections) {
  revealObserver.callback([{target: section, isIntersecting: true}]);
}
assert.deepEqual(revealObserver.unobserved, sections);
assert.deepEqual(sectionChanges.slice(sections.length), sections.map(section => [section.id, 'is-visible']));
assert.equal(reviewButton.disabled, false);
assert.equal(reviewResult.hidden, true);
reviewClick();
assert.equal(reviewResult.hidden, false);
assert.equal(draftLabel.textContent, '검토 완료');
assert.equal(reviewButton.textContent, '다시 보기');
assert.deepEqual(approvalLabels, ['is-approved']);
reviewClick();
assert.deepEqual(reviewChanges, [
  ['remove', 'is-reflected'], ['add', 'is-reflected'],
  ['remove', 'is-reflected'], ['add', 'is-reflected'],
]);
"""
    subprocess.run(["node", "-e", script, str(DIST / "home.js"), activation], check=True,
                   capture_output=True, text=True)
