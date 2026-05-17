(() => {
  const MAX_HISTORY = 50;
  const STORAGE_KEY = 'pointer_history';

  // ─── Content Detection ────────────────────────────────────────────────────

  const CONTENT_TAGS = new Set([
    'P', 'SPAN', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'TD', 'TH', 'LABEL', 'BUTTON', 'STRONG', 'EM',
    'B', 'I', 'CODE', 'PRE', 'BLOCKQUOTE', 'ARTICLE',
    'SECTION', 'FIGCAPTION', 'CITE', 'MARK', 'ABBR'
  ]);

  function hasContentAt(x, y, target) {
    let el = target;
    while (el && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
      if (CONTENT_TAGS.has(el.tagName)) return true;
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true;
      }
      el = el.parentElement;
    }
    const range = document.caretRangeFromPoint?.(x, y);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) return true;
    return false;
  }

  // ─── History State ────────────────────────────────────────────────────────

  let clickHistory = [];   // renamed from 'history' to avoid shadowing window.history
  let currentIndex = -1;
  let isNavigating = false;

  async function loadHistory() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        clickHistory = result[STORAGE_KEY].entries || [];
        currentIndex = result[STORAGE_KEY].index ?? clickHistory.length - 1;
      }
    } catch (_) {}
  }

  async function saveHistory() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: { entries: clickHistory, index: currentIndex }
      });
    } catch (_) {}
  }

  function pushPosition(x, y, height) {
    if (isNavigating) return;
    const entry = {
      url: location.href,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      x, y, height,
      timestamp: Date.now()
    };
    clickHistory = clickHistory.slice(0, currentIndex + 1);
    clickHistory.push(entry);
    if (clickHistory.length > MAX_HISTORY) clickHistory.shift();
    currentIndex = clickHistory.length - 1;
    saveHistory().catch(() => {});
  }

  async function goBack() {
    if (currentIndex <= 0) return;
    currentIndex--;
    await navigateTo(clickHistory[currentIndex]);
    saveHistory().catch(() => {});
  }

  async function goForward() {
    if (currentIndex >= clickHistory.length - 1) return;
    currentIndex++;
    await navigateTo(clickHistory[currentIndex]);
    saveHistory().catch(() => {});
  }

  async function gotoIndex(i) {
    if (i < 0 || i >= clickHistory.length) return;
    currentIndex = i;
    await navigateTo(clickHistory[currentIndex]);
    saveHistory().catch(() => {});
  }

  async function navigateTo(entry) {
    isNavigating = true;
    if (entry.url !== location.href) {
      await saveHistory();
      location.href = entry.url;
      return;
    }
    window.scrollTo({ left: entry.scrollX, top: entry.scrollY, behavior: 'smooth' });
    setTimeout(() => {
      showMarker(null, entry.x, entry.y, entry.height || 18);
      isNavigating = false;
    }, 400);
  }

  // ─── Visual Effects ───────────────────────────────────────────────────────

  let activeCaret = null;
  let activeRange  = null;

  function applyPosition(el, x, y, height) {
    el.style.left   = `${x}px`;
    el.style.top    = `${y}px`;
    el.style.height = `${height}px`;
  }

  function positionFromRange(el, range) {
    const rect = range.getBoundingClientRect();
    if (rect.height > 0) {
      applyPosition(
        el,
        rect.left + window.scrollX,
        rect.top  + rect.height / 2 + window.scrollY,
        rect.height
      );
      return true;
    }
    return false;
  }

  function spawnGhost(x, y, height) {
    const g = document.createElement('div');
    g.className = 'pointer-ghost';
    applyPosition(g, x, y, height);
    document.body.appendChild(g);
    g.addEventListener('animationend', () => g.remove());
  }

  function moveCaret(className, range, fallbackX, fallbackY, fallbackH) {
    // Spawn ghost at the current position before moving
    if (activeCaret) {
      spawnGhost(
        parseFloat(activeCaret.style.left),
        parseFloat(activeCaret.style.top),
        parseFloat(activeCaret.style.height)
      );
    }

    if (!activeCaret || activeCaret.className !== className) {
      // First placement or switching type (caret ↔ marker) — create fresh
      if (activeCaret) activeCaret.remove();
      const el = document.createElement('div');
      el.className = className;
      // Place without transition first so it doesn't fly from 0,0
      el.style.transition = 'none';
      if (!range || !positionFromRange(el, range)) {
        applyPosition(el, fallbackX, fallbackY, fallbackH);
      }
      document.body.appendChild(el);
      activeCaret = el;
      // Re-enable transition after first paint
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { el.style.transition = ''; });
      });
    } else {
      // Reuse element — CSS transition will sweep it to new position
      if (!range || !positionFromRange(activeCaret, range)) {
        applyPosition(activeCaret, fallbackX, fallbackY, fallbackH);
      }
    }

    activeRange = range;
  }

  function showCaret(range, fallbackX, fallbackY, fallbackH) {
    moveCaret('pointer-caret', range, fallbackX, fallbackY, fallbackH);
  }

  function showMarker(range, fallbackX, fallbackY, fallbackH) {
    moveCaret('pointer-marker', range, fallbackX, fallbackY, fallbackH);
  }

  // Reposition on zoom (resize event) without transition
  window.addEventListener('resize', () => {
    if (activeCaret && activeRange) {
      activeCaret.style.transition = 'none';
      positionFromRange(activeCaret, activeRange);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { activeCaret.style.transition = ''; });
      });
    }
  });

  // ─── Floating Controls Widget ─────────────────────────────────────────────

  function buildWidget() {
    const host = document.createElement('div');
    host.id = 'pointer-widget-host';
    // Use Shadow DOM to fully isolate from page styles
    const shadow = host.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        #bar {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 2147483647;
          display: flex;
          gap: 6px;
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid rgba(99, 102, 241, 0.35);
          border-radius: 10px;
          padding: 6px 8px;
          backdrop-filter: blur(10px);
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          opacity: 0;
          transform: translateY(-6px);
          transition: opacity 0.25s, transform 0.25s;
          pointer-events: none;
        }
        #bar.visible {
          opacity: 1;
          transform: translateY(0);
          pointer-events: all;
        }
        button {
          all: unset;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 7px;
          color: #94a3b8;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        button:hover  { background: rgba(99,102,241,0.2); color: #e2e8f0; }
        button:active { background: rgba(99,102,241,0.35); }
        button:disabled { opacity: 0.25; cursor: default; pointer-events: none; }
        .divider {
          width: 1px;
          background: rgba(255,255,255,0.1);
          margin: 4px 0;
        }
      </style>
      <div id="bar">
        <button id="btn-back" title="Back (Alt+←)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button id="btn-forward" title="Forward (Alt+→)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <div class="divider"></div>
        <button id="btn-clear" title="Clear history">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;

    const bar     = shadow.getElementById('bar');
    const btnBack = shadow.getElementById('btn-back');
    const btnFwd  = shadow.getElementById('btn-forward');
    const btnClr  = shadow.getElementById('btn-clear');

    btnBack.addEventListener('click', async () => { await goBack();    syncWidget(); });
    btnFwd.addEventListener('click',  async () => { await goForward(); syncWidget(); });
    btnClr.addEventListener('click',  () => {
      clickHistory = [];
      currentIndex = -1;
      saveHistory();
      syncWidget();
    });

    document.documentElement.appendChild(host);

    function syncWidget() {
      const hasHistory = history.length > 0;
      bar.classList.toggle('visible', hasHistory);
      btnBack.disabled = currentIndex <= 0;
      btnFwd.disabled  = currentIndex >= clickHistory.length - 1;
    }

    // Expose so history changes can update button states
    return syncWidget;
  }

  const syncWidget = buildWidget();

  // ─── Event Listeners ─────────────────────────────────────────────────────

  document.addEventListener('click', (e) => {
    if (!hasContentAt(e.clientX, e.clientY, e.target)) return;

    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
    const lh = parseFloat(getComputedStyle(e.target).lineHeight) || 18;
    const fx = e.clientX + window.scrollX;
    const fy = e.clientY + window.scrollY;

    showCaret(range, fx, fy, lh);

    const rect = range?.getBoundingClientRect();
    const docX = rect?.height > 0 ? rect.left + window.scrollX : fx;
    const docY = rect?.height > 0 ? rect.top + rect.height / 2 + window.scrollY : fy;
    pushPosition(docX, docY, rect?.height || lh);
    syncWidget();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      goBack();
      syncWidget();
    } else if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      goForward();
      syncWidget();
    }
  });

  // Message listener for popup controls
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'back')    { goBack();             syncWidget(); sendResponse({ ok: true }); }
    if (msg.action === 'forward') { goForward();          syncWidget(); sendResponse({ ok: true }); }
    if (msg.action === 'goto')    { gotoIndex(msg.index); syncWidget(); sendResponse({ ok: true }); }
    return true;
  });

  // ─── Init ─────────────────────────────────────────────────────────────────

  loadHistory().then(syncWidget);
})();

