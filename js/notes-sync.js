// notes-sync.js — GitHub Gist-backed notes sync for stock dashboard
// Single-user setup: 1 PAT (gist scope) + 1 secret gist holding notes.json
//
// Storage:
//   localStorage['stockDashboard.notes']     → cache (always valid)
//   localStorage['stockDashboard.syncCfg']   → { token, gistId, filename }
//
// API:
//   getNote(code) / saveNote(code, text)     → sync-aware wrappers (replace render.js originals)
//   openSyncSettings()                       → settings modal
//   initNoteSync()                           → call once at app start; fetches gist if configured

(function () {
  const NOTES_KEY = 'stockDashboard.notes';
  const CFG_KEY = 'stockDashboard.syncCfg';
  const DEFAULT_FILE = 'stock-notes.json';

  // ===== Settings =====
  function getCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function setCfg(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg || {}));
  }

  // ===== Notes (local cache) =====
  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveLocal(notes) {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes || {}));
  }

  // ===== Gist API =====
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
    if (!file) return {};
    try { return JSON.parse(file.content || '{}'); }
    catch (e) { return {}; }
  }

  async function pushRemote(notes) {
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
      body: JSON.stringify({ files: { [filename]: { content: JSON.stringify(notes, null, 2) } } }),
    });
    if (!res.ok) throw new Error(`Gist push ${res.status}`);
    setStatus('synced');
  }

  // ===== Sync orchestration =====
  let pushTimer = null;
  function debouncedPush() {
    setStatus('syncing');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        // Fetch latest remote, merge with local (local wins for the keys we changed)
        const remote = await fetchRemote();
        const local = loadLocal();
        const merged = { ...(remote || {}), ...local };
        saveLocal(merged);
        await pushRemote(merged);
      } catch (e) {
        console.warn('Gist push failed', e);
        setStatus('error', e.message);
      }
    }, 1500);
  }

  async function pullOnce() {
    const cfg = getCfg();
    if (!cfg.token || !cfg.gistId) { setStatus('off'); return false; }
    setStatus('syncing');
    try {
      const remote = await fetchRemote();
      if (remote == null) { setStatus('off'); return false; }
      const local = loadLocal();
      // Merge: local takes priority for keys that exist locally (offline edits)
      // For initial pull use remote as base
      const merged = { ...remote, ...local };
      // Detect if merged differs from remote → push back to reconcile
      const changed = JSON.stringify(merged) !== JSON.stringify(remote);
      saveLocal(merged);
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

  // ===== Public API: replace render.js getNote/saveNote =====
  window.getNote = function (code) {
    return (loadLocal()[code] || '');
  };

  window.saveNote = function (code, text) {
    const store = loadLocal();
    if (text && text.trim()) store[code] = text.trim();
    else delete store[code];
    saveLocal(store);
    if (getCfg().token) debouncedPush();
  };

  // ===== Settings modal =====
  window.openSyncSettings = function () {
    const cfg = getCfg();
    const html = `
      <div class="modal open" id="syncModal" aria-hidden="false" style="z-index:1000">
        <div class="modal-backdrop" data-close-sync="1"></div>
        <div class="modal-panel modal-panel-sm">
          <button class="modal-close" data-close-sync="1" aria-label="닫기">✕</button>
          <header class="modal-head"><div>
            <h2>☁️ 메모 동기화 설정</h2>
            <p class="modal-sub">GitHub Gist를 백엔드로 사용 (무료, 모든 기기 동기화)</p>
          </div></header>
          <div class="modal-body">
            <div class="sync-step">
              <p><strong>1단계.</strong> GitHub PAT 발급 → <a href="https://github.com/settings/tokens/new?scopes=gist&description=Stock%20Dashboard%20Notes" target="_blank" rel="noopener">발급 페이지 열기</a> (gist 권한만)</p>
              <p><strong>2단계.</strong> <a href="https://gist.github.com/" target="_blank" rel="noopener">새 Secret Gist 생성</a> — 파일명 <code>stock-notes.json</code>, 내용 <code>{}</code> 입력 후 'Create secret gist'</p>
              <p><strong>3단계.</strong> 생성된 Gist URL의 끝 ID(예: <code>github.com/.../<b>abc123def</b></code>)를 복사</p>
            </div>
            <label class="sync-field">
              <span>GitHub PAT</span>
              <input id="syncToken" type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" value="${cfg.token || ''}">
            </label>
            <label class="sync-field">
              <span>Gist ID</span>
              <input id="syncGistId" type="text" placeholder="abc123def456..." value="${cfg.gistId || ''}">
            </label>
            <label class="sync-field">
              <span>파일명 (선택)</span>
              <input id="syncFilename" type="text" placeholder="stock-notes.json" value="${cfg.filename || ''}">
            </label>
            <div class="sync-actions">
              <button class="btn-primary" id="syncSave" type="button">저장 + 동기화 시작</button>
              <button class="btn-secondary" id="syncTest" type="button">연결 테스트</button>
              <button class="btn-secondary" id="syncDisable" type="button">동기화 끄기</button>
            </div>
            <p class="sync-note" id="syncMsg" style="margin-top:12px;font-size:12px;color:var(--text-dim)"></p>
            <p class="sync-note" style="font-size:11px;color:var(--text-dim);margin-top:16px">
              💡 PAT는 이 브라우저에만 저장됩니다. 깃 Gist는 secret(검색 불가)이지만 URL을 아는 사람은 접근 가능합니다. PAT가 노출되면 즉시 GitHub에서 revoke하세요.
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
      if (ok) setTimeout(close, 1200);
    };
    document.getElementById('syncTest').onclick = async () => {
      const tmpCfg = {
        token: document.getElementById('syncToken').value.trim(),
        gistId: document.getElementById('syncGistId').value.trim(),
        filename: document.getElementById('syncFilename').value.trim() || DEFAULT_FILE,
      };
      const saved = getCfg();
      setCfg(tmpCfg);
      try {
        const r = await fetchRemote();
        document.getElementById('syncMsg').textContent = `✅ 연결 OK — 원격 메모 ${Object.keys(r || {}).length}개`;
      } catch (e) {
        document.getElementById('syncMsg').textContent = `❌ ${e.message}`;
      } finally {
        setCfg(saved);
      }
    };
    document.getElementById('syncDisable').onclick = () => {
      setCfg({});
      setStatus('off');
      document.getElementById('syncMsg').textContent = '🔒 동기화 꺼짐 (로컬 캐시는 유지)';
    };
  };

  // ===== Init =====
  window.initNoteSync = function () {
    if (getCfg().token) {
      pullOnce().then(ok => { if (ok && typeof render === 'function') render(); });
    } else {
      setStatus('off');
    }
  };
})();
