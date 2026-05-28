import { render, setOnNavigate } from "./render.js";
import {
  STORAGE_KEY,
  TRACKING_KEY,
  loadTracking,
  saveState,
  getActiveTab,
  sendToPage,
  resetDomainColors,
} from "./state.js";

// ── Navigation handler (called when user clicks a history entry) ──

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

  await sendToPage({ action: "goto", index: i });
});

// ── Controls ──

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
  resetDomainColors();
  render();
});

// ── Init ──

render();

// Auto-refresh when content script writes new history
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[STORAGE_KEY] || changes[TRACKING_KEY]))
    render();
});
