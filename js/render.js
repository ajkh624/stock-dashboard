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
  const p1 = s.checklist_part1_risk, p1t = s.checklist_part1_total || 18;
  const p2 = s.checklist_part2_quality, p2t = s.checklist_part2_total || 12;
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

function renderCard(s) {
  const opCls = opinionClassMap[s.opinion] || 'neutral';
  const tags = (s.tags||[]).map(t=>`<span class="tag">${t}</span>`).join('');
  const hasTs = !!(s.timeseries && s.timeseries.years && s.timeseries.years.length);
  return `
  <article class="card${hasTs?' has-ts':''}" data-code="${s.code}" data-idx="${s._idx}" role="button" tabindex="0">
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
    ${renderIncome(s)}
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
  // assign stable index for modal lookup
  STATE.stocks.forEach((s, i) => s._idx = i);
  const list = applyFilters(STATE.stocks);
  document.getElementById('cards').innerHTML = list.map(renderCard).join('');
  document.getElementById('tbody').innerHTML = list.map(renderRow).join('');
  document.getElementById('stockCount').textContent = `${list.length} 종목`;
  document.getElementById('updatedAt').textContent = `갱신: ${shortDate(STATE.updated_at)}`;
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

function renderCharts() {
  const body = document.getElementById('modalBody');
  const pd = getPeriodData(CURRENT_STOCK, CURRENT_PERIOD);

  // destroy previous charts
  CHART_INSTANCES.forEach(c => { try { c.destroy(); } catch(e){} });
  CHART_INSTANCES = [];

  if (!pd) {
    body.innerHTML = `<div class="chart-empty">📊 ${CURRENT_PERIOD==='quarterly'?'분기별':'연간'} 시계열 데이터가 없습니다.<br><small>(다음 분석 회차에 추가 예정)</small></div>`;
    return;
  }

  const subEl = document.getElementById('modalSub');
  subEl.textContent = `${pd.labels[0]} ~ ${pd.labels[pd.labels.length-1]} · ${pd.source || ''}`;

  const specs = CHART_SPECS.filter(sp => pd.data[sp.key] && pd.data[sp.key].some(v => v != null));
  if (!specs.length) {
    body.innerHTML = `<div class="chart-empty">📊 표시할 지표가 없습니다.</div>`;
    return;
  }

  body.innerHTML = `<div class="chart-grid">${specs.map((sp, i) => {
    const arr = pd.data[sp.key];
    const latest = arr[arr.length-1];
    return `<div class="chart-box">
      <h3><span>${sp.label}</span><span class="latest">최근 ${fmtVal(latest, sp.unit)}</span></h3>
      <div class="chart-canvas-wrap"><canvas id="chart_${i}"></canvas></div>
    </div>`;
  }).join('')}</div>`;

  const chartFontColor = '#9099a8';
  const gridColor = 'rgba(255,255,255,0.06)';

  specs.forEach((sp, i) => {
    const ctx = document.getElementById(`chart_${i}`);
    if (!ctx) return;
    const arr = pd.data[sp.key];
    const inst = new Chart(ctx, {
      type: 'line',
      data: {
        labels: pd.labels,
        datasets: [{
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
        }]
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
              label: (c) => `${sp.label}: ${fmtVal(c.parsed.y, sp.unit)}`
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

function updateToggleAvailability() {
  const toggle = document.getElementById('modalToggle');
  const ts = CURRENT_STOCK?.timeseries;
  const hasAnnual = !!(ts && ts.years && ts.years.length);
  const hasQuarterly = !!(ts && ts.quarterly && ts.quarterly.labels && ts.quarterly.labels.length);
  toggle.querySelector('[data-period="annual"]').disabled = !hasAnnual;
  toggle.querySelector('[data-period="quarterly"]').disabled = !hasQuarterly;
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
  // Period toggle
  const seg = e.target.closest('#modalToggle .seg');
  if (seg && !seg.disabled) {
    setPeriod(seg.dataset.period);
    return;
  }
  // Modal close
  if (e.target.closest('[data-close="1"]')) {
    closeChartModal();
    return;
  }
  // Card click — but ignore clicks on inner interactive elements
  const card = e.target.closest('.card');
  if (!card) return;
  if (e.target.closest('details, summary, a, button, input')) return;
  const idx = Number(card.dataset.idx);
  const stock = STATE.stocks[idx];
  if (stock) openChartModal(stock);
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
