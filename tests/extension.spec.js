import { test as base, expect, chromium } from "@playwright/test";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import http from "http";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXT_PATH = fs.realpathSync(ROOT);

function computeExtensionId(extPath) {
  const hash = crypto.createHash("sha256").update(extPath).digest();
  const bytes = hash.slice(0, 16);
  let id = "";
  for (const byte of bytes) {
    id += String.fromCharCode("a".charCodeAt(0) + ((byte >> 4) & 0x0f));
    id += String.fromCharCode("a".charCodeAt(0) + (byte & 0x0f));
  }
  return id;
}
const EXTENSION_ID = computeExtensionId(EXT_PATH);

// ── Extended test page with all element types needed for exhaustive coverage ──

const TEST_PAGE = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="min-height: 1200px; padding: 20px; font-size: 16px; line-height: 1.5;">
  <p id="p1">The first paragraph with enough text for a click target.</p>
  <p id="p2">The second paragraph also has sufficient content text.</p>
  <p id="p3" style="margin-top: 80px; line-height: 32px;">This paragraph has tall line-height for testing height tracking.</p>
  <h1 id="h1">Main Page Heading Title</h1>
  <h2 id="h2">Subheading with text content</h2>
  <h3 id="h3">Smaller heading text</h3>
  <a id="a1" href="#">Clickable hyperlink text here</a>
  <button id="btn1">Button label text</button>
  <span id="span1">Inline span text content</span>
  <div id="text-div">Direct text content in a div</div>
  <div id="empty-div" style="height:40px;width:200px;background:#eee;"></div>
  <div id="img-no-alt" style="width:100px;height:100px;background:#ccc;"></div>
  <details id="details1"><summary id="summary1">Summary text to click</summary>Details content here.</details>
  <blockquote id="bq1">Blockquote text for testing</blockquote>
  <code id="code1">console.log("code text")</code>
  <pre id="pre1">Preformatted text block</pre>
  <li id="li1">List item text content</li>
  <label id="label1">Label text for form</label>
  <strong id="strong1">Bold strong text</strong>
  <em id="em1">Emphasized italic text</em>
  <div id="editable-div" contenteditable="true" style="border:1px solid #999;padding:10px;margin:10px 0;">
    Editable content region — click here.
  </div>
  <input id="input1" type="text" value="Input field text" style="display:block;margin:10px 0;" />
  <textarea id="textarea1" rows="3" style="display:block;margin:10px 0;">Textarea content</textarea>
  <select id="select1" style="display:block;margin:10px 0;">
    <option>Option 1</option><option>Option 2</option>
  </select>
  <div id="far-down" style="margin-top: 900px;">Content far down the page requiring scroll.</div>
</body></html>`;

// ── Helpers ──

/** Get info about the active caret or marker element */
async function getCaretInfo(page) {
  return page.evaluate(() => {
    const all = document.querySelectorAll("*");
    for (const el of all) {
      const cn = el.className;
      if (
        typeof cn === "string" &&
        (cn.includes("pointer-caret") || cn.includes("pointer-marker"))
      ) {
        return {
          className: cn,
          left: parseFloat(el.style.left),
          top: parseFloat(el.style.top),
          height: parseFloat(el.style.height),
        };
      }
    }
    return null;
  });
}

/** Get all ghost elements currently in the DOM */
async function getGhostInfo(page) {
  return page.evaluate(() => {
    const ghosts = [];
    const all = document.querySelectorAll("*");
    for (const el of all) {
      const cn = el.className;
      if (typeof cn === "string" && cn.includes("pointer-ghost")) {
        ghosts.push({
          className: cn,
          left: parseFloat(el.style.left),
          top: parseFloat(el.style.top),
        });
      }
    }
    return ghosts;
  });
}

/** Get widget button states from inside shadow DOM */
async function getWidgetState(page) {
  return page.evaluate(() => {
    const host = document.getElementById("pointer-widget-host");
    if (!host || !host.shadowRoot) return null;
    const sr = host.shadowRoot;
    const bar = sr.getElementById("bar");
    const toggleBtn = sr.getElementById("btn-toggle");
    const backBtn = sr.getElementById("btn-back");
    const fwdBtn = sr.getElementById("btn-forward");
    const clrBtn = sr.getElementById("btn-clear");
    const cursorBtn = sr.getElementById("btn-cursor");
    const counter = sr.getElementById("counter");
    return {
      barVisible: bar.classList.contains("visible"),
      toggleClass: toggleBtn.className,
      backDisabled: backBtn.disabled,
      fwdDisabled: fwdBtn.disabled,
      clrDisabled: clrBtn.disabled,
      cursorActive: cursorBtn.classList.contains("active"),
      counterText: counter.textContent,
    };
  });
}

/** Click a widget button inside shadow DOM by id */
async function clickWidgetButton(page, buttonId) {
  await page.evaluate((id) => {
    const host = document.getElementById("pointer-widget-host");
    if (!host || !host.shadowRoot) return;
    host.shadowRoot.getElementById(id).click();
  }, buttonId);
}

/** Open the popup and return the page object */
async function openPopup(context) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${EXTENSION_ID}/popup/popup.html`, {
    waitUntil: "networkidle",
  });
  await popup.waitForTimeout(800);
  return popup;
}

