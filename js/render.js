// Stock dashboard renderer
let STATE = { stocks: [], updated_at: null, livePrices: {}, liveUpdatedAt: null };
window.STATE = STATE;

// ========== Pagination ==========
const PAGE_SIZE = 20;
let CURRENT_PAGE = 1;
function resetPage() { CURRENT_PAGE = 1; }

// ========== Hidden stocks (localStorage) ==========
const HIDDEN_KEY = 'stockDashboard.hiddenStocks';
function loadHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveHidden(set) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
}
function stockKey(s) {
  // 같은 종목 여러 분석본 구분: code + analyzed_at
  return `${s.code}__${s.analyzed_at || ''}`;
}
function isHidden(s) {
  return loadHidden().has(stockKey(s));
}
function hideStock(s) {
  const h = loadHidden(); h.add(stockKey(s)); saveHidden(h); render(); updateHiddenBadge();
}
function restoreStock(key) {
  const h = loadHidden(); h.delete(key); saveHidden(h); render(); updateHiddenBadge();
}
function restoreAll() {
  saveHidden(new Set()); render(); updateHiddenBadge();
}
function updateHiddenBadge() {
  const n = loadHidden().size;
  const el = document.getElementById('hiddenBadge');
  if (!el) return;
  if (n === 0) { el.style.display = 'none'; return; }
  el.style.display = 'inline-flex';
  el.textContent = `🗑️ 숨김 ${n}개`;
}

const TOOLTIPS = {
  PER: 'PER = 주가 ÷ 주당순이익(EPS) · 이익 1원 사기 위해 주가 몇 배 내는가 · 10↓ 저평가 / 20↑ 고평가',
  PBR: 'PBR = 주가 ÷ 주당순자산(BPS) · 청산가치 대비 주가 · 1배↓ 장부가 이하 · 자산 부실 시 함정 주의',
  ROE: 'ROE = 당기순이익 ÷ 자기자본 · 주주 돈으로 얼마 벌었나 · 15%+ 5년 유지 = 우량 (버핏 핵심지표)',
  배당: '배당수익률 = 주당배당금 ÷ 주가 · 5%+ 매력 · 배당성향 80%+ 무리한 배당은 지속 불가능',
  CFO: 'CFO = 영업현금흐름 · 본업으로 실제 들어온 현금 · 순익보다 일관되게 커야 정상 · 마이너스면 분식 의심',
  FCF: 'FCF = CFO − CAPEX · 주주에게 돌려줄 수 있는 현금 · 꾸준히 (+)여야 진짜 우량',
  현재가: '직전 거래일 종가 (출처: 네이버페이 증권)',
  분석일시: '본 카드 작성·갱신 일시 (KST)',
  FY: 'Fiscal Year — 참고한 사업보고서 회계연도',
  체크리스트: 'Part 1 위험(/18): 회피 신호 · Part 2 우량(/12): 매수 신호 · 위험 3↑ 회피 / 우량 9↑ 매수 후보',
};

