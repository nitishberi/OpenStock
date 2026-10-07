"""
OpenInsider Form 4 HTML table parsers.

Parses tinytable rows from:
  - /latest-cluster-buys
  - /latest-insider-purchases-25k
  - /{TICKER} per-symbol screener

Field mapping aligned with community scrapers (e.g. insidertracker).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

SourceList = Literal["cluster-buys", "purchases-25k", "ticker"]

OPENINSIDER_ORIGIN = "http://www.openinsider.com"

LIST_PATHS: dict[SourceList, str] = {
    "cluster-buys": "/latest-cluster-buys",
    "purchases-25k": "/latest-insider-purchases-25k",
}

_NUM_RE = re.compile(r"[^\d.\-+]")
_PCT_RE = re.compile(r"[^\d.\-+]")
_TRADE_TYPE_RE = re.compile(r"^([A-Z])\b")
_TICKER_HREF_RE = re.compile(r'^/([A-Z][A-Z0-9.\-]{0,11})$')


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def parse_money(raw: str) -> float | None:
    t = _clean_text(raw)
    if not t or t in {"-", "—", "N/A"}:
        return None
    neg = t.startswith("(") and t.endswith(")")
    t = t.replace("$", "").replace(",", "").replace("+", "").replace("(", "").replace(")", "")
    try:
        v = float(t)
        return -v if neg else v
    except ValueError:
        return None


def parse_qty(raw: str) -> float | None:
    t = _clean_text(raw).replace(",", "").replace("+", "")
    if not t or t in {"-", "—"}:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def parse_pct(raw: str) -> float | None:
    t = _clean_text(raw).replace("%", "").replace("+", "").replace(",", "")
    if not t or t in {"-", "—", "New"}:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def parse_trade_type(raw: str) -> str:
    t = _clean_text(raw)
    m = _TRADE_TYPE_RE.match(t)
    return m.group(1) if m else (t[:1].upper() if t else "")


def parse_filing_date(raw: str) -> str | None:
    """Return ISO date (YYYY-MM-DD) from 'YYYY-MM-DD HH:MM:SS' or date-only."""
    t = _clean_text(raw)
    if not t:
        return None
    m = re.match(r"(\d{4}-\d{2}-\d{2})", t)
    return m.group(1) if m else None


def parse_trade_date(raw: str) -> str | None:
    return parse_filing_date(raw)


def detect_flags(flag_cell: str, source_list: SourceList, title: str | None = None) -> dict[str, bool]:
    cell = (flag_cell or "").upper()
    title_u = (title or "").upper()
    return {
        "amended": "A" in cell.split() or cell.strip() == "A" or " A " in f" {cell} ",
        "multiDay": "M" in cell,
        "cluster": source_list == "cluster-buys" or "C" in cell,
        "ceoCfo": bool(re.search(r"\b(CEO|CFO|CHIEF EXECUTIVE|CHIEF FINANCIAL)\b", title_u)),
    }


class _TinyTableParser(HTMLParser):
    """Collect rows from the first table.tinytable."""

    def __init__(self) -> None:
        super().__init__()
        self.in_tiny = False
        self.table_depth = 0
        self.in_tr = False
        self.in_cell = False
        self.cell_tag = ""
        self.cell_parts: list[str] = []
        self.cell_hrefs: list[str] = []
        self.row_cells: list[dict[str, Any]] = []
        self.rows: list[list[dict[str, Any]]] = []
        self.headers: list[str] = []
        self._capture = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        ad = {k: (v or "") for k, v in attrs}
        if tag == "table":
            cls = ad.get("class", "")
            if not self.in_tiny and "tinytable" in cls.split():
                self.in_tiny = True
                self.table_depth = 1
                self._capture = True
            elif self.in_tiny:
                self.table_depth += 1
            return
        if not self._capture:
            return
        if tag == "tr":
            self.in_tr = True
            self.row_cells = []
            return
        if self.in_tr and tag in {"td", "th"}:
            self.in_cell = True
            self.cell_tag = tag
            self.cell_parts = []
            self.cell_hrefs = []
            return
        if self.in_cell and tag == "a":
            href = ad.get("href", "")
            if href:
                self.cell_hrefs.append(href)

    def handle_endtag(self, tag: str) -> None:
        if not self._capture and tag != "table":
            return
        if tag in {"td", "th"} and self.in_cell:
            text = _clean_text("".join(self.cell_parts))
            self.row_cells.append({"tag": self.cell_tag, "text": text, "hrefs": list(self.cell_hrefs)})
            self.in_cell = False
            self.cell_parts = []
            self.cell_hrefs = []
            return
        if tag == "tr" and self.in_tr:
            self.in_tr = False
            if not self.row_cells:
                return
            if self.row_cells[0]["tag"] == "th" or all(c["tag"] == "th" for c in self.row_cells):
                self.headers = [_clean_text(c["text"]).lower().replace("\xa0", " ") for c in self.row_cells]
            else:
                self.rows.append(self.row_cells)
            self.row_cells = []
            return
        if tag == "table" and self.in_tiny:
            self.table_depth -= 1
            if self.table_depth <= 0:
                self.in_tiny = False
                self._capture = False

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.cell_parts.append(data)


def _header_map(headers: list[str]) -> dict[str, int]:
    """Map logical field → column index from header labels."""
    idx: dict[str, int] = {}
    for i, h in enumerate(headers):
        h2 = h.replace("&nbsp;", " ").replace("δ", "delta").replace("Δ", "delta")
        h2 = re.sub(r"\s+", " ", h2).strip().lower()
        if "filing" in h2 and "date" in h2:
            idx["filingDate"] = i
        elif "trade" in h2 and "date" in h2:
            idx["tradeDate"] = i
        elif h2 == "ticker":
            idx["ticker"] = i
        elif "company" in h2:
            idx["companyName"] = i
        elif "insider" in h2 and "name" in h2:
            idx["insiderName"] = i
        elif h2 == "title":
            idx["title"] = i
        elif h2 in {"ins", "industry"}:
            # cluster: Ins count; purchases: Industry is absent — Industry vs Ins
            if h2 == "ins":
                idx["insCount"] = i
            else:
                idx["industry"] = i
        elif "trade" in h2 and "type" in h2:
            idx["tradeType"] = i
        elif h2 == "price":
            idx["price"] = i
        elif h2 == "qty":
            idx["qty"] = i
        elif h2 == "owned":
            idx["owned"] = i
        elif ("own" in h2 and "delta" in h2) or h2 in {"Δown", "deltaown", "δown", "&delta;own"}:
            idx["deltaOwnPct"] = i
        elif h2 == "value":
            idx["valueUsd"] = i
        elif i == 0:
            idx["flags"] = i
    if "flags" not in idx and headers:
        idx["flags"] = 0
    return idx


def _cell_at(row: list[dict[str, Any]], i: int | None) -> dict[str, Any]:
    if i is None or i < 0 or i >= len(row):
        return {"text": "", "hrefs": []}
    return row[i]


def _ticker_from_cell(cell: dict[str, Any]) -> str:
    for href in cell.get("hrefs") or []:
        path = urlparse(href).path if "://" in href else href
        m = _TICKER_HREF_RE.match(path)
        if m:
            return m.group(1).upper()
    # Tip()-polluted text sometimes still ends with ticker
    text = _clean_text(cell.get("text") or "")
    m = re.search(r"\b([A-Z][A-Z0-9.\-]{0,11})\b\s*$", text)
    return m.group(1).upper() if m else text.upper()[:12]


def parse_openinsider_html(
    html: str,
    *,
    source_list: SourceList,
    source_url: str | None = None,
    ticker_hint: str | None = None,
) -> list[dict[str, Any]]:
    """Parse OpenInsider tinytable HTML into InsiderFiling-shaped dicts."""
    parser = _TinyTableParser()
    parser.feed(html)
    hmap = _header_map(parser.headers)
    base = source_url or OPENINSIDER_ORIGIN
    now = datetime.now(timezone.utc).isoformat()
    out: list[dict[str, Any]] = []

    for row in parser.rows:
        trade_raw = _cell_at(row, hmap.get("tradeType")).get("text", "")
        if not trade_raw or not re.search(r"\b[PSAF]\b", trade_raw):
            # Require a recognizable trade-type cell
            if "Purchase" not in trade_raw and "Sale" not in trade_raw:
                continue

        ticker_cell = _cell_at(row, hmap.get("ticker"))
        ticker = _ticker_from_cell(ticker_cell) or (ticker_hint or "").upper()
        if not ticker:
            continue

        filing_raw = _cell_at(row, hmap.get("filingDate")).get("text", "")
        # Filing date cell often wraps a link — text already collected
        if not filing_raw:
            for href in _cell_at(row, hmap.get("filingDate")).get("hrefs") or []:
                filing_raw = href  # unused; text should exist
        filing_date = parse_filing_date(filing_raw)
        trade_date = parse_trade_date(_cell_at(row, hmap.get("tradeDate")).get("text", ""))
        if not filing_date or not trade_date:
            continue

        insider_name = _clean_text(_cell_at(row, hmap.get("insiderName")).get("text", ""))
        title = _clean_text(_cell_at(row, hmap.get("title")).get("text", ""))
        company = _clean_text(_cell_at(row, hmap.get("companyName")).get("text", ""))
        ins_count_raw = _cell_at(row, hmap.get("insCount")).get("text", "")
        ins_count = None
        if ins_count_raw.isdigit():
            ins_count = int(ins_count_raw)

        # Cluster list has no insider name — synthesize stable placeholder
        if not insider_name and source_list == "cluster-buys":
            insider_name = f"CLUSTER:{ins_count or '?'}"

        flag_cell = _cell_at(row, hmap.get("flags")).get("text", "")
        flags = detect_flags(flag_cell, source_list, title)
        if ins_count and ins_count >= 2:
            flags["cluster"] = True

        trade_type = parse_trade_type(trade_raw)
        price = parse_money(_cell_at(row, hmap.get("price")).get("text", ""))
        qty = parse_qty(_cell_at(row, hmap.get("qty")).get("text", ""))
        owned = parse_qty(_cell_at(row, hmap.get("owned")).get("text", ""))
        delta = parse_pct(_cell_at(row, hmap.get("deltaOwnPct")).get("text", ""))
        value = parse_money(_cell_at(row, hmap.get("valueUsd")).get("text", ""))

        filing: dict[str, Any] = {
            "filingDate": filing_date,
            "tradeDate": trade_date,
            "ticker": ticker,
            "companyName": company or None,
            "insiderName": insider_name,
            "title": title or None,
            "tradeType": trade_type,
            "price": price,
            "qty": qty,
            "owned": owned,
            "deltaOwnPct": delta,
            "valueUsd": value,
            "flags": flags,
            "insCount": ins_count,
            "sourceUrl": urljoin(base if "://" in (base or "") else OPENINSIDER_ORIGIN + "/", f"/{ticker}"),
            "sourceList": source_list,
            "ingestedAt": now,
        }
        out.append(filing)

    return out


def list_url(source_list: SourceList, ticker: str | None = None) -> str:
    if source_list == "ticker":
        if not ticker:
            raise ValueError("ticker required for source_list=ticker")
        return f"{OPENINSIDER_ORIGIN}/{ticker.upper()}"
    return f"{OPENINSIDER_ORIGIN}{LIST_PATHS[source_list]}"
