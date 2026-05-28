import { MAX_HISTORY, DEBOUNCE_MS, DEBOUNCE_PX, STORAGE_KEY } from "../shared/constants.js";

const listeners = new Set();

let entries = [];
let currentIndex = -1;
let isNavigating = false;
let lastClick = { x: -1, y: -1, ts: 0 };
let showNavigatedMarker = null;

export function setShowNavigatedMarker(fn) {
  showNavigatedMarker = fn;
}

// ── Events ──

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

// ── Accessors ──

export function getEntries() {
  return entries;
}

export function getCurrentIndex() {
  return currentIndex;
}

export function getCurrentEntry() {
  return entries[currentIndex];
}

export function getLength() {
  return entries.length;
}

export function getIsNavigating() {
  return isNavigating;
}

export function setIsNavigating(val) {
  isNavigating = val;
}

// ── Persistence ──

export async function load() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      entries = result[STORAGE_KEY].entries || [];
      currentIndex = result[STORAGE_KEY].index ?? entries.length - 1;
    }
  } catch (_) {}
}

export async function save() {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: { entries, index: currentIndex },
    });
  } catch (_) {}
}

// ── Mutations ──

export function pushPosition(x, y, height) {
  if (isNavigating) return;

  const now = Date.now();
  const dx = Math.abs(x - lastClick.x);
  const dy = Math.abs(y - lastClick.y);
  if (
    now - lastClick.ts < DEBOUNCE_MS &&
    dx < DEBOUNCE_PX &&
    dy < DEBOUNCE_PX
  ) {
    return;
  }
  lastClick = { x, y, ts: now };

  const entry = {
    url: location.href,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    x,
    y,
    height,
    timestamp: Date.now(),
  };

  entries = entries.slice(0, currentIndex + 1);
  entries.push(entry);
  if (entries.length > MAX_HISTORY) entries.shift();
  currentIndex = entries.length - 1;
  save();
  notify();
}

export async function goBack() {
  if (currentIndex <= 0) return;
  currentIndex--;
  await navigateTo(entries[currentIndex]);
  save();
  notify();
}

export async function goForward() {
  if (currentIndex >= entries.length - 1) return;
  currentIndex++;
  await navigateTo(entries[currentIndex]);
  save();
  notify();
}

export async function gotoIndex(i) {
  if (i < 0 || i >= entries.length) return;
  currentIndex = i;
  await navigateTo(entries[currentIndex]);
  save();
  notify();
}

async function navigateTo(entry) {
  isNavigating = true;
  if (entry.url !== location.href) {
    await save();
    location.href = entry.url;
    return;
  }
  window.scrollTo({
    left: entry.scrollX,
    top: entry.scrollY,
    behavior: "smooth",
  });
  setTimeout(() => {
    if (showNavigatedMarker) showNavigatedMarker(entry.x, entry.y, entry.height || 18);
    isNavigating = false;
  }, 400);
}

export function clear() {
  entries = [];
  currentIndex = -1;
  save();
  notify();
}
