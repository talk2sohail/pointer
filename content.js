(() => {
  const MAX_HISTORY = 50;
  const STORAGE_KEY = "pointer_history";

  // ─── Content Detection ────────────────────────────────────────────────────

  // Elements likely to contain human-readable text.
  const CONTENT_TAGS = new Set([
    "P",
    "SPAN",
    "A",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "TD",
    "TH",
    "DT",
    "DD",
    "LABEL",
    "BUTTON",
    "STRONG",
    "EM",
    "B",
    "I",
    "U",
    "S",
    "CODE",
    "PRE",
    "KBD",
    "SAMP",
    "BLOCKQUOTE",
    "Q",
    "ARTICLE",
    "SECTION",
    "ASIDE",
    "MAIN",
    "FIGCAPTION",
    "CAPTION",
    "LEGEND",
    "CITE",
    "MARK",
    "ABBR",
    "TIME",
    "SMALL",
    "SUMMARY",
    "DETAILS",
    "OPTION",
  ]);

  function hasContentAt(x, y, target) {
    let el = target;
    while (el && el.tagName !== "BODY" && el.tagName !== "HTML") {
      // Known text-bearing element.
      if (CONTENT_TAGS.has(el.tagName)) return true;

      // contenteditable regions (rich text editors, comment boxes, etc.).
      if (el.isContentEditable) return true;

      // Any element whose own (non-child) text is non-empty.
      // Uses textContent of direct text-node children to avoid
      // false positives from deeply nested invisible text.
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim())
          return true;
      }

      el = el.parentElement;
    }

    // Fallback: browser's own range-from-point for edge cases (SVG text, etc.).
    const range = document.caretRangeFromPoint?.(x, y);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) return true;
    return false;
  }

  // ─── History State ────────────────────────────────────────────────────────

  let clickHistory = []; // renamed from 'history' to avoid shadowing window.history
  let currentIndex = -1;
  let isNavigating = false;

  // Debounce: ignore rapid re-clicks at (nearly) the same spot.
  const DEBOUNCE_MS = 300;
  const DEBOUNCE_PX = 20;
  let lastClick = { x: -1, y: -1, ts: 0 };

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
        [STORAGE_KEY]: { entries: clickHistory, index: currentIndex },
      });
    } catch (_) {}
  }

  function pushPosition(x, y, height) {
    if (isNavigating) return;

    // Skip if within the debounce window of the previous click.
    const now = Date.now();
    const dx = Math.abs(x - lastClick.x);
    const dy = Math.abs(y - lastClick.y);
    if (
      now - lastClick.ts < DEBOUNCE_MS &&
      dx < DEBOUNCE_PX &&
      dy < DEBOUNCE_PX
    ) {
      return;
    }
    lastClick = { x, y, ts: now };

    const entry = {
      url: location.href,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      x,
      y,
      height,
      timestamp: Date.now(),
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
    window.scrollTo({
      left: entry.scrollX,
      top: entry.scrollY,
      behavior: "smooth",
    });
    setTimeout(() => {
      showMarker(null, entry.x, entry.y, entry.height || 18);
      isNavigating = false;
    }, 400);
  }

  // ─── Visual Effects ───────────────────────────────────────────────────────

  let activeCaret = null;
  let activeRange = null;

  function applyPosition(el, x, y, height) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.height = `${height}px`;
  }

  function positionFromRange(el, range) {
    const rect = range.getBoundingClientRect();
    if (rect.height > 0) {
      applyPosition(
        el,
        rect.left + window.scrollX,
        rect.top + rect.height / 2 + window.scrollY,
        rect.height,
      );
      return true;
    }
    return false;
  }

  function spawnGhost(x, y, height) {
    const g = document.createElement("div");
    // Match ghost colour to the active caret: red for marker, indigo for click.
    const isMarker = activeCaret && activeCaret.className === "pointer-marker";
    g.className = isMarker ? "pointer-ghost-marker" : "pointer-ghost";
    applyPosition(g, x, y, height);
    document.body.appendChild(g);
    g.addEventListener("animationend", () => g.remove());
  }

  function moveCaret(className, range, fallbackX, fallbackY, fallbackH) {
    // Spawn ghost at the current position before moving
    if (activeCaret) {
      spawnGhost(
        parseFloat(activeCaret.style.left),
        parseFloat(activeCaret.style.top),
        parseFloat(activeCaret.style.height),
      );
    }

    if (!activeCaret || activeCaret.className !== className) {
      // First placement or switching type (caret ↔ marker) — create fresh
      if (activeCaret) activeCaret.remove();
      const el = document.createElement("div");
      el.className = className;
      // Place without transition first so it doesn't fly from 0,0
      el.style.transition = "none";
      if (!range || !positionFromRange(el, range)) {
        applyPosition(el, fallbackX, fallbackY, fallbackH);
      }
      document.body.appendChild(el);
      activeCaret = el;
      // Re-enable transition after first paint
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = "";
        });
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
    moveCaret("pointer-caret", range, fallbackX, fallbackY, fallbackH);
  }

  function showMarker(range, fallbackX, fallbackY, fallbackH) {
    moveCaret("pointer-marker", range, fallbackX, fallbackY, fallbackH);
  }

  // Reposition on zoom (resize event) without transition
  window.addEventListener("resize", () => {
    if (activeCaret && activeRange) {
      activeCaret.style.transition = "none";
      positionFromRange(activeCaret, activeRange);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          activeCaret.style.transition = "";
        });
      });
    }
  });

  // ─── Floating Controls Widget ─────────────────────────────────────────────

  function buildWidget() {
    const host = document.createElement("div");
    host.id = "pointer-widget-host";
    // Use Shadow DOM to fully isolate from page styles
    const shadow = host.attachShadow({ mode: "closed" });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        #bar {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          gap: 4px;
          background: rgba(15, 23, 42, 0.88);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 12px;
          padding: 5px 8px;
          backdrop-filter: blur(12px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 1px rgba(99,102,241,0.2);
          opacity: 0;
          transform: translateY(-8px) scale(0.96);
          transition: opacity 0.3s cubic-bezier(0.16,1,0.3,1), transform 0.3s cubic-bezier(0.16,1,0.3,1);
          pointer-events: none;
        }
        #bar.visible {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: all;
        }
        button {
          all: unset;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 8px;
          color: #94a3b8;
          cursor: pointer;
          transition: background 0.15s, color 0.15s, transform 0.1s;
        }
        button:hover:not(:disabled)  { background: rgba(99,102,241,0.2); color: #e2e8f0; }
        button:active:not(:disabled) { background: rgba(99,102,241,0.35); transform: scale(0.93); }
        button:disabled { opacity: 0.25; cursor: default; pointer-events: none; }
        #counter {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 38px;
          height: 26px;
          padding: 0 6px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: #a5b4fc;
          letter-spacing: 0.3px;
          user-select: none;
        }
        .divider {
          width: 1px;
          height: 18px;
          background: rgba(255,255,255,0.08);
          border-radius: 1px;
        }
      </style>
      <div id="bar">
        <button id="btn-back" title="Back (Alt+←)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span id="counter"></span>
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

    const bar = shadow.getElementById("bar");
    const btnBack = shadow.getElementById("btn-back");
    const btnFwd = shadow.getElementById("btn-forward");
    const btnClr = shadow.getElementById("btn-clear");
    const counter = shadow.getElementById("counter");

    btnBack.addEventListener("click", async () => {
      await goBack();
      syncWidget();
    });
    btnFwd.addEventListener("click", async () => {
      await goForward();
      syncWidget();
    });
    btnClr.addEventListener("click", () => {
      clickHistory = [];
      currentIndex = -1;
      saveHistory();
      syncWidget();
    });

    document.documentElement.appendChild(host);

    function syncWidget() {
      const hasHistory = clickHistory.length > 0;
      bar.classList.toggle("visible", hasHistory);
      btnBack.disabled = currentIndex <= 0;
      btnFwd.disabled = currentIndex >= clickHistory.length - 1;
      // Show position counter like "3 / 12"
      const total = clickHistory.length;
      counter.textContent = total > 0 ? `${currentIndex + 1} / ${total}` : "";
    }

    // Expose so history changes can update button states
    return syncWidget;
  }

  const syncWidget = buildWidget();

  // ─── Event Listeners ─────────────────────────────────────────────────────

  document.addEventListener(
    "click",
    (e) => {
      if (!hasContentAt(e.clientX, e.clientY, e.target)) return;

      const range =
        document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
      const lh = parseFloat(getComputedStyle(e.target).lineHeight) || 18;
      const fx = e.clientX + window.scrollX;
      const fy = e.clientY + window.scrollY;

      showCaret(range, fx, fy, lh);

      const rect = range?.getBoundingClientRect();
      const docX = rect?.height > 0 ? rect.left + window.scrollX : fx;
      const docY =
        rect?.height > 0 ? rect.top + rect.height / 2 + window.scrollY : fy;
      pushPosition(docX, docY, rect?.height || lh);
      syncWidget();
    },
    true,
  );

  document.addEventListener("keydown", (e) => {
    // Don't intercept shortcuts when the user is typing in an editable field.
    const tag = document.activeElement?.tagName;
    const editable =
      document.activeElement?.isContentEditable ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT";
    if (editable) return;

    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      goBack();
      syncWidget();
    } else if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      goForward();
      syncWidget();
    }
  });

  // Message listener for popup controls
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "ping") {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.action === "back") {
      goBack();
      syncWidget();
      sendResponse({ ok: true });
    }
    if (msg.action === "forward") {
      goForward();
      syncWidget();
      sendResponse({ ok: true });
    }
    if (msg.action === "goto") {
      gotoIndex(msg.index);
      syncWidget();
      sendResponse({ ok: true });
    }
    return true;
  });

  // ─── Init ─────────────────────────────────────────────────────────────────

  loadHistory().then(syncWidget);
})();
