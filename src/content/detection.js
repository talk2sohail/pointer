const CONTENT_TAGS = new Set([
  "P", "SPAN", "A", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "TD", "TH", "DT", "DD", "LABEL", "BUTTON",
  "STRONG", "EM", "B", "I", "U", "S", "CODE", "PRE",
  "KBD", "SAMP", "BLOCKQUOTE", "Q", "ARTICLE", "SECTION",
  "ASIDE", "MAIN", "FIGCAPTION", "CAPTION", "LEGEND",
  "CITE", "MARK", "ABBR", "TIME", "SMALL", "SUMMARY",
  "DETAILS", "OPTION",
]);

export function hasContentAt(x, y, target) {
  let el = target;
  while (el && el.tagName !== "BODY" && el.tagName !== "HTML") {
    if (CONTENT_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim())
        return true;
    }
    el = el.parentElement;
  }
  const range = document.caretRangeFromPoint?.(x, y);
  if (range && range.startContainer.nodeType === Node.TEXT_NODE) return true;
  return false;
}