function tip(key) {
  if (!TOOLTIPS[key]) return '';
  const v = TOOLTIPS[key].replace(/"/g,'&quot;');
  return ` title="${v}" data-tip="${v}"`;
}

const opinionClassMap = {
  '강매수': 'buy_strong', '매수': 'buy', '중립': 'neutral',
  '회피': 'avoid', '매도': 'sell',
};

const fmt = (n, suffix='') => (n == null ? '-' : Number(n).toLocaleString() + suffix);
const fmtPct = (n) => (n == null ? '-' : Number(n).toFixed(1) + '%');
const fmtX = (n) => (n == null ? '-' : Number(n).toFixed(2));

// 네이버 vs KRX 비교 셀: 메인 값 + 2번째 줄 KRX 보조
// kind: 'x' = 배수(PER/PBR), 'pct' = 퍼센트(배당)
function cmpCell(navVal, krxVal, kind='x') {
  const fmtV = (v) => kind === 'pct' ? fmtPct(v) : fmtX(v);
  // 둘 다 없으면 -
  if (navVal == null && krxVal == null) return '<span style="color:var(--text-dim)">-</span>';
  // 네이버만 있음 → 그냥 표시
  if (krxVal == null) return fmtV(navVal);
  // 네이버 없음 → KRX값 회색으로 메인 표시
  if (navVal == null || navVal === 0) {
    return `<span style="color:#93c5fd">${fmtV(krxVal)}</span><br><small class="krx-aux">KRX</small>`;
  }
  // 둘 다 있음: 차이 계산 (네이버 기준 = (네이버 - KRX) / KRX)
  const diffPct = ((navVal - krxVal) / Math.abs(krxVal)) * 100;
  const absDiff = Math.abs(diffPct);
  // 차이 미미하면 KRX 생략
  if (absDiff < 0.5) {
    return `${fmtV(navVal)}<br><small class="krx-aux">≈KRX</small>`;
  }
  let diffCls = 'diff-small';
  if (absDiff >= 20) diffCls = 'diff-large';
  else if (absDiff >= 10) diffCls = 'diff-mid';
  const sign = diffPct > 0 ? '+' : '';
  return `${fmtV(navVal)}<br><small class="krx-aux">${fmtV(krxVal)}</small> <small class="cmp-diff ${diffCls}">${sign}${diffPct.toFixed(0)}%</small>`;
}

function shortDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function renderIncome(s) {
  if (s.revenue_eok == null && s.op_income_eok == null && s.net_income_eok == null) return '';
  const fy = s.source_year ? `${s.source_year}` : '';
  return `
  <div class="income">
    <div class="income-head">📊 ${fy} 손익 (억원)</div>
    <div class="income-grid">
      <div><span class="ilabel">매출</span><span class="ival">${fmt(s.revenue_eok)}</span></div>
      <div><span class="ilabel">영업이익</span><span class="ival">${fmt(s.op_income_eok)}</span></div>
      <div><span class="ilabel">순이익</span><span class="ival">${fmt(s.net_income_eok)}</span></div>
      <div><span class="ilabel">부채비율</span><span class="ival">${s.debt_ratio==null?'-':s.debt_ratio+'%'}</span></div>
    </div>
    ${s.financial_note?`<div class="income-note">ℹ️ ${s.financial_note}</div>`:''}
  </div>`;
}

function renderChecklist(s) {
  const p1 = s.checklist_part1_risk, p1t = s.checklist_part1_total || 17;
  const p2 = s.checklist_part2_quality, p2t = s.checklist_part2_total || 13;
  if (p1 == null && p2 == null) return '';
  const p1na = s.checklist_part1_na || 0, p2na = s.checklist_part2_na || 0;
  const full = s.checklist_detail_full;
  if (full) {
    const renderItems = (list) => list.map((it, i) => {
      const cls = it.status; // hit/ok/ng/na
      const icon = {hit:'⚠️', ok:'✓', ng:'✗', na:'—'}[cls] || '•';
      return `<li class="${cls}"><span class="ico">${icon}</span><span class="lbl">${i+1}. ${it.label}</span><span class="ev">${it.evidence}</span></li>`;
    }).join('');
    return `
  <details class="checklist">
    <summary>
      <span class="chk-badge risk">⚠️ 위험 ${p1}/${p1t}${p1na?` (NA ${p1na})`:''}</span>
      <span class="chk-badge quality">⭐ 우량 ${p2}/${p2t}${p2na?` (NA ${p2na})`:''}</span>
      <span class="chk-toggle">▼</span>
    </summary>
    <div class="chk-body">
      <div class="chk-section">
        <h4>🚨 Part 1. 위험 시그널 (18개)</h4>
        <ul class="chk-list">${renderItems(full.part1)}</ul>
      </div>
      <div class="chk-section">
        <h4>✅ Part 2. 우량 시그널 (12개)</h4>
        <ul class="chk-list">${renderItems(full.part2)}</ul>
      </div>
    </div>
  </details>`;
  }
  // fallback (이전 간단 형식)
  const d = s.checklist_detail || {};
  const risks = (d.part1_risks_hit||[]).map(x=>`<li class="hit">⚠️ ${x}</li>`).join('');
  const passed = (d.part2_passed||[]).map(x=>`<li class="ok">✓ ${x}</li>`).join('');
  const failed = (d.part2_failed||[]).map(x=>`<li class="ng">✗ ${x}</li>`).join('');
  const hasDetail = risks || passed || failed;
  return `
  <details class="checklist">
    <summary>
      <span class="chk-badge risk">⚠️ 위험 ${p1??'-'}/${p1t}</span>
      <span class="chk-badge quality">⭐ 우량 ${p2??'-'}/${p2t}</span>
      ${hasDetail ? '<span class="chk-toggle">▼</span>' : ''}
    </summary>
    ${hasDetail ? `<div class="chk-body">
      ${risks ? `<div class="chk-section"><h4>Part 1 위험 ON</h4><ul>${risks}</ul></div>` : ''}
      ${passed ? `<div class="chk-section"><h4>Part 2 통과</h4><ul>${passed}</ul></div>` : ''}
      ${failed ? `<div class="chk-section"><h4>Part 2 미통과</h4><ul>${failed}</ul></div>` : ''}
    </div>` : ''}
  </details>`;
}

function renderPriceBlock(s) {
  const live = STATE.livePrices[s.code];
  const analyzedDate = (s.analysis_date || (s.analyzed_at||'').slice(0,10)) || '-';
  const analyzedPriceRow = `
    <div class="price-row analyzed">
      <span class="pr-label">분석일 (${analyzedDate})</span>
      <span class="pr-value">${fmt(s.price, '원')}</span>
    </div>`;
  if (!live || live.error || live.price == null) {
    return `<div class="price-block">${analyzedPriceRow}
      <div class="price-row live na">
        <span class="pr-label">실시간</span>
        <span class="pr-value">${live && live.error ? '오류' : '대기중'}</span>
      </div>
    </div>`;
  }
  // 변동률 부호
  const pct = live.change_pct;
  const cls = pct == null ? 'flat' : (pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat'));
  const sign = pct == null ? '' : (pct > 0 ? '▲' : (pct < 0 ? '▼' : '–'));
  // 분석일 대비 변화율
  const vsAnalyzed = (s.price && live.price) ? ((live.price - s.price)/s.price*100) : null;
  const vsCls = vsAnalyzed == null ? 'flat' : (vsAnalyzed > 0 ? 'up' : (vsAnalyzed < 0 ? 'down' : 'flat'));
  const vsSign = vsAnalyzed == null ? '' : (vsAnalyzed > 0 ? '+' : '');
  // 시각
  const fetched = live.fetched_at ? new Date(live.fetched_at) : null;
  const fetchedStr = fetched ? `${fetched.getMonth()+1}/${fetched.getDate()} ${String(fetched.getHours()).padStart(2,'0')}:${String(fetched.getMinutes()).padStart(2,'0')}` : '-';
  return `<div class="price-block">
    ${analyzedPriceRow}
    <div class="price-row live ${cls}">
      <span class="pr-label">실시간 (${fetchedStr})</span>
      <span class="pr-value">
        ${fmt(live.price, '원')}
        <span class="pr-chg">${sign}${pct == null ? '-' : Math.abs(pct).toFixed(2)+'%'}</span>
      </span>
    </div>
    ${vsAnalyzed != null ? `
    <div class="price-row diff ${vsCls}">
      <span class="pr-label">분석일 대비</span>
      <span class="pr-value">${vsSign}${vsAnalyzed.toFixed(2)}%</span>
    </div>` : ''}
  </div>`;
}

function renderCard(s) {
  const opCls = opinionClassMap[s.opinion] || 'neutral';
  const tags = (s.tags||[]).map(t=>`<span class="tag">${t}</span>`).join('');
  const hasTs = !!(s.timeseries && s.timeseries.years && s.timeseries.years.length);
  const watching = window.Journal ? Journal.isWatching(s.code) : false;
  const pos = window.Journal ? Journal.getPosition(s.code) : { qty: 0 };
  const alertN = window.Journal ? Journal.getAlerts(s.code).length : 0;
  const trades = window.Journal ? Journal.getTrades(s.code) : [];
  return `
  <article class="card${hasTs?' has-ts':''}${watching?' watching':''}${pos.qty>0?' holding':''}" data-code="${s.code}" data-idx="${s._idx}" role="button" tabindex="0">
    <div class="card-actions">
      <button class="card-cmp-btn" data-action="cmp" title="비교 바스켓에 추가/제외" aria-label="비교">☐</button>
      <button class="card-watch-btn ${watching?'active':''}" data-action="watch" title="${watching?'워치리스트에서 제거':'워치리스트에 추가'}" aria-label="워치">${watching?'⭐':'☆'}</button>
      <button class="card-trade-btn ${pos.qty>0?'active':''}" data-action="trade" title="매매 기록${pos.qty>0?` (보유 ${pos.qty}주)`:''}" aria-label="매매">📒${trades.length?`<small>${trades.length}</small>`:''}</button>
      <button class="card-alert-btn ${alertN>0?'active':''}" data-action="alert" title="가격 알림${alertN>0?` (${alertN}개 활성)`:''}" aria-label="알림">🔔${alertN?`<small>${alertN}</small>`:''}</button>
      <button class="card-note-btn" data-action="note" title="메모 추가/편집" aria-label="메모">📝</button>
      <button class="card-delete" data-action="delete" title="이 카드 숨기기" aria-label="삭제">✕</button>
    </div>
    ${renderHoldingBadge(s, pos)}
    <div class="card-head">
      <div>
        <span class="card-name">${s.name}</span>
        <span class="card-code">${s.code}</span>
      </div>
      <span class="opinion ${opCls}">${s.opinion}</span>
    </div>
    ${renderPriceBlock(s)}
    <div class="card-metrics">
      <div class="metric"${tip('PER (네이버/KRX)')}>${renderPercentileBadge(s.per_percentile,'per')}<span class="metric-label">PER</span><span class="metric-value">${fmtX(s.per)}${s.krx_per?`<small class="krx-tag" title="KRX 공식 2026-05-13">/${s.krx_per.toFixed(2)}</small>`:''}</span></div>
      <div class="metric"${tip('PBR (네이버/KRX)')}>${renderPercentileBadge(s.pbr_percentile,'pbr')}<span class="metric-label">PBR</span><span class="metric-value">${fmtX(s.pbr)}${s.krx_pbr?`<small class="krx-tag" title="KRX 공식 2026-05-13">/${s.krx_pbr.toFixed(2)}</small>`:''}</span></div>
      <div class="metric"${tip('ROE')}><span class="metric-label">ROE</span><span class="metric-value">${fmtPct(s.roe)}</span></div>
      <div class="metric"${tip('배당')}>${renderPercentileBadge(s.div_percentile,'div')}<span class="metric-label">배당</span><span class="metric-value">${fmtPct(s.dividend_yield)}</span></div>
    </div>
    <div class="card-cf">
      <div${tip('CFO')}>CFO <strong>${fmt(s.cfo_eok)}억</strong></div>
      <div${tip('FCF')}>FCF <strong>${fmt(s.fcf_eok)}억</strong></div>
      <div class="card-date"${tip('분석일시')}>${shortDate(s.analyzed_at)}${s.source_year?` · ${s.source_year} 사업보고서`:''}</div>
    </div>
    ${renderIncome(s)}
    ${renderChecklist(s)}
    <p class="card-thesis">${s.thesis||''}</p>
    ${tags ? `<div class="card-tags">${tags}</div>` : ''}
    ${renderNote(s)}
  </article>`;
}

function renderMarketBaseline() {
  const el = document.getElementById('marketBaseline');
  if (!el) return;
  const m = STATE.market_baseline;
  if (!m) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = `
    <span><span class="mb-label">📊 시장 기준선</span><strong>${m.baseline_date}</strong> · ${m.universe_size.toLocaleString()}종목 (${m.baseline_filter})</span>
    <span>PER 중앙값 <strong>${m.per_median}</strong> · 평균 ${m.per_mean}</span>
    <span>PBR 중앙값 <strong>${m.pbr_median}</strong> · 평균 ${m.pbr_mean}</span>
    <span>배당 중앙값 <strong>${m.div_median}%</strong> · 평균 ${m.div_mean}%</span>
    <span style="opacity:.7">카드 우상단 백분위 배지 = 등록 종목의 시장 상대 위치</span>
  `;
}

function renderPercentileBadge(p, kind) {
  if (p == null) return '';
  // PER/PBR: 낮을수록 좋음 (저평가). 배당: 높을수록 좋음.
  // 표시: 시장의 하위 N% 위치
  let display, cls, title;
  if (kind === 'div') {
    display = `상위 ${(100-p).toFixed(0)}%`;
    cls = p >= 80 ? 'pct-good' : (p >= 50 ? 'pct-mid' : 'pct-bad');
    title = `배당수익률 시장 백분위: 상위 ${(100-p).toFixed(0)}% (높을수록 고배당)`;
  } else {
    display = `하위 ${p.toFixed(0)}%`;
    cls = p <= 20 ? 'pct-good' : (p <= 50 ? 'pct-mid' : 'pct-bad');
    title = `${kind.toUpperCase()} 시장 백분위: 하위 ${p.toFixed(0)}% (낮을수록 저평가)`;
  }
  return `<span class="pct-badge ${cls}" title="${title}">${display}</span>`;
}

function renderNote(s) {
  const note = getNote(s.code);
  if (!note) return '';
  return `<div class="card-note" data-note-code="${s.code}" title="클릭하여 편집"><span class="card-note-label">📝 메모</span><span class="card-note-text">${escapeHtml(note)}</span></div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getNote(code) {
  try { return (JSON.parse(localStorage.getItem('stockDashboard.notes')||'{}'))[code] || ''; }
  catch(e) { return ''; }
}

function saveNote(code, text) {
  let store = {};
  try { store = JSON.parse(localStorage.getItem('stockDashboard.notes')||'{}'); } catch(e) {}
  if (text && text.trim()) store[code] = text.trim();
  else delete store[code];
  localStorage.setItem('stockDashboard.notes', JSON.stringify(store));
}

function editNote(code, name) {
  const current = getNote(code);
  const input = prompt(`${name} 메모 (비워두면 삭제)`, current);
  if (input === null) return;  // cancel
  saveNote(code, input);
  render();
}

function renderHoldingBadge(s, pos) {
  if (!pos || pos.qty <= 0) return '';
  const live = STATE.livePrices?.[s.code]?.price;
  const pnl = (live && pos.avgCost) ? ((live - pos.avgCost) / pos.avgCost * 100) : null;
  const pnlHTML = pnl != null
    ? `<span class="${pnl > 0 ? 'up' : pnl < 0 ? 'down' : 'flat'}">${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%</span>`
    : '';
  return `<div class="holding-bar">📦 보유 ${pos.qty.toLocaleString()}주 · 평단 ${Math.round(pos.avgCost).toLocaleString()}원 ${pnlHTML}</div>`;
}

function renderRow(s) {
  const opCls = opinionClassMap[s.opinion] || 'neutral';
  const live = STATE.livePrices[s.code];
  const livePrice = live && !live.error && live.price != null ? live.price : null;
  const vsAnalyzed = (s.price && livePrice) ? ((livePrice - s.price)/s.price*100) : null;
  const liveCls = livePrice == null ? 'flat' : (live.change_pct == null ? 'flat' : (live.change_pct > 0 ? 'up' : (live.change_pct < 0 ? 'down' : 'flat')));
  const liveCellHTML = livePrice == null
    ? `<span style="color:var(--text-dim)">${live && live.error ? '오류' : '-'}</span>`
    : `<span class="live-px ${liveCls}">${fmt(livePrice)}${live.change_pct != null ? ` <small>(${live.change_pct > 0 ? '+' : ''}${live.change_pct.toFixed(2)}%)</small>` : ''}</span>`;
  const analyzedCellHTML = `<span>${fmt(s.price)}</span><br><small style="color:var(--text-dim)">${s.analysis_date || (s.analyzed_at||'').slice(0,10)}</small>`;
  const vsCellHTML = vsAnalyzed == null ? '-' : `<span class="${vsAnalyzed>0?'up':(vsAnalyzed<0?'down':'flat')}">${vsAnalyzed > 0 ? '+' : ''}${vsAnalyzed.toFixed(2)}%</span>`;
  const watching = window.Journal ? Journal.isWatching(s.code) : false;
  const pos = window.Journal ? Journal.getPosition(s.code) : { qty: 0 };
  const alertN = window.Journal ? Journal.getAlerts(s.code).length : 0;
  const trades = window.Journal ? Journal.getTrades(s.code) : [];
  return `<tr class="stock-row" data-idx="${s._idx}" data-code="${s.code}" tabindex="0">
    <td>${shortDate(s.analyzed_at)}</td>
    <td><small style="color:var(--text-dim)">${s.source_year||'-'}</small></td>
    <td><strong>${s.name}</strong><br><small style="color:var(--text-dim)">${s.code}</small></td>
    <td class="num" title="분석일 가격">${analyzedCellHTML}</td>
    <td class="num" title="실시간 (Yahoo Finance)">${liveCellHTML}</td>
    <td class="num" title="분석일 대비">${vsCellHTML}</td>
    <td class="num cmp-cell" title="네이버(분석시점) / KRX(2026-05-13) (차이%)">${cmpCell(s.per, s.krx_per, 'x')}</td>
    <td class="num cmp-cell" title="네이버(분석시점) / KRX(2026-05-13) (차이%)">${cmpCell(s.pbr, s.krx_pbr, 'x')}</td>
    <td class="num">${fmtPct(s.roe)}</td>
    <td class="num cmp-cell" title="네이버(분석시점) / KRX 배당수익률(2026-05-13) (차이%)">${cmpCell(s.dividend_yield, s.krx_dividend_yield, 'pct')}</td>
    <td class="num">${fmt(s.cfo_eok)}</td>
    <td class="num">${fmt(s.fcf_eok)}</td>
    <td class="chk-cell">
      <span class="chk-badge risk">⚠️${s.checklist_part1_risk??'-'}/${s.checklist_part1_total||17}</span>
      <span class="chk-badge quality">⭐${s.checklist_part2_quality??'-'}/${s.checklist_part2_total||13}</span>
    </td>
    <td><span class="opinion ${opCls}">${s.opinion}</span></td>
    <td style="max-width:240px;font-size:12px;color:var(--text-dim);white-space:normal;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">${s.thesis||''}</td>
    <td class="row-actions">
      <button class="row-act-btn card-cmp-btn" data-action="cmp" title="비교 바스켓에 추가/제외" aria-label="비교">☐</button>
      <button class="row-act-btn ${watching?'active-watch':''}" data-action="watch" title="${watching?'워치리스트에서 제거':'워치리스트에 추가'}" aria-label="워치">${watching?'⭐':'☆'}</button>
      <button class="row-act-btn ${pos.qty>0?'active-trade':''}" data-action="trade" title="매매 기록${pos.qty>0?` (보유 ${pos.qty}주)`:''}" aria-label="매매">📒${trades.length?`<small>${trades.length}</small>`:''}</button>
      <button class="row-act-btn ${alertN>0?'active-alert':''}" data-action="alert" title="가격 알림${alertN>0?` (${alertN}개)`:''}" aria-label="알림">🔔${alertN?`<small>${alertN}</small>`:''}</button>
      <button class="row-act-btn" data-action="note" title="메모 추가/편집" aria-label="메모">📝</button>
      <button class="row-delete" data-action="delete" title="이 행 숨기기" aria-label="삭제">✕</button>
    </td>
  </tr>`;
}

function applyFilters(list) {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const op = document.getElementById('opinionFilter').value;
  const sort = document.getElementById('sortBy').value;
  const tab = (document.querySelector('.filter-tab.active')?.dataset.tab) || 'all';
  const hidden = loadHidden();

  let out = list.filter(s => {
    if (hidden.has(stockKey(s))) return false;
    if (op && s.opinion !== op) return false;
    if (tab === 'watch' && !(window.Journal && Journal.isWatching(s.code))) return false;
    if (tab === 'holding' && !(window.Journal && Journal.getPosition(s.code).qty > 0)) return false;
    if (!q) return true;
    const hay = [s.name, s.code, ...(s.tags||[])].join(' ').toLowerCase();
    return hay.includes(q);
  });

  const cmp = {
    analyzed_at_desc: (a,b)=> (b.analyzed_at||'').localeCompare(a.analyzed_at||''),
    per_asc:  (a,b)=> (a.per??1e9) - (b.per??1e9),
    pbr_asc:  (a,b)=> (a.pbr??1e9) - (b.pbr??1e9),
    roe_desc: (a,b)=> (b.roe??-1e9) - (a.roe??-1e9),
    dividend_desc: (a,b)=> (b.dividend_yield??-1e9) - (a.dividend_yield??-1e9),
  }[sort];
  return out.sort(cmp);
}

function render() {
  // assign stable index for modal lookup
  STATE.stocks.forEach((s, i) => s._idx = i);
  const list = applyFilters(STATE.stocks);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages;
  if (CURRENT_PAGE < 1) CURRENT_PAGE = 1;
  const start = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const pageItems = list.slice(start, start + PAGE_SIZE);

  document.getElementById('cards').innerHTML = pageItems.map(renderCard).join('');
  document.getElementById('tbody').innerHTML = pageItems.map(renderRow).join('');
  document.getElementById('stockCount').textContent = `${total} 종목`;
  document.getElementById('updatedAt').textContent = `갱신: ${shortDate(STATE.updated_at)}`;
  renderPager(total, totalPages);
  updateHiddenBadge();
  if (window.Compare && window.Compare.updateUI) window.Compare.updateUI();
}

// ========== Pager UI ==========
function renderPager(total, totalPages) {
  const html = buildPagerHTML(total, totalPages);
  ['pagerTop', 'pagerBottom'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}
function buildPagerHTML(total, totalPages) {
  if (total <= PAGE_SIZE) {
    // 한 페이지면 정보만 표시 (또는 비표시)
    return total === 0
      ? `<span class="pg-info">표시할 종목이 없습니다</span>`
      : `<span class="pg-info">전체 ${total}개</span>`;
  }
  const cur = CURRENT_PAGE;
  const pages = pagerWindow(cur, totalPages);
  const start = (cur - 1) * PAGE_SIZE + 1;
  const end = Math.min(cur * PAGE_SIZE, total);
  let html = '';
  html += `<button class="pg-btn" data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''} aria-label="이전">‹</button>`;
  for (const p of pages) {
    if (p === '...') {
      html += `<span class="pg-ellipsis">…</span>`;
    } else {
      html += `<button class="pg-btn ${p === cur ? 'active' : ''}" data-page="${p}" aria-label="${p}페이지">${p}</button>`;
    }
  }
  html += `<button class="pg-btn" data-page="${cur + 1}" ${cur === totalPages ? 'disabled' : ''} aria-label="다음">›</button>`;
  html += `<span class="pg-info">${start}–${end} / ${total}</span>`;
  return html;
}
function pagerWindow(cur, total) {
  // 모바일 친화: 양옆 1개씩 + 처음/끝 + ellipsis
  if (total <= 7) return Array.from({length: total}, (_, i) => i + 1);
  const out = [1];
  const left = Math.max(2, cur - 1);
  const right = Math.min(total - 1, cur + 1);
  if (left > 2) out.push('...');
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push('...');
  out.push(total);
  return out;
}
function goToPage(p) {
  CURRENT_PAGE = p;
  render();
  // 카드 영역으로 스크롤 (헤더만큼 여백)
  const cards = document.getElementById('cards');
  if (cards) {
    const y = cards.getBoundingClientRect().top + window.pageYOffset - 80;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}

// ========== Hidden stocks 복원 모달 ==========
function openHiddenModal() {
  const m = document.getElementById('hiddenModal');
  if (!m) return;
  renderHiddenModal();
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
}
function closeHiddenModal() {
  const m = document.getElementById('hiddenModal');
  if (!m) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
}
function renderHiddenModal() {
  const hidden = loadHidden();
  const body = document.getElementById('hiddenBody');
  if (!body) return;
  if (hidden.size === 0) {
    body.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:24px">숨긴 항목이 없습니다.</p>';
    return;
  }
  // hidden 키 → stock 매칭
  const items = [...hidden].map(key => {
    const stock = STATE.stocks.find(s => stockKey(s) === key);
    return { key, stock };
  });
  body.innerHTML = `
    <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
      <span style="color:var(--text-dim);font-size:12px">총 ${hidden.size}개 숨김</span>
      <button id="restoreAllBtn" class="btn-restore-all">전체 복원</button>
    </div>
    <ul class="hidden-list">
      ${items.map(({key, stock}) => `
        <li>
          <div>
            <strong>${stock ? stock.name : '(삭제된 종목)'}</strong>
            <small style="color:var(--text-dim);margin-left:6px">${stock ? stock.code : key}</small>
            ${stock?.analyzed_at ? `<br><small style="color:var(--text-dim)">분석: ${shortDate(stock.analyzed_at)}</small>` : ''}
          </div>
          <button data-restore="${key}" class="btn-restore">복원</button>
        </li>
      `).join('')}
    </ul>`;
}

// ========== Time-series Chart Modal ==========
const CHART_SPECS = [
  { key: 'revenue_eok',    label: '매출 (억원)',         color: '#4ade80', unit: '억' },
  { key: 'op_income_eok',  label: '영업이익 (억원)',     color: '#60a5fa', unit: '억' },
  { key: 'net_income_eok', label: '순이익 (억원)',       color: '#a78bfa', unit: '억' },
  { key: 'op_margin_pct',  label: '영업이익률 (%)',      color: '#fbbf24', unit: '%'  },
  { key: 'roe_pct',        label: 'ROE (%)',             color: '#fb7185', unit: '%'  },
  { key: 'debt_ratio',     label: '부채비율 (%)',        color: '#f97316', unit: '%'  },
  { key: 'cfo_eok',        label: 'CFO (억원)',          color: '#22d3ee', unit: '억' },
  { key: 'fcf_eok',        label: 'FCF (억원)',          color: '#10b981', unit: '억' },
  { key: 'per',            label: 'PER (배)',            color: '#e879f9', unit: '배' },
  { key: 'pbr',            label: 'PBR (배)',            color: '#f472b6', unit: '배' },
  { key: 'dividend_yield', label: '배당수익률 (%)',      color: '#facc15', unit: '%'  },
];

let CHART_INSTANCES = [];
let CURRENT_STOCK = null;
let CURRENT_PERIOD = 'annual';

function fmtVal(v, unit) {
  if (v == null) return '-';
  const n = Number(v);
  if (unit === '%') return n.toFixed(2) + '%';
  if (unit === '배') return n.toFixed(2);
  return n.toLocaleString() + (unit==='억' ? '억' : '');
}

function getPeriodData(stock, period) {
  const ts = stock.timeseries;
  if (!ts) return null;
  if (period === 'quarterly') {
    if (!ts.quarterly || !ts.quarterly.labels || !ts.quarterly.labels.length) return null;
    return { labels: ts.quarterly.labels, data: ts.quarterly, source: ts.quarterly.source };
  }
  if (!ts.years || !ts.years.length) return null;
  return { labels: ts.years.map(String), data: ts, source: ts.source };
}

function renderModalChecklist(stock) {
  const p1 = stock.checklist_part1_risk, p1t = stock.checklist_part1_total || 17;
  const p2 = stock.checklist_part2_quality, p2t = stock.checklist_part2_total || 13;
  if (p1 == null && p2 == null) return '';
  const p1na = stock.checklist_part1_na || 0, p2na = stock.checklist_part2_na || 0;
  const opCls = opinionClassMap[stock.opinion] || 'neutral';
  const head = `
    <div class="mc-head">
      <span class="opinion ${opCls}">${stock.opinion || '-'}</span>
      <span class="chk-badge risk">⚠️ 위험 ${p1 ?? '-'}/${p1t}${p1na?` (NA ${p1na})`:''}</span>
      <span class="chk-badge quality">⭐ 우량 ${p2 ?? '-'}/${p2t}${p2na?` (NA ${p2na})`:''}</span>
      ${stock.thesis ? `<p class="mc-thesis">${stock.thesis}</p>` : ''}
    </div>`;

  const full = stock.checklist_detail_full;
  let cols = '';
  if (full && full.part1 && full.part2) {
    const renderItems = (list) => list.map((it, i) => {
      const cls = it.status;
      const icon = {hit:'⚠️', ok:'✓', ng:'✗', na:'—'}[cls] || '•';
      return `<li class="${cls}"><span class="ico">${icon}</span><span class="lbl">${i+1}. ${it.label}</span><span class="ev">${it.evidence||''}</span></li>`;
    }).join('');
    cols = `
      <div class="mc-cols">
        <div class="mc-section">
          <h4><span>🚨 위험 시그널</span><span>(${p1}/${p1t})</span></h4>
          <ul>${renderItems(full.part1)}</ul>
        </div>
        <div class="mc-section">
          <h4><span>✅ 우량 시그널</span><span>(${p2}/${p2t})</span></h4>
          <ul>${renderItems(full.part2)}</ul>
        </div>
      </div>`;
  } else {
    const d = stock.checklist_detail || {};
    const risks = (d.part1_risks_hit||[]).map(x=>`<li class="hit"><span class="ico">⚠️</span><span class="lbl">${x}</span></li>`).join('');
    const passed = (d.part2_passed||[]).map(x=>`<li class="ok"><span class="ico">✓</span><span class="lbl">${x}</span></li>`).join('');
    const failed = (d.part2_failed||[]).map(x=>`<li class="ng"><span class="ico">✗</span><span class="lbl">${x}</span></li>`).join('');
    if (!risks && !passed && !failed) return `<section class="modal-checklist">${head}</section>`;
    cols = `
      <div class="mc-cols">
        <div class="mc-section">
          <h4><span>🚨 위험 ON</span><span>(${p1 ?? '-'}/${p1t})</span></h4>
          <ul>${risks || '<li class="na"><span class="ico">—</span><span class="lbl">위험 시그널 없음</span></li>'}</ul>
        </div>
        <div class="mc-section">
          <h4><span>✅ 우량주 체크 (${p2 ?? '-'}/${p2t})</span></h4>
          <ul>${passed}${failed}</ul>
        </div>
      </div>`;
  }
  return `<section class="modal-checklist">${head}${cols}</section>`;
}

function renderCharts() {
  const body = document.getElementById('modalBody');
  const pd = getPeriodData(CURRENT_STOCK, CURRENT_PERIOD);

  // destroy previous charts
  CHART_INSTANCES.forEach(c => { try { c.destroy(); } catch(e){} });
  CHART_INSTANCES = [];

  const checklistHTML = renderModalChecklist(CURRENT_STOCK);

  if (!pd) {
    body.innerHTML = `${checklistHTML}<div class="chart-empty">📊 ${CURRENT_PERIOD==='quarterly'?'분기별':'연간'} 시계열 데이터가 없습니다.<br><small>(다음 분석 회차에 추가 예정)</small></div>`;
    return;
  }

  const subEl = document.getElementById('modalSub');
  subEl.textContent = `${pd.labels[0]} ~ ${pd.labels[pd.labels.length-1]} · ${pd.source || ''}`;

  const specs = CHART_SPECS.filter(sp => pd.data[sp.key] && pd.data[sp.key].some(v => v != null));
  if (!specs.length) {
    body.innerHTML = `${checklistHTML}<div class="chart-empty">📊 표시할 지표가 없습니다.</div>`;
    return;
  }

  body.innerHTML = `${checklistHTML}${renderEventLegend(CURRENT_STOCK)}<div class="chart-grid">${specs.map((sp, i) => {
    const arr = pd.data[sp.key];
    const latest = arr[arr.length-1];
    return `<div class="chart-box">
      <h3><span>${sp.label}</span><span class="latest">최근 ${fmtVal(latest, sp.unit)}</span></h3>
      <div class="chart-canvas-wrap"><canvas id="chart_${i}"></canvas></div>
    </div>`;
  }).join('')}</div>${renderTradeTimeline(CURRENT_STOCK)}`;

  const chartFontColor = '#9099a8';
  const gridColor = 'rgba(255,255,255,0.06)';

  specs.forEach((sp, i) => {
    const ctx = document.getElementById(`chart_${i}`);
    if (!ctx) return;
    const arr = pd.data[sp.key];
    const eventDS = buildEventDataset(CURRENT_STOCK, pd.labels, arr, CURRENT_PERIOD);
    const datasets = [{
      label: sp.label,
      data: arr,
      borderColor: sp.color,
      backgroundColor: sp.color + '22',
      tension: 0.25,
      spanGaps: true,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: sp.color,
      fill: true,
    }];
    if (eventDS) datasets.push(eventDS);
    const inst = new Chart(ctx, {
      type: 'line',
      data: {
        labels: pd.labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f1115',
            borderColor: '#2a2f3a', borderWidth: 1,
            titleColor: '#e6e8ec', bodyColor: '#e6e8ec',
            callbacks: {
              label: (c) => {
                if (c.dataset._isEvent) {
                  const ev = c.dataset._events[c.dataIndex];
                  return ev ? `${ev.type}: ${ev.label}` : null;
                }
                return `${sp.label}: ${fmtVal(c.parsed.y, sp.unit)}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: chartFontColor, font: { size: 11 } },
            grid: { color: gridColor }
          },
          y: {
            ticks: {
              color: chartFontColor, font: { size: 11 },
              callback: v => sp.unit === '%' ? v + '%'
                              : sp.unit === '배' ? v
                              : v.toLocaleString()
            },
            grid: { color: gridColor }
          }
        }
      }
    });
    CHART_INSTANCES.push(inst);
  });
}

