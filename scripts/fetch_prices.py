#!/usr/bin/env python3
"""
Yahoo Finance에서 stocks.json 의 종목들 현재가를 가져와
data/live-prices.json 으로 저장. yfinance 패키지로 crumb·cookie 자동 처리.
GitHub Actions cron 에서 호출.
"""
from __future__ import annotations
import json
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

try:
    import yfinance as yf  # type: ignore
except ImportError:
    print("yfinance not installed, falling back to urllib")
    yf = None

import urllib.request
import urllib.error
import http.cookiejar

ROOT = Path(__file__).resolve().parent.parent
STOCKS = ROOT / "data" / "stocks.json"
OUT = ROOT / "data" / "live-prices.json"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

COOKIE_JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIE_JAR))
OPENER.addheaders = [
    ("User-Agent", UA),
    ("Accept", "application/json,text/plain,*/*"),
    ("Accept-Language", "en-US,en;q=0.9"),
    ("Referer", "https://finance.yahoo.com/"),
]


def fetch_via_yfinance(symbol: str) -> Optional[dict]:
    """yfinance 패키지로 가져오기 (crumb·cookie 자동)."""
    try:
        t = yf.Ticker(symbol)
        # fast_info 우선, 실패하면 history 사용
        try:
            fi = t.fast_info
            price = fi.get("last_price") or fi.get("regular_market_price")
            prev = fi.get("previous_close") or fi.get("regular_market_previous_close")
            currency = fi.get("currency")
            exch = fi.get("exchange")
        except Exception:
            fi = None
            price = prev = currency = exch = None

        if price is None:
            hist = t.history(period="2d", interval="1d")
            if hist.empty:
                return None
            price = float(hist["Close"].iloc[-1])
            prev = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else None

        change = (price - prev) if (prev is not None) else None
        pct = (change / prev * 100) if (change is not None and prev) else None
        return {
            "symbol": symbol,
            "price": round(float(price), 2),
            "prev_close": round(float(prev), 2) if prev is not None else None,
            "change": round(float(change), 2) if change is not None else None,
            "change_pct": round(float(pct), 2) if pct is not None else None,
            "currency": currency or "KRW",
            "exchange": exch,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    except Exception as e:
        return {"symbol": symbol, "error": f"yfinance: {type(e).__name__}: {str(e)[:100]}"}


def fetch_via_urllib(symbol: str) -> Optional[dict]:
    """urllib 폴백."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=2d"
    try:
        with OPENER.open(url, timeout=10) as r:
            data = json.loads(r.read())
        meta = data["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice")
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        if price is None:
            return None
        change = (price - prev) if prev else None
        pct = (change / prev * 100) if (change is not None and prev) else None
        return {
            "symbol": meta.get("symbol", symbol),
            "price": round(price, 2) if isinstance(price, float) else price,
            "prev_close": prev,
            "change": round(change, 2) if change is not None else None,
            "change_pct": round(pct, 2) if pct is not None else None,
            "currency": meta.get("currency"),
            "exchange": meta.get("exchangeName"),
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    except (urllib.error.URLError, KeyError, json.JSONDecodeError, IndexError) as e:
        return {"symbol": symbol, "error": f"urllib: {str(e)[:100]}"}


def fetch(symbol: str) -> Optional[dict]:
    if yf is not None:
        r = fetch_via_yfinance(symbol)
        if r and "price" in r and r["price"] is not None:
            return r
        # yfinance 실패 시 urllib 폴백
        print(f"  [yfinance fail, fallback urllib] {r}")
    return fetch_via_urllib(symbol)


def main():
    stocks = json.loads(STOCKS.read_text(encoding="utf-8"))
    seen = set()
    targets = []
    for s in stocks["stocks"]:
        code = s.get("code")
        market = s.get("market", "KS")
        sym = f"{code}.{market}"
        if not code or sym in seen:
            continue
        seen.add(sym)
        targets.append((code, market, sym))

    results = {}
    for code, market, sym in targets:
        r = fetch(sym)
        if r:
            results[code] = r
        print(f"  {sym}: {r.get('price') if r and 'price' in r else (r.get('error') if r else 'FAIL')}")
        time.sleep(0.5)

    out = {
        "updated_at": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "source": "Yahoo Finance (yfinance)",
        "prices": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    ok_n = sum(1 for v in results.values() if "price" in v and v["price"] is not None)
    print(f"✅ {ok_n}/{len(results)} symbols OK → {OUT}")


if __name__ == "__main__":
    main()
