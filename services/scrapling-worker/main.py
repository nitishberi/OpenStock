"""
Scrapling news intake worker for Auto Day Trader (OpenStock fork).

Discover URLs via search APIs (or accept pre-discovered URLs), fetch with Scrapling,
normalize into MediaDocument-shaped payloads. Respects domain allowlist; no login walls.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
import yaml
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, HttpUrl

logger = logging.getLogger("scrapling-worker")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

APP_TOKEN = os.getenv("SCRAPLING_WORKER_TOKEN", "")
ALLOWLIST_PATH = os.getenv("SOURCES_CONFIG", os.path.join(os.path.dirname(__file__), "sources.yaml"))
RATE_LIMIT_PER_DOMAIN = float(os.getenv("SCRAPE_RATE_LIMIT_SECONDS", "2"))
USE_STEALTH = os.getenv("SCRAPLING_STEALTH", "false").lower() == "true"
MONGODB_URI = os.getenv("MONGODB_URI", "")
WEB_INGEST_URL = os.getenv("WEB_INGEST_URL", "")  # optional POST back to Next.js (media)
WEB_INSIDER_INGEST_URL = os.getenv(
    "WEB_INSIDER_INGEST_URL", ""
)  # optional POST back to Next.js (insider filings)
# Full OpenInsider list scrapes cached ≤1 / 15 min
OPENINSIDER_LIST_CACHE_SECONDS = float(os.getenv("OPENINSIDER_LIST_CACHE_SECONDS", "900"))

app = FastAPI(title="Auto Day Trader Scrapling Worker", version="0.1.0")

_last_hit: dict[str, float] = {}
_openinsider_list_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def require_token(authorization: str | None = Header(default=None), x_worker_token: str | None = Header(default=None)):
    if not APP_TOKEN:
        return  # open in local/dev when token unset
    provided = x_worker_token
    if authorization and authorization.lower().startswith("bearer "):
        provided = authorization.split(" ", 1)[1].strip()
    if provided != APP_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


def load_sources() -> dict[str, Any]:
    if not os.path.exists(ALLOWLIST_PATH):
        return {"allowlist": [], "rss": []}
    with open(ALLOWLIST_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {"allowlist": [], "rss": []}


def domain_allowed(url: str, allowlist: list[str]) -> bool:
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return False
    host = host.lower().removeprefix("www.")
    if not allowlist:
        return True
    for entry in allowlist:
        e = entry.lower().removeprefix("www.")
        if host == e or host.endswith("." + e):
            return True
    return False


def throttle(domain: str) -> None:
    now = time.time()
    last = _last_hit.get(domain, 0)
    wait = RATE_LIMIT_PER_DOMAIN - (now - last)
    if wait > 0:
        time.sleep(wait)
    _last_hit[domain] = time.time()


class FetchRequest(BaseModel):
    urls: list[HttpUrl] = Field(default_factory=list)
    symbol: str | None = None
    source_kind: str = "manual"
    max_chars: int = 8000


class DiscoverFetchRequest(BaseModel):
    symbol: str
    company: str | None = None
    articles: list[dict[str, Any]] = Field(default_factory=list)
    max_chars: int = 8000


class MediaPayload(BaseModel):
    symbol: str | None = None
    title: str
    url: str
    source: str
    sourceKind: str
    excerpt: str | None = None
    body: str | None = None
    publishedAt: str | None = None
    fetchedAt: str
    domain: str
    score: float | None = None
    tags: list[str] = Field(default_factory=list)


def extract_with_scrapling(url: str, max_chars: int) -> dict[str, Any]:
    """Fetch and extract article text using Scrapling when available."""
    title = ""
    body = ""
    try:
        from scrapling.fetchers import Fetcher, StealthyFetcher  # type: ignore

        fetcher = StealthyFetcher if USE_STEALTH else Fetcher
        page = fetcher.get(str(url), stealthy_headers=True) if USE_STEALTH else fetcher.get(str(url))
        # scrapling returns Adaptives that support css/xpath
        title_el = page.css("title::text") or page.css("h1::text")
        if title_el:
            title = str(title_el[0]) if isinstance(title_el, list) else str(title_el)
        paragraphs = page.css("article p::text") or page.css("p::text")
        if paragraphs:
            texts = [str(p).strip() for p in paragraphs if str(p).strip()]
            body = "\n\n".join(texts)[:max_chars]
        if not body:
            body = (page.get_all_text() or "")[:max_chars]
    except Exception as e:
        logger.warning("Scrapling fetch failed for %s: %s — falling back to httpx", url, e)
        with httpx.Client(follow_redirects=True, timeout=20.0) as client:
            r = client.get(str(url), headers={"User-Agent": "AutoDayTraderBot/0.1 (+research; respectful)"})
            r.raise_for_status()
            text = r.text
            # minimal extraction
            import re

            m = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
            title = re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
            cleaned = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
            cleaned = re.sub(r"<style[\s\S]*?</style>", " ", cleaned, flags=re.I)
            cleaned = re.sub(r"<[^>]+>", " ", cleaned)
            body = re.sub(r"\s+", " ", cleaned).strip()[:max_chars]

    return {"title": title, "body": body}


def to_media(
    *,
    url: str,
    symbol: str | None,
    source_kind: str,
    title: str | None = None,
    excerpt: str | None = None,
    body: str | None = None,
    score: float | None = None,
    published_at: str | None = None,
) -> MediaPayload:
    host = (urlparse(url).hostname or "unknown").removeprefix("www.")
    return MediaPayload(
        symbol=symbol.upper() if symbol else None,
        title=(title or "Untitled")[:500],
        url=str(url),
        source=host,
        sourceKind=source_kind,
        excerpt=(excerpt or (body[:400] if body else None)),
        body=body,
        publishedAt=published_at,
        fetchedAt=datetime.now(timezone.utc).isoformat(),
        domain=host,
        score=score,
        tags=["scrapling"],
    )


async def persist_docs(docs: list[MediaPayload]) -> None:
    """Optional: push to Mongo or Next ingest endpoint."""
    if WEB_INGEST_URL:
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = {}
            if APP_TOKEN:
                headers["X-Worker-Token"] = APP_TOKEN
            await client.post(WEB_INGEST_URL, json={"documents": [d.model_dump() for d in docs]}, headers=headers)
    if MONGODB_URI:
        try:
            from pymongo import MongoClient

            client = MongoClient(MONGODB_URI)
            db_name = os.getenv("MONGODB_DB", "openstock")
            col = client[db_name]["mediadocuments"]
            for d in docs:
                col.update_one(
                    {"url": d.url},
                    {
                        "$set": {
                            **d.model_dump(),
                            "publishedAt": d.publishedAt,
                            "fetchedAt": datetime.now(timezone.utc),
                        }
                    },
                    upsert=True,
                )
        except Exception as e:
            logger.warning("Mongo persist failed: %s", e)


@app.get("/health")
def health():
    return {
        "ok": True,
        "stealth": USE_STEALTH,
        "token_required": bool(APP_TOKEN),
        "sources": ALLOWLIST_PATH,
    }


@app.get("/sources")
def sources(_: None = Depends(require_token)):
    return load_sources()


@app.post("/fetch", response_model=list[MediaPayload])
async def fetch_urls(req: FetchRequest, _: None = Depends(require_token)):
    cfg = load_sources()
    allowlist = cfg.get("allowlist") or []
    out: list[MediaPayload] = []
    for url in req.urls:
        u = str(url)
        host = (urlparse(u).hostname or "").removeprefix("www.")
        if not domain_allowed(u, allowlist):
            logger.info("Skipping non-allowlisted domain: %s", host)
            continue
        throttle(host)
        try:
            extracted = extract_with_scrapling(u, req.max_chars)
            out.append(
                to_media(
                    url=u,
                    symbol=req.symbol,
                    source_kind=req.source_kind,
                    title=extracted.get("title"),
                    body=extracted.get("body"),
                )
            )
        except Exception as e:
            logger.error("Failed %s: %s", u, e)
    if out:
        await persist_docs(out)
    return out


@app.post("/ingest", response_model=list[MediaPayload])
async def ingest_discovered(req: DiscoverFetchRequest, _: None = Depends(require_token)):
    """Accept pre-discovered article metadata from the web app, fetch bodies, return MediaDocuments."""
    cfg = load_sources()
    allowlist = cfg.get("allowlist") or []
    out: list[MediaPayload] = []
    for art in req.articles:
        u = art.get("url")
        if not u:
            continue
        host = (urlparse(u).hostname or "").removeprefix("www.")
        if not domain_allowed(u, allowlist):
            continue
        throttle(host)
        try:
            extracted = extract_with_scrapling(u, req.max_chars)
            out.append(
                to_media(
                    url=u,
                    symbol=req.symbol,
                    source_kind=art.get("provider") or art.get("sourceKind") or "tavily",
                    title=extracted.get("title") or art.get("title"),
                    excerpt=art.get("snippet"),
                    body=extracted.get("body"),
                    score=art.get("score"),
                    published_at=art.get("publishedAt"),
                )
            )
        except Exception as e:
            logger.error("Failed ingest %s: %s", u, e)
    if out:
        await persist_docs(out)
    return out


@app.post("/rss")
async def crawl_rss(_: None = Depends(require_token)):
    """Fetch configured public RSS feeds (no login)."""
    cfg = load_sources()
    feeds = cfg.get("rss") or []
    out: list[MediaPayload] = []
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        for feed in feeds:
            url = feed.get("url") if isinstance(feed, dict) else feed
            if not url:
                continue
            try:
                r = await client.get(url)
                r.raise_for_status()
                # Lightweight item link extraction without heavy deps
                import re

                links = re.findall(r"<link>([^<]+)</link>", r.text)[:10]
                for link in links:
                    link = link.strip()
                    if not link.startswith("http"):
                        continue
                    host = (urlparse(link).hostname or "").removeprefix("www.")
                    if not domain_allowed(link, cfg.get("allowlist") or []):
                        continue
                    throttle(host)
                    extracted = extract_with_scrapling(link, 6000)
                    out.append(
                        to_media(
                            url=link,
                            symbol=None,
                            source_kind="rss",
                            title=extracted.get("title"),
                            body=extracted.get("body"),
                        )
                    )
            except Exception as e:
                logger.warning("RSS failed %s: %s", url, e)
    if out:
        await persist_docs(out)
    return {"count": len(out), "documents": [d.model_dump() for d in out]}


def config_fingerprint() -> str:
    raw = open(ALLOWLIST_PATH, "rb").read() if os.path.exists(ALLOWLIST_PATH) else b""
    return hashlib.sha256(raw).hexdigest()[:12]


# --- OpenInsider Form 4 ---


class OpenInsiderScanRequest(BaseModel):
    lists: list[str] = Field(default_factory=lambda: ["cluster-buys", "purchases-25k"])
    tickers: list[str] = Field(default_factory=list)
    persist: bool = True
    force: bool = False  # bypass 15-min list cache


def fetch_html(url: str) -> str:
    """Fetch HTML via Scrapling when available; httpx fallback."""
    try:
        from scrapling.fetchers import Fetcher, StealthyFetcher  # type: ignore

        fetcher = StealthyFetcher if USE_STEALTH else Fetcher
        page = fetcher.get(str(url), stealthy_headers=True) if USE_STEALTH else fetcher.get(str(url))
        html = getattr(page, "html_content", None) or getattr(page, "body", None)
        if html:
            return str(html)
        # Adaptive objects often stringify to HTML
        text = str(page)
        if "<table" in text.lower():
            return text
    except Exception as e:
        logger.warning("Scrapling HTML fetch failed for %s: %s — httpx fallback", url, e)
    with httpx.Client(follow_redirects=True, timeout=30.0) as client:
        r = client.get(
            str(url),
            headers={"User-Agent": "AutoDayTraderBot/0.1 (+research; respectful; Form4)"},
        )
        r.raise_for_status()
        return r.text


async def persist_insider_filings(filings: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {"posted": 0, "mongo": 0}
    if not filings:
        return result
    if WEB_INSIDER_INGEST_URL:
        async with httpx.AsyncClient(timeout=60.0) as client:
            headers = {}
            if APP_TOKEN:
                headers["X-Worker-Token"] = APP_TOKEN
            r = await client.post(
                WEB_INSIDER_INGEST_URL,
                json={"filings": filings},
                headers=headers,
            )
            if r.is_success:
                result["posted"] = len(filings)
                result["ingest"] = r.json()
            else:
                logger.warning("Insider ingest POST failed %s: %s", r.status_code, r.text[:300])
    if MONGODB_URI:
        try:
            from pymongo import MongoClient

            client = MongoClient(MONGODB_URI)
            db_name = os.getenv("MONGODB_DB", "openstock")
            col = client[db_name]["insiderfilings"]
            for f in filings:
                key = {
                    "ticker": f.get("ticker"),
                    "filingDate": f.get("filingDate"),
                    "insiderName": f.get("insiderName") or "",
                    "tradeDate": f.get("tradeDate"),
                    "qty": f.get("qty"),
                    "valueUsd": f.get("valueUsd"),
                }
                col.update_one(key, {"$set": f}, upsert=True)
                result["mongo"] += 1
        except Exception as e:
            logger.warning("Mongo insider persist failed: %s", e)
    return result


@app.post("/openinsider/scan")
async def openinsider_scan(req: OpenInsiderScanRequest, _: None = Depends(require_token)):
    """
    Scrape OpenInsider list pages and/or per-ticker pages; parse Form 4 tables.
    Respects allowlist + polite rate limits; caches full list scrapes for 15 minutes.
    """
    from openinsider import list_url, parse_openinsider_html

    cfg = load_sources()
    allowlist = cfg.get("allowlist") or []
    all_filings: list[dict[str, Any]] = []
    meta: list[dict[str, Any]] = []

    for list_name in req.lists:
        if list_name not in ("cluster-buys", "purchases-25k"):
            raise HTTPException(status_code=400, detail=f"Unknown list: {list_name}")
        url = list_url(list_name)  # type: ignore[arg-type]
        if not domain_allowed(url, allowlist):
            raise HTTPException(status_code=403, detail="openinsider.com not allowlisted")

        cache_key = list_name
        now = time.time()
        cached = _openinsider_list_cache.get(cache_key)
        if not req.force and cached and now - cached[0] < OPENINSIDER_LIST_CACHE_SECONDS:
            filings = cached[1]
            meta.append({"list": list_name, "url": url, "cached": True, "count": len(filings)})
            all_filings.extend(filings)
            continue

        host = (urlparse(url).hostname or "").removeprefix("www.")
        throttle(host)
        try:
            html = fetch_html(url)
            filings = parse_openinsider_html(html, source_list=list_name, source_url=url)  # type: ignore[arg-type]
            _openinsider_list_cache[cache_key] = (now, filings)
            meta.append({"list": list_name, "url": url, "cached": False, "count": len(filings)})
            all_filings.extend(filings)
        except Exception as e:
            logger.error("OpenInsider list scrape failed %s: %s", url, e)
            meta.append({"list": list_name, "url": url, "error": str(e), "count": 0})

    for ticker in req.tickers:
        t = ticker.strip().upper()
        if not t:
            continue
        url = list_url("ticker", t)
        if not domain_allowed(url, allowlist):
            continue
        host = (urlparse(url).hostname or "").removeprefix("www.")
        throttle(host)
        try:
            html = fetch_html(url)
            filings = parse_openinsider_html(html, source_list="ticker", source_url=url, ticker_hint=t)
            meta.append({"list": "ticker", "ticker": t, "url": url, "count": len(filings)})
            all_filings.extend(filings)
        except Exception as e:
            logger.error("OpenInsider ticker scrape failed %s: %s", t, e)
            meta.append({"list": "ticker", "ticker": t, "error": str(e), "count": 0})

    persist_info: dict[str, Any] = {}
    if req.persist and all_filings:
        persist_info = await persist_insider_filings(all_filings)

    return {
        "ok": True,
        "count": len(all_filings),
        "meta": meta,
        "persist": persist_info,
        "filings": all_filings,
    }


@app.post("/openinsider/parse")
async def openinsider_parse(
    body: dict[str, Any],
    _: None = Depends(require_token),
):
    """Parse provided HTML (fixtures / tests) without network fetch."""
    from openinsider import parse_openinsider_html

    html = body.get("html") or ""
    source_list = body.get("sourceList") or "purchases-25k"
    if source_list not in ("cluster-buys", "purchases-25k", "ticker"):
        raise HTTPException(status_code=400, detail="invalid sourceList")
    filings = parse_openinsider_html(
        html,
        source_list=source_list,
        source_url=body.get("sourceUrl"),
        ticker_hint=body.get("ticker"),
    )
    return {"ok": True, "count": len(filings), "filings": filings}