// ========== Corporate Events on Charts (Tier 2.3) ==========
const EVENT_STYLES = {
  '유증':   { color:'#fb7185', icon:'▼' },
  'CB':     { color:'#fb7185', icon:'▼' },
  'BW':     { color:'#fb7185', icon:'▼' },
  '감자':   { color:'#dc2626', icon:'⚠' },
  '매각':   { color:'#fbbf24', icon:'▼' },
  '자사주': { color:'#4ade80', icon:'▲' },
  '인수':   { color:'#60a5fa', icon:'●' },
  '기타':   { color:'#9099a8', icon:'◆' },
};

function eventStyle(type) { return EVENT_STYLES[type] || EVENT_STYLES['기타']; }

// 이벤트 날짜를 차트 라벨 인덱스로 매핑
// period=annual: 연도 매칭, quarterly: YY.NQ 매칭
function mapEventToIndex(ev, labels, period) {
  const d = new Date(ev.date);
  if (isNaN(d)) return -1;
  if (period === 'annual') {
    const y = String(d.getFullYear());
    return labels.indexOf(y);
  } else {
    const yy = String(d.getFullYear()).slice(2);
    const q = Math.floor(d.getMonth() / 3) + 1;
    const lab = `${yy}.${q}Q`;
    return labels.indexOf(lab);
  }
}

