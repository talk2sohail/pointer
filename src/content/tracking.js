import { TRACKING_KEY } from "../shared/constants.js";

let enabled = true;
const listeners = new Set();

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(enabled);
}

export async function load() {
  try {
    const result = await chrome.storage.local.get(TRACKING_KEY);
    if (result[TRACKING_KEY] !== undefined) {
      enabled = result[TRACKING_KEY];
    }
  } catch (_) {}
}

async function save() {
  try {
    await chrome.storage.local.set({ [TRACKING_KEY]: enabled });
  } catch (_) {}
}

export function isEnabled() {
  return enabled;
}

export function set(on) {
  enabled = on;
  save();
  notify();
}

export function toggle() {
  set(!enabled);
  return enabled;
}
