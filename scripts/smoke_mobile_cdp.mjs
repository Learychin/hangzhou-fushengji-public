import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const ROOT = process.cwd();
const PREVIEW_ROOT = path.resolve(ROOT, process.env.MOBILE_PREVIEW_DIR || "web_mvp");
const TARGET_URL_FROM_ENV = process.env.TARGET_URL || "";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const REQUESTED_PORT = Number(process.env.CDP_PORT || 9324);
let PORT = REQUESTED_PORT;
const WIDTH = Number(process.env.MOBILE_WIDTH || 390);
const HEIGHT = Number(process.env.MOBILE_HEIGHT || 844);
const ENTRY_ONLY = process.env.MOBILE_ENTRY_ONLY === "1";
const CAMPAIGN_QA = process.env.MOBILE_CAMPAIGN_QA === "1";
const QA_EXPERIMENT = String(process.env.QA_EXPERIMENT || "").trim();
const OUT_DIR = path.join(ROOT, "reports", "mobile_smoke");
const HOST = "127.0.0.1";
const EXPECTED_VERSION = readGameVersion();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readGameVersion() {
  const raw = fs.readFileSync(path.join(ROOT, "src", "engine", "game-engine.js"), "utf8");
  const match = raw.match(/GAME_VERSION_CODE\s*=\s*["']([^"']+)["']/);
  if (!match?.[1]) throw new Error("Could not read GAME_VERSION_CODE from src/engine/game-engine.js");
  return match[1];
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function findFreePort() {
  if (REQUESTED_PORT > 0) return REQUESTED_PORT;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, HOST, () => {
      const address = server.address();
      const picked = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(picked));
    });
    server.on("error", reject);
  });
}

function sendNotFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function serveStaticRequest(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${HOST}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PREVIEW_ROOT, relativePath);

  if (filePath !== PREVIEW_ROOT && !filePath.startsWith(`${PREVIEW_ROOT}${path.sep}`)) {
    sendNotFound(res);
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendNotFound(res);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serveStaticRequest);
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close();
        reject(new Error("Could not determine local static server port"));
        return;
      }
      resolve({
        url: `http://${HOST}:${address.port}/`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  return res.json();
}

async function waitForPageTarget() {
  const base = `http://${HOST}:${PORT}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    if (launchError) throw launchError;
    if (chromeExit) {
      throw new Error(`Chrome exited before DevTools was ready: code ${chromeExit.code}, signal ${chromeExit.signal}`);
    }
    try {
      let pages = await fetchJson(`${base}/json/list`);
      let page = pages.find((x) => x.type === "page");
      if (!page) {
        await fetchJson(`${base}/json/new?about:blank`, { method: "PUT" });
        pages = await fetchJson(`${base}/json/list`);
        page = pages.find((x) => x.type === "page");
      }
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (_error) {
      await sleep(120);
    }
  }
  throw new Error("Timed out waiting for Chrome DevTools page target");
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    if (typeof WebSocket !== "function") {
      throw new Error("This Node runtime does not provide a global WebSocket");
    }
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) {
        this.events.push(msg);
        if (this.events.length > 80) this.events = this.events.slice(-80);
        return;
      }
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}: ${msg.error.data || ""}`));
      else resolve(msg.result || {});
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 8000);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }

  recentDiagnostics() {
    return this.events
      .filter((event) => event.method === "Runtime.exceptionThrown" || event.method === "Log.entryAdded")
      .slice(-8)
      .map((event) => {
        if (event.method === "Runtime.exceptionThrown") {
          const details = event.params?.exceptionDetails || {};
          return {
            method: event.method,
            text: details.text,
            exception: details.exception?.description || details.exception?.value || "",
            url: details.url,
            lineNumber: details.lineNumber,
            columnNumber: details.columnNumber,
          };
        }
        return {
          method: event.method,
          level: event.params?.entry?.level,
          text: event.params?.entry?.text,
          url: event.params?.entry?.url,
          lineNumber: event.params?.entry?.lineNumber,
        };
      });
  }
}

async function evaluate(cdp, expression) {
  const res = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return res.result?.value;
}

async function waitForReady(cdp) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const ready = await evaluate(cdp, `document.readyState === "complete"
      && Boolean(document.getElementById("startConfirmBtn"))
      && Boolean(document.getElementById("actionOpportunityBtn"))
      && Boolean(document.getElementById("thumbActionBtn"))
      && document.body.classList.contains("mobile-ui")`);
    if (ready) return;
    await sleep(120);
  }
  const diagnostics = await evaluate(cdp, `(() => ({
    readyState: document.readyState,
    bodyClass: document.body?.className || "",
    hasEngine: Boolean(globalThis.HZFSJEngine),
    hasGame: typeof game !== "undefined",
    hasStartConfirmBtn: Boolean(document.getElementById("startConfirmBtn")),
    hasActionOpportunityBtn: Boolean(document.getElementById("actionOpportunityBtn")),
    hasThumbActionBtn: Boolean(document.getElementById("thumbActionBtn")),
    scriptCount: document.scripts.length,
    title: document.title,
  }))()`);
  throw new Error(`Timed out waiting for game page readiness: ${JSON.stringify({ ...diagnostics, cdp: cdp.recentDiagnostics() })}`);
}

async function waitFor(cdp, expression, label, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(cdp.recentDiagnostics())}`);
}

async function collectPwaMetrics(cdp) {
  return evaluate(cdp, `(() => {
    if (!("serviceWorker" in navigator) || !("caches" in window)) {
      return Promise.resolve({ supported: false });
    }
    return navigator.serviceWorker.ready.then(async (registration) => {
      const cacheNames = await caches.keys();
      const shellCache = cacheNames.find((name) => name.startsWith("bfsj-shell")) || "";
      let cachedAssets = [];
      if (shellCache) {
        const cache = await caches.open(shellCache);
        const requests = await cache.keys();
        cachedAssets = requests.map((request) => new URL(request.url).pathname.split("/").pop() || "/");
      }
      return {
        supported: true,
        scope: registration.scope,
        active: Boolean(registration.active),
        controller: Boolean(navigator.serviceWorker.controller),
        cacheNames,
        shellCache,
        cachedAssets,
      };
    });
  })()`);
}

async function screenshot(cdp, filePath) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(filePath, Buffer.from(data, "base64"));
}

function launchChrome() {
  const profile = path.join("/private/tmp", `hzfsj_cdp_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-extensions",
    "--disable-sync",
    "--hide-scrollbars",
    `--remote-debugging-address=${HOST}`,
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "about:blank",
  ];
  const child = spawn(CHROME, args, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.profile = profile;
  return child;
}

