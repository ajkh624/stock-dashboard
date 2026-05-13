// journal-ui.js — Trade journal / watchlist / alerts UI helpers
// Depends on window.Journal (journal-sync.js) and STATE (render.js)

(function () {
  // ============= TRADES =============
  window.openTradeModal = function (code, name) {
    const trades = Journal.getTrades(code);
    const pos = Journal.getPosition(code);
    const livePrice = (STATE.livePrices?.[code]?.price) ?? null;
    const unrealized = (pos.qty > 0 && livePrice)
      ? ((livePrice - pos.avgCost) / pos.avgCost * 100) : null;

    const tradeRows = trades.length ? trades.map(t => {
      const cls = t.type === 'buy' ? 'buy' : (t.type === 'sell' ? 'sell' : 'memo');
      const ico = { buy: '🟢', sell: '🔴', memo: '📝' }[t.type] || '•';
      const amt = (t.price && t.qty) ? `${Number(t.price).toLocaleString()}원 × ${t.qty}` : (t.price ? `${Number(t.price).toLocaleString()}원` : '');
      return `<li class="trade-row ${cls}">
        <span class="t-ico">${ico}</span>
        <span class="t-date">${t.date}</span>
        <span class="t-type">${t.type === 'buy' ? '매수' : t.type === 'sell' ? '매도' : '메모'}</span>
        <span class="t-amt">${amt}</span>
        <span class="t-reason">${escapeHtml(t.reason || '')}</span>
        <button class="t-del" data-trade-del="${t.id}" title="삭제">✕</button>
      </li>`;
    }).join('') : '<li class="empty">아직 기록 없음</li>';

    const posHTML = pos.qty > 0 ? `
      <div class="pos-summary">
        <span>📦 보유 ${pos.qty.toLocaleString()}주</span>
        <span>평단 ${Math.round(pos.avgCost).toLocaleString()}원</span>
        ${unrealized != null ? `<span class="${unrealized > 0 ? 'up' : unrealized < 0 ? 'down' : ''}">평가손익 ${unrealized > 0 ? '+' : ''}${unrealized.toFixed(2)}%</span>` : ''}
      </div>` : (pos.totalTrades > 0 ? '<div class="pos-summary">💤 청산 완료</div>' : '');

    const planHTML = renderStopLossPanel(code, name, pos, livePrice);

    const today = new Date().toISOString().slice(0, 10);
    const defaultPrice = livePrice || '';
    const html = `
      <div class="modal open" id="tradeModal" aria-hidden="false" style="z-index:1100">
        <div class="modal-backdrop" data-close-trade="1"></div>
        <div class="modal-panel modal-panel-sm">
          <button class="modal-close" data-close-trade="1">✕</button>
          <header class="modal-head"><div>
            <h2>📒 매매 기록 — ${escapeHtml(name)} <small style="color:var(--text-dim)">(${code})</small></h2>
            ${posHTML}
          </div></header>
          <div class="modal-body">
            ${planHTML}
            <form id="tradeForm" class="trade-form">
              <div class="tf-row">
                <select name="type" required>
                  <option value="buy">🟢 매수</option>
                  <option value="sell">🔴 매도</option>
                  <option value="memo">📝 메모</option>
                </select>
                <input type="date" name="date" value="${today}" required>
              </div>
              <div class="tf-row">
                <input type="number" name="price" placeholder="가격 (원)" value="${defaultPrice}" step="1" min="0">
                <input type="number" name="qty" placeholder="수량" step="1" min="0">
              </div>
              <textarea name="reason" placeholder="왜? (선택) 예: PBR 0.8 진입, 목표가 도달, 자본스트레스 우려..." rows="2"></textarea>
              <button type="submit" class="btn-primary">기록 추가</button>
            </form>
            <h3 class="trade-h">📋 기록 (${trades.length}건)</h3>
            <ul class="trade-list">${tradeRows}</ul>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const close = () => { document.getElementById('tradeModal')?.remove(); render(); };
    document.querySelectorAll('[data-close-trade]').forEach(el => el.addEventListener('click', close));
    document.getElementById('tradeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const trade = {
        type: fd.get('type'),
        date: fd.get('date'),
        price: fd.get('price') ? Number(fd.get('price')) : null,
        qty: fd.get('qty') ? Number(fd.get('qty')) : null,
        reason: fd.get('reason') || '',
      };
      Journal.addTrade(code, trade);
      close();
      openTradeModal(code, name); // reopen with fresh list
    });
    document.querySelectorAll('[data-trade-del]').forEach(b => b.addEventListener('click', () => {
      if (!confirm('이 기록을 삭제할까요?')) return;
      Journal.removeTrade(code, b.dataset.tradeDel);
      close();
      openTradeModal(code, name);
    }));
    bindStopLossPanel(code, name, pos, livePrice, () => { close(); openTradeModal(code, name); });
  };

  // ============= STOP-LOSS / PLAN PANEL =============
  // 평단가 기반 손절선 자동 표시 + 1-click 알림 등록
  // 분할매수 플랜 (1차/2차/3차 가격 미리 설정) — 도달 시 알림 자동 점화
  function renderStopLossPanel(code, name, pos, livePrice) {
    const hasPos = pos.qty > 0;
    const avg = hasPos ? pos.avgCost : null;
    const planStr = localStorage.getItem('sd_plan_' + code);
    let plan = null;
    try { plan = planStr ? JSON.parse(planStr) : null; } catch (e) {}
    const existingAlerts = Journal.getAlerts(code);
    const hasAlertNear = (px) => existingAlerts.some(a =>
      (a.type === 'price_below' || a.type === 'price_above') &&
      Math.abs(Number(a.value) - px) < px * 0.005
    );

    // 손절 단계 — 보유 종목만
    const stops = hasPos ? [
      { pct: -10, label: '경고선', color: 'warn' },
      { pct: -15, label: '주의선', color: 'warn' },
      { pct: -25, label: '손절선', color: 'danger' },
    ].map(s => {
      const px = Math.round(avg * (1 + s.pct / 100));
      const armed = hasAlertNear(px);
      const reached = livePrice && livePrice <= px;
      return { ...s, px, armed, reached };
    }) : [];

    const stopsHTML = hasPos ? `
      <div class="plan-section">
        <div class="plan-h">🎯 손절선 자동 추적
          <span class="plan-sub">평단 ${Math.round(avg).toLocaleString()}원 기준</span>
        </div>
        <div class="stop-grid">
          ${stops.map(s => `
            <div class="stop-row ${s.color}${s.reached ? ' reached' : ''}">
              <span class="stop-pct">${s.pct}%</span>
              <span class="stop-label">${s.label}</span>
              <span class="stop-px">${s.px.toLocaleString()}원${s.reached ? ' 🚨' : ''}</span>
              <button type="button" class="stop-arm ${s.armed ? 'armed' : ''}"
                data-arm-px="${s.px}" data-arm-label="${s.label} (${s.pct}%)" data-arm-type="price_below"
                title="${s.armed ? '이미 알림 등록됨' : '클릭해 알림 등록'}">${s.armed ? '✓ 알림 ON' : '🔔 알림 걸기'}</button>
            </div>`).join('')}
        </div>
      </div>` : '';

    // 분할매수 플랜
    const planSlots = plan?.slots || [
      { tier: 1, price: livePrice || '', qty: '', done: false },
      { tier: 2, price: '', qty: '', done: false },
      { tier: 3, price: '', qty: '', done: false },
    ];
    const planHTML = `
      <div class="plan-section">
        <div class="plan-h">📐 분할매수 플랜
          <span class="plan-sub">단계별 가격·수량 미리 설정 → 도달 시 알림</span>
        </div>
        <div class="plan-grid" id="planGrid">
          ${planSlots.map((s, i) => {
            const armed = s.price && hasAlertNear(Number(s.price));
            return `
              <div class="plan-row${s.done ? ' done' : ''}">
                <span class="plan-tier">${s.tier}차</span>
                <input type="number" class="plan-price" data-tier="${s.tier}" placeholder="가격" value="${s.price || ''}" step="1" min="0">
                <input type="number" class="plan-qty"   data-tier="${s.tier}" placeholder="수량" value="${s.qty || ''}" step="1" min="0">
                <button type="button" class="stop-arm ${armed ? 'armed' : ''}"
                  data-plan-arm-tier="${s.tier}"
                  title="${armed ? '이미 알림 등록됨' : '이 가격에 알림 걸기'}">${armed ? '✓' : '🔔'}</button>
              </div>`;
          }).join('')}
        </div>
        <div class="plan-foot">
          <button type="button" class="btn-plan-save" id="planSaveBtn">💾 플랜 저장</button>
          ${plan ? `<button type="button" class="btn-plan-clear" id="planClearBtn">🗑️ 플랜 삭제</button>` : ''}
          <small class="plan-hint">알림은 매일 18:00 KST 종가 기준 발송</small>
        </div>
      </div>`;

    return `<div class="trade-plan-wrap">${stopsHTML}${planHTML}</div>`;
  }

  function bindStopLossPanel(code, name, pos, livePrice, refresh) {
    // 1-click 손절 알림 등록
    document.querySelectorAll('#tradeModal .stop-arm[data-arm-px]').forEach(btn => {
      btn.addEventListener('click', () => {
        const px = Number(btn.dataset.armPx);
        const label = btn.dataset.armLabel;
        const type = btn.dataset.armType;
        if (btn.classList.contains('armed')) {
          if (!confirm(`${label} ${px.toLocaleString()}원 알림이 이미 등록돼 있습니다. 다시 추가할까요?`)) return;
        }
        Journal.addAlert(code, { type, value: px, note: label });
        refresh();
      });
    });
    // 분할매수 — 각 차수별 1-click 알림 (price_below)
    document.querySelectorAll('#tradeModal [data-plan-arm-tier]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tier = btn.dataset.planArmTier;
        const priceEl = document.querySelector(`#tradeModal .plan-price[data-tier="${tier}"]`);
        const px = Number(priceEl?.value || 0);
        if (!px) { alert(`${tier}차 가격을 먼저 입력하세요.`); return; }
        Journal.addAlert(code, { type: 'price_below', value: px, note: `분할매수 ${tier}차` });
        savePlanFromForm(code);
        refresh();
      });
    });
    // 플랜 저장 / 삭제
    document.getElementById('planSaveBtn')?.addEventListener('click', () => {
      savePlanFromForm(code);
      alert('✅ 분할매수 플랜 저장 완료');
    });
    document.getElementById('planClearBtn')?.addEventListener('click', () => {
      if (!confirm('이 종목의 분할매수 플랜을 삭제할까요?')) return;
      localStorage.removeItem('sd_plan_' + code);
      refresh();
    });
  }

  function savePlanFromForm(code) {
    const slots = [1, 2, 3].map(tier => {
      const price = document.querySelector(`#tradeModal .plan-price[data-tier="${tier}"]`)?.value;
      const qty   = document.querySelector(`#tradeModal .plan-qty[data-tier="${tier}"]`)?.value;
      return { tier, price: price ? Number(price) : '', qty: qty ? Number(qty) : '', done: false };
    });
    localStorage.setItem('sd_plan_' + code, JSON.stringify({ slots, saved_at: new Date().toISOString() }));
  }

  // ============= ALERTS =============
  window.openAlertModal = function (code, name) {
    const alerts = Journal.getAlerts(code);
    const live = STATE.livePrices?.[code]?.price;
    const stock = STATE.stocks.find(s => s.code === code);

    const rows = alerts.length ? alerts.map(a => {
      const desc = describeAlert(a);
      return `<li class="alert-row">
        <span class="a-desc">🔔 ${desc}</span>
        <span class="a-meta">생성 ${a.created || '-'}${a.last_triggered ? ` · 마지막 발송 ${a.last_triggered}` : ''}</span>
        <button class="a-del" data-alert-del="${a.id}">✕</button>
      </li>`;
    }).join('') : '<li class="empty">설정된 알림 없음</li>';

    const html = `
      <div class="modal open" id="alertModal" aria-hidden="false" style="z-index:1100">
        <div class="modal-backdrop" data-close-alert="1"></div>
        <div class="modal-panel modal-panel-sm">
          <button class="modal-close" data-close-alert="1">✕</button>
          <header class="modal-head"><div>
            <h2>🔔 알림 — ${escapeHtml(name)} <small style="color:var(--text-dim)">(${code})</small></h2>
            <p class="modal-sub">현재가 ${live ? live.toLocaleString() + '원' : '-'} · 매일 18:00 KST 자동 발송</p>
          </div></header>
          <div class="modal-body">
            <form id="alertForm" class="alert-form">
              <select name="type" required>
                <option value="price_above">📈 가격 이상</option>
                <option value="price_below">📉 가격 이하</option>
                <option value="change_pct_abs">⚡ 당일 변동률(절대값) 이상</option>
              </select>
              <input type="number" name="value" placeholder="값 (원 또는 %)" required step="any">
              <button type="submit" class="btn-primary">추가</button>
            </form>
            <h3 class="trade-h">⚙️ 활성 알림 (${alerts.length})</h3>
            <ul class="alert-list">${rows}</ul>
            <p class="sync-note" style="font-size:11px;color:var(--text-dim);margin-top:12px">
              💡 알림은 GitHub Actions가 매일 18:00 KST에 체크해 텔레그램으로 발송합니다. 1회 발송 후 자동 비활성화됩니다.
            </p>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const close = () => { document.getElementById('alertModal')?.remove(); render(); };
    document.querySelectorAll('[data-close-alert]').forEach(el => el.addEventListener('click', close));
    document.getElementById('alertForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      Journal.addAlert(code, { type: fd.get('type'), value: Number(fd.get('value')) });
      close();
      openAlertModal(code, name);
    });
    document.querySelectorAll('[data-alert-del]').forEach(b => b.addEventListener('click', () => {
      Journal.removeAlert(code, b.dataset.alertDel);
      close();
      openAlertModal(code, name);
    }));
  };

  function describeAlert(a) {
    if (a.type === 'price_above') return `가격이 <b>${Number(a.value).toLocaleString()}원 이상</b>이 되면`;
    if (a.type === 'price_below') return `가격이 <b>${Number(a.value).toLocaleString()}원 이하</b>가 되면`;
    if (a.type === 'change_pct_abs') return `당일 변동률이 <b>±${a.value}%</b> 이상이면`;
    return `${a.type} ${a.value}`;
  }
  window.describeAlert = describeAlert;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  window.escapeHtmlJ = escapeHtml;
})();
