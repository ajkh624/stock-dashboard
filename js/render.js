// Stock dashboard renderer
let STATE = { stocks: [], updated_at: null };

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

function shortDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function renderChecklist(s) {
  const p1 = s.checklist_part1_risk, p1t = s.checklist_part1_total || 18;
  const p2 = s.checklist_part2_quality, p2t = s.checklist_part2_total || 12;
  if (p1 == null && p2 == null) return '';
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
      ${risks ? `<div class="chk-section"><h4>Part 1 위험 신호 ON</h4><ul>${risks}</ul></div>` : ''}
      ${passed ? `<div class="chk-section"><h4>Part 2 통과</h4><ul>${passed}</ul></div>` : ''}
      ${failed ? `<div class="chk-section"><h4>Part 2 미통과</h4><ul>${failed}</ul></div>` : ''}
    </div>` : ''}
  </details>`;
}

function renderCard(s) {
  const opCls = opinionClassMap[s.opinion] || 'neutral';
  const tags = (s.tags||[]).map(t=>`<span class="tag">${t}</span>`).join('');
  return `
  <article class="card">
    <div class="card-head">
      <div>
        <span class="card-name">${s.name}</span>
        <span class="card-code">${s.code}</span>
      </div>
      <span class="opinion ${opCls}">${s.opinion}</span>
    </div>
    <div class="card-price"${tip('현재가')}>${fmt(s.price, '원')}</div>
    <div class="card-metrics">
      <div class="metric"${tip('PER')}><span class="metric-label">PER</span><span class="metric-value">${fmtX(s.per)}</span></div>
      <div class="metric"${tip('PBR')}><span class="metric-label">PBR</span><span class="metric-value">${fmtX(s.pbr)}</span></div>
      <div class="metric"${tip('ROE')}><span class="metric-label">ROE</span><span class="metric-value">${fmtPct(s.roe)}</span></div>
      <div class="metric"${tip('배당')}><span class="metric-label">배당</span><span class="metric-value">${fmtPct(s.dividend_yield)}</span></div>
    </div>
    <div class="card-cf">
      <div${tip('CFO')}>CFO <strong>${fmt(s.cfo_eok)}억</strong></div>
      <div${tip('FCF')}>FCF <strong>${fmt(s.fcf_eok)}억</strong></div>
      <div class="card-date"${tip('분석일시')}>${shortDate(s.analyzed_at)}${s.source_year?` · ${s.source_year} 사업보고서`:''}</div>
    </div>
    ${renderChecklist(s)}
    <p class="card-thesis">${s.thesis||''}</p>
    ${tags ? `<div class="card-tags">${tags}</div>` : ''}
  </article>`;
}

function renderRow(s) {
  const opCls = opinionClassMap[s.opinion] || 'neutral';
  return `<tr>
    <td>${shortDate(s.analyzed_at)}</td>
    <td><small style="color:var(--text-dim)">${s.source_year||'-'}</small></td>
    <td><strong>${s.name}</strong><br><small style="color:var(--text-dim)">${s.code}</small></td>
    <td class="num">${fmt(s.price)}</td>
    <td class="num">${fmtX(s.per)}</td>
    <td class="num">${fmtX(s.pbr)}</td>
    <td class="num">${fmtPct(s.roe)}</td>
    <td class="num">${fmtPct(s.dividend_yield)}</td>
    <td class="num">${fmt(s.cfo_eok)}</td>
    <td class="num">${fmt(s.fcf_eok)}</td>
    <td class="chk-cell">
      <span class="chk-badge risk">⚠️${s.checklist_part1_risk??'-'}/${s.checklist_part1_total||18}</span>
      <span class="chk-badge quality">⭐${s.checklist_part2_quality??'-'}/${s.checklist_part2_total||12}</span>
    </td>
    <td><span class="opinion ${opCls}">${s.opinion}</span></td>
    <td style="max-width:360px;font-size:12px;color:var(--text-dim)">${s.thesis||''}</td>
  </tr>`;
}

function applyFilters(list) {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const op = document.getElementById('opinionFilter').value;
  const sort = document.getElementById('sortBy').value;

  let out = list.filter(s => {
    if (op && s.opinion !== op) return false;
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
  const list = applyFilters(STATE.stocks);
  document.getElementById('cards').innerHTML = list.map(renderCard).join('');
  document.getElementById('tbody').innerHTML = list.map(renderRow).join('');
  document.getElementById('stockCount').textContent = `${list.length} 종목`;
  document.getElementById('updatedAt').textContent = `갱신: ${shortDate(STATE.updated_at)}`;
}

async function load() {
  const res = await fetch('data/stocks.json?ts=' + Date.now());
  const data = await res.json();
  STATE.stocks = data.stocks || [];
  STATE.updated_at = data.updated_at;
  render();
  // Mirror title -> data-tip for static HTML table headers
  document.querySelectorAll('th[title]:not([data-tip])').forEach(el => {
    el.setAttribute('data-tip', el.getAttribute('title'));
  });
}

['searchInput','opinionFilter','sortBy'].forEach(id =>
  document.getElementById(id).addEventListener('input', render));

load();
