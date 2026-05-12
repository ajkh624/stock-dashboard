#!/usr/bin/env python3
"""
KRX(pykrx) 에서 stocks.json 의 종목들 일봉 종가를 가져와
data/live-prices.json 으로 저장. 매일 KST 18:00 GitHub Actions cron 에서 호출.
"""
from __future__ import annotations
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from pykrx import stock  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
STOCKS = ROOT / "data" / "stocks.json"
OUT = ROOT / "data" / "live-prices.json"

KST = timezone(timedelta(hours=9))


def fetch_via_krx(code: str) -> Optional[dict]:
    """pykrx 로 최근 14일 일봉 → 마지막 거래일 종가 + 전일 대비."""
    end = datetime.now(KST).strftime("%Y%m%d")
    start = (datetime.now(KST) - timedelta(days=14)).strftime("%Y%m%d")
    try:
        df = stock.get_market_ohlcv_by_date(start, end, code)
        if df is None or df.empty or len(df) < 2:
            return {"symbol": code, "error": "krx: insufficient data"}
        last = df.iloc[-1]
        prev = df.iloc[-2]
        close = int(last["종가"])
        prev_close = int(prev["종가"])
        change = close - prev_close
        pct = (change / prev_close * 100) if prev_close else None
        return {
            "symbol": code,
            "price": close,
            "prev_close": prev_close,
            "change": change,
            "change_pct": round(pct, 2) if pct is not None else None,
            "currency": "KRW",
            "exchange": "KRX",
            "source": "krx",
            "trade_date": str(df.index[-1].date()),
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    except Exception as e:
        return {"symbol": code, "error": f"krx: {type(e).__name__}: {str(e)[:120]}"}


def main():
    stocks = json.loads(STOCKS.read_text(encoding="utf-8"))
    seen = set()
    targets = []
    for s in stocks["stocks"]:
        code = s.get("code")
        if not code or code in seen:
            continue
        seen.add(code)
        targets.append(code)

    results = {}
    for code in targets:
        r = fetch_via_krx(code)
        if r:
            results[code] = r
        label = r.get("price") if r and "price" in r else (r.get("error") if r else "FAIL")
        print(f"  {code}: {label}")

    out = {
        "updated_at": datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "source": "KRX (pykrx)",
        "schedule": "일 1회 KST 18:00 (평일)",
        "prices": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    ok_n = sum(1 for v in results.values() if "price" in v and v.get("price") is not None)
    print(f"✅ {ok_n}/{len(results)} symbols OK → {OUT}")


if __name__ == "__main__":
    main()
