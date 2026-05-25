const STORAGE_KEY = "pointer_history";

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
  if (!tab) return;
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
    second: "2-digit",
  });
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname + u.pathname.slice(0, 30) + (u.pathname.length > 30 ? "…" : "")
    );
  } catch (_) {
    return url.slice(0, 40);
  }
}

async function checkConnectivity() {
  const tab = await getActiveTab();
  if (!tab) return false;
  // Pages like chrome://, edge://, about: can't host content scripts.
  if (!tab.url || !/^(https?:|file:)/i.test(tab.url)) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "ping" });
    return true;
  } catch (_) {
    return false;
  }
}

async function render() {
  const state = await loadState();
  const { entries, index } = state;
  const list = document.getElementById("history-list");
  const banner = document.getElementById("banner");

  document.getElementById("btn-back").disabled = index <= 0;
  document.getElementById("btn-forward").disabled = index >= entries.length - 1;

  // Show a banner when the content script can't be reached on this tab.
  const online = await checkConnectivity();
  banner.classList.toggle("hidden", online);

  if (entries.length === 0) {
    list.innerHTML = '<li class="empty">No clicks recorded yet.</li>';
    return;
  }

  // Show newest first; track original index for navigation
  list.innerHTML = [...entries]
    .map((e, i) => ({ e, i }))
    .reverse()
    .map(
      ({ e, i }) => `
      <li class="${i === index ? "active" : ""}" data-index="${i}" title="Jump to this position">
        <div class="entry-url">${shortUrl(e.url)}</div>
        <div class="entry-meta">${formatTime(e.timestamp)}</div>
      </li>
    `,
    )
    .join("");

  list.querySelectorAll("li[data-index]").forEach((li) => {
    li.addEventListener("click", async () => {
      const i = parseInt(li.dataset.index, 10);
      await sendToPage({ action: "goto", index: i });
    });
  });
}

document.getElementById("btn-back").addEventListener("click", async () => {
  await sendToPage({ action: "back" });
});

document.getElementById("btn-forward").addEventListener("click", async () => {
  await sendToPage({ action: "forward" });
});

document.getElementById("btn-clear").addEventListener("click", async () => {
  await saveState({ entries: [], index: -1 });
  render();
});

render();

// Refresh popup automatically when content script writes new history
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) render();
});