function buildEventDataset(stock, labels, valArr, period) {
  const events = stock.corporate_events;
  if (!events || !events.length) return null;
  // 각 라벨 인덱스 별 이벤트 묶기
  const byIdx = new Map();
  events.forEach(ev => {
    const i = mapEventToIndex(ev, labels, period);
    if (i < 0) return;
    if (!byIdx.has(i)) byIdx.set(i, []);
    byIdx.get(i).push(ev);
  });
  if (!byIdx.size) return null;
  // 데이터 포인트: y 값은 해당 인덱스의 값 또는 inferred. 빈 인덱스는 null
  const data = labels.map((_, i) => {
    if (!byIdx.has(i)) return null;
    const v = valArr[i];
    return v != null ? v : null;
  });
  const evMeta = labels.map((_, i) => {
    const evs = byIdx.get(i);
    if (!evs) return null;
    return { type: evs[0].type, label: evs.map(e=>e.label).join(' / ') };
  });
  // 첫 이벤트 색을 dataset 메인색으로
  const firstEv = events[0];
  const sty = eventStyle(firstEv.type);
  return {
    label: '자본이벤트',
    data,
    type: 'line',
    showLine: false,
    pointStyle: 'triangle',
    pointRadius: 9,
    pointHoverRadius: 12,
    pointBackgroundColor: sty.color,
    pointBorderColor: '#0f1115',
    pointBorderWidth: 2,
    spanGaps: false,
    _isEvent: true,
    _events: evMeta,
  };
}

