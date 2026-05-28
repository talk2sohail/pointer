import * as history from "./history.js";
import * as tracking from "./tracking.js";
import * as visuals from "./visuals.js";

const CURSOR_TYPES = ["", "fire"];

let syncWidget = null;

export function build() {
  const host = document.createElement("div");
  host.id = "pointer-widget-host";
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
      #btn-toggle {
        width: 28px;
        height: 28px;
        border-radius: 6px;
      }
      #btn-toggle svg { transition: opacity 0.2s; }
      #btn-toggle.on  { color: #a5b4fc; }
      #btn-toggle.off { color: #475569; }
      #btn-cursor.active { color: #f97316; }
      #btn-cursor.active svg { filter: drop-shadow(0 0 4px rgba(249,115,22,0.6)); }
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
      <button id="btn-toggle" title="Toggle tracking">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <circle cx="12" cy="12" r="4"/>
        </svg>
      </button>
      <button id="btn-cursor" title="Cycle cursor style">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M12 2C12 2 7 8 7 13c0 2.8 2.2 5 5 5s5-2.2 5-5c0-5-5-11-5-11zm0 16c-1.7 0-3-1.3-3-3 0-3 3-7 3-7s3 4 3 7c0 1.7-1.3 3-3 3z"/>
          <path d="M10 18l-1 3h6l-1-3"/>
        </svg>
      </button>
      <div class="divider"></div>
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
  const btnToggle = shadow.getElementById("btn-toggle");
  const btnCursor = shadow.getElementById("btn-cursor");
  const btnBack = shadow.getElementById("btn-back");
  const btnFwd = shadow.getElementById("btn-forward");
  const btnClr = shadow.getElementById("btn-clear");
  const counter = shadow.getElementById("counter");

  btnToggle.addEventListener("click", () => {
    const next = !tracking.isEnabled();
    tracking.set(next);
  });

  btnCursor.addEventListener("click", () => {
    const current = visuals.getCursorType();
    const idx = CURSOR_TYPES.indexOf(current);
    const next = CURSOR_TYPES[(idx + 1) % CURSOR_TYPES.length];
    visuals.setCursorType(next);
    sync();
  });

  btnBack.addEventListener("click", () => {
    history.goBack();
  });

  btnFwd.addEventListener("click", () => {
    history.goForward();
  });

  btnClr.addEventListener("click", () => {
    history.clear();
  });

  document.documentElement.appendChild(host);

  function sync() {
    const total = history.getLength();
    const index = history.getCurrentIndex();
    const trackingOn = tracking.isEnabled();
    const cursorType = visuals.getCursorType();

    bar.classList.toggle("visible", !trackingOn || total > 0);
    btnToggle.className = trackingOn ? "on" : "off";
    btnToggle.title = trackingOn
      ? "Tracking on — click to pause"
      : "Tracking paused — click to resume";

    btnCursor.classList.toggle("active", cursorType === "fire");
    btnCursor.title = cursorType === "fire"
      ? "Cursor: fire — click to switch"
      : "Cursor: default — click to switch";

    const navDisabled = !trackingOn;
    btnBack.disabled = navDisabled || index <= 0;
    btnFwd.disabled = navDisabled || index >= total - 1;
    btnClr.disabled = navDisabled;

    counter.textContent =
      total > 0
        ? `${index + 1} / ${total}`
        : trackingOn
          ? ""
          : "Paused";
  }

  syncWidget = sync;

  history.onChange(sync);
  tracking.onChange(sync);

  return sync;
}

export function sync() {
  if (syncWidget) syncWidget();
}
