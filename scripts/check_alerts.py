#!/usr/bin/env python3
"""
check_alerts.py — 매일 18:00 KST 가격 알림 체크 + 텔레그램 발송

실행 방식:
  - GitHub Actions: fetch_prices.py 다음에 실행
  - Secrets 필요:
      GIST_TOKEN: GitHub PAT (gist scope)
      GIST_ID:    알림이 저장된 Gist ID
      GIST_FILE:  파일명 (기본 stock-notes.json)
      TG_BOT_TOKEN: 텔레그램 봇 토큰
      TG_CHAT_ID:   발송 대상 chat_id
      TG_THREAD_ID: (선택) Telegram 토픽 thread_id

동작:
  1. data/live-prices.json + stocks.json 로드
  2. Gist에서 alerts 읽기
  3. 각 알림 조건 체크 → hit 시 텔레그램 발송 + active=false 처리
  4. 변경된 state를 Gist에 PATCH

체크 가능 alert.type:
  - price_above:    가격 >= value
  - price_below:    가격 <= value
  - change_pct_abs: |change_pct| >= value
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STOCKS_FILE = ROOT / "data" / "stocks.json"
LIVE_FILE = ROOT / "data" / "live-prices.json"
KST = timezone(timedelta(hours=9))


def env(key: str, required: bool = True) -> str:
    v = os.environ.get(key, "").strip()
    if required and not v:
        print(f"⚠️  env {key} not set — skipping alerts")
        sys.exit(0)
    return v


def fetch_gist(token: str, gist_id: str, filename: str) -> dict:
    req = urllib.request.Request(
        f"https://api.github.com/gists/{gist_id}",
        headers={"Authorization": f"token {token}", "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        gist = json.loads(r.read())
    files = gist.get("files", {})
    f = files.get(filename) or next(iter(files.values()), None)
    if not f:
        return {}
    try:
        return json.loads(f.get("content") or "{}")
    except json.JSONDecodeError:
        return {}


def push_gist(token: str, gist_id: str, filename: str, content: dict) -> None:
    body = json.dumps(
        {"files": {filename: {"content": json.dumps(content, ensure_ascii=False, indent=2)}}}
    ).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.github.com/gists/{gist_id}",
        data=body,
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
        method="PATCH",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        r.read()


def tg_send(token: str, chat_id: str, thread_id: str, text: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if thread_id:
        payload["message_thread_id"] = int(thread_id)
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()
    except urllib.error.HTTPError as e:
        print(f"  ❌ telegram error {e.code}: {e.read().decode()[:200]}")


def check_alert(alert: dict, live: dict) -> tuple[bool, str]:
    """Return (triggered, description)."""
    t = alert.get("type")
    v = float(alert.get("value", 0))
    price = live.get("price")
    chg = live.get("change_pct")
    if price is None:
        return False, ""
    if t == "price_above" and price >= v:
        return True, f"📈 <b>{price:,.0f}원</b> ≥ {v:,.0f}원"
    if t == "price_below" and price <= v:
        return True, f"📉 <b>{price:,.0f}원</b> ≤ {v:,.0f}원"
    if t == "change_pct_abs" and chg is not None and abs(chg) >= v:
        return True, f"⚡ 당일 <b>{chg:+.2f}%</b> (임계 ±{v}%)"
    return False, ""


def main():
    # Required env (skip silently if not configured — keeps fetch_prices step independent)
    token = env("GIST_TOKEN")
    gist_id = env("GIST_ID")
    filename = os.environ.get("GIST_FILE", "stock-notes.json").strip() or "stock-notes.json"
    tg_token = env("TG_BOT_TOKEN")
    tg_chat = env("TG_CHAT_ID")
    tg_thread = os.environ.get("TG_THREAD_ID", "").strip()

    # Load local data
    stocks = json.loads(STOCKS_FILE.read_text(encoding="utf-8")).get("stocks", [])
    name_by_code = {s["code"]: s.get("name", s["code"]) for s in stocks}
    live_data = json.loads(LIVE_FILE.read_text(encoding="utf-8")).get("prices", {})

    # Load alerts from Gist
    state = fetch_gist(token, gist_id, filename)
    alerts_map = state.get("alerts", {}) or {}
    if not alerts_map:
        print("📭 no alerts configured")
        return

    now_str = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    hit_count = 0
    changed = False

    for code, alerts in list(alerts_map.items()):
        live = live_data.get(code)
        if not live or live.get("error") or live.get("price") is None:
            continue
        name = name_by_code.get(code, code)
        new_alerts = []
        for a in alerts:
            if a.get("active") is False:
                new_alerts.append(a)
                continue
            triggered, desc = check_alert(a, live)
            if triggered:
                hit_count += 1
                # Build message
                pct = live.get("change_pct")
                pct_str = f"({pct:+.2f}%)" if pct is not None else ""
                trade_date = live.get("trade_date", "")
                msg = (
                    f"🔔 <b>{name}</b> ({code}) 알림\n"
                    f"{desc}\n"
                    f"종가 {live['price']:,}원 {pct_str} · {trade_date}\n"
                    f"━━━━━━━━━━\n"
                    f"📊 대시보드: https://ajkh624.github.io/stock-dashboard/\n"
                    f"⏰ {now_str}"
                )
                tg_send(tg_token, tg_chat, tg_thread, msg)
                print(f"  ✅ {name} ({code}) — {desc}")
                a["active"] = False
                a["last_triggered"] = datetime.now(KST).strftime("%Y-%m-%d")
                changed = True
            new_alerts.append(a)
        alerts_map[code] = new_alerts

    if changed:
        state["alerts"] = alerts_map
        meta = state.get("_meta") or {}
        meta["version"] = 2
        meta["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        state["_meta"] = meta
        push_gist(token, gist_id, filename, state)
        print(f"📤 gist updated · {hit_count} alert(s) fired")
    else:
        print(f"✅ checked {sum(len(v) for v in alerts_map.values())} alert(s), 0 fired")


if __name__ == "__main__":
    main()