function renderEventLegend(stock) {
  const events = stock.corporate_events;
  if (!events || !events.length) return '';
  // 타입별 그룹
  const groups = {};
  events.forEach(ev => {
    if (!groups[ev.type]) groups[ev.type] = [];
    groups[ev.type].push(ev);
  });
  const sorted = [...events].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const items = sorted.map(ev => {
    const sty = eventStyle(ev.type);
    return `<li><span class="ev-ico" style="color:${sty.color}">${sty.icon}</span>
      <span class="ev-date">${ev.date}</span>
      <span class="ev-type" style="color:${sty.color}">${ev.type}</span>
      <span class="ev-lbl">${ev.label}</span></li>`;
  }).join('');
  return `<details class="event-legend" open>
    <summary>📌 자본이벤트 ${events.length}건 — 차트 위 ▼ 마커로 표시</summary>
    <ul class="ev-list">${items}</ul>
  </details>`;
}


function updateToggleAvailability() {
  const toggle = document.getElementById('modalToggle');
  const ts = CURRENT_STOCK?.timeseries;
  const hasAnnual = !!(ts && ts.years && ts.years.length);
  const hasQuarterly = !!(ts && ts.quarterly && ts.quarterly.labels && ts.quarterly.labels.length);
  toggle.querySelector('[data-period="annual"]').disabled = !hasAnnual;
  toggle.querySelector('[data-period="quarterly"]').disabled = !hasQuarterly;
}