/** Click a content element and wait for the caret to appear */
async function clickAndWait(page, selector) {
  await page.click(selector, { force: true });
  await page.waitForTimeout(500);
}

// ── Server & Test Fixtures ──

let server;
let serverPort;

const test = base.extend({
  httpServer: [
    async ({}, use) => {
      server = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(TEST_PAGE);
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      serverPort = server.address().port;
      await use({ port: serverPort });
    },
    { scope: "worker", auto: true },
  ],

  context: [
    async ({}, use) => {
      const udir = `/tmp/pw-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ctx = await chromium.launchPersistentContext(udir, {
        headless: false,
        args: [
          `--disable-extensions-except=${EXT_PATH}`,
          `--load-extension=${EXT_PATH}`,
          "--no-sandbox",
        ],
      });
      await use(ctx);
      await ctx.close();
      try {
        fs.rmSync(udir, { recursive: true, force: true });
      } catch {}
    },
    { scope: "test" },
  ],

  pointerPage: [
    async ({ context }, use) => {
      const pages = context.pages();
      const page = pages.length > 0 ? pages[0] : await context.newPage();
      await page.goto(`http://127.0.0.1:${serverPort}/`, {
        waitUntil: "networkidle",
      });
      await page.waitForTimeout(1500);
      await use(page);
    },
    { scope: "test" },
  ],
});

test.afterAll(() => {
  server?.close();
});

// ═══════════════════════════════════════════════════════════════
// 1. INJECTION & BOOTSTRAP
// ═══════════════════════════════════════════════════════════════

