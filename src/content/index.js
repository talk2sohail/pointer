import { hasContentAt } from "./detection.js";
import * as history from "./history.js";
import * as visuals from "./visuals.js";
import * as tracking from "./tracking.js";
import * as widget from "./widget.js";
import * as messaging from "./messaging.js";

messaging.setup();

// Wire up the marker shown on back/forward/goto navigation
history.setShowNavigatedMarker((x, y, h) => {
  visuals.showMarker(null, x, y, h);
});

// ── Click ──

document.addEventListener(
  "click",
  (e) => {
    if (!tracking.isEnabled()) return;
    if (history.getIsNavigating()) return;
    if (!hasContentAt(e.clientX, e.clientY, e.target)) return;

    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
    const lh = parseFloat(getComputedStyle(e.target).lineHeight) || 18;
    const fx = e.clientX + window.scrollX;
    const fy = e.clientY + window.scrollY;

    visuals.showCaret(range, fx, fy, lh);

    const rect = range?.getBoundingClientRect();
    const docX = rect?.height > 0 ? rect.left + window.scrollX : fx;
    const docY =
      rect?.height > 0 ? rect.top + rect.height / 2 + window.scrollY : fy;
    history.pushPosition(docX, docY, rect?.height || lh);
  },
  true,
);

// ── Keyboard Navigation ──

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  const editable =
    document.activeElement?.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT";
  if (editable) return;

  if (e.altKey && e.key === "ArrowLeft") {
    e.preventDefault();
    history.goBack();
  } else if (e.altKey && e.key === "ArrowRight") {
    e.preventDefault();
    history.goForward();
  }
});

// ── Resize Reposition ──

window.addEventListener("resize", () => {
  visuals.repositionOnResize();
});

// ── Tracking toggle: remove caret when paused ──

tracking.onChange((enabled) => {
  if (!enabled) visuals.remove();
});

// ── Init ──

Promise.all([history.load(), tracking.load()]).then(() => {
  widget.build();
});
