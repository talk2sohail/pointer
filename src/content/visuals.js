let activeCaret = null;
let activeRange = null;
let cursorType = "";
let cursorTypeSuffix = "";

export function getCursorType() {
  return cursorType;
}

export function setCursorType(type) {
  cursorType = type;
  cursorTypeSuffix = type ? `--${type}` : "";
  if (activeCaret) {
    const base = activeCaret.className.replace(/--\w+$/, "");
    activeCaret.className = base + cursorTypeSuffix;
  }
}

function typify(base) {
  return base + cursorTypeSuffix;
}

function ghostClassFor(caretClass) {
  const isMarker = caretClass.startsWith("pointer-marker");
  return isMarker ? typify("pointer-ghost-marker") : typify("pointer-ghost");
}

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

function spawnGhost(x, y, height, caretClass) {
  const g = document.createElement("div");
  g.className = ghostClassFor(caretClass);
  applyPosition(g, x, y, height);
  document.body.appendChild(g);
  g.addEventListener("animationend", () => g.remove());
}

function moveCaret(baseClass, range, fallbackX, fallbackY, fallbackH) {
  const className = typify(baseClass);
  if (activeCaret) {
    spawnGhost(
      parseFloat(activeCaret.style.left),
      parseFloat(activeCaret.style.top),
      parseFloat(activeCaret.style.height),
      activeCaret.className,
    );
  }

  if (!activeCaret || activeCaret.className !== className) {
    if (activeCaret) activeCaret.remove();
    const el = document.createElement("div");
    el.className = className;
    el.style.transition = "none";
    if (!range || !positionFromRange(el, range)) {
      applyPosition(el, fallbackX, fallbackY, fallbackH);
    }
    document.body.appendChild(el);
    activeCaret = el;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = "";
      });
    });
  } else {
    if (!range || !positionFromRange(activeCaret, range)) {
      applyPosition(activeCaret, fallbackX, fallbackY, fallbackH);
    }
  }

  activeRange = range;
}

export function showCaret(range, fallbackX, fallbackY, fallbackH) {
  moveCaret("pointer-caret", range, fallbackX, fallbackY, fallbackH);
}

export function showMarker(range, fallbackX, fallbackY, fallbackH) {
  moveCaret("pointer-marker", range, fallbackX, fallbackY, fallbackH);
}

export function remove() {
  if (activeCaret) {
    activeCaret.remove();
    activeCaret = null;
    activeRange = null;
  }
}

export function repositionOnResize() {
  if (activeCaret && activeRange) {
    activeCaret.style.transition = "none";
    positionFromRange(activeCaret, activeRange);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        activeCaret.style.transition = "";
      });
    });
  }
}
