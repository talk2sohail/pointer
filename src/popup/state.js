const STORAGE_KEY = "pointer_history";
const TRACKING_KEY = "pointer_tracking";

export { STORAGE_KEY, TRACKING_KEY };

// ── Storage ──

export async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || { entries: [], index: -1 };
}

export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function loadTracking() {
  const result = await chrome.storage.local.get(TRACKING_KEY);
  return result[TRACKING_KEY] !== undefined ? result[TRACKING_KEY] : true;
}

// ── Tab Communication ──

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function sendToPage(msg) {
  const tab = await getActiveTab();
  if (!tab) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
    return true;
  } catch (_) {
    return false;
  }
}

export async function checkConnectivity() {
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

// ── Domain Colours ──

const DOMAIN_COLORS = [
  { bg: "#4f46e5", fg: "#e0e7ff" },
  { bg: "#0d9488", fg: "#ccfbf1" },
  { bg: "#d97706", fg: "#fef3c7" },
  { bg: "#dc2626", fg: "#fee2e2" },
  { bg: "#7c3aed", fg: "#ede9fe" },
  { bg: "#059669", fg: "#d1fae5" },
  { bg: "#ea580c", fg: "#fff7ed" },
  { bg: "#2563eb", fg: "#dbeafe" },
];

const domainColorMap = {};
let colorIdx = 0;

export function colorForDomain(hostname) {
  if (!domainColorMap[hostname]) {
    domainColorMap[hostname] = DOMAIN_COLORS[colorIdx % DOMAIN_COLORS.length];
    colorIdx++;
  }
  return domainColorMap[hostname];
}

export function resetDomainColors() {
  for (const k of Object.keys(domainColorMap)) delete domainColorMap[k];
  colorIdx = 0;
}

// ── Formatting ──

export function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function domainLetter(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host[0] || "?";
  } catch (_) {
    return "?";
  }
}

export function shortUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.slice(0, 30);
    const trail = u.pathname.length > 30 ? "\u2026" : "";
    return u.hostname.replace(/^www\./, "") + path + trail;
  } catch (_) {
    return url.slice(0, 40);
  }
}

export function uniquePages(entries) {
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
