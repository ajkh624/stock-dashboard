#!/usr/bin/env python3
"""
종목을 stocks.json 에 추가하는 헬퍼.
사용 예:
  python scripts/add.py --name 다우기술 --code 023590 --price 47550 \
    --per 4.22 --pbr 0.60 --roe 15.95 --div 3.79 \
    --cfo-eok 12000 --fcf-eok 8000 --opinion 매수 \
    --thesis "매출 17.5조..." --tags 금융,저평가
"""
import argparse, json, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "stocks.json"

OPINION_COLOR = {
    "강매수": "buy_strong", "매수": "buy", "중립": "neutral",
    "회피": "avoid", "매도": "sell",
}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--name", required=True)
    p.add_argument("--code", required=True)
    p.add_argument("--price", type=float)
    p.add_argument("--per", type=float)
    p.add_argument("--pbr", type=float)
    p.add_argument("--roe", type=float)
    p.add_argument("--div", type=float, dest="dividend_yield")
    p.add_argument("--debt", type=float, dest="debt_ratio")
    p.add_argument("--cfo-eok", type=float, dest="cfo_eok")
    p.add_argument("--fcf-eok", type=float, dest="fcf_eok")
    p.add_argument("--revenue-eok", type=float, dest="revenue_eok")
    p.add_argument("--op-income-eok", type=float, dest="op_income_eok")
    p.add_argument("--net-income-eok", type=float, dest="net_income_eok")
    p.add_argument("--opinion", required=True, choices=list(OPINION_COLOR))
    p.add_argument("--thesis", required=True)
    p.add_argument("--part1-risk", type=int, default=None)
    p.add_argument("--part1-total", type=int, default=18)
    p.add_argument("--part2-quality", type=int, default=None)
    p.add_argument("--part2-total", type=int, default=12)
    p.add_argument("--risks-hit", default="", help="comma-separated")
    p.add_argument("--passed", default="", help="comma-separated")
    p.add_argument("--failed", default="", help="comma-separated")
    p.add_argument("--rcept", default=None)
    p.add_argument("--source-year", type=int, default=None)
    p.add_argument("--tags", default="")
    args = p.parse_args()

    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat(timespec="seconds")

    entry = {
        "analyzed_at": now,
        "name": args.name,
        "code": args.code,
        "price": args.price,
        "per": args.per,
        "pbr": args.pbr,
        "roe": args.roe,
        "dividend_yield": args.dividend_yield,
        "debt_ratio": args.debt_ratio,
        "cfo_eok": args.cfo_eok,
        "fcf_eok": args.fcf_eok,
        "revenue_eok": args.revenue_eok,
        "op_income_eok": args.op_income_eok,
        "net_income_eok": args.net_income_eok,
        "opinion": args.opinion,
        "opinion_color": OPINION_COLOR[args.opinion],
        "thesis": args.thesis,
        "checklist_part1_risk": args.part1_risk,
        "checklist_part1_total": args.part1_total,
        "checklist_part2_quality": args.part2_quality,
        "checklist_part2_total": args.part2_total,
        "checklist_detail": {
            "part1_risks_hit": [x.strip() for x in args.risks_hit.split(",") if x.strip()],
            "part2_passed":   [x.strip() for x in args.passed.split(",") if x.strip()],
            "part2_failed":   [x.strip() for x in args.failed.split(",") if x.strip()],
        },
        "dart_rcept": args.rcept,
        "source_year": args.source_year,
        "tags": [t.strip() for t in args.tags.split(",") if t.strip()],
    }

    db = json.loads(DATA.read_text(encoding="utf-8"))
    db["stocks"].append(entry)
    db["updated_at"] = now
    DATA.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ added: {args.name} ({args.code}) → {DATA}")

if __name__ == "__main__":
    main()
