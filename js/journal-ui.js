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
  };

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
