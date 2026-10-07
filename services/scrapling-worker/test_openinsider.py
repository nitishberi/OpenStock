"""Unit tests for OpenInsider HTML parsers (saved fixtures, no network)."""

from __future__ import annotations

import unittest
from pathlib import Path

from openinsider import parse_openinsider_html

FIXTURES = Path(__file__).parent / "fixtures"


class TestOpenInsiderParsers(unittest.TestCase):
    def test_cluster_buys_fixture(self) -> None:
        html = (FIXTURES / "latest-cluster-buys.html").read_text(encoding="utf-8")
        rows = parse_openinsider_html(html, source_list="cluster-buys")
        self.assertGreaterEqual(len(rows), 3)
        for r in rows:
            self.assertTrue(r["ticker"])
            self.assertRegex(r["filingDate"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertRegex(r["tradeDate"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertEqual(r["sourceList"], "cluster-buys")
            self.assertTrue(r["flags"]["cluster"])
            self.assertTrue(str(r["insiderName"]).startswith("CLUSTER:"))
            self.assertIn(r["tradeType"], {"P", "S", "A", "F"})
        buys = [r for r in rows if r["tradeType"] == "P"]
        self.assertTrue(buys)
        self.assertIsNotNone(buys[0]["valueUsd"])
        self.assertGreater(abs(buys[0]["valueUsd"] or 0), 0)

    def test_purchases_25k_fixture(self) -> None:
        html = (FIXTURES / "latest-insider-purchases-25k.html").read_text(encoding="utf-8")
        rows = parse_openinsider_html(html, source_list="purchases-25k")
        self.assertGreaterEqual(len(rows), 3)
        for r in rows:
            self.assertTrue(r["ticker"])
            self.assertTrue(r["insiderName"])
            self.assertFalse(str(r["insiderName"]).startswith("CLUSTER:"))
            self.assertEqual(r["sourceList"], "purchases-25k")
            self.assertEqual(r["tradeType"], "P")
            self.assertIsNotNone(r["valueUsd"])
            self.assertGreaterEqual(abs(r["valueUsd"] or 0), 25_000)

    def test_ticker_aapl_fixture(self) -> None:
        html = (FIXTURES / "ticker-aapl.html").read_text(encoding="utf-8")
        rows = parse_openinsider_html(html, source_list="ticker", ticker_hint="AAPL")
        self.assertGreaterEqual(len(rows), 3)
        for r in rows:
            self.assertEqual(r["ticker"], "AAPL")
            self.assertTrue(r["insiderName"])
            self.assertEqual(r["sourceList"], "ticker")
        # Cook Timothy D sale in fixture
        cooks = [r for r in rows if "Cook" in (r["insiderName"] or "")]
        self.assertTrue(cooks)
        self.assertEqual(cooks[0]["tradeType"], "S")


if __name__ == "__main__":
    unittest.main()
