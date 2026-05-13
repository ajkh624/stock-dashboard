// ========== Comparison Basket (Tier 2.1) ==========
// 카드 체크박스로 2~5종 골라 ① 핵심 지표 비교 표 ② 시계열 오버레이 차트
// 별도 모듈, 기존 render.js / journal.js 와 독립.

(function () {
  const MAX = 5;
  const KEY = 'sd_compare_v1';

  // ----- state -----
  const Compare = {
    codes: new Set(),
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) JSON.parse(raw).forEach(c => this.codes.add(c));
      } catch (e) {}
    },
    save() {
      localStorage.setItem(KEY, JSON.stringify([...this.codes]));
    },
    toggle(code) {
      if (this.codes.has(code)) this.codes.delete(code);
      else {
        if (this.codes.size >= MAX) {
          alert(`최대 ${MAX}종까지 비교 가능합니다.`);
          return false;
        }
        this.codes.add(code);
      }
      this.save();
      return true;
    },
    clear() { this.codes.clear(); this.save(); },
    has(code) { return this.codes.has(code); },
    list() {
      const all = (typeof STATE !== 'undefined' && STATE.stocks) || (window.STATE && STATE.stocks) || [];
      return [...this.codes].map(c => all.find(s => s.code === c)).filter(Boolean);
    }
  };
  window.Compare = Compare;
  Compare.load();

  // ----- top bar UI -----
  function renderBar() {
    let bar = document.getElementById('compareBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'compareBar';
      bar.className = 'compare-bar';
      bar.innerHTML = `
        <div class="cb-inner">
          <span class="cb-label">📊 비교</span>
          <div class="cb-chips" id="cbChips"></div>
          <button type="button" class="cb-go" id="cbGo">비교하기 →</button>
          <button type="button" class="cb-clear" id="cbClear" title="모두 해제">✕</button>
        </div>`;
      document.body.appendChild(bar);
      bar.querySelector('#cbGo').addEventListener('click', openModal);
      bar.querySelector('#cbClear').addEventListener('click', () => {
        Compare.clear();
        updateUI();
      });
      bar.querySelector('#cbChips').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-remove]');
        if (chip) {
          Compare.toggle(chip.dataset.remove);
          updateUI();
        }
      });
    }
    const list = Compare.list();
    const chipsEl = bar.querySelector('#cbChips');
    chipsEl.innerHTML = list.map(s => `
      <span class="cb-chip">
        <b>${s.name}</b>
        <small>${s.code}</small>
        <button data-remove="${s.code}" title="제외">×</button>
      </span>`).join('');
    bar.classList.toggle('show', list.length >= 1);
    bar.querySelector('#cbGo').disabled = list.length < 2;
    bar.querySelector('#cbGo').textContent = list.length < 2
      ? `${list.length}/2 선택 (2~5)`
      : `📊 ${list.length}종 비교하기 →`;
  }

  function updateUI() {
    // 카드/행의 체크박스 상태 동기화
    document.querySelectorAll('.card-cmp-btn').forEach(btn => {
      const code = btn.closest('[data-code]')?.dataset.code;
      const on = code && Compare.has(code);
      btn.classList.toggle('active', !!on);
      btn.textContent = on ? '☑' : '☐';
      btn.title = on ? '비교에서 제외' : '비교에 추가';
    });
    document.querySelectorAll('.card[data-code]').forEach(c => {
      c.classList.toggle('in-compare', Compare.has(c.dataset.code));
    });
    renderBar();
  }
  window.Compare.updateUI = updateUI;

  // ----- click delegation -----
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.card-cmp-btn');
    if (!btn) return;
    const card = btn.closest('[data-code]');
    if (!card) return;
    e.stopPropagation();
    e.preventDefault();
    if (Compare.toggle(card.dataset.code)) updateUI();
  }, true);

  // ----- comparison modal -----
  const CHART_SPECS = [
    { key: 'revenue_eok',    label: '매출 (억원)',         unit: '억' },
    { key: 'op_income_eok',  label: '영업이익 (억원)',     unit: '억' },
    { key: 'net_income_eok', label: '순이익 (억원)',       unit: '억' },
    { key: 'op_margin_pct',  label: '영업이익률 (%)',      unit: '%'  },
    { key: 'roe_pct',        label: 'ROE (%)',             unit: '%'  },
    { key: 'debt_ratio',     label: '부채비율 (%)',        unit: '%'  },
    { key: 'cfo_eok',        label: 'CFO (억원)',          unit: '억' },
    { key: 'fcf_eok',        label: 'FCF (억원)',          unit: '억' },
    { key: 'per',            label: 'PER (배)',            unit: '배' },
    { key: 'pbr',            label: 'PBR (배)',            unit: '배' },
    { key: 'dividend_yield', label: '배당수익률 (%)',      unit: '%'  },
  ];
  const SERIES_COLORS = ['#4ade80','#60a5fa','#a78bfa','#fb7185','#facc15'];

  let MODAL_CHARTS = [];
  let MODAL_PERIOD = 'annual';

  function fmtV(v, unit) {
    if (v == null || Number.isNaN(v)) return '-';
    const n = Number(v);
    if (unit === '%')  return n.toFixed(2) + '%';
    if (unit === '배') return n.toFixed(2);
    return Math.round(n).toLocaleString() + (unit === '억' ? '억' : '');
  }

  function getSeries(stock, period) {
    const ts = stock.timeseries;
    if (!ts) return null;
    if (period === 'quarterly') {
      if (!ts.quarterly || !ts.quarterly.labels?.length) return null;
      return { labels: ts.quarterly.labels, data: ts.quarterly };
    }
    if (!ts.years?.length) return null;
    return { labels: ts.years.map(String), data: ts };
  }

  function alignLabels(seriesList) {
    // 공통 라벨 = 모든 시리즈의 라벨 합집합, 정렬은 첫 시리즈 기준
    if (!seriesList.length) return [];
    const set = new Set();
    seriesList.forEach(s => s.labels.forEach(l => set.add(l)));
    return [...set].sort((a, b) => {
      const an = Number(a), bn = Number(b);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
      return String(a).localeCompare(String(b));
    });
  }

  function valueAt(series, label, key) {
    const i = series.labels.indexOf(label);
    if (i < 0) return null;
    return series.data[key]?.[i] ?? null;
  }

  function opinionBadge(s) {
    const map = { '강매수':'buy_strong','매수':'buy','중립':'neutral','회피':'avoid','매도':'sell' };
    const cls = map[s.opinion] || 'neutral';
    return `<span class="opinion ${cls}">${s.opinion || '-'}</span>`;
  }

  function buildHeaderTable(stocks) {
    const live = (typeof STATE !== 'undefined' ? STATE.livePrices : window.STATE?.livePrices) || {};
    const head = stocks.map(s => `<th>${s.name}<br><small>${s.code}</small></th>`).join('');
    const row = (label, cells, hint='') => `<tr><th class="lbl"${hint?` title="${hint}"`:''}>${label}</th>${cells}</tr>`;
    const cell = (val, cls='') => `<td class="${cls}">${val}</td>`;

    // 헬퍼 — 같은 지표 행에서 최적값 찾기
    const bestIdx = (arr, mode) => {
      const idxs = arr.map((v,i)=>({v,i})).filter(x=>x.v!=null && !Number.isNaN(x.v));
      if (!idxs.length) return -1;
      if (mode === 'min') return idxs.reduce((a,b)=>a.v<=b.v?a:b).i;
      return idxs.reduce((a,b)=>a.v>=b.v?a:b).i;
    };
    const fmtCell = (vals, fmt, mode) => {
      const bi = bestIdx(vals, mode);
      return vals.map((v,i)=>cell(fmt(v), i===bi?'best':'')).join('');
    };

    const opinion = stocks.map(s=>opinionBadge(s)).join('').split('').join(''); // raw
    const opinionRow = `<tr><th class="lbl">의견</th>${stocks.map(s=>`<td>${opinionBadge(s)}</td>`).join('')}</tr>`;

    const prices = stocks.map(s=>live[s.code]?.price ?? s.price);
    const priceRow = `<tr><th class="lbl">현재가</th>${stocks.map((s,i)=>{
      const p = prices[i];
      const lv = live[s.code];
      const chg = lv?.change_rate;
      const chgStr = (chg!=null) ? ` <small class="${chg>=0?'up':'dn'}">${chg>=0?'+':''}${chg.toFixed(2)}%</small>` : '';
      return `<td><b>${p?p.toLocaleString():'-'}</b>${chgStr}</td>`;
    }).join('')}</tr>`;

    const pers = stocks.map(s=>s.per);
    const pbrs = stocks.map(s=>s.pbr);
    const roes = stocks.map(s=>s.roe);
    const divs = stocks.map(s=>s.dividend_yield);
    const debts = stocks.map(s=>s.debt_ratio);
    const cfos = stocks.map(s=>s.cfo_eok);
    const fcfs = stocks.map(s=>s.fcf_eok);
    const revs = stocks.map(s=>s.revenue_eok);
    const ops  = stocks.map(s=>s.op_income_eok);
    const nis  = stocks.map(s=>s.net_income_eok);
    const p1s  = stocks.map(s=>s.checklist_part1_risk);
    const p2s  = stocks.map(s=>s.checklist_part2_quality);

    return `
      <table class="cmp-table">
        <thead><tr><th class="lbl">지표</th>${head}</tr></thead>
        <tbody>
          ${opinionRow}
          ${priceRow}
          ${row('PER (배)', fmtCell(pers, v=>fmtV(v,'배'), 'min'), '낮을수록 좋음 (적자 제외)')}
          ${row('PBR (배)', fmtCell(pbrs, v=>fmtV(v,'배'), 'min'), '낮을수록 좋음')}
          ${row('ROE (%)', fmtCell(roes, v=>fmtV(v,'%'),  'max'), '높을수록 좋음')}
          ${row('배당수익률 (%)', fmtCell(divs, v=>fmtV(v,'%'), 'max'), '높을수록 좋음')}
          ${row('부채비율 (%)', fmtCell(debts, v=>fmtV(v,'%'), 'min'), '낮을수록 좋음')}
          ${row('매출 (억)', fmtCell(revs, v=>fmtV(v,'억'), 'max'))}
          ${row('영업이익 (억)', fmtCell(ops, v=>fmtV(v,'억'), 'max'))}
          ${row('순이익 (억)', fmtCell(nis, v=>fmtV(v,'억'), 'max'))}
          ${row('CFO (억)', fmtCell(cfos, v=>fmtV(v,'억'), 'max'))}
          ${row('FCF (억)', fmtCell(fcfs, v=>fmtV(v,'억'), 'max'))}
          ${row('위험 (/18)', fmtCell(p1s, v=>v==null?'-':`${v}/18`, 'min'), '낮을수록 좋음')}
          ${row('우량 (/12)', fmtCell(p2s, v=>v==null?'-':`${v}/12`, 'max'), '높을수록 좋음')}
        </tbody>
      </table>
    `;
  }

  function renderOverlayCharts(stocks) {
    const seriesList = stocks.map(s => {
      const ser = getSeries(s, MODAL_PERIOD);
      return ser ? { stock: s, labels: ser.labels, data: ser.data } : null;
    }).filter(Boolean);

    if (!seriesList.length) {
      return `<div class="cmp-empty">📊 ${MODAL_PERIOD==='quarterly'?'분기':'연간'} 시계열 데이터가 있는 종목이 없습니다.</div>`;
    }

    const labels = alignLabels(seriesList);
    // 어떤 지표를 표시? — 적어도 한 종목이 데이터를 가진 지표만
    const specs = CHART_SPECS.filter(sp => seriesList.some(ser => (ser.data[sp.key]||[]).some(v=>v!=null)));

    const html = `<div class="cmp-charts">${specs.map((sp,i)=>`
      <div class="cmp-chart-box">
        <h4>${sp.label}</h4>
        <div class="cmp-chart-wrap"><canvas id="cmp_${i}"></canvas></div>
      </div>`).join('')}</div>`;

    // 그리기는 mount 후 setTimeout으로
    queueMicrotask(() => {
      MODAL_CHARTS.forEach(c => { try { c.destroy(); } catch(e){} });
      MODAL_CHARTS = [];
      specs.forEach((sp, i) => {
        const ctx = document.getElementById(`cmp_${i}`);
        if (!ctx) return;
        const datasets = seriesList.map((ser, si) => {
          const color = SERIES_COLORS[si % SERIES_COLORS.length];
          return {
            label: ser.stock.name,
            data: labels.map(lab => valueAt(ser, lab, sp.key)),
            borderColor: color,
            backgroundColor: color + '22',
            tension: 0.25,
            spanGaps: true,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: color,
            fill: false,
          };
        });
        MODAL_CHARTS.push(new Chart(ctx, {
          type: 'line',
          data: { labels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { display: true, position: 'bottom', labels: { color:'#9099a8', boxWidth: 10 } },
              tooltip: {
                backgroundColor: '#0f1115',
                borderColor: '#2a2f3a', borderWidth: 1,
                titleColor: '#e6e8ec', bodyColor: '#e6e8ec',
                callbacks: {
                  label: (c) => `${c.dataset.label}: ${fmtV(c.parsed.y, sp.unit)}`
                }
              }
            },
            scales: {
              x: { ticks: { color: '#9099a8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
              y: {
                ticks: {
                  color: '#9099a8', font: { size: 11 },
                  callback: v => sp.unit === '%' ? v + '%' : sp.unit === '배' ? v : Number(v).toLocaleString()
                },
                grid: { color: 'rgba(255,255,255,0.06)' }
              }
            }
          }
        }));
      });
    });

    return html;
  }

  function renderModalBody() {
    const body = document.getElementById('cmpModalBody');
    const stocks = Compare.list();
    if (stocks.length < 2) {
      body.innerHTML = '<div class="cmp-empty">2종 이상 선택해주세요.</div>';
      return;
    }
    const hasAnyQuarterly = stocks.some(s => s.timeseries?.quarterly?.labels?.length);
    const hasAnyAnnual    = stocks.some(s => s.timeseries?.years?.length);
    document.getElementById('cmpPeriodAnnual').disabled = !hasAnyAnnual;
    document.getElementById('cmpPeriodQ').disabled      = !hasAnyQuarterly;
    if (MODAL_PERIOD === 'annual' && !hasAnyAnnual && hasAnyQuarterly) MODAL_PERIOD = 'quarterly';
    if (MODAL_PERIOD === 'quarterly' && !hasAnyQuarterly && hasAnyAnnual) MODAL_PERIOD = 'annual';
    document.querySelectorAll('#cmpModal .seg').forEach(b=>{
      b.classList.toggle('active', b.dataset.period === MODAL_PERIOD);
    });

    body.innerHTML = `
      <div class="cmp-sub">
        <span>${stocks.length}종 비교 · ${MODAL_PERIOD==='quarterly'?'분기':'연간'} · 셀의 ⭐는 해당 지표 최적값</span>
      </div>
      ${buildHeaderTable(stocks)}
      <h3 class="cmp-h3">📈 시계열 오버레이</h3>
      ${renderOverlayCharts(stocks)}
    `;
  }

  function openModal() {
    const stocks = Compare.list();
    if (stocks.length < 2) { alert('비교는 2종 이상 선택해야 합니다.'); return; }
    const modal = document.getElementById('cmpModal');
    if (!modal) return;
    document.getElementById('cmpModalTitle').textContent = '📊 종목 비교';
    document.getElementById('cmpModalSub').textContent = stocks.map(s=>s.name).join(' · ');
    renderModalBody();
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    const modal = document.getElementById('cmpModal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');
    document.body.style.overflow = '';
    MODAL_CHARTS.forEach(c => { try { c.destroy(); } catch(e){} });
    MODAL_CHARTS = [];
  }
  window.Compare.openModal = openModal;
  window.Compare.closeModal = closeModal;

  document.addEventListener('click', (e) => {
    if (e.target.matches('#cmpModal [data-close]')) closeModal();
    const seg = e.target.closest('#cmpModal .seg');
    if (seg) {
      MODAL_PERIOD = seg.dataset.period;
      renderModalBody();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = document.getElementById('cmpModal');
      if (m && m.classList.contains('open')) closeModal();
    }
  });

  // 페이지 로드 후 초기 상태 동기화
  function init() { updateUI(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
