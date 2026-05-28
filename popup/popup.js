(() => {
  // src/popup/state.js
  var STORAGE_KEY = "pointer_history";
  var TRACKING_KEY = "pointer_tracking";
  async function loadState() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || { entries: [], index: -1 };
  }
  async function saveState(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }
  async function loadTracking() {
    const result = await chrome.storage.local.get(TRACKING_KEY);
    return result[TRACKING_KEY] !== void 0 ? result[TRACKING_KEY] : true;
  }
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }
  async function sendToPage(msg) {
    const tab = await getActiveTab();
    if (!tab) return false;
    try {
      await chrome.tabs.sendMessage(tab.id, msg);
      return true;
    } catch (_) {
      return false;
    }
  }
  async function checkConnectivity() {
    const tab = await getActiveTab();
    if (!tab) return false;
    if (!tab.url || !/^(https?:|file:)/i.test(tab.url)) return false;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "ping" });
      return true;
    } catch (_) {
      return false;
    }
  }
  var DOMAIN_COLORS = [
    { bg: "#4f46e5", fg: "#e0e7ff" },
    { bg: "#0d9488", fg: "#ccfbf1" },
    { bg: "#d97706", fg: "#fef3c7" },
    { bg: "#dc2626", fg: "#fee2e2" },
    { bg: "#7c3aed", fg: "#ede9fe" },
    { bg: "#059669", fg: "#d1fae5" },
    { bg: "#ea580c", fg: "#fff7ed" },
    { bg: "#2563eb", fg: "#dbeafe" }
  ];
  var domainColorMap = {};
  var colorIdx = 0;
  function colorForDomain(hostname) {
    if (!domainColorMap[hostname]) {
      domainColorMap[hostname] = DOMAIN_COLORS[colorIdx % DOMAIN_COLORS.length];
      colorIdx++;
    }
    return domainColorMap[hostname];
  }
  function resetDomainColors() {
    for (const k of Object.keys(domainColorMap)) delete domainColorMap[k];
    colorIdx = 0;
  }
  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  function domainLetter(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return host[0] || "?";
    } catch (_) {
      return "?";
    }
  }
  function shortUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname === "/" ? "" : u.pathname.slice(0, 30);
      const trail = u.pathname.length > 30 ? "\u2026" : "";
      return u.hostname.replace(/^www\./, "") + path + trail;
    } catch (_) {
      return url.slice(0, 40);
    }
  }
  function uniquePages(entries) {
    const seen = /* @__PURE__ */ new Set();
    let count = 0;
    for (const e of entries) {
      if (!seen.has(e.url)) {
        seen.add(e.url);
        count++;
      }
    }
    return count;
  }

  // src/popup/render.js
  var onNavigate = null;
  function setOnNavigate(fn) {
    onNavigate = fn;
  }
  async function render() {
    const state = await loadState();
    const { entries, index } = state;
    const list = document.getElementById("history-list");
    const banner = document.getElementById("banner");
    const stats = document.getElementById("stats");
    document.getElementById("btn-back").disabled = index <= 0;
    document.getElementById("btn-forward").disabled = index >= entries.length - 1;
    if (entries.length > 0) {
      const pages = uniquePages(entries);
      const posWord = entries.length === 1 ? "position" : "positions";
      const pageWord = pages === 1 ? "page" : "pages";
      stats.textContent = `${entries.length} ${posWord} across ${pages} ${pageWord}`;
    } else {
      stats.textContent = "Click History";
    }
    const online = await checkConnectivity();
    banner.classList.toggle("hidden", online);
    const tracking = await loadTracking();
    const toggleBtn = document.getElementById("btn-toggle-track");
    toggleBtn.className = tracking ? "btn-toggle on" : "btn-toggle off";
    toggleBtn.title = tracking ? "Tracking on \u2014 click to pause" : "Tracking paused \u2014 click to resume";
    if (!tracking) {
      document.getElementById("btn-back").disabled = true;
      document.getElementById("btn-forward").disabled = true;
      document.getElementById("btn-clear").disabled = true;
    }
    if (entries.length === 0) {
      list.innerHTML = `
      <li class="empty">
        <div class="empty-icon">\u{1F3AF}</div>
        <p>No clicks recorded yet.</p>
        <p class="empty-hint">Click on any text on the page to start.</p>
      </li>`;
      return;
    }
    let lastUrl = null;
    const html = [...entries].map((e, i) => ({ e, i })).reverse().map(({ e, i }) => {
      const hostname = shortUrl(e.url);
      const letter = domainLetter(e.url);
      const color = colorForDomain(hostname);
      const isActive = i === index;
      const showSep = e.url !== lastUrl;
      lastUrl = e.url;
      let sep = "";
      if (showSep) {
        sep = `<li class="page-sep">${hostname}</li>`;
      }
      return sep + `<li class="${isActive ? "active" : ""}" data-index="${i}" title="Jump to position ${i + 1}">
          <span class="entry-favicon" style="background:${color.bg};color:${color.fg}">${letter}</span>
          <div class="entry-body">
            <div class="entry-url">${shortUrl(e.url)}</div>
            <div class="entry-meta">
              <span class="entry-index">#${i + 1}</span>
              <span>${formatTime(e.timestamp)}</span>
            </div>
          </div>
        </li>`;
    }).join("");
    list.innerHTML = html;
    list.querySelectorAll("li[data-index]").forEach((li) => {
      li.addEventListener("click", async () => {
        const i = parseInt(li.dataset.index, 10);
        if (onNavigate) onNavigate(i, entries);
      });
    });
  }

  // src/popup/index.js
  setOnNavigate(async (i, entries) => {
    const entry = entries[i];
    if (!entry) return;
    const activeTab = await getActiveTab();
    if (entry.url === activeTab?.url) {
      await sendToPage({ action: "goto", index: i });
      return;
    }
    const existing = await chrome.tabs.query({ url: entry.url });
    if (existing.length > 0) {
      const tab = existing[0];
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      chrome.tabs.sendMessage(tab.id, {
        action: "gotoPosition",
        x: entry.x,
        y: entry.y,
        height: entry.height,
        scrollX: entry.scrollX,
        scrollY: entry.scrollY
      }).catch(() => {
      });
      window.close();
      return;
    }
    await sendToPage({ action: "goto", index: i });
  });
  document.getElementById("btn-toggle-track").addEventListener("click", async () => {
    const cur = await loadTracking();
    const next = !cur;
    await chrome.storage.local.set({ [TRACKING_KEY]: next });
    await sendToPage({ action: "toggle", enabled: next });
    render();
  });
  document.getElementById("btn-back").addEventListener("click", async () => {
    await sendToPage({ action: "back" });
  });
  document.getElementById("btn-forward").addEventListener("click", async () => {
    await sendToPage({ action: "forward" });
  });
  document.getElementById("btn-clear").addEventListener("click", async () => {
    await saveState({ entries: [], index: -1 });
    resetDomainColors();
    render();
  });
  render();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes[STORAGE_KEY] || changes[TRACKING_KEY]))
      render();
  });
})();