function renderTradeTimeline(stock) {
  if (!window.Journal) return '';
  const trades = Journal.getTrades(stock.code);
  if (!trades.length) return '';
  const pos = Journal.getPosition(stock.code);
  const live = STATE.livePrices?.[stock.code]?.price;
  const pnl = (pos.qty > 0 && live && pos.avgCost) ? ((live - pos.avgCost) / pos.avgCost * 100) : null;
  const rows = trades.slice().reverse().map(t => {
    const ico = { buy: '🟢', sell: '🔴', memo: '📝' }[t.type] || '•';
    const lbl = t.type === 'buy' ? '매수' : t.type === 'sell' ? '매도' : '메모';
    const amt = (t.price && t.qty) ? ` · ${Number(t.price).toLocaleString()}원 × ${t.qty}` : (t.price ? ` · ${Number(t.price).toLocaleString()}원` : '');
    return `<li><span>${ico} <b>${t.date}</b> ${lbl}${amt}</span>${t.reason ? `<small>${escapeHtml(t.reason)}</small>` : ''}</li>`;
  }).join('');
  const posHTML = pos.qty > 0
    ? `<div class="trade-pos">📦 보유 ${pos.qty.toLocaleString()}주 · 평단 ${Math.round(pos.avgCost).toLocaleString()}원${pnl != null ? ` · <span class="${pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}">${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%</span>` : ''}</div>`
    : '<div class="trade-pos">💤 청산 완료</div>';
  return `<section class="modal-trade">
    <h3>📒 매매 기록 (${trades.length})</h3>
    ${posHTML}
    <ul class="modal-trade-list">${rows}</ul>
  </section>`;
}

function setPeriod(period) {
  CURRENT_PERIOD = period;
  document.querySelectorAll('#modalToggle .seg').forEach(b => {
    b.classList.toggle('active', b.dataset.period === period);
  });
  renderCharts();
}

function openChartModal(stock) {
  CURRENT_STOCK = stock;
  const ts = stock.timeseries;
  const modal = document.getElementById('chartModal');
  document.getElementById('modalTitle').textContent = `${stock.name} (${stock.code})`;

  updateToggleAvailability();
  // default: annual if available else quarterly
  const hasAnnual = !!(ts && ts.years && ts.years.length);
  CURRENT_PERIOD = hasAnnual ? 'annual' : (ts && ts.quarterly ? 'quarterly' : 'annual');
  document.querySelectorAll('#modalToggle .seg').forEach(b => {
    b.classList.toggle('active', b.dataset.period === CURRENT_PERIOD);
  });

  if (!ts) {
    document.getElementById('modalSub').textContent = '시계열 데이터 없음';
    document.getElementById('modalBody').innerHTML =
      renderModalChecklist(stock) +
      `<div class="chart-empty">📊 이 종목은 아직 시계열 데이터가 등록되지 않았습니다.<br><small>(다음 분석 회차에 추가 예정)</small></div>`;
  } else {
    renderCharts();
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeChartModal() {
  const modal = document.getElementById('chartModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  CHART_INSTANCES.forEach(c => { try { c.destroy(); } catch(e){} });
  CHART_INSTANCES = [];
  CURRENT_STOCK = null;
}

// Click delegation
document.addEventListener('click', (e) => {
  // Hidden badge → 복원 모달 열기
  if (e.target.closest('#hiddenBadge')) {
    openHiddenModal();
    return;
  }
  // Note button (card or row)
  const noteBtn = e.target.closest('[data-action="note"]');
  if (noteBtn) {
    e.stopPropagation();
    const host = noteBtn.closest('.card, tr.stock-row');
    if (host) {
      const idx = Number(host.dataset.idx);
      const stock = STATE.stocks[idx];
      if (stock) editNote(stock.code, stock.name);
    }
    return;
  }
  // Watch toggle
  const watchBtn = e.target.closest('[data-action="watch"]');
  if (watchBtn) {
    e.stopPropagation();
    const host = watchBtn.closest('.card, tr.stock-row');
    if (host && window.Journal) {
      const idx = Number(host.dataset.idx);
      const stock = STATE.stocks[idx];
      if (stock) { Journal.toggleWatch(stock.code); render(); }
    }
    return;
  }
  // Trade journal
  const tradeBtn = e.target.closest('[data-action="trade"]');
  if (tradeBtn) {
    e.stopPropagation();
    const host = tradeBtn.closest('.card, tr.stock-row');
    if (host) {
      const idx = Number(host.dataset.idx);
      const stock = STATE.stocks[idx];
      if (stock && window.openTradeModal) openTradeModal(stock.code, stock.name);
    }
    return;
  }
  // Alert
  const alertBtn = e.target.closest('[data-action="alert"]');
  if (alertBtn) {
    e.stopPropagation();
    const host = alertBtn.closest('.card, tr.stock-row');
    if (host) {
      const idx = Number(host.dataset.idx);
      const stock = STATE.stocks[idx];
      if (stock && window.openAlertModal) openAlertModal(stock.code, stock.name);
    }
    return;
  }
  // Filter tab
  const tab = e.target.closest('.filter-tab');
  if (tab) {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t === tab));
    resetPage();
    render();
    return;
  }
  // Existing note pill (click to edit)
  const notePill = e.target.closest('.card-note');
  if (notePill) {
    e.stopPropagation();
    const code = notePill.dataset.noteCode;
    const stock = STATE.stocks.find(s => s.code === code);
    if (stock) editNote(stock.code, stock.name);
    return;
  }
  // Delete button (card or row)
  const delBtn = e.target.closest('[data-action="delete"]');
  if (delBtn) {
    e.stopPropagation();
    const host = delBtn.closest('.card, tr.stock-row');
    if (host) {
      const idx = Number(host.dataset.idx);
      const stock = STATE.stocks[idx];
      if (stock) hideStock(stock);
    }
    return;
  }
  // Period toggle
  const seg = e.target.closest('#modalToggle .seg');
  if (seg && !seg.disabled) {
    setPeriod(seg.dataset.period);
    return;
  }
  // Modal close
  if (e.target.closest('[data-close="1"]')) {
    closeChartModal();
    closeHiddenModal();
    return;
  }
  // Restore from hidden modal
  const restoreBtn = e.target.closest('[data-restore]');
  if (restoreBtn) {
    restoreStock(restoreBtn.dataset.restore);
    renderHiddenModal();
    return;
  }
  if (e.target.closest('#restoreAllBtn')) {
    restoreAll();
    renderHiddenModal();
    return;
  }
  // Card click — but ignore clicks on inner interactive elements
  const card = e.target.closest('.card');
  if (card && !e.target.closest('details, summary, a, button, input')) {
    const idx = Number(card.dataset.idx);
    const stock = STATE.stocks[idx];
    if (stock) openChartModal(stock);
    return;
  }
  // Table row click (desktop view) — 액션 버튼 클릭은 제외
  const row = e.target.closest('tr.stock-row');
  if (row && !e.target.closest('a, button, input, .row-actions')) {
    const idx = Number(row.dataset.idx);
    const stock = STATE.stocks[idx];
    if (stock) openChartModal(stock);
  }
});

// ESC to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeChartModal();
  // Keyboard accessibility: Enter on focused card
  if (e.key === 'Enter') {
    const card = document.activeElement?.closest?.('.card');
    if (card) {
      const idx = Number(card.dataset.idx);
      const stock = STATE.stocks[idx];
      if (stock) openChartModal(stock);
    }
  }
});