async function collectMetrics(cdp) {
  return evaluate(cdp, `(() => {
    const rectOf = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        id,
        className: el.className || "",
        text: (el.innerText || el.textContent || "").trim().slice(0, 80),
        display: s.display,
        visibility: s.visibility,
        disabled: Boolean(el.disabled),
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        width: Math.round(r.width),
        height: Math.round(r.height),
        visible: r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden",
      };
    };
    const ids = [
      "mobileStatusStrip",
      "opportunityStrip",
      "actionOpportunityCard",
      "buyOpportunityCard",
      "sellOpportunityCard",
      "actionOpportunityBtn",
      "buyOpportunityBtn",
      "sellOpportunityBtn",
      "mobileTradeDock",
      "thumbActionDock",
      "thumbActionKicker",
      "thumbActionTitle",
      "thumbActionMeta",
      "thumbActionWhy",
      "thumbActionBtn",
      "quickTravelBtn",
      "quickExpandBtn",
      "mobileTabTrade",
      "mobileTabStatus",
      "marketPanel",
      "opsPanel",
      "invPanel",
      "placeDock",
      "startModal",
      "startConfirmBtn",
      "endModal",
      "endSummaryBody",
      "endReplayBtn",
      "endSaveBtn",
      "endSkipBtn",
      "guestSaveModal",
      "guestNicknameInput",
      "guestSaveSubmitBtn",
      "guestSaveCancelBtn",
    ];
    const rects = Object.fromEntries(ids.map((id) => [id, rectOf(id)]));
    const visualCards = Array.from(document.querySelectorAll(".opportunity-card"))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.id,
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height),
          text: el.innerText.trim().slice(0, 80),
        };
      })
      .sort((a, b) => (a.top - b.top) || (a.left - b.left));
    const opportunityLayout = (() => {
      const strip = document.getElementById("opportunityStrip");
      const primary = document.getElementById("actionOpportunityCard");
      if (!strip || !primary) return null;
      const stripRect = strip.getBoundingClientRect();
      const primaryRect = primary.getBoundingClientRect();
      const cards = Array.from(strip.querySelectorAll(".opportunity-card")).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.id,
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height),
          visibleWidth: Math.round(Math.min(r.right, window.innerWidth, stripRect.right) - Math.max(r.left, 0, stripRect.left)),
          visibleHeight: Math.round(Math.min(r.bottom, window.innerHeight, stripRect.bottom) - Math.max(r.top, 0, stripRect.top)),
        };
      });
      return {
        strip: {
          left: Math.round(stripRect.left),
          right: Math.round(stripRect.right),
          width: Math.round(stripRect.width),
          scrollWidth: strip.scrollWidth,
          clientWidth: strip.clientWidth,
        },
        primaryFullRow: primaryRect.width >= stripRect.width - 16,
        cards,
      };
    })();
    const touchIds = ["thumbActionBtn", "actionOpportunityBtn", "buyOpportunityBtn", "sellOpportunityBtn", "quickTravelBtn", "quickExpandBtn", "mobileTabTrade", "mobileTabStatus", "startConfirmBtn", "endReplayBtn", "endSaveBtn", "endSkipBtn", "guestNicknameInput", "guestSaveSubmitBtn", "guestSaveCancelBtn"];
    const smallTouchTargets = touchIds
      .map((id) => rects[id])
      .filter((r) => r && r.visible && (r.height < 44 || r.width < 44))
      .map((r) => ({ id: r.id, width: r.width, height: r.height }));
    const goalProgress = (() => {
      const track = document.getElementById("roundGoalProgressTrack");
      const fill = document.getElementById("roundGoalProgressFill");
      if (!track || !fill) return null;
      const trackRect = track.getBoundingClientRect();
      const fillRect = fill.getBoundingClientRect();
      const fillPct = trackRect.width > 0 ? Math.round((fillRect.width / trackRect.width) * 100) : 0;
      return {
        visible: trackRect.width > 0 && trackRect.height > 0,
        ariaNow: Number(track.getAttribute("aria-valuenow")),
        width: Math.round(trackRect.width),
        height: Math.round(trackRect.height),
        fillWidth: Math.round(fillRect.width),
        fillPct,
      };
    })();
    const endModalLayout = (() => {
      const modal = document.getElementById("endModal");
      if (!modal || modal.classList.contains("hidden")) return null;
      const card = modal.querySelector(".summary-card");
      const body = document.getElementById("endSummaryBody");
      const actions = modal.querySelector(".modal-actions");
      const save = document.getElementById("endSaveBtn");
      const skip = document.getElementById("endSkipBtn");
      const replay = document.getElementById("endReplayBtn");
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height),
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
        };
      };
      return {
        card: box(card),
        body: box(body),
        actions: box(actions),
        replay: box(replay),
        save: box(save),
        skip: box(skip),
        bodyScrollable: Boolean(body && body.scrollHeight > body.clientHeight + 8),
        secondarySameRow: Boolean(save && skip && Math.abs(save.getBoundingClientRect().top - skip.getBoundingClientRect().top) <= 2),
        secondaryTextFits: Boolean(save && skip && save.scrollWidth <= save.clientWidth + 2 && skip.scrollWidth <= skip.clientWidth + 2),
      };
    })();
    return {
      bodyClass: document.body.className,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: {
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      },
      dayText: document.getElementById("dayText")?.textContent || "",
      paceText: document.getElementById("roundPaceText")?.textContent || "",
      progressText: document.getElementById("roundProgressText")?.textContent || "",
      cash: document.getElementById("mobileTopCash")?.textContent || "",
      goalText: document.getElementById("roundGoalText")?.textContent || "",
      bountyText: document.getElementById("roundBountyText")?.textContent || "",
      streakText: document.getElementById("roundStreakText")?.textContent || "",
      goalProgress,
      opportunityFirstCard: visualCards[0]?.id || null,
      actionTitle: document.getElementById("actionOpportunityTitle")?.textContent || "",
      thumbKicker: document.getElementById("thumbActionKicker")?.textContent || "",
      thumbTitle: document.getElementById("thumbActionTitle")?.textContent || "",
      thumbWhy: document.getElementById("thumbActionWhy")?.textContent || "",
      actionButton: document.getElementById("actionOpportunityBtn")?.textContent || "",
      thumbButton: document.getElementById("thumbActionBtn")?.textContent || "",
      endSummary: document.getElementById("endSummaryBody")?.innerText || "",
      opportunityCards: visualCards,
      opportunityLayout,
      rects,
      smallTouchTargets,
      endModalLayout,
      mobileCapabilities: {
        viewport: document.querySelector('meta[name="viewport"]')?.content || "",
        themeColor: document.querySelector('meta[name="theme-color"]')?.content || "",
        manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") || "",
        appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content || "",
        appIcon: document.querySelector('link[rel="icon"]')?.getAttribute("href") || "",
        iconLinks: [...document.querySelectorAll('link[rel="icon"]')].map((link) => link.getAttribute("href") || ""),
        appleTouchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") || "",
        bodyTouchAction: getComputedStyle(document.body).touchAction,
        thumbTouchAction: getComputedStyle(document.getElementById("thumbActionBtn")).touchAction,
        tapHighlight: getComputedStyle(document.body).webkitTapHighlightColor,
      },
    };
  })()`);
}

function assertMetrics(metrics) {
  const problems = [];
  const usesGridTradeUi = String(metrics.bodyClass || "").includes("mobile-view-market")
    && !metrics.rects.opportunityStrip?.visible;
  if (!String(metrics.bodyClass || "").includes("mobile-ui")) problems.push("body did not enter mobile-ui mode");
  if (!usesGridTradeUi && !String(metrics.bodyClass || "").includes("mobile-view-trade")) {
    problems.push("body did not enter a mobile market view");
  }
  if (metrics.scroll.overflowX > 2) problems.push(`page has horizontal overflow: ${metrics.scroll.overflowX}px`);
  if (!metrics.paceText.includes("已用") && !metrics.paceText.includes("本局用时")) problems.push(`pace text is not live: ${metrics.paceText || "empty"}`);
  if (!metrics.goalText.includes("下一档") && !metrics.goalText.includes("先回正") && !metrics.goalText.includes("本局评级")) {
    problems.push(`goal text missing or unclear: ${metrics.goalText || "empty"}`);
  }
  if (!metrics.streakText.includes("盈利") && !metrics.streakText.includes("连赚") && !metrics.streakText.includes("最佳") && !metrics.streakText.includes("单笔")) {
    problems.push(`streak text missing or unclear: ${metrics.streakText || "empty"}`);
  }
  if (!metrics.bountyText.includes("本局悬赏") && !metrics.bountyText.includes("悬赏完成")) {
    problems.push(`bounty text missing or unclear: ${metrics.bountyText || "empty"}`);
  }
  if (!usesGridTradeUi && !metrics.goalProgress?.visible) {
    problems.push(`goal progress bar is not visible: ${JSON.stringify(metrics.goalProgress)}`);
  } else if (!usesGridTradeUi && (!Number.isFinite(metrics.goalProgress.ariaNow) || metrics.goalProgress.ariaNow < 0 || metrics.goalProgress.ariaNow > 100)) {
    problems.push(`goal progress aria-valuenow is invalid: ${JSON.stringify(metrics.goalProgress)}`);
  } else if (!usesGridTradeUi && Math.abs(metrics.goalProgress.ariaNow - metrics.goalProgress.fillPct) > 2) {
    problems.push(`goal progress visual width does not match aria value: ${JSON.stringify(metrics.goalProgress)}`);
  }
  if (!metrics.mobileCapabilities.viewport.includes("viewport-fit=cover")) problems.push(`viewport-fit missing: ${metrics.mobileCapabilities.viewport}`);
  if (!metrics.mobileCapabilities.themeColor) problems.push("theme-color meta missing");
  if (!metrics.mobileCapabilities.manifest.includes("manifest.webmanifest")) problems.push(`manifest link missing: ${metrics.mobileCapabilities.manifest}`);
  if (metrics.mobileCapabilities.appleCapable !== "yes") problems.push("apple mobile web app meta missing");
  if (!metrics.mobileCapabilities.appIcon.includes("app-icon.svg")) problems.push(`app icon missing: ${metrics.mobileCapabilities.appIcon}`);
  if (!metrics.mobileCapabilities.iconLinks.includes("./app-icon-192.png")) problems.push(`192 png icon link missing: ${metrics.mobileCapabilities.iconLinks.join(",")}`);
  if (!metrics.mobileCapabilities.appleTouchIcon.includes("app-icon-180.png")) problems.push(`apple touch png icon missing: ${metrics.mobileCapabilities.appleTouchIcon}`);
  if (metrics.mobileCapabilities.bodyTouchAction !== "manipulation") problems.push(`body touch-action is ${metrics.mobileCapabilities.bodyTouchAction}`);
  if (metrics.mobileCapabilities.thumbTouchAction !== "manipulation") problems.push(`thumb touch-action is ${metrics.mobileCapabilities.thumbTouchAction}`);
  if (!usesGridTradeUi && metrics.opportunityFirstCard !== "actionOpportunityCard") problems.push(`primary opportunity card is not first: ${metrics.opportunityFirstCard || "none"}`);
  if (!usesGridTradeUi && !metrics.opportunityLayout?.primaryFullRow) {
    problems.push(`primary opportunity card is not full row: ${JSON.stringify(metrics.opportunityLayout)}`);
  }
  const clippedOpportunityCards = (usesGridTradeUi ? [] : metrics.opportunityLayout?.cards || [])
    .filter((card) => card.visibleWidth < card.width - 2 || card.visibleHeight < card.height - 2);
  if (clippedOpportunityCards.length) {
    problems.push(`opportunity cards clipped: ${JSON.stringify(clippedOpportunityCards)}`);
  }
  if (metrics.actionTitle !== metrics.thumbTitle) problems.push(`thumb title out of sync: ${metrics.thumbTitle} vs ${metrics.actionTitle}`);
  if (metrics.actionButton !== metrics.thumbButton) problems.push(`thumb button out of sync: ${metrics.thumbButton} vs ${metrics.actionButton}`);
  if (!String(metrics.thumbWhy || "").trim()) problems.push("thumb action reason is empty");
  if (metrics.rects.thumbActionWhy?.visible && metrics.rects.thumbActionWhy.height < 10) {
    problems.push(`thumb action reason collapsed: ${metrics.rects.thumbActionWhy.width}x${metrics.rects.thumbActionWhy.height}`);
  }
  if (metrics.smallTouchTargets.length) {
    problems.push(`small touch targets: ${metrics.smallTouchTargets.map((x) => `${x.id} ${x.width}x${x.height}`).join(", ")}`);
  }
  const visibleSurfaceIds = usesGridTradeUi
    ? ["mobileStatusStrip", "placeDock", "marketPanel", "invPanel", "mobileTradeDock"]
    : ["mobileStatusStrip", "opportunityStrip", "thumbActionDock", "thumbActionBtn", "marketPanel", "opsPanel", "invPanel"];
  for (const id of visibleSurfaceIds) {
    if (!metrics.rects[id]?.visible) problems.push(`${id} is not visible`);
  }
  if (problems.length) throw new Error(problems.join("; "));
}

