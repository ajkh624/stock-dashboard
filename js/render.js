// Stock dashboard renderer
let STATE = { stocks: [], updated_at: null };

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
    <div class="card-price">${fmt(s.price, '원')}</div>
    <div class="card-metrics">
      <div class="metric"><span class="metric-label">PER</span><span class="metric-value">${fmtX(s.per)}</span></div>
      <div class="metric"><span class="metric-label">PBR</span><span class="metric-value">${fmtX(s.pbr)}</span></div>
      <div class="metric"><span class="metric-label">ROE</span><span class="metric-value">${fmtPct(s.roe)}</span></div>
      <div class="metric"><span class="metric-label">배당</span><span class="metric-value">${fmtPct(s.dividend_yield)}</span></div>
    </div>
    <div class="card-cf">
      <div>CFO <strong>${fmt(s.cfo_eok)}억</strong></div>
      <div>FCF <strong>${fmt(s.fcf_eok)}억</strong></div>
      <div class="card-date">${shortDate(s.analyzed_at)}</div>
    </div>
    <p class="card-thesis">${s.thesis||''}</p>
    ${tags ? `<div class="card-tags">${tags}</div>` : ''}
  </article>`;
}

function renderRow(s) {
  const opCls = opinionClassMap[s.opinion] || 'neutral';
  return `<tr>
    <td>${shortDate(s.analyzed_at)}</td>
    <td><strong>${s.name}</strong><br><small style="color:var(--text-dim)">${s.code}</small></td>
    <td class="num">${fmt(s.price)}</td>
    <td class="num">${fmtX(s.per)}</td>
    <td class="num">${fmtX(s.pbr)}</td>
    <td class="num">${fmtPct(s.roe)}</td>
    <td class="num">${fmtPct(s.dividend_yield)}</td>
    <td class="num">${fmt(s.cfo_eok)}</td>
    <td class="num">${fmt(s.fcf_eok)}</td>
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
}

['searchInput','opinionFilter','sortBy'].forEach(id =>
  document.getElementById(id).addEventListener('input', render));

load();