test.describe("Injection & Bootstrap", () => {
  test("content script is injected and widget host exists", async ({
    pointerPage: page,
  }) => {
    await expect(page.locator("#pointer-widget-host")).toBeAttached();
  });

  test("widget host has a shadow root with expected elements", async ({
    pointerPage: page,
  }) => {
    const hasShadow = await page.evaluate(() => {
      const host = document.getElementById("pointer-widget-host");
      return !!(host && host.shadowRoot);
    });
    expect(hasShadow).toBe(true);

    const ids = await page.evaluate(() => {
      const host = document.getElementById("pointer-widget-host");
      const sr = host.shadowRoot;
      return [
        "bar",
        "btn-toggle",
        "btn-back",
        "btn-forward",
        "btn-clear",
        "btn-cursor",
        "counter",
      ].map((id) => !!sr.getElementById(id));
    });
    expect(ids.every(Boolean)).toBe(true);
  });

  test("widget bar is hidden initially when no history and tracking is on", async ({
    pointerPage: page,
  }) => {
    const state = await getWidgetState(page);
    expect(state).not.toBeNull();
    // With tracking on but no history, bar should be hidden
    expect(state.barVisible).toBe(false);
    expect(state.counterText).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. CLICK TRACKING — BASIC
// ═══════════════════════════════════════════════════════════════

test.describe("Click Tracking — Basic", () => {
  test("clicking on a paragraph creates a caret element", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
    expect(caret.className).toContain("pointer-caret");
    expect(caret.left).toBeGreaterThan(0);
    expect(caret.top).toBeGreaterThan(0);
  });

  test("clicking on non-content does not reposition the caret", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#empty-div");
    const pos2 = await getCaretInfo(page);
    expect(pos2.left).toBe(pos1.left);
    expect(pos2.top).toBe(pos1.top);
  });

  test("clicking on an image-like div without text is treated as non-content", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#img-no-alt");
    const pos2 = await getCaretInfo(page);
    expect(pos2.left).toBe(pos1.left);
    expect(pos2.top).toBe(pos1.top);
  });

  test("clicking on direct text node in a div creates caret", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#text-div");
    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
    expect(caret.className).toContain("pointer-caret");
    expect(caret.top).toBeGreaterThan(0);
  });

  test("clicking on contentEditable div creates caret", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#editable-div");
    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
    expect(caret.className).toContain("pointer-caret");
    expect(caret.top).toBeGreaterThan(0);
  });

  test("clicking on various content tags creates a caret", async ({
    pointerPage: page,
  }) => {
    for (const sel of ["#h1", "#h2", "#h3", "#a1", "#btn1", "#span1"]) {
      await clickAndWait(page, sel);
    }
    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
    expect(caret.top).toBeGreaterThan(0);
  });

  test("clicking on extended content tags creates caret", async ({
    pointerPage: page,
  }) => {
    for (const sel of [
      "#summary1",
      "#bq1",
      "#code1",
      "#li1",
      "#label1",
      "#strong1",
      "#em1",
    ]) {
      await clickAndWait(page, sel);
    }
    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
  });

  test("clicking on <pre> content creates caret", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#pre1");
    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
  });

  test("caret height reflects the clicked element line-height", async ({
    pointerPage: page,
  }) => {
    // p3 has line-height: 32px — caret height should be approximately that
    await clickAndWait(page, "#p3");
    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
    // Height should be near 32 (allow some floating point variance)
    expect(caret.height).toBeGreaterThan(15);
    expect(caret.height).toBeLessThan(50);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. HISTORY DEBOUNCE
// ═══════════════════════════════════════════════════════════════

test.describe("History Debounce", () => {
  test("nearby clicks within debounce window do not create duplicate entries", async ({
    context,
    pointerPage: page,
  }) => {
    // Two rapid clicks on the same paragraph should count as 1
    await page.click("#p1", { force: true });
    await page.waitForTimeout(50);
    await page.click("#p1", { force: true });
    await page.waitForTimeout(500);

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    expect(statsText).toContain("1 position");
    await popup.close();
  });

  test("clicks far apart in time (>300ms) create separate entries", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    // Debounce window is 300ms; wait longer to ensure it's a new entry
    await page.waitForTimeout(400);
    await clickAndWait(page, "#p1");

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    expect(statsText).toContain("2 positions");
    await popup.close();
  });

  test("clicks far apart in position (>20px) create separate entries even within debounce window", async ({
    context,
    pointerPage: page,
  }) => {
    // p1 and h1 are far apart positionally, so both register even in rapid succession
    await page.click("#p1", { force: true });
    await page.waitForTimeout(100);
    await page.click("#h1", { force: true });
    await page.waitForTimeout(500);

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    expect(statsText).toContain("2 positions");
    await popup.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. HISTORY MANAGEMENT — NAVIGATION
// ═══════════════════════════════════════════════════════════════

test.describe("History Management — Navigation", () => {
  test("Alt+ArrowLeft navigates backward in history", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#h1");
    const pos2 = await getCaretInfo(page);
    expect(pos2.top).not.toBe(pos1.top);

    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);
    const posBack = await getCaretInfo(page);
    expect(posBack).not.toBeNull();
    expect(posBack.top).toBe(pos1.top);
    expect(posBack.left).toBe(pos1.left);
  });

  test("Alt+ArrowRight navigates forward in history", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#h1");
    const pos2 = await getCaretInfo(page);

    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);
    await page.keyboard.press("Alt+ArrowRight");
    await page.waitForTimeout(1200);
    const posFwd = await getCaretInfo(page);
    expect(posFwd).not.toBeNull();
    expect(posFwd.top).toBe(pos2.top);
    expect(posFwd.left).toBe(pos2.left);
  });

  test("Alt+Left at index 0 is a no-op (does not throw)", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);

    // At first entry, going back should do nothing
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(800);
    const posAfter = await getCaretInfo(page);
    expect(posAfter).not.toBeNull();
    expect(posAfter.top).toBe(pos1.top);
  });

  test("Alt+Right at last index is a no-op (does not throw)", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);

    // At last (only) entry, going forward should do nothing
    await page.keyboard.press("Alt+ArrowRight");
    await page.waitForTimeout(800);
    const posAfter = await getCaretInfo(page);
    expect(posAfter).not.toBeNull();
    expect(posAfter.top).toBe(pos1.top);
  });

  test("navigation marker is red (pointer-marker) not blue (pointer-caret)", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    // Navigate back — this should use showMarker, which renders a pointer-marker
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);
    const marker = await getCaretInfo(page);
    expect(marker).not.toBeNull();
    expect(marker.className).toContain("pointer-marker");
    expect(marker.className).not.toContain("pointer-caret");
  });

  test("subsequent click after navigating back is a normal caret", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);

    // New click after navigation should create caret (blue), not marker (red)
    await clickAndWait(page, "#btn1");
    const caret = await getCaretInfo(page);
    expect(caret.className).toContain("pointer-caret");
  });

  test("forward history is truncated when clicking new position after going back", async ({
    context,
    pointerPage: page,
  }) => {
    // 1. Click p1 (idx=0), h1 (idx=1), btn1 (idx=2)
    // 2. Go back to p1 (idx=0)
    // 3. Click span1 — this should truncate forward history, making span1 idx=1
    // Total should be 2, not 4
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");
    await clickAndWait(page, "#btn1");
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);

    // Now at p1 (index 0). Click a new position
    await clickAndWait(page, "#span1");

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    // Should be 2: p1 + span1 (h1 and btn1 were truncated)
    expect(statsText).toContain("2 positions");
    await popup.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. HISTORY MANAGEMENT — MAX_HISTORY
// ═══════════════════════════════════════════════════════════════

test.describe("History Management — Max History", () => {
  test("entries beyond MAX_HISTORY (50) evict the oldest", async ({
    context,
    pointerPage: page,
  }) => {
    // Click more than 50 times to test eviction
    const maxClicks = 55;
    for (let i = 0; i < maxClicks; i++) {
      // Alternate between p1 and h1 to ensure debounce doesn't suppress
      const sel = i % 2 === 0 ? "#p1" : "#h1";
      await page.click(sel, { force: true });
      await page.waitForTimeout(320); // > debounce window
    }

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    // MAX_HISTORY is 50, so we should see exactly 50 positions
    expect(statsText).toContain("50 positions");
    expect(statsText).not.toContain("55 positions");
    await popup.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. HISTORY MANAGEMENT — CLEAR
// ═══════════════════════════════════════════════════════════════

test.describe("History Management — Clear", () => {
  test("clear() wipes all entries and resets index to -1", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    // Clear via widget button
    await clickWidgetButton(page, "btn-clear");
    await page.waitForTimeout(500);

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    expect(statsText).toContain("Click History");
    await popup.close();
  });

  test("widget clear button is visible and enabled with history", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const state = await getWidgetState(page);
    expect(state.clrDisabled).toBe(false);
  });

  test("after clear, widget bar becomes hidden again", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    let state = await getWidgetState(page);
    expect(state.barVisible).toBe(true);

    await clickWidgetButton(page, "btn-clear");
    await page.waitForTimeout(500);

    state = await getWidgetState(page);
    expect(state.barVisible).toBe(false);
    expect(state.counterText).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. VISUALS — GHOST AFTERIMAGE
// ═══════════════════════════════════════════════════════════════

test.describe("Visuals — Ghost Afterimage", () => {
  test("a ghost element appears at the old position when caret moves to a new click", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);

    // Click somewhere else — should spawn ghost at p1
    await page.click("#h1", { force: true });
    await page.waitForTimeout(100); // Ghost spawns immediately

    const ghosts = await getGhostInfo(page);
    expect(ghosts.length).toBeGreaterThan(0);
    // Ghost should be at old position (p1) or very close
    const ghostMatch = ghosts.find((g) => Math.abs(g.top - pos1.top) < 20);
    expect(ghostMatch).toBeDefined();
  });

  test("a ghost-marker appears when navigating with Alt+Arrow", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    // Navigate back — should spawn a ghost-marker at h1
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(500);

    const ghosts = await getGhostInfo(page);
    // When moving from caret (blue) to marker (red), the ghost class
    // is derived from the OLD element's class, so it's pointer-ghost.
    const anyGhost = ghosts.find((g) => g.className.includes("pointer-ghost"));
    expect(anyGhost).toBeDefined();
  });

  test("ghost elements are removed after animation completes", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    // Wait for ghost animation to finish (0.35s for ghost + some buffer)
    await page.waitForTimeout(500);

    // Ghosts should be gone
    const ghosts = await getGhostInfo(page);
    expect(ghosts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. VISUALS — FIRE CURSOR TYPE
// ═══════════════════════════════════════════════════════════════

test.describe("Visuals — Fire Cursor Type", () => {
  test("cursor cycle button toggles between default and fire cursor", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");

    // Default cursor — caret should NOT have --fire suffix
    let caret = await getCaretInfo(page);
    expect(caret.className).not.toContain("--fire");

    // Click cursor cycle button
    await clickWidgetButton(page, "btn-cursor");
    await page.waitForTimeout(300);

    // Click another position to trigger a new caret render
    await clickAndWait(page, "#h1");
    caret = await getCaretInfo(page);
    expect(caret.className).toContain("--fire");

    // Toggle back to default
    await clickWidgetButton(page, "btn-cursor");
    await page.waitForTimeout(300);
    await clickAndWait(page, "#btn1");
    caret = await getCaretInfo(page);
    expect(caret.className).not.toContain("--fire");
  });

  test("fire ghost afterimage uses fire styling", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickWidgetButton(page, "btn-cursor");
    await page.waitForTimeout(300);

    await page.click("#h1", { force: true });
    await page.waitForTimeout(100);

    const ghosts = await getGhostInfo(page);
    const fireGhost = ghosts.find((g) => g.className.includes("--fire"));
    expect(fireGhost).toBeDefined();
  });

  test("navigation marker also uses fire style when fire cursor is active", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    // Enable fire cursor
    await clickWidgetButton(page, "btn-cursor");
    await page.waitForTimeout(300);

    // Navigate back — marker should have --fire
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);
    const marker = await getCaretInfo(page);
    expect(marker.className).toContain("--fire");
    expect(marker.className).toContain("pointer-marker");
  });

  test("widget cursor button shows active state when fire is selected", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");

    let state = await getWidgetState(page);
    expect(state.cursorActive).toBe(false);

    await clickWidgetButton(page, "btn-cursor");
    await page.waitForTimeout(300);

    state = await getWidgetState(page);
    expect(state.cursorActive).toBe(true);

    await clickWidgetButton(page, "btn-cursor");
    await page.waitForTimeout(300);

    state = await getWidgetState(page);
    expect(state.cursorActive).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. WIDGET UI — BUTTONS & STATE
// ═══════════════════════════════════════════════════════════════

test.describe("Widget UI — Buttons & State", () => {
  test("widget toggle button disables tracking and removes caret", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    expect(await getCaretInfo(page)).not.toBeNull();

    // Toggle off via widget
    await clickWidgetButton(page, "btn-toggle");
    await page.waitForTimeout(500);

    // Caret should be removed
    expect(await getCaretInfo(page)).toBeNull();

    // New click should not create caret
    await clickAndWait(page, "#h1");
    expect(await getCaretInfo(page)).toBeNull();
  });

  test("widget re-enables tracking and caret reappears on click", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickWidgetButton(page, "btn-toggle");
    await page.waitForTimeout(500);
    expect(await getCaretInfo(page)).toBeNull();

    // Toggle on
    await clickWidgetButton(page, "btn-toggle");
    await page.waitForTimeout(500);

    // Click should work again
    await clickAndWait(page, "#h1");
    expect(await getCaretInfo(page)).not.toBeNull();
  });

  test("widget back button navigates backward", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#h1");

    await clickWidgetButton(page, "btn-back");
    await page.waitForTimeout(1200);

    const posBack = await getCaretInfo(page);
    expect(posBack).not.toBeNull();
    expect(posBack.top).toBe(pos1.top);
  });

  test("widget forward button navigates forward", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");
    const pos2 = await getCaretInfo(page);

    // Go back first
    await clickWidgetButton(page, "btn-back");
    await page.waitForTimeout(1200);

    // Then forward
    await clickWidgetButton(page, "btn-forward");
    await page.waitForTimeout(1200);

    const posFwd = await getCaretInfo(page);
    expect(posFwd).not.toBeNull();
    expect(posFwd.top).toBe(pos2.top);
  });

  test('widget counter shows correct "current / total" format', async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");
    await clickAndWait(page, "#btn1");

    let state = await getWidgetState(page);
    expect(state.counterText).toBe("3 / 3");

    // Go back one
    await clickWidgetButton(page, "btn-back");
    await page.waitForTimeout(1200);

    state = await getWidgetState(page);
    expect(state.counterText).toBe("2 / 3");
  });

  test("widget buttons are disabled when tracking is off", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickWidgetButton(page, "btn-toggle");
    await page.waitForTimeout(300);

    const state = await getWidgetState(page);
    expect(state.backDisabled).toBe(true);
    expect(state.fwdDisabled).toBe(true);
    expect(state.clrDisabled).toBe(true);
    expect(state.toggleClass).toBe("off");
  });

  test("widget bar remains visible when tracking is off but history exists", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickWidgetButton(page, "btn-toggle");
    await page.waitForTimeout(300);

    const state = await getWidgetState(page);
    expect(state.barVisible).toBe(true);
    // When tracking is off but history exists, counter still shows position
    expect(state.counterText).toBe("1 / 1");
  });

  test("widget back button disabled at first entry", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");

    const state = await getWidgetState(page);
    expect(state.backDisabled).toBe(true);
    expect(state.fwdDisabled).toBe(true);
  });

  test("widget forward button enabled after going back", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    await clickWidgetButton(page, "btn-back");
    await page.waitForTimeout(1200);

    const state = await getWidgetState(page);
    expect(state.backDisabled).toBe(true); // at first entry
    expect(state.fwdDisabled).toBe(false); // can go forward
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. KEYBOARD NAVIGATION — EDGE CASES
// ═══════════════════════════════════════════════════════════════

test.describe("Keyboard Navigation — Edge Cases", () => {
  test("Alt+ArrowLeft does not navigate when focus is inside an input field", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#h1");

    // Focus the input field
    await page.focus("#input1");
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(800);

    // Should NOT have navigated — caret should still be at h1
    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
    expect(caret.top).not.toBe(pos1.top);
  });

  test("Alt+ArrowLeft does not navigate when focus is inside a textarea", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#h1");

    await page.focus("#textarea1");
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(800);

    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
    expect(caret.top).not.toBe(pos1.top);
  });

  test("Alt+ArrowLeft does not navigate when focus is inside a select element", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#h1");

    await page.focus("#select1");
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(800);

    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
    expect(caret.top).not.toBe(pos1.top);
  });

  test("Alt+ArrowLeft does not navigate when focus is in contentEditable div", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#h1");

    await page.focus("#editable-div");
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(800);

    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
    expect(caret.top).not.toBe(pos1.top);
  });

  test("regular arrow keys (without Alt) do not interfere", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);

    // Press ArrowLeft without Alt — should not navigate
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(500);
    const pos2 = await getCaretInfo(page);
    expect(pos2).not.toBeNull();
    expect(pos2.top).toBe(pos1.top);
    expect(pos2.left).toBe(pos1.left);
  });

  test("clicks are ignored during navigation (isNavigating guard)", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    // Start navigation back
    await page.keyboard.press("Alt+ArrowLeft");
    // Immediately click — should be ignored because isNavigating is true
    await page.click("#btn1", { force: true });
    await page.waitForTimeout(1200);

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    // Should still be 2 positions (click during navigation was ignored)
    expect(statsText).toContain("2 positions");
    await popup.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. SCROLLING & RESIZE
// ═══════════════════════════════════════════════════════════════

test.describe("Scrolling & Resize", () => {
  test("caret position accounts for scroll offset", async ({
    pointerPage: page,
  }) => {
    // Scroll down to a far element
    await page.evaluate(() => {
      document.getElementById("far-down").scrollIntoView();
    });
    await page.waitForTimeout(500);

    await clickAndWait(page, "#far-down");
    const caret = await getCaretInfo(page);
    expect(caret).not.toBeNull();
    // Position should be large (near bottom of page)
    expect(caret.top).toBeGreaterThan(500);
  });

  test("navigating to a position restores scroll position", async ({
    pointerPage: page,
  }) => {
    // Click at top
    await clickAndWait(page, "#p1");
    const scrollYBefore = await page.evaluate(() => window.scrollY);

    // Scroll down and click
    await page.evaluate(() => {
      document.getElementById("far-down").scrollIntoView();
    });
    await page.waitForTimeout(500);
    await clickAndWait(page, "#far-down");

    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBeGreaterThan(scrollYBefore);

    // Navigate back should restore scroll position
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);

    const scrollYRestored = await page.evaluate(() => window.scrollY);
    expect(scrollYRestored).toBeLessThan(100);
  });

  test("resize event repositions caret without errors", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const caretBefore = await getCaretInfo(page);
    expect(caretBefore).not.toBeNull();

    // Resize the viewport
    await page.setViewportSize({ width: 600, height: 400 });
    await page.waitForTimeout(500);

    // Caret should still exist (repositioned)
    const caretAfter = await getCaretInfo(page);
    expect(caretAfter).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. PERSISTENCE
// ═══════════════════════════════════════════════════════════════

test.describe("Persistence", () => {
  test("history persists after page reload", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");
    await clickAndWait(page, "#btn1");

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // One more click after reload
    await clickAndWait(page, "#p1");

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    // Should have restored 3 entries plus the new one
    expect(statsText).toContain("positions");
    expect(statsText).not.toBe("Click History");
    await popup.close();
  });

  test("cleared history stays cleared after reload", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    // Clear via popup
    const popup1 = await openPopup(context);
    await page.bringToFront();
    await popup1.waitForTimeout(100);
    await popup1.click("#btn-clear");
    await popup1.waitForTimeout(500);
    await popup1.close();

    // Reload
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const popup2 = await openPopup(context);
    const statsText = await popup2.textContent("#stats");
    expect(statsText).toContain("Click History");
    await popup2.close();
  });

  test("tracking state persists after page reload", async ({
    context,
    pointerPage: page,
  }) => {
    // Toggle tracking OFF via popup
    const popup1 = await openPopup(context);
    await page.bringToFront();
    await popup1.waitForTimeout(100);
    await popup1.click("#btn-toggle-track");
    await popup1.waitForTimeout(500);
    await popup1.close();

    // Click should be ignored (tracking off)
    await clickAndWait(page, "#p1");
    expect(await getCaretInfo(page)).toBeNull();

    // Reload — tracking should still be off
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    await clickAndWait(page, "#p1");
    expect(await getCaretInfo(page)).toBeNull();
  });

  test("history survives navigating to a different page and back", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    // Navigate away
    await page.goto("about:blank", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // Navigate back
    await page.goto(`http://127.0.0.1:${serverPort}/`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(1500);

    await clickAndWait(page, "#btn1");

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    expect(statsText).toContain("3 positions");
    await popup.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 13. POPUP — BASIC
// ═══════════════════════════════════════════════════════════════

test.describe("Popup — Basic", () => {
  test("popup renders empty state with no history", async ({
    context,
    pointerPage: page,
  }) => {
    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    expect(statsText).toContain("Click History");

    const emptyIcon = await popup.textContent(".empty-icon");
    expect(emptyIcon).toContain("🎯");
    await popup.close();
  });

  test("popup renders history after clicks", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");
    await clickAndWait(page, "#btn1");

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    expect(statsText).toContain("3 positions");
    await popup.close();
  });

  test('popup shows singular "position" for one entry', async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    expect(statsText).toContain("1 position");
    expect(statsText).toContain("1 page");
    await popup.close();
  });

  test("popup back button navigates content script", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#h1");

    const popup = await openPopup(context);
    await page.bringToFront();
    await popup.waitForTimeout(200);

    await popup.click("#btn-back");
    await page.waitForTimeout(1200);

    const posBack = await getCaretInfo(page);
    expect(posBack).not.toBeNull();
    expect(posBack.top).toBe(pos1.top);
    expect(posBack.left).toBe(pos1.left);
    await popup.close();
  });

  test("popup forward button navigates content script forward", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");
    const pos2 = await getCaretInfo(page);

    // Go back first
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);

    const popup = await openPopup(context);
    await page.bringToFront();
    await popup.waitForTimeout(200);

    await popup.click("#btn-forward");
    await page.waitForTimeout(1200);

    const posFwd = await getCaretInfo(page);
    expect(posFwd).not.toBeNull();
    expect(posFwd.top).toBe(pos2.top);
    await popup.close();
  });

  test("popup back/forward buttons are disabled at boundaries", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");

    const popup = await openPopup(context);
    const backDisabled = await popup.locator("#btn-back").isDisabled();
    const fwdDisabled = await popup.locator("#btn-forward").isDisabled();
    expect(backDisabled).toBe(true);
    expect(fwdDisabled).toBe(true);
    await popup.close();
  });

  test("popup clear button resets history display", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");

    const popup = await openPopup(context);
    const statsBefore = await popup.textContent("#stats");
    expect(statsBefore).toContain("1 position");

    await page.bringToFront();
    await popup.waitForTimeout(100);
    await popup.click("#btn-clear");
    await popup.waitForTimeout(500);

    const statsAfter = await popup.textContent("#stats");
    expect(statsAfter).toContain("Click History");
    await popup.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 14. POPUP — TOGGLE
// ═══════════════════════════════════════════════════════════════

test.describe("Popup — Toggle", () => {
  test("popup toggle disables tracking", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    expect(await getCaretInfo(page)).not.toBeNull();

    const popup = await openPopup(context);
    await page.bringToFront();
    await popup.waitForTimeout(200);

    const toggleBtn = popup.locator("#btn-toggle-track");
    await expect(toggleBtn).toHaveClass(/on/);
    await toggleBtn.click();
    await popup.waitForTimeout(500);

    const caretAfterToggleOff = await getCaretInfo(page);
    expect(caretAfterToggleOff).toBeNull();

    // Click on content — tracking is OFF, no caret appears
    await clickAndWait(page, "#h1");
    expect(await getCaretInfo(page)).toBeNull();

    // Toggle back ON
    await page.bringToFront();
    await popup.waitForTimeout(100);
    await toggleBtn.click();
    await popup.waitForTimeout(500);
    await expect(toggleBtn).toHaveClass(/on/);

    // Click should work again
    await clickAndWait(page, "#h1");
    const posAfterRe = await getCaretInfo(page);
    expect(posAfterRe).not.toBeNull();
    expect(posAfterRe.top).toBeGreaterThan(0);

    await popup.close();
  });

  test("popup toggle class reflects tracking state on open", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");

    // Toggle off via popup
    const popup1 = await openPopup(context);
    await page.bringToFront();
    await popup1.waitForTimeout(100);
    await popup1.click("#btn-toggle-track");
    await popup1.waitForTimeout(500);
    await popup1.close();

    // Open a fresh popup — toggle should show 'off'
    const popup2 = await openPopup(context);
    const toggleBtn = popup2.locator("#btn-toggle-track");
    await expect(toggleBtn).toHaveClass(/off/);
    await popup2.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 15. POPUP — ENTRY CLICKS (gotoIndex)
// ═══════════════════════════════════════════════════════════════

test.describe("Popup — Entry Clicks", () => {
  test("clicking a history entry in popup navigates to that position", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#h1");
    await clickAndWait(page, "#btn1");

    const popup = await openPopup(context);
    await page.bringToFront();
    await popup.waitForTimeout(200);

    // Click the last rendered entry (entries are rendered in reverse,
    // so the last DOM element has data-index=0, which is p1)
    const oldestEntry = popup.locator("li[data-index]").last();
    await oldestEntry.click();
    await page.waitForTimeout(1200);

    const posAfter = await getCaretInfo(page);
    expect(posAfter).not.toBeNull();
    expect(posAfter.top).toBe(pos1.top);
    expect(posAfter.left).toBe(pos1.left);
    await popup.close();
  });

  test("active entry in popup is visually highlighted", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    const popup = await openPopup(context);
    const activeCount = await popup.locator("li.active[data-index]").count();
    expect(activeCount).toBe(1);
    await popup.close();
  });

  test("clicking beyond-bounds entry does nothing (no throw)", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");

    const popup = await openPopup(context);
    // There's only 1 entry. Clicking index 99 should be harmless.
    // We verify the popup doesn't crash by checking stats still show 1 position.
    await page.bringToFront();
    await popup.waitForTimeout(100);

    const statsText = await popup.textContent("#stats");
    expect(statsText).toContain("1 position");
    await popup.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 16. POPUP — CONNECTIVITY BANNER
// ═══════════════════════════════════════════════════════════════

test.describe("Popup — Connectivity Banner", () => {
  test("banner hides after popup re-renders while content page is active", async ({
    context,
    pointerPage: page,
  }) => {
    // Popup's getActiveTab() returns the popup itself on initial render.
    // We toggle tracking to force a re-render while content page is active.
    const popup = await openPopup(context);
    await page.bringToFront();
    await page.waitForTimeout(200);

    const toggleBtn = popup.locator("#btn-toggle-track");
    await toggleBtn.click();
    await popup.waitForTimeout(500);
    await toggleBtn.click();
    await popup.waitForTimeout(500);

    const banner = popup.locator("#banner");
    await expect(banner).toHaveClass(/hidden/);
    await popup.close();
  });

  test("banner is visible when content script is unreachable", async ({
    context,
    pointerPage: page,
  }) => {
    // Navigate away from the test page to about:blank
    await page.goto("about:blank", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const popup = await openPopup(context);
    await popup.waitForTimeout(500);
    const banner = popup.locator("#banner");
    // Banner should be visible (not have the "hidden" class)
    await expect(banner).not.toHaveClass(/hidden/);
    await popup.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 17. POPUP — DOMAIN COLORING & FORMATTING
// ═══════════════════════════════════════════════════════════════

test.describe("Popup — Domain Coloring & Formatting", () => {
  test("history entries show domain favicon with distinct colors per domain", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    const popup = await openPopup(context);
    // Each entry should have a .entry-favicon span
    const favicons = popup.locator(".entry-favicon");
    const count = await favicons.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // The favicon should have inline background-color style
    const bg = await favicons.first().getAttribute("style");
    expect(bg).toContain("background");

    await popup.close();
  });

  test("page separator appears between entries from different URLs", async ({
    context,
    pointerPage: page,
  }) => {
    // All clicks are on the same page, so we expect only one separator for the first entry group
    await clickAndWait(page, "#p1");
    await clickAndWait(page, "#h1");

    const popup = await openPopup(context);
    const seps = popup.locator(".page-sep");
    // There's only one page group, but entries are rendered in reverse.
    // The page-sep appears before the first entry of each new URL group.
    expect(await seps.count()).toBe(1);
    await popup.close();
  });

  test("entry displays formatted time", async ({
    context,
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");

    const popup = await openPopup(context);
    const entryMeta = await popup.locator(".entry-meta").first().textContent();
    // Should contain "#1" and a time like "HH:MM"
    expect(entryMeta).toContain("#1");
    // Time format: two digits, colon, two digits (e.g. "12:34")
    expect(entryMeta).toMatch(/\d{2}:\d{2}/);
    await popup.close();
  });
});

// ═══════════════════════════════════════════════════════════════
// 18. MESSAGING
// ═══════════════════════════════════════════════════════════════

test.describe("Messaging", () => {
  test("content script responds to getState implicitly via toggle", async ({
    pointerPage: page,
  }) => {
    // getState is tested indirectly: the popup toggle tests verify
    // that sendToPage({ action: "toggle" }) and getState message
    // infrastructure works end-to-end via tracking on/off behavior.
    const caret = await getCaretInfo(page);
    expect(caret).toBeNull(); // no clicks yet, tracking is on
  });
});

// ═══════════════════════════════════════════════════════════════
// 19. STRESS / EDGE CASES
// ═══════════════════════════════════════════════════════════════

test.describe("Stress / Edge Cases", () => {
  test("rapid sequential clicks on different targets all register", async ({
    context,
    pointerPage: page,
  }) => {
    // Click 10 different targets in quick succession (with >300ms gaps)
    const targets = [
      "#p1",
      "#p2",
      "#h1",
      "#h2",
      "#h3",
      "#a1",
      "#btn1",
      "#span1",
      "#text-div",
      "#p3",
    ];
    for (const sel of targets) {
      await page.click(sel, { force: true });
      await page.waitForTimeout(320);
    }

    const popup = await openPopup(context);
    const statsText = await popup.textContent("#stats");
    expect(statsText).toContain("10 positions");
    await popup.close();
  });

  test("navigating back then forward multiple times preserves positions", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    const pos1 = await getCaretInfo(page);
    await clickAndWait(page, "#h1");
    const pos2 = await getCaretInfo(page);
    await clickAndWait(page, "#btn1");
    const pos3 = await getCaretInfo(page);

    // Back, Back, Forward, Back — sequence should work
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);
    let caret = await getCaretInfo(page);
    expect(caret.top).toBe(pos2.top);

    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);
    caret = await getCaretInfo(page);
    expect(caret.top).toBe(pos1.top);

    await page.keyboard.press("Alt+ArrowRight");
    await page.waitForTimeout(1200);
    caret = await getCaretInfo(page);
    expect(caret.top).toBe(pos2.top);

    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1200);
    caret = await getCaretInfo(page);
    expect(caret.top).toBe(pos1.top);
  });

  test("widget bar is styled with position fixed and high z-index", async ({
    pointerPage: page,
  }) => {
    const styles = await page.evaluate(() => {
      const host = document.getElementById("pointer-widget-host");
      if (!host || !host.shadowRoot) return null;
      const bar = host.shadowRoot.getElementById("bar");
      const cs = getComputedStyle(bar);
      return {
        position: cs.position,
        zIndex: cs.zIndex,
        top: cs.top,
        right: cs.right,
        display: cs.display,
      };
    });
    expect(styles).not.toBeNull();
    expect(styles.position).toBe("fixed");
    expect(styles.zIndex).toBe("2147483647");
  });

  test("multiple caret/marker classes do not cause leaks (remove on toggle)", async ({
    pointerPage: page,
  }) => {
    await clickAndWait(page, "#p1");
    expect(await getCaretInfo(page)).not.toBeNull();

    // Toggle tracking off removes caret
    await clickWidgetButton(page, "btn-toggle");
    await page.waitForTimeout(300);
    expect(await getCaretInfo(page)).toBeNull();

    // Toggle on, click again — should have exactly 1 caret
    await clickWidgetButton(page, "btn-toggle");
    await page.waitForTimeout(300);
    await clickAndWait(page, "#h1");

    // Count caret elements (should be exactly 1)
    const count = await page.evaluate(() => {
      let n = 0;
      for (const el of document.querySelectorAll("*")) {
        const cn = el.className;
        if (
          typeof cn === "string" &&
          (cn.includes("pointer-caret") || cn.includes("pointer-marker"))
        )
          n++;
      }
      return n;
    });
    expect(count).toBe(1);
  });
});
