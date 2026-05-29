import * as history from "./history.js";
import * as tracking from "./tracking.js";
import * as visuals from "./visuals.js";
import { CURSOR_TYPES } from "../shared/constants.js";

let syncWidget = null;
let panelOpen = false;

export function build() {
  const host = document.createElement("div");
  host.id = "pointer-widget-host";
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      #widget-wrap {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 0;
        opacity: 0;
        transform: translateY(-8px) scale(0.96);
        transition: opacity 0.3s cubic-bezier(0.16,1,0.3,1), transform 0.3s cubic-bezier(0.16,1,0.3,1);
        pointer-events: none;
      }
      #widget-wrap.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: all;
      }

      /* ── Cursor panel (horizontal slider, same height as bar) ── */
      #cursor-panel {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 5px 6px;
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 12px;
        backdrop-filter: blur(12px);
        box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 1px rgba(99,102,241,0.2);
        white-space: nowrap;
        opacity: 0;
        transform: translateX(8px) scale(0.96);
        transition: opacity 0.22s cubic-bezier(0.16,1,0.3,1), transform 0.22s cubic-bezier(0.16,1,0.3,1);
        pointer-events: none;
        margin-right: 6px;
      }
      #cursor-panel.open {
        opacity: 1;
        transform: translateX(0) scale(1);
        pointer-events: all;
      }

      .cursor-option {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 30px;
        border-radius: 8px;
        color: #64748b;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .cursor-option:hover { background: rgba(99,102,241,0.2); color: #e2e8f0; }
      .cursor-option.active { background: rgba(99,102,241,0.25); color: #a5b4fc; }
      .cursor-option.active svg { filter: drop-shadow(0 0 4px rgba(99,102,241,0.5)); }

      /* ── Bar ── */
      #bar {
        display: flex;
        align-items: center;
        gap: 4px;
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 12px;
        padding: 5px 8px;
        backdrop-filter: blur(12px);
        box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 1px rgba(99,102,241,0.2);
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

      #cursor-current {
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
      #cursor-current:hover { background: rgba(99,102,241,0.2); color: #e2e8f0; }
      #cursor-current:active { background: rgba(99,102,241,0.35); transform: scale(0.93); }
      #cursor-current.active { color: #f97316; }
      #cursor-current.active svg { filter: drop-shadow(0 0 4px rgba(249,115,22,0.6)); }
      #cursor-current.open { color: #a5b4fc; }

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

    <div id="widget-wrap">
      <div id="cursor-panel"></div>
      <div id="bar">
        <button id="btn-toggle" title="Toggle tracking">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <circle cx="12" cy="12" r="4"/>
          </svg>
        </button>
        <button id="cursor-current" title="Current cursor style">
          <svg id="cursor-svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="8" y="5" width="2" height="14" rx="1"/>
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
    </div>
  `;

  const wrap = shadow.getElementById("widget-wrap");
  const panel = shadow.getElementById("cursor-panel");
  const bar = shadow.getElementById("bar");
  const btnToggle = shadow.getElementById("btn-toggle");
  const btnCursor = shadow.getElementById("cursor-current");
  const cursorSvg = shadow.getElementById("cursor-svg");
  const btnBack = shadow.getElementById("btn-back");
  const btnFwd = shadow.getElementById("btn-forward");
  const btnClr = shadow.getElementById("btn-clear");
  const counter = shadow.getElementById("counter");

  // ── Build cursor panel options ──

  function buildPanel() {
    panel.innerHTML = CURSOR_TYPES.map((ct) => {
      const isActive = visuals.getCursorType() === ct.id;
      const iconSvg =
        ct.id === "fire"
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C12 2 7 8 7 13c0 2.8 2.2 5 5 5s5-2.2 5-5c0-5-5-11-5-11zm0 16c-1.7 0-3-1.3-3-3 0-3 3-7 3-7s3 4 3 7c0 1.7-1.3 3-3 3z"/><path d="M10 18l-1 3h6l-1-3"/></svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="8" y="5" width="2" height="14" rx="1"/></svg>`;
      return `
        <button class="cursor-option${isActive ? " active" : ""}" data-cursor="${ct.id}" title="${ct.label}">
          ${iconSvg}
        </button>`;
    }).join("");

    panel.querySelectorAll(".cursor-option").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.cursor;
        visuals.setCursorType(id);
        closePanel();
        sync();
      });
    });
  }

  buildPanel();

  // ── Panel open / close ──

  function openPanel() {
    panelOpen = true;
    panel.classList.add("open");
    btnCursor.classList.add("open");
    btnCursor.title = "Close cursor picker";
    buildPanel(); // refresh active state
  }

  function closePanel() {
    panelOpen = false;
    panel.classList.remove("open");
    btnCursor.classList.remove("open");
    btnCursor.title = "Choose cursor style";
  }

  btnCursor.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  });

  // Close panel on outside click
  shadow.addEventListener("click", (e) => {
    if (panelOpen && !panel.contains(e.target) && e.target !== btnCursor) {
      closePanel();
    }
  });

  // ── Other buttons ──

  btnToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = !tracking.isEnabled();
    tracking.set(next);
  });

  btnBack.addEventListener("click", (e) => {
    e.stopPropagation();
    history.goBack();
  });

  btnFwd.addEventListener("click", (e) => {
    e.stopPropagation();
    history.goForward();
  });

  btnClr.addEventListener("click", (e) => {
    e.stopPropagation();
    history.clear();
  });

  document.documentElement.appendChild(host);

  // ── Sync ──

  function sync() {
    const total = history.getLength();
    const index = history.getCurrentIndex();
    const trackingOn = tracking.isEnabled();
    const cursorType = visuals.getCursorType();

    wrap.classList.toggle("visible", !trackingOn || total > 0);

    btnToggle.className = trackingOn ? "on" : "off";
    btnToggle.title = trackingOn
      ? "Tracking on — click to pause"
      : "Tracking paused — click to resume";

    // Update cursor indicator icon
    const isFire = cursorType === "fire";
    btnCursor.classList.toggle("active", isFire);
    btnCursor.title = isFire ? "Cursor: Fire" : "Cursor: Default";
    cursorSvg.innerHTML = isFire
      ? `<path d="M12 2C12 2 7 8 7 13c0 2.8 2.2 5 5 5s5-2.2 5-5c0-5-5-11-5-11zm0 16c-1.7 0-3-1.3-3-3 0-3 3-7 3-7s3 4 3 7c0 1.7-1.3 3-3 3z"/><path d="M10 18l-1 3h6l-1-3"/>`
      : `<rect x="8" y="5" width="2" height="14" rx="1"/>`;

    const navDisabled = !trackingOn;
    btnBack.disabled = navDisabled || index <= 0;
    btnFwd.disabled = navDisabled || index >= total - 1;
    btnClr.disabled = navDisabled;

    counter.textContent =
      total > 0 ? `${index + 1} / ${total}` : trackingOn ? "" : "Paused";
  }

  syncWidget = sync;

  history.onChange(sync);
  tracking.onChange(sync);

  return sync;
}

export function sync() {
  if (syncWidget) syncWidget();
}
