import json
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
        self._script = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if tag == "script":
            self._script = {"attrs": attrs, "text": ""}

    def handle_data(self, data):
        if self._script is not None:
            self._script["text"] += data
        else:
            self.text.append(data)

    def handle_endtag(self, tag):
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
    assert not runtime_scripts
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
    summaries = [attrs for tag, attrs in homepage.tags if tag == "summary"]
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
        elif tag in {"link", "img"} and target.startswith("/"):
            assert (DIST / target.lstrip("/")).is_file()