async function runCampaignQa(cdp, artifacts) {
  await waitFor(cdp, `Boolean(window.BFSJ_PLATFORM?.runtime?.initialized) && window.BFSJ_PLATFORM.runtime.campaigns.length === 3`, "local campaign fixtures");
  const initial = await evaluate(cdp, `(() => ({
    modalVisible: Boolean(document.getElementById("campaignModal") && !document.getElementById("campaignModal").classList.contains("hidden")),
    campaigns: window.BFSJ_PLATFORM.runtime.campaigns.map((item) => item.id),
    economy: { cash: game.cash, debt: game.debt, bank: game.bank, items: game.totalItems, coat: game.coat, timeLeft: game.timeLeft },
  }))()`);
  if (initial.modalVisible) throw new Error("campaign appeared immediately after start");

  const productTarget = await evaluate(cdp, `(() => {
    const goods = game.market[0];
    const campaign = window.BFSJ_PLATFORM.runtime.campaigns.find((item) => item.id === "qa_product_drink");
    if (!goods || !campaign) return null;
    campaign.target_entity_key = String(goods.id);
    campaign.payload = { ...(campaign.payload || {}), goods_id: goods.id };
    const rows = [...document.querySelectorAll("#marketTable tbody tr")];
    const row = rows.find((item) => item.textContent.includes(goods.name));
    row?.click();
    return { clicked: Boolean(row), goodsId: goods.id, goodsName: goods.name };
  })()`);
  if (!productTarget?.clicked) throw new Error(`could not select the campaign product: ${JSON.stringify(productTarget)}`);
  await waitFor(cdp, `document.getElementById("productSponsorSlot")?.dataset.placement === "product"`, "product campaign slot");
  const productSlot = await evaluate(cdp, `(() => ({
    text: document.getElementById("productSponsorSlot")?.textContent || "",
    repeatEligible: Boolean(window.BFSJ_PLATFORM.pickCampaign("product", { goods_id: ${JSON.stringify(productTarget.goodsId)} })),
    economy: { cash: game.cash, debt: game.debt, bank: game.bank, items: game.totalItems, coat: game.coat, timeLeft: game.timeLeft },
  }))()`);
  if (!productSlot.text.startsWith("合作内容 · ")) throw new Error(`product disclosure is unclear: ${productSlot.text}`);
  if (productSlot.repeatEligible) throw new Error("product frequency cap did not apply after impression");
  if (JSON.stringify(productSlot.economy) !== JSON.stringify(initial.economy)) throw new Error("product campaign changed the economy");
  await evaluate(cdp, `document.getElementById("productSponsorSlot")?.click(); true`);
  await waitFor(cdp, `!document.getElementById("campaignModal")?.classList.contains("hidden")`, "product campaign modal");
  const productModal = await evaluate(cdp, `({
    disclosure: document.getElementById("campaignDisclosureLabel")?.textContent || "",
    title: document.getElementById("campaignTitle")?.textContent || "",
    actionVisible: !document.getElementById("campaignActionBtn")?.classList.contains("hidden"),
  })`);
  if (productModal.disclosure !== "合作内容" || !productModal.title.includes("气泡水") || !productModal.actionVisible) {
    throw new Error(`product modal is incomplete: ${JSON.stringify(productModal)}`);
  }
  await screenshot(cdp, artifacts.campaignProduct);
  await evaluate(cdp, `document.getElementById("campaignCloseBtn")?.click(); true`);

  const beforeTravel = await evaluate(cdp, `({ cash: game.cash, debt: game.debt, bank: game.bank, items: game.totalItems, coat: game.coat, timeLeft: game.timeLeft })`);
  await evaluate(cdp, `travelToLocation(2); true`);
  await waitFor(cdp, `document.getElementById("productSponsorSlot")?.dataset.placement === "location"`, "location campaign slot");
  const locationSlot = await evaluate(cdp, `(() => ({
    text: document.getElementById("productSponsorSlot")?.textContent || "",
    currentLoc: game.currentLoc,
    economy: { cash: game.cash, debt: game.debt, bank: game.bank, items: game.totalItems, coat: game.coat, timeLeft: game.timeLeft },
  }))()`);
  if (!locationSlot.text.startsWith("合作内容 · ") || locationSlot.currentLoc !== 2) {
    throw new Error(`location campaign target failed: ${JSON.stringify(locationSlot)}`);
  }
  if (locationSlot.economy.timeLeft !== beforeTravel.timeLeft - 1) throw new Error("location travel did not consume exactly one day");
  await evaluate(cdp, `document.getElementById("productSponsorSlot")?.click(); true`);
  await waitFor(cdp, `document.getElementById("campaignTitle")?.textContent.includes("灵隐")`, "location campaign modal");
  await screenshot(cdp, artifacts.campaignLocation);
  await evaluate(cdp, `document.getElementById("campaignCloseBtn")?.click(); true`);
  const afterLocation = await evaluate(cdp, `({ cash: game.cash, debt: game.debt, bank: game.bank, items: game.totalItems, coat: game.coat, timeLeft: game.timeLeft })`);
  if (JSON.stringify(afterLocation) !== JSON.stringify(locationSlot.economy)) throw new Error("opening location campaign changed the economy");

  await evaluate(cdp, `pendingNewsCampaignContext = { day: game.daysUsed, trigger: "market_news" }; modalQueue = []; showNextModal(); true`);
  await waitFor(cdp, `document.getElementById("campaignTitle")?.textContent.includes("排队系统")`, "news campaign after market news");
  const newsModal = await evaluate(cdp, `({
    disclosure: document.getElementById("campaignDisclosureLabel")?.textContent || "",
    title: document.getElementById("campaignTitle")?.textContent || "",
    body: document.getElementById("campaignBody")?.textContent || "",
  })`);
  if (newsModal.disclosure !== "合作内容" || !newsModal.body.includes("查询排队进度")) {
    throw new Error(`news campaign is incomplete: ${JSON.stringify(newsModal)}`);
  }
  await screenshot(cdp, artifacts.campaignNews);
  await evaluate(cdp, `document.getElementById("campaignCloseBtn")?.click(); true`);

  const final = await evaluate(cdp, `(() => ({
    economy: { cash: game.cash, debt: game.debt, bank: game.bank, items: game.totalItems, coat: game.coat, timeLeft: game.timeLeft },
    events: window.BFSJ_PLATFORM.runtime.campaignEvents.map((event) => ({ id: event.campaign_id, type: event.event_type, metadata: event.metadata })),
    caps: JSON.parse(localStorage.getItem("bfsj_campaign_caps_v1") || "{}"),
    modalVisible: Boolean(document.getElementById("campaignModal") && !document.getElementById("campaignModal").classList.contains("hidden")),
  }))()`);
  if (JSON.stringify(final.economy) !== JSON.stringify(afterLocation)) throw new Error("news campaign changed the economy");
  if (final.modalVisible) throw new Error("campaign modal stayed open after dismissal");
  for (const id of ["qa_product_drink", "qa_location_lingyin", "qa_news_queue"]) {
    const events = final.events.filter((event) => event.id === id).map((event) => event.type);
    if (!events.includes("eligible") || !events.includes("impression") || !events.includes("dismiss")) {
      throw new Error(`campaign events incomplete for ${id}: ${events.join(",")}`);
    }
  }
  fs.writeFileSync(artifacts.campaignReport, JSON.stringify({ targetUrl, viewport: { width: WIDTH, height: HEIGHT }, initial, productSlot, productModal, locationSlot, newsModal, final }, null, 2));
  console.log(`Campaign delivery smoke passed: ${WIDTH}x${HEIGHT}`);
  console.log(`Campaign report: ${artifacts.campaignReport}`);
  console.log(`Campaign screenshots: ${artifacts.campaignProduct}, ${artifacts.campaignLocation}, ${artifacts.campaignNews}`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const runStamp = stamp();
const artifacts = {
  startModal: path.join(OUT_DIR, `${runStamp}_start_modal.png`),
  afterStart: path.join(OUT_DIR, `${runStamp}_after_start.png`),
  afterAction: path.join(OUT_DIR, `${runStamp}_after_action.png`),
  afterSecondAction: path.join(OUT_DIR, `${runStamp}_after_second_action.png`),
  afterFlow: path.join(OUT_DIR, `${runStamp}_after_flow.png`),
  afterRestore: path.join(OUT_DIR, `${runStamp}_after_restore.png`),
  afterProfit: path.join(OUT_DIR, `${runStamp}_after_profit.png`),
  afterRepay: path.join(OUT_DIR, `${runStamp}_after_repay.png`),
  afterExpand: path.join(OUT_DIR, `${runStamp}_after_expand.png`),
  afterEnd: path.join(OUT_DIR, `${runStamp}_after_end.png`),
  afterReplay: path.join(OUT_DIR, `${runStamp}_after_replay.png`),
  campaignProduct: path.join(OUT_DIR, `${runStamp}_campaign_product.png`),
  campaignLocation: path.join(OUT_DIR, `${runStamp}_campaign_location.png`),
  campaignNews: path.join(OUT_DIR, `${runStamp}_campaign_news.png`),
  campaignReport: path.join(OUT_DIR, `${runStamp}_campaign_report.json`),
  report: path.join(OUT_DIR, `${runStamp}_report.json`),
};

let targetUrl = TARGET_URL_FROM_ENV;
let staticServer = null;
if (!targetUrl) {
  staticServer = await startStaticServer();
  targetUrl = staticServer.url;
}
if (QA_EXPERIMENT) {
  const url = new URL(targetUrl);
  url.searchParams.set("qa_experiment", QA_EXPERIMENT);
  targetUrl = url.href;
}
if (CAMPAIGN_QA) {
  const url = new URL(targetUrl);
  url.searchParams.set("qa_campaigns", "1");
  targetUrl = url.href;
}

PORT = await findFreePort();
const chrome = launchChrome();
let cdp;
let stderr = "";
let launchError = null;
let chromeExit = null;
chrome.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});
chrome.on("error", (error) => {
  launchError = error;
});
chrome.on("exit", (code, signal) => {
  chromeExit = { code, signal };
});