async function loadLivePrices() {
  try {
    const res = await fetch('data/live-prices.json?ts=' + Date.now(), {cache: 'no-store'});
    if (!res.ok) return;
    const data = await res.json();
    STATE.livePrices = data.prices || {};
    STATE.liveUpdatedAt = data.updated_at;
    const liveEl = document.getElementById('liveUpdatedAt');
    if (liveEl) liveEl.textContent = `실시간(Yahoo): ${shortDate(data.updated_at)}`;
  } catch (e) {
    console.warn('live prices load failed', e);
  }
}

async function load() {
  const res = await fetch('data/stocks.json?ts=' + Date.now());
  const data = await res.json();
  STATE.stocks = data.stocks || [];
  STATE.updated_at = data.updated_at;
  STATE.market_baseline = data.market_baseline || null;
  renderMarketBaseline();
  await loadLivePrices();
  render();
  // Mirror title -> data-tip for static HTML table headers
  document.querySelectorAll('th[title]:not([data-tip])').forEach(el => {
    el.setAttribute('data-tip', el.getAttribute('title'));
  });
  // 페이지가 열려있는 동안 실시간 가격 자동 갱신 (3분마다)
  setInterval(async () => {
    await loadLivePrices();
    render();
  }, 180000);
}

['searchInput','opinionFilter','sortBy'].forEach(id =>
  document.getElementById(id).addEventListener('input', () => { resetPage(); render(); }));

// pager 클릭 위임
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.pager .pg-btn[data-page]');
  if (!btn || btn.disabled) return;
  const p = parseInt(btn.dataset.page, 10);
  if (!isNaN(p)) goToPage(p);
});

load();
