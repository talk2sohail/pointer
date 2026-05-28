import {
  loadState,
  loadTracking,
  checkConnectivity,
  colorForDomain,
  formatTime,
  domainLetter,
  shortUrl,
  uniquePages,
  getActiveTab,
  sendToPage,
} from "./state.js";

let onNavigate = null;

export function setOnNavigate(fn) {
  onNavigate = fn;
}

export async function render() {
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

  // Tracking toggle
  const tracking = await loadTracking();
  const toggleBtn = document.getElementById("btn-toggle-track");
  toggleBtn.className = tracking ? "btn-toggle on" : "btn-toggle off";
  toggleBtn.title = tracking
    ? "Tracking on — click to pause"
    : "Tracking paused — click to resume";

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

  // Build list
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
      if (onNavigate) onNavigate(i, entries);
    });
  });
}