try {
  const wsUrl = await waitForPageTarget();
  if (launchError) throw launchError;
  if (chromeExit) throw new Error(`Chrome exited before DevTools was ready: code ${chromeExit.code}, signal ${chromeExit.signal}`);
  cdp = new CDP(wsUrl);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp.send("Page.navigate", { url: targetUrl });
  await waitForReady(cdp);
  if (ENTRY_ONLY) {
    const entryMetrics = await evaluate(cdp, `(() => ({
      version: typeof GAME_VERSION_CODE === "string" ? GAME_VERSION_CODE : "",
      hasEngine: Boolean(globalThis.HZFSJEngine),
      bodyClass: document.body.className,
      startVisible: Boolean(document.getElementById("startModal") && !document.getElementById("startModal").classList.contains("hidden")),
      marketRows: document.querySelectorAll("#marketTable tbody tr").length,
      inventoryRows: document.querySelectorAll("#invTable tbody tr").length,
      mobileCash: document.getElementById("mobileTopCash")?.textContent || "",
    }))()`);
    if (!entryMetrics.hasEngine) throw new Error("entry smoke missing HZFSJEngine");
    if (entryMetrics.version !== EXPECTED_VERSION) throw new Error(`entry smoke version mismatch: ${JSON.stringify(entryMetrics)}`);
    if (!entryMetrics.bodyClass.includes("mobile-ui")) throw new Error(`entry smoke did not enter mobile UI: ${JSON.stringify(entryMetrics)}`);
    if (!entryMetrics.startVisible) throw new Error(`entry smoke missing start modal: ${JSON.stringify(entryMetrics)}`);
    await screenshot(cdp, artifacts.startModal);
    console.log(`Mobile entry smoke passed: ${WIDTH}x${HEIGHT}, ${EXPECTED_VERSION}`);
    console.log(`Screenshot: ${artifacts.startModal}`);
    throw new Error("__MOBILE_ENTRY_ONLY_DONE__");
  }
  const startBriefText = await evaluate(cdp, `document.querySelector("#startModal .start-brief")?.innerText || ""`);
  if (!startBriefText.includes("45 天交易局") && !startBriefText.includes("45天交易局")) {
    throw new Error(`start brief missing run framing: ${startBriefText}`);
  }
  if (startBriefText.includes("上榜")) {
    throw new Error(`start brief should not distract first-run players with leaderboard copy: ${startBriefText}`);
  }
  const startGoalText = await evaluate(cdp, `document.getElementById("startGoalCard")?.innerText || ""`);
  if (startGoalText) {
    if (!startGoalText.includes("首局目标") && !startGoalText.includes("本局开跑目标")) {
      throw new Error(`start goal card missing title: ${startGoalText}`);
    }
    if (!startGoalText.includes("45 天") && !startGoalText.includes("本机最佳")) {
      throw new Error(`start goal card missing run target or career stats: ${startGoalText}`);
    }
  }
  const startConfirmRect = await evaluate(cdp, `(() => {
    const el = document.getElementById("startConfirmBtn");
    const card = document.querySelector("#startModal .summary-card");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cardRect = card?.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      width: Math.round(r.width),
      height: Math.round(r.height),
      cardWidth: Math.round(cardRect?.width || 0),
      textFits: el.scrollWidth <= el.clientWidth + 2,
      backgroundColor: s.backgroundColor,
      color: s.color,
      visible: r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden",
      text: el.textContent || "",
    };
  })()`);
  if (!startConfirmRect?.visible) throw new Error("start confirm button is not visible");
  if (startConfirmRect.height < 44) {
    throw new Error(`start confirm button is too small: ${startConfirmRect.width}x${startConfirmRect.height}`);
  }
  if (startConfirmRect.cardWidth && startConfirmRect.width < startConfirmRect.cardWidth * 0.82) {
    throw new Error(`start confirm button should read as the primary full-width CTA: ${JSON.stringify(startConfirmRect)}`);
  }
  if (!startConfirmRect.textFits) {
    throw new Error(`start confirm button text overflows: ${JSON.stringify(startConfirmRect)}`);
  }
  if (!/223,\s*242,\s*230/.test(startConfirmRect.backgroundColor || "")) {
    throw new Error(`start confirm button should match the green primary action style: ${JSON.stringify(startConfirmRect)}`);
  }
  if (!startConfirmRect.text.includes("开始")) {
    throw new Error(`start confirm button should start the run: ${startConfirmRect.text}`);
  }
  await screenshot(cdp, artifacts.startModal);
  await evaluate(cdp, `document.getElementById("startConfirmBtn")?.click(); true`);
  await sleep(300);
  const afterStart = await collectMetrics(cdp);
  const usesGridTradeUi = String(afterStart.bodyClass || "").includes("mobile-view-market")
    && !afterStart.rects.opportunityStrip?.visible;
  assertMetrics(afterStart);
  if (CAMPAIGN_QA) {
    await runCampaignQa(cdp, artifacts);
    throw new Error("__MOBILE_CAMPAIGN_QA_DONE__");
  }
  if (!afterStart.thumbKicker.includes("回正差")) {
    throw new Error(`thumb dock did not surface run goal at start: ${afterStart.thumbKicker}`);
  }
  if (!afterStart.thumbWhy.includes("悬赏")) {
    throw new Error(`thumb action reason did not connect to bounty: ${afterStart.thumbWhy}`);
  }
  const mobileMenuVersion = await evaluate(cdp, `(() => {
    document.getElementById("mobileMenuBtn")?.click();
    const card = document.getElementById("mobileMenuCard");
    const version = document.getElementById("mobileVersionText");
    const cardRect = card?.getBoundingClientRect();
    const versionRect = version?.getBoundingClientRect();
    const visible = Boolean(card && !card.classList.contains("hidden") && versionRect && versionRect.width > 0 && versionRect.height > 0);
    return {
      visible,
      text: version?.textContent || "",
      card: cardRect ? { left: Math.round(cardRect.left), right: Math.round(cardRect.right), width: Math.round(cardRect.width) } : null,
      version: versionRect ? { left: Math.round(versionRect.left), right: Math.round(versionRect.right), width: Math.round(versionRect.width) } : null,
      textFits: version ? version.scrollWidth <= version.clientWidth + 2 : false,
    };
  })()`);
  if (!mobileMenuVersion.visible || !mobileMenuVersion.text.includes(EXPECTED_VERSION)) {
    throw new Error(`mobile menu version is not visible/current: ${JSON.stringify(mobileMenuVersion)}`);
  }
  if (!mobileMenuVersion.textFits) {
    throw new Error(`mobile menu version text overflows: ${JSON.stringify(mobileMenuVersion)}`);
  }
  if (
    mobileMenuVersion.card
    && mobileMenuVersion.version
    && (mobileMenuVersion.version.left < mobileMenuVersion.card.left || mobileMenuVersion.version.right > mobileMenuVersion.card.right)
  ) {
    throw new Error(`mobile menu version escaped card bounds: ${JSON.stringify(mobileMenuVersion)}`);
  }
  await evaluate(cdp, `document.getElementById("mobileMenuBtn")?.click(); true`);
  const pwaMetrics = await collectPwaMetrics(cdp);
  if (!pwaMetrics.supported) throw new Error("service worker or cache storage is not supported in smoke browser");
  if (!pwaMetrics.active) throw new Error("service worker did not become active");
  if (!pwaMetrics.shellCache) throw new Error("app shell cache was not created");
  for (const asset of ["index.html", "styles.css", "main.js", "config.js", "manifest.webmanifest", "app-icon.svg", "app-icon-180.png", "app-icon-192.png", "app-icon-512.png"]) {
    if (!pwaMetrics.cachedAssets.includes(asset)) throw new Error(`app shell cache missing ${asset}`);
  }
  const rapidTapGuard = await evaluate(cdp, `(() => new Promise((resolve) => {
    const before = {
      daysUsed: game.daysUsed,
      timeLeft: game.timeLeft,
      totalItems: game.totalItems,
      cash: game.cash,
    };
    document.getElementById("thumbActionBtn")?.click();
    document.getElementById("thumbActionBtn")?.click();
    setTimeout(() => {
      const during = {
        daysUsed: game.daysUsed,
        timeLeft: game.timeLeft,
        totalItems: game.totalItems,
        cash: game.cash,
        lockClass: document.getElementById("thumbActionDock")?.className || "",
      };
      startNewGameFlow();
      setTimeout(() => resolve({
        before,
        during,
        afterReset: {
          daysUsed: game.daysUsed,
          timeLeft: game.timeLeft,
          totalItems: game.totalItems,
          dayText: document.getElementById("dayText")?.textContent || "",
        },
      }), 80);
    }, 40);
  }))()`);
  if (rapidTapGuard.during.daysUsed !== rapidTapGuard.before.daysUsed || rapidTapGuard.during.timeLeft !== rapidTapGuard.before.timeLeft) {
    throw new Error(`rapid double tap advanced the day flow: ${JSON.stringify(rapidTapGuard)}`);
  }
  if (rapidTapGuard.during.totalItems <= rapidTapGuard.before.totalItems || rapidTapGuard.during.cash >= rapidTapGuard.before.cash) {
    throw new Error(`rapid double tap did not execute the first recommended action cleanly: ${JSON.stringify(rapidTapGuard)}`);
  }
  if (!rapidTapGuard.during.lockClass.includes("action-locked")) {
    throw new Error(`rapid double tap did not show action lock feedback: ${JSON.stringify(rapidTapGuard)}`);
  }
  if (rapidTapGuard.afterReset.daysUsed !== 0 || rapidTapGuard.afterReset.totalItems !== 0 || !rapidTapGuard.afterReset.dayText.includes("0/45")) {
    throw new Error(`rapid tap guard reset failed: ${JSON.stringify(rapidTapGuard)}`);
  }
  await screenshot(cdp, artifacts.afterStart);

  let afterAction = null;
  let afterSecondAction = null;
  let afterFlow = null;
  for (let tap = 1; tap <= 6; tap += 1) {
    await evaluate(cdp, `document.getElementById("thumbActionBtn")?.click(); true`);
    await sleep(tap >= 3 ? 800 : 550);
    const metrics = await collectMetrics(cdp);
    assertMetrics(metrics);
    if (tap === 1) {
      afterAction = metrics;
      await screenshot(cdp, artifacts.afterAction);
    }
    if (tap === 2) {
      afterSecondAction = metrics;
      await screenshot(cdp, artifacts.afterSecondAction);
    }
    afterFlow = metrics;
    if (metrics.dayText !== afterStart.dayText) break;
  }
  if (!afterSecondAction) {
    afterSecondAction = afterAction || afterStart;
    await screenshot(cdp, artifacts.afterSecondAction);
  }
  if (afterFlow.dayText === afterStart.dayText) {
    throw new Error(`primary action did not advance the turn flow within 6 taps: ${afterFlow.dayText}`);
  }
  if (!String(afterAction?.rects?.thumbActionDock?.className || "").includes("thumb-pop")) {
    throw new Error(`thumb action dock did not pulse after primary action: ${afterAction?.rects?.thumbActionDock?.className || "(missing)"}`);
  }
  await screenshot(cdp, artifacts.afterFlow);

  const restoreBefore = await evaluate(cdp, `(() => ({
    daysUsed: game.daysUsed,
    timeLeft: game.timeLeft,
    score: game.score,
    cash: game.cash,
    debt: game.debt,
    profitStreak,
    maxProfitStreak,
    lastTradeFeedbackKey,
    experimentKey: game.experimentKey,
    experimentConfig: JSON.stringify(game.experimentConfig || {}),
    runExperimentKey: window.BFSJ_PLATFORM?.runMeta?.().experiment_key || null,
    sessionId: window.BFSJ_PLATFORM?.runMeta?.().session_id || null,
    storedSessionId: localStorage.getItem("bfsj_platform_session_v1"),
    activeSaved: Boolean(localStorage.getItem("bfsj_active_run_v1")),
  }))()`);
  if (!restoreBefore.activeSaved) throw new Error("active run snapshot was not written before reload");
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForReady(cdp);
  await sleep(600);
  const afterRestore = await collectMetrics(cdp);
  assertMetrics(afterRestore);
  const restoreAfter = await evaluate(cdp, `(() => ({
    daysUsed: game.daysUsed,
    timeLeft: game.timeLeft,
    score: game.score,
    cash: game.cash,
    debt: game.debt,
    profitStreak,
    maxProfitStreak,
    lastTradeFeedbackKey,
    experimentKey: game.experimentKey,
    experimentConfig: JSON.stringify(game.experimentConfig || {}),
    runExperimentKey: window.BFSJ_PLATFORM?.runMeta?.().experiment_key || null,
    sessionId: window.BFSJ_PLATFORM?.runMeta?.().session_id || null,
    storedSessionId: localStorage.getItem("bfsj_platform_session_v1"),
    startVisible: Boolean(document.getElementById("startModal") && !document.getElementById("startModal").classList.contains("hidden")),
    restoredBanner: (document.getElementById("saveSuccessBanner")?.textContent || "").includes("已恢复上次进度"),
  }))()`);
  if (restoreAfter.startVisible) throw new Error("start modal appeared after active run restore");
  for (const key of ["daysUsed", "timeLeft", "score", "cash", "debt"]) {
    if (restoreAfter[key] !== restoreBefore[key]) {
      throw new Error(`active run restore mismatch for ${key}: ${restoreBefore[key]} -> ${restoreAfter[key]}`);
    }
  }
  if (!restoreAfter.restoredBanner) throw new Error("restore banner did not appear after reload");
  for (const key of ["profitStreak", "maxProfitStreak", "lastTradeFeedbackKey"]) {
    if (restoreAfter[key] !== restoreBefore[key]) {
      throw new Error(`active run restore duplicated trade feedback for ${key}: ${restoreBefore[key]} -> ${restoreAfter[key]}`);
    }
  }
  for (const key of ["experimentKey", "experimentConfig", "runExperimentKey", "sessionId", "storedSessionId"]) {
    if (restoreAfter[key] !== restoreBefore[key]) {
      throw new Error(`active run restore changed experiment identity for ${key}: ${restoreBefore[key]} -> ${restoreAfter[key]}`);
    }
  }
  await screenshot(cdp, artifacts.afterRestore);

  const profitFeedback = await evaluate(cdp, `(() => new Promise((resolve) => {
    game.cash = 20000;
    game.bank = 0;
    game.debt = 0;
    game.inv = [{ id: 0, name: game.goods[0].name, buyPrice: 10, count: 10 }];
    game.totalItems = 10;
    game.market = [{ id: 0, name: game.goods[0].name, price: 500, kind: game.goods[0].kind, weight: game.goods[0].weight }];
    game.lastTrade = null;
    lastTradeFeedbackKey = null;
    profitStreak = 0;
    runBestProfit = 0;
    runBestProfitGoods = "";
    render();
    document.getElementById("thumbActionBtn")?.click();
    setTimeout(() => resolve({
      banner: document.getElementById("saveSuccessBanner")?.textContent || "",
      roundClass: document.getElementById("roundProgress")?.className || "",
      streakText: document.getElementById("roundStreakText")?.textContent || "",
      goalText: document.getElementById("roundGoalText")?.textContent || "",
      goalProgress: {
        ariaNow: Number(document.getElementById("roundGoalProgressTrack")?.getAttribute("aria-valuenow")),
        width: document.getElementById("roundGoalProgressFill")?.getBoundingClientRect().width || 0,
      },
    }), 320);
  }))()`);
  if (!profitFeedback.banner.includes("赚了")) throw new Error(`profit feedback did not mention profit: ${profitFeedback.banner}`);
  if (!profitFeedback.banner.includes("距下一档") && !profitFeedback.banner.includes("回正还差")) {
    throw new Error(`profit feedback did not include next target gap: ${profitFeedback.banner}`);
  }
  if (!profitFeedback.roundClass.includes("combo-pop")) throw new Error(`profit feedback did not pulse round progress: ${profitFeedback.roundClass}`);
  if (!profitFeedback.streakText.includes("刚赚") && !profitFeedback.streakText.includes("连赚")) {
    throw new Error(`profit streak text did not update: ${profitFeedback.streakText}`);
  }
  if (
    !Number.isFinite(profitFeedback.goalProgress.ariaNow)
    || profitFeedback.goalProgress.ariaNow <= 0
    || (!usesGridTradeUi && profitFeedback.goalProgress.width <= 0)
  ) {
    throw new Error(`profit did not advance goal progress: ${JSON.stringify(profitFeedback.goalProgress)}`);
  }
  await screenshot(cdp, artifacts.afterProfit);

  const partialRepayBefore = await evaluate(cdp, `(() => {
    game.cash = 6000;
    game.debt = 14000;
    game.inv = [];
    game.totalItems = 0;
    game.timeLeft = 8;
    game.lastTrade = null;
    render();
    return {
      debt: game.debt,
      cash: game.cash,
      daysUsed: game.daysUsed,
      title: document.getElementById("thumbActionTitle")?.textContent || "",
      meta: document.getElementById("thumbActionMeta")?.textContent || "",
      why: document.getElementById("thumbActionWhy")?.textContent || "",
      button: document.getElementById("thumbActionBtn")?.textContent || "",
    };
  })()`);
  if (partialRepayBefore.title !== "先卸掉利息") {
    throw new Error(`partial repay prompt did not surface in thumb dock: ${partialRepayBefore.title}`);
  }
  if (partialRepayBefore.button !== "先还一笔") {
    throw new Error(`partial repay button text mismatch: ${partialRepayBefore.button}`);
  }
  if (!partialRepayBefore.why.includes("还后欠") && !partialRepayBefore.why.includes("压力更轻")) {
    throw new Error(`partial repay reason is unclear: ${partialRepayBefore.why}`);
  }
  await evaluate(cdp, `document.getElementById("thumbActionBtn")?.click(); true`);
  await sleep(300);
  const partialRepayAfter = await evaluate(cdp, `(() => ({
    debt: game.debt,
    cash: game.cash,
  }))()`);
  if (!(partialRepayAfter.debt < partialRepayBefore.debt)) {
    throw new Error(`partial repay did not reduce debt: ${partialRepayBefore.debt} -> ${partialRepayAfter.debt}`);
  }

  const debtBeforeRepay = await evaluate(cdp, `(() => {
    game.cash = Math.max(game.cash, 20000);
    game.debt = 9000;
    game.inv = [];
    game.totalItems = 0;
    game.lastTrade = { type: "sell", pnl: 5000 };
    render();
    return game.debt;
  })()`);
  await sleep(300);
  const afterRepayPrompt = await collectMetrics(cdp);
  assertMetrics(afterRepayPrompt);
  if (afterRepayPrompt.thumbTitle !== "先卸掉利息") {
    throw new Error(`debt repay prompt did not surface in thumb dock: ${afterRepayPrompt.thumbTitle}`);
  }
  if (afterRepayPrompt.thumbButton !== "一键还债") {
    throw new Error(`debt repay button text mismatch: ${afterRepayPrompt.thumbButton}`);
  }
  await evaluate(cdp, `document.getElementById("thumbActionBtn")?.click(); true`);
  await sleep(400);
  const debtAfterRepay = await evaluate(cdp, `game.debt`);
  if (!(debtAfterRepay < debtBeforeRepay)) {
    throw new Error(`debt repay action did not reduce debt: ${debtBeforeRepay} -> ${debtAfterRepay}`);
  }
  const afterRepay = await collectMetrics(cdp);
  assertMetrics(afterRepay);
  await screenshot(cdp, artifacts.afterRepay);

  const expandBefore = await evaluate(cdp, `(() => {
    document.getElementById("capacityModal")?.classList.add("hidden");
    document.getElementById("eventModal")?.classList.add("hidden");
    recommendedActionLockUntilMs = 0;
    game.cash = Math.max(game.cash, 240000);
    game.debt = 0;
    game.inv = [];
    game.totalItems = game.coat;
    game.lastTrade = null;
    render();
    return {
      coat: game.coat,
      cash: game.cash,
      title: document.getElementById("thumbActionTitle")?.textContent || "",
      meta: document.getElementById("thumbActionMeta")?.textContent || "",
      why: document.getElementById("thumbActionWhy")?.textContent || "",
      button: document.getElementById("thumbActionBtn")?.textContent || "",
    };
  })()`);
  if (expandBefore.title !== "扩仓接下一波") {
    throw new Error(`expand prompt did not surface in thumb dock: ${expandBefore.title}`);
  }
  if (expandBefore.button !== "去扩仓") {
    throw new Error(`expand button text mismatch: ${expandBefore.button}`);
  }
  if (!expandBefore.why.includes("下波多装") && !expandBefore.why.includes("更稳")) {
    throw new Error(`expand reason is unclear: ${expandBefore.why}`);
  }
  await evaluate(cdp, `document.getElementById("thumbActionBtn")?.click(); true`);
  await sleep(300);
  const recommendedExpandAfter = await evaluate(cdp, `(() => ({
    coat: game.coat,
    cash: game.cash,
    modalVisible: Boolean(document.getElementById("capacityModal") && !document.getElementById("capacityModal").classList.contains("hidden")),
    banner: document.getElementById("saveSuccessBanner")?.textContent || "",
    capacityEvent: (game.eventLog || []).filter((event) => event.event_type === "capacity_upgrade").at(-1)?.payload || null,
  }))()`);
  if (!(recommendedExpandAfter.coat > expandBefore.coat)) {
    throw new Error(`recommended one-tap expansion did not increase capacity: ${expandBefore.coat} -> ${recommendedExpandAfter.coat}`);
  }
  if (recommendedExpandAfter.modalVisible) throw new Error("recommended one-tap expansion opened a redundant confirmation modal");
  if (Number(recommendedExpandAfter.capacityEvent?.after || 0) !== recommendedExpandAfter.coat) {
    throw new Error(`recommended expansion event is missing: ${JSON.stringify(recommendedExpandAfter)}`);
  }
  await evaluate(cdp, `document.getElementById("quickExpandBtn")?.click(); true`);
  await sleep(150);
  const expandModalVisible = await evaluate(cdp, `Boolean(document.getElementById("capacityModal") && !document.getElementById("capacityModal").classList.contains("hidden"))`);
  if (!expandModalVisible) throw new Error("manual capacity modal did not open from the explicit expand control");
  await evaluate(cdp, `(() => {
    const input = document.getElementById("capacityTargetInput");
    if (input) {
      input.value = "10";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  })()`);
  await evaluate(cdp, `document.getElementById("capacityConfirmBtn")?.click(); true`);
  await sleep(300);
  const expandAfter = await evaluate(cdp, `(() => ({
    coat: game.coat,
    cash: game.cash,
    inputValue: document.getElementById("capacityTargetInput")?.value || "",
    confirmDisabled: Boolean(document.getElementById("capacityConfirmBtn")?.disabled),
    summary: document.getElementById("capacitySummaryText")?.textContent || "",
    cost: document.getElementById("capacityCostText")?.innerText || "",
    lastLogs: (game.logs || []).slice(-5),
    modalVisible: Boolean(document.getElementById("capacityModal") && !document.getElementById("capacityModal").classList.contains("hidden")),
  }))()`);
  if (!(expandAfter.coat > recommendedExpandAfter.coat)) {
    throw new Error(`manual capacity confirmation did not increase capacity: ${recommendedExpandAfter.coat} -> ${expandAfter.coat}; ${JSON.stringify(expandAfter)}`);
  }
  if (expandAfter.modalVisible) throw new Error("capacity modal stayed visible after confirm");
  const afterExpand = await collectMetrics(cdp);
  assertMetrics(afterExpand);
  await screenshot(cdp, artifacts.afterExpand);

  await evaluate(cdp, `(() => {
    game.inv = [];
    game.totalItems = 0;
    game.timeLeft = 1;
    const loc = suggestedTravelLocation();
    if (loc) travelToLocation(loc);
    return true;
  })()`);
  await sleep(800);
  const afterEnd = await collectMetrics(cdp);
  if (!afterEnd.rects.endModal?.visible) throw new Error("end modal did not appear after forced final turn");
  if (!afterEnd.rects.endReplayBtn?.visible) throw new Error("replay button is not visible on end modal");
  if (!afterEnd.rects.endSaveBtn?.visible || !afterEnd.rects.endSkipBtn?.visible) throw new Error("secondary end actions are not visible on end modal");
  if (!usesGridTradeUi && !afterEnd.rects.endReplayBtn.text.includes("再来一局 ·")) {
    throw new Error(`replay button does not carry next-run goal: ${afterEnd.rects.endReplayBtn.text}`);
  }
  if (!usesGridTradeUi && !/(冲|破纪录|刷新纪录)/.test(afterEnd.rects.endReplayBtn.text)) {
    throw new Error(`replay button goal is unclear: ${afterEnd.rects.endReplayBtn.text}`);
  }
  if (usesGridTradeUi && !afterEnd.rects.endReplayBtn.text.includes("再来一局")) {
    throw new Error(`grid UI replay action is unclear: ${afterEnd.rects.endReplayBtn.text}`);
  }
  if (!(afterEnd.rects.endReplayBtn.height > afterEnd.rects.endSaveBtn.height)) {
    throw new Error(`replay action is not visually prioritized: replay ${afterEnd.rects.endReplayBtn.height}px, save ${afterEnd.rects.endSaveBtn.height}px`);
  }
  if (!afterEnd.endModalLayout?.bodyScrollable) {
    throw new Error(`end summary body is not independently scrollable: ${JSON.stringify(afterEnd.endModalLayout)}`);
  }
  if (
    afterEnd.endModalLayout?.body
    && afterEnd.endModalLayout?.actions
    && afterEnd.endModalLayout.body.bottom > afterEnd.endModalLayout.actions.top + 1
  ) {
    throw new Error(`end summary actions overlap scroll body: ${JSON.stringify(afterEnd.endModalLayout)}`);
  }
  if (!afterEnd.endModalLayout?.secondarySameRow) {
    throw new Error(`end modal secondary actions should fit side by side: ${JSON.stringify(afterEnd.endModalLayout)}`);
  }
  if (!afterEnd.endModalLayout?.secondaryTextFits) {
    throw new Error(`end modal secondary action text overflows: ${JSON.stringify(afterEnd.endModalLayout)}`);
  }
  if (!afterEnd.endSummary.includes("本机")) throw new Error("end summary did not include local run stats");
  if (!afterEnd.endSummary.includes("本局用时")) throw new Error("end summary did not include run duration");
  if (!afterEnd.endSummary.includes("本局评级")) throw new Error("end summary did not include run grade");
  if (!afterEnd.endSummary.includes("上局对比")) throw new Error("end summary did not include previous-run comparison");
  if (!afterEnd.endSummary.includes("本局高光")) throw new Error("end summary did not include run highlights");
  if (!afterEnd.endSummary.includes("总分")) throw new Error("end summary did not include final score highlight");
  if (!afterEnd.endSummary.includes("下一局")) throw new Error("end summary did not include next-run goal");
  if (!afterEnd.endSummary.includes("下一局挑战")) throw new Error("end summary did not include next-run challenge");
  if (!afterEnd.endSummary.includes("下一局起手计划")) throw new Error("end summary did not include next-run opening plan");
  if (!afterEnd.endSummary.includes("主按钮") || !afterEnd.endSummary.includes("最后 5 天")) {
    throw new Error(`end summary opening plan is not actionable enough: ${afterEnd.endSummary}`);
  }
  if (!afterEnd.endSummary.includes("本局悬赏")) throw new Error("end summary did not include run bounty");
  if (!afterEnd.endSummary.includes("本机生涯")) throw new Error("end summary did not include local career panel");
  if (!afterEnd.endSummary.includes("最佳连赚")) throw new Error("end summary did not include best streak career stat");
  if (!afterEnd.endSummary.includes("最大单笔")) throw new Error("end summary did not include best single profit career stat");
  if (!afterEnd.endSummary.includes("最高连赚")) throw new Error("end summary did not include profit streak summary");
  if (!afterEnd.endSummary.includes("本局徽章")) throw new Error("end summary did not include achievement badges");
  await screenshot(cdp, artifacts.afterEnd);

  await evaluate(cdp, `window.__BFSJ_FORCE_GUEST_SAVE_OFFLINE = true; document.getElementById("endSaveBtn")?.click(); true`);
  await sleep(400);
  const afterGuestSaveOpen = await collectMetrics(cdp);
  if (!afterGuestSaveOpen.rects.guestSaveModal?.visible) throw new Error("guest nickname modal did not open from end save action");
  if (!afterGuestSaveOpen.rects.guestNicknameInput?.visible) throw new Error("guest nickname input is not visible");
  if (!afterGuestSaveOpen.rects.guestSaveSubmitBtn?.visible || !afterGuestSaveOpen.rects.guestSaveCancelBtn?.visible) {
    throw new Error("guest save modal actions are not visible");
  }
  if (afterGuestSaveOpen.rects.guestNicknameInput.height < 44) {
    throw new Error(`guest nickname input is too small: ${afterGuestSaveOpen.rects.guestNicknameInput.width}x${afterGuestSaveOpen.rects.guestNicknameInput.height}`);
  }
  if ((afterGuestSaveOpen.smallTouchTargets || []).some((target) => String(target.id).startsWith("guest"))) {
    throw new Error(`guest save modal has small touch targets: ${JSON.stringify(afterGuestSaveOpen.smallTouchTargets)}`);
  }
  const guestOpenHint = await evaluate(cdp, `document.getElementById("guestSaveHint")?.textContent || ""`);
  if (!guestOpenHint.includes("本机") || !guestOpenHint.includes("稍后")) {
    throw new Error(`guest save offline opening hint is unclear: ${guestOpenHint}`);
  }
  await evaluate(cdp, `(() => {
    const input = document.getElementById("guestNicknameInput");
    if (input) input.value = "测试玩家";
    document.getElementById("guestSaveSubmitBtn")?.click();
    return true;
  })()`);
  await sleep(250);
  const guestNoCloud = await evaluate(cdp, `(() => ({
      forceOffline: window.__BFSJ_FORCE_GUEST_SAVE_OFFLINE === true,
      offline: typeof isGuestSaveOffline === "function" ? isGuestSaveOffline() : null,
      hasCloudClient: Boolean(cloud.client),
      hasCloudUser: Boolean(cloud.user),
      hint: document.getElementById("guestSaveHint")?.textContent || "",
      hintIsError: document.getElementById("guestSaveHint")?.classList.contains("error-text") || false,
      banner: document.getElementById("saveSuccessBanner")?.textContent || "",
      modalVisible: Boolean(document.getElementById("guestSaveModal") && !document.getElementById("guestSaveModal").classList.contains("hidden")),
    }))()`);
  if (!guestNoCloud.modalVisible) throw new Error(`guest save modal closed after failed no-cloud submit: ${JSON.stringify(guestNoCloud)}`);
  if (!guestNoCloud.hint.includes("云端未连接") || !guestNoCloud.hint.includes("本机")) {
    throw new Error(`guest save no-cloud hint is unclear: ${JSON.stringify(guestNoCloud)}`);
  }
  if (!guestNoCloud.hintIsError) throw new Error(`guest save no-cloud hint should use error styling: ${JSON.stringify(guestNoCloud)}`);
  if (!guestNoCloud.banner.includes("本机") || !guestNoCloud.banner.includes("稍后")) {
    throw new Error(`guest save no-cloud banner is unclear: ${JSON.stringify(guestNoCloud)}`);
  }
  await evaluate(cdp, `document.getElementById("guestSaveCancelBtn")?.click(); document.getElementById("endModal")?.classList.remove("hidden"); true`);
  await sleep(200);
  const afterGuestSaveCancel = await collectMetrics(cdp);
  if (afterGuestSaveCancel.rects.guestSaveModal?.visible) throw new Error("guest nickname modal stayed visible after cancel");
  if (!afterGuestSaveCancel.rects.endModal?.visible || !afterGuestSaveCancel.rects.endReplayBtn?.visible) {
    throw new Error("end modal did not return after guest save cancel");
  }

  await evaluate(cdp, `document.getElementById("endReplayBtn")?.click(); true`);
  await sleep(500);
  const afterReplay = await collectMetrics(cdp);
  assertMetrics(afterReplay);
  if (afterReplay.rects.endModal?.visible) throw new Error("end modal stayed visible after replay");
  if (afterReplay.rects.startModal?.visible) throw new Error("start modal appeared after replay");
  const expectedReplayDayText = usesGridTradeUi ? "第0/45天" : "杭州浮生(0/45天)";
  if (afterReplay.dayText !== expectedReplayDayText) throw new Error(`replay did not start a fresh run: ${afterReplay.dayText}`);
  if (!usesGridTradeUi && !afterReplay.progressText.includes("0/30")) throw new Error(`replay progress did not reset: ${afterReplay.progressText}`);
  await screenshot(cdp, artifacts.afterReplay);

  const goalMoment = await evaluate(cdp, `(() => new Promise((resolve) => {
    game.cash = 90000;
    game.bank = 0;
    game.debt = 0;
    game.timeLeft = 26;
    game.gameOver = false;
    game.lastTrade = null;
    lastGoalMomentKey = "";
    lastNetWorthMilestone = 0;
    render();
    setTimeout(() => resolve({
      banner: document.getElementById("saveSuccessBanner")?.textContent || "",
      goal: document.getElementById("roundGoalText")?.textContent || "",
      kicker: document.getElementById("thumbActionKicker")?.textContent || "",
      dockClass: document.getElementById("thumbActionDock")?.className || "",
      day: document.getElementById("dayText")?.textContent || "",
      goalProgress: {
        ariaNow: Number(document.getElementById("roundGoalProgressTrack")?.getAttribute("aria-valuenow")),
        width: document.getElementById("roundGoalProgressFill")?.getBoundingClientRect().width || 0,
      },
    }), 320);
  }))()`);
  if (usesGridTradeUi && !goalMoment.banner.includes("快升档了") && !goalMoment.banner.includes("经营阶段晋升")) {
    throw new Error(`grid UI goal moment did not show useful feedback: ${goalMoment.banner}`);
  }
  if (!usesGridTradeUi && !goalMoment.banner.includes("快升档了")) {
    throw new Error(`near-grade goal moment did not show banner: ${goalMoment.banner}`);
  }
  if (!usesGridTradeUi && (!goalMoment.goal.includes("快升档") || !goalMoment.kicker.includes("升档差"))) {
    throw new Error(`near-grade goal copy did not update: ${goalMoment.goal} / ${goalMoment.kicker}`);
  }
  if (!usesGridTradeUi && !goalMoment.dockClass.includes("goal-hot")) {
    throw new Error(`near-grade dock did not get goal-hot state: ${goalMoment.dockClass}`);
  }
  if (!usesGridTradeUi && (
    goalMoment.goalProgress.ariaNow < 85
    || goalMoment.goalProgress.ariaNow > 95
    || goalMoment.goalProgress.width <= 0
  )) {
    throw new Error(`near-grade goal progress did not land near the next grade: ${JSON.stringify(goalMoment.goalProgress)}`);
  }

  const finalSprint = await evaluate(cdp, `(() => new Promise((resolve) => {
    game.cash = 250000;
    game.bank = 0;
    game.debt = 0;
    game.inv = [];
    game.totalItems = 0;
    game.timeLeft = 5;
    game.gameOver = false;
    game.lastTrade = null;
    render();
    setTimeout(() => resolve({
      goal: document.getElementById("roundGoalText")?.textContent || "",
      kicker: document.getElementById("thumbActionKicker")?.textContent || "",
      dockClass: document.getElementById("thumbActionDock")?.className || "",
      button: document.getElementById("thumbActionBtn")?.textContent || "",
      day: document.getElementById("dayText")?.textContent || "",
    }), 120);
  }))()`);
  if (!finalSprint.goal.includes("最后 5 天") || !finalSprint.goal.includes("下一档")) {
    throw new Error(`final sprint goal copy is unclear: ${JSON.stringify(finalSprint)}`);
  }
  if (!finalSprint.kicker.includes("最后5天") || !finalSprint.kicker.includes("下档差")) {
    throw new Error(`final sprint kicker is unclear: ${JSON.stringify(finalSprint)}`);
  }
  if (!finalSprint.dockClass.includes("sprint-hot")) {
    throw new Error(`final sprint dock did not get sprint-hot state: ${finalSprint.dockClass}`);
  }

  const report = {
    targetUrl,
    viewport: { width: WIDTH, height: HEIGHT },
    artifacts,
    startBriefText,
    startGoalText,
    startConfirmRect,
    pwaMetrics,
    afterStart,
    afterAction,
    afterSecondAction,
    afterFlow,
    restoreAudit: { before: restoreBefore, after: restoreAfter },
    afterRestore,
    profitFeedback,
    partialRepayBefore,
    partialRepayAfter,
    afterRepayPrompt,
    afterRepay,
    expandBefore,
    recommendedExpandAfter,
    expandAfter,
    afterExpand,
    afterEnd,
    afterGuestSaveOpen,
    afterGuestSaveCancel,
    afterReplay,
    goalMoment,
  };
  fs.writeFileSync(artifacts.report, JSON.stringify(report, null, 2));
  console.log(`Mobile CDP smoke passed: ${WIDTH}x${HEIGHT}`);
  console.log(`Screenshots: ${artifacts.startModal}, ${artifacts.afterStart}, ${artifacts.afterAction}, ${artifacts.afterFlow}, ${artifacts.afterRestore}, ${artifacts.afterProfit}, ${artifacts.afterRepay}, ${artifacts.afterExpand}, ${artifacts.afterEnd}, ${artifacts.afterReplay}`);
  console.log(`Report: ${artifacts.report}`);
} catch (error) {
  if (error.message === "__MOBILE_ENTRY_ONLY_DONE__" || error.message === "__MOBILE_CAMPAIGN_QA_DONE__") {
    process.exitCode = 0;
  } else {
  const hint = stderr.split("\\n").filter(Boolean).slice(-8).join("\\n");
  console.error(`Mobile CDP smoke failed: ${error.message}`);
  if (hint) console.error(hint);
  process.exitCode = 1;
  }
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  if (chrome.profile) {
    try {
      fs.rmSync(chrome.profile, { recursive: true, force: true });
    } catch {}
  }
  await staticServer?.close();
}
