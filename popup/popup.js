const STORAGE_KEY = "pointer_history";
const TRACKING_KEY = "pointer_tracking";

// ── Colour palette for domain favicon pills ──────────────────────────────
const DOMAIN_COLORS = [
  { bg: "#4f46e5", fg: "#e0e7ff" }, // indigo
  { bg: "#0d9488", fg: "#ccfbf1" }, // teal
  { bg: "#d97706", fg: "#fef3c7" }, // amber
  { bg: "#dc2626", fg: "#fee2e2" }, // red
  { bg: "#7c3aed", fg: "#ede9fe" }, // violet
  { bg: "#059669", fg: "#d1fae5" }, // emerald
  { bg: "#ea580c", fg: "#fff7ed" }, // orange
  { bg: "#2563eb", fg: "#dbeafe" }, // blue
];

const domainColorMap = {};
let colorIdx = 0;

function colorForDomain(hostname) {
  if (!domainColorMap[hostname]) {
    domainColorMap[hostname] = DOMAIN_COLORS[colorIdx % DOMAIN_COLORS.length];
    colorIdx++;
  }
  return domainColorMap[hostname];
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || { entries: [], index: -1 };
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
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

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
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
  const seen = new Set();
  let count = 0;
  for (const e of entries) {
    if (!seen.has(e.url)) {
      seen.add(e.url);
      count++;
    }
  }
  return count;
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

async function loadTracking() {
  const result = await chrome.storage.local.get(TRACKING_KEY);
  return result[TRACKING_KEY] !== undefined ? result[TRACKING_KEY] : true;
}

// ── Render ───────────────────────────────────────────────────────────────

async function render() {
  const state = await loadState();
  const { entries, index } = state;
  const list = document.getElementById("history-list");
  const banner = document.getElementById("banner");
  const stats = document.getElementById("stats");

  document.getElementById("btn-back").disabled = index <= 0;
  document.getElementById("btn-forward").disabled = index >= entries.length - 1;

  // Stats bar
  if (entries.length > 0) {
    const pages = uniquePages(entries);
    const posWord = entries.length === 1 ? "position" : "positions";
    const pageWord = pages === 1 ? "page" : "pages";
    stats.textContent = `${entries.length} ${posWord} across ${pages} ${pageWord}`;
  } else {
    stats.textContent = "Click History";
  }

  // Connectivity banner
  const online = await checkConnectivity();
  banner.classList.toggle("hidden", online);

  // Tracking toggle — sync with stored state
  const tracking = await loadTracking();
  const toggleBtn = document.getElementById("btn-toggle-track");
  toggleBtn.className = tracking ? "btn-toggle on" : "btn-toggle off";
  toggleBtn.title = tracking
    ? "Tracking on — click to pause"
    : "Tracking paused — click to resume";
  // Disable nav/clear when tracking is off
  if (!tracking) {
    document.getElementById("btn-back").disabled = true;
    document.getElementById("btn-forward").disabled = true;
    document.getElementById("btn-clear").disabled = true;
  }

  // Empty state
  if (entries.length === 0) {
    list.innerHTML = `
      <li class="empty">
        <div class="empty-icon">🎯</div>
        <p>No clicks recorded yet.</p>
        <p class="empty-hint">Click on any text on the page to start.</p>
      </li>`;
    return;
  }

  // Build list with page separators (newest first)
  let lastUrl = null;
  const html = [...entries]
    .map((e, i) => ({ e, i }))
    .reverse()
    .map(({ e, i }) => {
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

      return (
        sep +
        `<li class="${isActive ? "active" : ""}" data-index="${i}" title="Jump to position ${i + 1}">
          <span class="entry-favicon" style="background:${color.bg};color:${color.fg}">${letter}</span>
          <div class="entry-body">
            <div class="entry-url">${shortUrl(e.url)}</div>
            <div class="entry-meta">
              <span class="entry-index">#${i + 1}</span>
              <span>${formatTime(e.timestamp)}</span>
            </div>
          </div>
        </li>`
      );
    })
    .join("");

  list.innerHTML = html;

  list.querySelectorAll("li[data-index]").forEach((li) => {
    li.addEventListener("click", async () => {
      const i = parseInt(li.dataset.index, 10);
      const entry = entries[i];
      if (!entry) return;

      const activeTab = await getActiveTab();

      // If the entry is on the same page, just jump to position.
      if (entry.url === activeTab?.url) {
        await sendToPage({ action: "goto", index: i });
        return;
      }

      // Look for an already-open tab with this URL.
      const existing = await chrome.tabs.query({ url: entry.url });
      if (existing.length > 0) {
        // Switch to the existing tab and position the cursor.
        const tab = existing[0];
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        // Send position directly — the content script in that tab is ready.
        chrome.tabs
          .sendMessage(tab.id, {
            action: "gotoPosition",
            x: entry.x,
            y: entry.y,
            height: entry.height,
            scrollX: entry.scrollX,
            scrollY: entry.scrollY,
          })
          .catch(() => {});
        window.close();
        return;
      }

      // No open tab — navigate the current tab.
      await sendToPage({ action: "goto", index: i });
    });
  });
}

// ── Controls ─────────────────────────────────────────────────────────────

document
  .getElementById("btn-toggle-track")
  .addEventListener("click", async () => {
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
  // Reset domain colour map so new entries get fresh assignments
  for (const k of Object.keys(domainColorMap)) delete domainColorMap[k];
  colorIdx = 0;
  render();
});

render();

// Refresh popup automatically when content script writes new history
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[STORAGE_KEY] || changes[TRACKING_KEY]))
    render();
});
