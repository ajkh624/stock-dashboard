#!/usr/bin/env python3
"""
Yahoo Finance 에서 stocks.json 의 종목들 현재가를 가져와
data/live-prices.json 으로 저장. GitHub Actions cron 에서 호출.
"""
from __future__ import annotations
import json
import time
import urllib.request
import urllib.error
import http.cookiejar
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
STOCKS = ROOT / "data" / "stocks.json"
OUT = ROOT / "data" / "live-prices.json"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

# 세션 쿠키 유지 (Yahoo가 cookie 없으면 429 던지는 경향)
COOKIE_JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIE_JAR))
OPENER.addheaders = [
    ("User-Agent", UA),
    ("Accept", "application/json,text/plain,*/*"),
    ("Accept-Language", "en-US,en;q=0.9"),
    ("Referer", "https://finance.yahoo.com/"),
]

def warmup():
    """Yahoo 홈에 한 번 들러서 쿠키 받기."""
    try:
        OPENER.open("https://fc.yahoo.com/", timeout=5).read(100)
    except Exception:
        pass


def fetch_yahoo(symbol: str) -> Optional[dict]:
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
        return {"symbol": symbol, "error": str(e)}

def main():
    stocks = json.loads(STOCKS.read_text(encoding="utf-8"))
    # 고유 (code, market) 추출
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
    warmup()
    for code, market, sym in targets:
        r = fetch_yahoo(sym)
        if r:
            results[code] = r
        print(f"  {sym}: {r.get('price') if r else 'FAIL'}")
        time.sleep(0.8)  # rate-limit 회피

    out = {
        "updated_at": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "source": "Yahoo Finance v8 chart API",
        "prices": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ {len(results)} symbols → {OUT}")

if __name__ == "__main__":
    main()
