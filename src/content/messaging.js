import * as history from "./history.js";
import * as visuals from "./visuals.js";
import * as tracking from "./tracking.js";

export function setup() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "ping") {
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === "back") {
      history.goBack();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === "forward") {
      history.goForward();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === "goto") {
      history.gotoIndex(msg.index);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === "gotoPosition") {
      history.setIsNavigating(true);
      window.scrollTo({
        left: msg.scrollX || 0,
        top: msg.scrollY || 0,
        behavior: "smooth",
      });
      setTimeout(() => {
        visuals.showMarker(null, msg.x, msg.y, msg.height || 18);
        history.setIsNavigating(false);
      }, 400);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === "toggle") {
      tracking.set(msg.enabled);
      sendResponse({ ok: true, enabled: tracking.isEnabled() });
      return true;
    }

    if (msg.action === "getState") {
      sendResponse({ enabled: tracking.isEnabled() });
      return true;
    }

    return true;
  });
}
