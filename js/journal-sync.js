// journal-sync.js — Unified Gist-backed storage for notes/trades/watchlist/alerts
// Replaces notes-sync.js. Single gist file holds all dashboard state.
//
// Gist file structure (v2):
//   {
//     "_meta": {"version": 2, "updated_at": "..."},
//     "notes":     {"215200": "텍스트", ...},
//     "trades":    {"215200": [{date,type,price,qty,reason}, ...], ...},
//     "watchlist": ["215200", "007120", ...],
//     "alerts":    {"215200": [{id,type,value,active,created,last_triggered}, ...], ...}
//   }
//
// Backwards compat: if old gist has flat {code: text} (v1), migrate to v2.notes on first load.

(function () {
  const LOCAL_KEY = 'stockDashboard.journal';
  const CFG_KEY = 'stockDashboard.syncCfg';
  const DEFAULT_FILE = 'stock-notes.json'; // keep same filename to reuse existing gist

  // ========= cfg =========
  function getCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function setCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c || {})); }

  // ========= local =========
  function emptyState() {
    return { _meta: { version: 2 }, notes: {}, trades: {}, watchlist: [], alerts: {} };
  }
  function loadLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      if (raw && raw._meta && raw._meta.version >= 2) return normalize(raw);
      // Migrate from old notes-only storage
      const oldNotes = JSON.parse(localStorage.getItem('stockDashboard.notes') || '{}');
      const st = emptyState();
      if (oldNotes && typeof oldNotes === 'object') st.notes = oldNotes;
      saveLocal(st);
      return st;
    } catch (e) { return emptyState(); }
  }
  function normalize(s) {
    const st = emptyState();
    Object.assign(st.notes, s.notes || {});
    Object.assign(st.trades, s.trades || {});
    Object.assign(st.alerts, s.alerts || {});
    st.watchlist = Array.isArray(s.watchlist) ? [...new Set(s.watchlist)] : [];
    return st;
  }
  function saveLocal(s) {
    s._meta = s._meta || { version: 2 };
    s._meta.updated_at = new Date().toISOString();
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  }

  // ========= gist =========
  async function fetchRemote() {
    const cfg = getCfg();
    if (!cfg.token || !cfg.gistId) return null;
    const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
      headers: { Authorization: `token ${cfg.token}`, Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Gist fetch ${res.status}`);
    const j = await res.json();
    const file = j.files[cfg.filename || DEFAULT_FILE] || j.files[Object.keys(j.files)[0]];
    if (!file) return emptyState();
    let parsed;
    try { parsed = JSON.parse(file.content || '{}'); }
    catch (e) { return emptyState(); }
    // v1 (flat notes) -> v2 migration
    if (!parsed._meta) {
      const migrated = emptyState();
      migrated.notes = parsed || {};
      return migrated;
    }
    return normalize(parsed);
  }

  async function pushRemote(state) {
    const cfg = getCfg();
    if (!cfg.token || !cfg.gistId) return;
    const filename = cfg.filename || DEFAULT_FILE;
    const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: { [filename]: { content: JSON.stringify(state, null, 2) } } }),
    });
    if (!res.ok) throw new Error(`Gist push ${res.status}`);
    setStatus('synced');
  }

  let pushTimer = null;
  function debouncedPush() {
    setStatus('syncing');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        const remote = await fetchRemote();
        const local = loadLocal();
        const merged = mergeStates(remote || emptyState(), local);
        saveLocal(merged);
        await pushRemote(merged);
      } catch (e) {
        console.warn('Gist push failed', e);
        setStatus('error', e.message);
      }
    }, 1500);
  }

  function mergeStates(remote, local) {
    // Local wins for any key that exists locally
    const m = emptyState();
    Object.assign(m.notes, remote.notes || {}, local.notes || {});
    Object.assign(m.trades, remote.trades || {}, local.trades || {});
    Object.assign(m.alerts, remote.alerts || {}, local.alerts || {});
    const setWl = new Set([...(remote.watchlist || []), ...(local.watchlist || [])]);
    // Removal: if local explicitly removed, prefer local's view
    m.watchlist = local.watchlist && local.watchlist.length >= 0 ? [...new Set(local.watchlist)] : [...setWl];
    return m;
  }

  async function pullOnce() {
    const cfg = getCfg();
    if (!cfg.token || !cfg.gistId) { setStatus('off'); return false; }
    setStatus('syncing');
    try {
      const remote = await fetchRemote();
      if (remote == null) { setStatus('off'); return false; }
      const local = loadLocal();
      const merged = mergeStates(remote, local);
      saveLocal(merged);
      const changed = JSON.stringify(merged) !== JSON.stringify(remote);
      if (changed) await pushRemote(merged);
      else setStatus('synced');
      return true;
    } catch (e) {
      console.warn('Gist pull failed', e);
      setStatus('error', e.message);
      return false;
    }
  }

  function setStatus(state, msg) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    const map = {
      off: { icon: '🔒', text: '동기화 꺼짐' },
      syncing: { icon: '🔄', text: '동기화 중…' },
      synced: { icon: '☁️', text: '동기화됨' },
      error: { icon: '⚠️', text: `오류 ${msg ? '— ' + msg : ''}` },
    };
    const m = map[state] || map.off;
    el.innerHTML = `${m.icon} ${m.text}`;
    el.dataset.state = state;
  }

  // ========= Public API =========
  window.Journal = {
    getNote(code) { return loadLocal().notes[code] || ''; },
    saveNote(code, text) {
      const st = loadLocal();
      if (text && text.trim()) st.notes[code] = text.trim();
      else delete st.notes[code];
      saveLocal(st);
      if (getCfg().token) debouncedPush();
    },
    // trades
    getTrades(code) { return loadLocal().trades[code] || []; },
    getAllTrades() { return loadLocal().trades; },
    addTrade(code, trade) {
      const st = loadLocal();
      if (!st.trades[code]) st.trades[code] = [];
      trade.id = trade.id || ('t' + Date.now() + Math.random().toString(36).slice(2, 6));
      st.trades[code].push(trade);
      st.trades[code].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      saveLocal(st);
      if (getCfg().token) debouncedPush();
    },
    removeTrade(code, id) {
      const st = loadLocal();
      if (!st.trades[code]) return;
      st.trades[code] = st.trades[code].filter(t => t.id !== id);
      if (!st.trades[code].length) delete st.trades[code];
      saveLocal(st);
      if (getCfg().token) debouncedPush();
    },
    // computed: net position
    getPosition(code) {
      const trs = this.getTrades(code);
      let qty = 0, costBasis = 0;
      for (const t of trs) {
        const q = Number(t.qty || 0);
        const p = Number(t.price || 0);
        if (t.type === 'buy') { costBasis += q * p; qty += q; }
        else if (t.type === 'sell') {
          // sell reduces costBasis proportionally
          if (qty > 0) { costBasis -= (costBasis / qty) * q; }
          qty -= q;
        }
      }
      return { qty, avgCost: qty > 0 ? costBasis / qty : 0, totalTrades: trs.length };
    },
    // watchlist
    getWatchlist() { return loadLocal().watchlist; },
    isWatching(code) { return loadLocal().watchlist.includes(code); },
    toggleWatch(code) {
      const st = loadLocal();
      const i = st.watchlist.indexOf(code);
      if (i >= 0) st.watchlist.splice(i, 1);
      else st.watchlist.push(code);
      saveLocal(st);
      if (getCfg().token) debouncedPush();
    },
    // alerts
    getAlerts(code) { return (loadLocal().alerts[code] || []).filter(a => a.active !== false); },
    getAllAlerts() { return loadLocal().alerts; },
    addAlert(code, alert) {
      const st = loadLocal();
      if (!st.alerts[code]) st.alerts[code] = [];
      alert.id = alert.id || ('a' + Date.now() + Math.random().toString(36).slice(2, 6));
      alert.active = true;
      alert.created = new Date().toISOString().slice(0, 10);
      st.alerts[code].push(alert);
      saveLocal(st);
      if (getCfg().token) debouncedPush();
    },
    removeAlert(code, id) {
      const st = loadLocal();
      if (!st.alerts[code]) return;
      st.alerts[code] = st.alerts[code].filter(a => a.id !== id);
      if (!st.alerts[code].length) delete st.alerts[code];
      saveLocal(st);
      if (getCfg().token) debouncedPush();
    },
    // generic
    state() { return loadLocal(); },
  };

  // Backward compatibility: keep window.getNote / window.saveNote so existing render.js works
  window.getNote = (code) => window.Journal.getNote(code);
  window.saveNote = (code, text) => window.Journal.saveNote(code, text);

  // ========= Settings modal (unchanged from notes-sync) =========
  window.openSyncSettings = function () {
    const cfg = getCfg();
    const html = `
      <div class="modal open" id="syncModal" aria-hidden="false" style="z-index:1000">
        <div class="modal-backdrop" data-close-sync="1"></div>
        <div class="modal-panel modal-panel-sm">
          <button class="modal-close" data-close-sync="1" aria-label="닫기">✕</button>
          <header class="modal-head"><div>
            <h2>☁️ 데이터 동기화 설정</h2>
            <p class="modal-sub">GitHub Gist에 메모·매매기록·워치·알림 통합 저장 (무료)</p>
          </div></header>
          <div class="modal-body">
            <div class="sync-step">
              <p><strong>1단계.</strong> GitHub PAT 발급 → <a href="https://github.com/settings/tokens/new?scopes=gist&description=Stock%20Dashboard" target="_blank" rel="noopener">발급 페이지</a> (gist 권한)</p>
              <p><strong>2단계.</strong> <a href="https://gist.github.com/" target="_blank" rel="noopener">새 Secret Gist 생성</a> — 파일명 <code>stock-notes.json</code>, 내용 <code>{}</code></p>
              <p><strong>3단계.</strong> Gist URL 끝의 ID 복사</p>
            </div>
            <label class="sync-field"><span>GitHub PAT</span>
              <input id="syncToken" type="password" placeholder="ghp_xx...xxxx" value="${cfg.token || ''}"></label>
            <label class="sync-field"><span>Gist ID</span>
              <input id="syncGistId" type="text" placeholder="abc123def456..." value="${cfg.gistId || ''}"></label>
            <label class="sync-field"><span>파일명 (선택)</span>
              <input id="syncFilename" type="text" placeholder="stock-notes.json" value="${cfg.filename || ''}"></label>
            <div class="sync-actions">
              <button class="btn-primary" id="syncSave" type="button">저장 + 동기화 시작</button>
              <button class="btn-secondary" id="syncTest" type="button">연결 테스트</button>
              <button class="btn-secondary" id="syncDisable" type="button">동기화 끄기</button>
            </div>
            <p class="sync-note" id="syncMsg" style="margin-top:12px;font-size:12px;color:var(--text-dim)"></p>
            <p class="sync-note" style="font-size:11px;color:var(--text-dim);margin-top:16px">
              💡 PAT는 브라우저에만 저장. Gist는 secret이지만 URL을 아는 사람은 접근 가능.
              <br>📡 18시 알림 발송용으로 같은 Gist ID·PAT를 <code>repo Secrets</code>에 등록하면 자동 알림이 켜집니다.
            </p>
          </div>
        </div>
      </div>`;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
    const close = () => { document.getElementById('syncModal')?.remove(); };
    document.querySelectorAll('[data-close-sync]').forEach(el => el.addEventListener('click', close));
    document.getElementById('syncSave').onclick = async () => {
      setCfg({
        token: document.getElementById('syncToken').value.trim(),
        gistId: document.getElementById('syncGistId').value.trim(),
        filename: document.getElementById('syncFilename').value.trim() || DEFAULT_FILE,
      });
      const ok = await pullOnce();
      const msg = document.getElementById('syncMsg');
      if (msg) msg.textContent = ok ? '✅ 동기화 시작됨' : '❌ 연결 실패 (PAT/Gist ID 확인)';
      if (ok) { setTimeout(close, 1200); if (typeof render === 'function') render(); }
    };
    document.getElementById('syncTest').onclick = async () => {
      const tmp = {
        token: document.getElementById('syncToken').value.trim(),
        gistId: document.getElementById('syncGistId').value.trim(),
        filename: document.getElementById('syncFilename').value.trim() || DEFAULT_FILE,
      };
      const saved = getCfg(); setCfg(tmp);
      try {
        const r = await fetchRemote();
        const counts = r ? `notes ${Object.keys(r.notes||{}).length} · trades ${Object.keys(r.trades||{}).length} · watch ${(r.watchlist||[]).length} · alerts ${Object.keys(r.alerts||{}).length}` : '';
        document.getElementById('syncMsg').textContent = `✅ 연결 OK — ${counts}`;
      } catch (e) {
        document.getElementById('syncMsg').textContent = `❌ ${e.message}`;
      } finally { setCfg(saved); }
    };
    document.getElementById('syncDisable').onclick = () => {
      setCfg({}); setStatus('off');
      document.getElementById('syncMsg').textContent = '🔒 동기화 꺼짐 (로컬 캐시 유지)';
    };
  };

  window.initNoteSync = function () {
    if (getCfg().token) {
      pullOnce().then(ok => { if (ok && typeof render === 'function') render(); });
    } else {
      setStatus('off');
    }
  };
})();
