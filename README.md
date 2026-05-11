# 📈 주식 재무제표 분석 대시보드

개인 종목 분석 결과를 누적·표시하는 정적 대시보드.

**Live**: https://ajkh624.github.io/stock-dashboard/

## 구조
- `index.html` — 대시보드 본체
- `data/stocks.json` — 분석 데이터 (Source of Truth)
- `css/style.css` — 모바일 최적 스타일
- `js/render.js` — 표/카드 렌더링·필터·정렬
- `scripts/add.py` — 종목 추가 헬퍼

## 새 종목 추가
```bash
python scripts/add.py --name 종목명 --code 005930 --price 70000 \
  --per 12.5 --pbr 1.2 --roe 8.5 --div 2.1 \
  --cfo-eok 100000 --fcf-eok 50000 \
  --opinion 매수 --thesis "..." --tags "반도체,대형주"
git add data/stocks.json && git commit -m "add: 종목명" && git push
```

## 면책
매수·매도 의견은 개인 분석이며 투자 권유가 아님.
