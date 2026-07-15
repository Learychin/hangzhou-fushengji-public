import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ROOT = path.join(ROOT, "web_mvp");
const HOST = "127.0.0.1";
const TARGET_URL = process.env.TARGET_URL?.trim() || "";
const VIEWPORTS = (process.env.MOBILE_VIEWPORTS || "360x740,390x844,430x932")
  .split(",")
  .map((value) => {
    const match = value.trim().match(/^(\d+)x(\d+)$/);
    if (!match) throw new Error(`Invalid viewport: ${value}`);
    return { width: Number(match[1]), height: Number(match[2]) };
  });

const MIME = {
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

function chromePath() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome executable not found. Set CHROME=/path/to/chrome.");
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url || "/", `http://${HOST}`);
      const relative = decodeURIComponent(url.pathname) === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = path.resolve(SITE_ROOT, relative);
      if (!file.startsWith(`${SITE_ROOT}${path.sep}`) && file !== path.join(SITE_ROOT, "index.html")) {
        response.writeHead(404).end("Not found");
        return;
      }
      fs.stat(file, (error, stat) => {
        if (error || !stat.isFile()) {
          response.writeHead(404).end("Not found");
          return;
        }
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        });
        fs.createReadStream(file).pipe(response);
      });
    });
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      resolve({
        url: `http://${HOST}:${address.port}/`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
    });
  }

  close() {
    this.socket?.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
  return result.result?.value;
}

async function browserTarget(port) {
  const endpoint = `http://${HOST}:${port}`;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const pages = await fetch(`${endpoint}/json/list`).then((response) => response.json());
      const page = pages.find((item) => item.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error("Chrome DevTools did not start");
}

async function waitReady(cdp) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ready = await evaluate(cdp, `document.readyState === "complete"
      && document.body.classList.contains("mobile-ui")
      && Boolean(document.querySelector("#marketTable tbody tr"))`);
    if (ready) return;
    await sleep(100);
  }
  throw new Error("Game page did not become ready");
}

function assertMetrics(metrics, viewport) {
  const problems = [];
  const near = (actual, expected, tolerance = 0.6) => Math.abs(actual - expected) <= tolerance;
  const x = metrics.x;
  if (!near(metrics.app.height, viewport.height)) problems.push(`app height ${metrics.app.height}`);
  if (metrics.overflowX > 0.5) problems.push(`horizontal overflow ${metrics.overflowX}`);
  if (metrics.scrollHeight > viewport.height + 1) problems.push(`vertical overflow ${metrics.scrollHeight}`);
  for (const [name, ratio] of Object.entries({ topbar: 2, ticker: 1, cash: 3, place: 2, dock: 3 })) {
    if (!near(metrics[name].height, x * ratio)) problems.push(`${name} is ${metrics[name].height}px, expected ${x * ratio}px`);
  }
  if (!near(metrics.cash.bottom, metrics.place.top)) problems.push("cash/place gap");
  if (!near(metrics.place.top, metrics.placeGrid.top)) problems.push("blank space above address grid");
  if (!near(metrics.place.bottom, metrics.trade.top)) problems.push("place/trade gap");
  if (!near(metrics.trade.bottom, metrics.dock.top)) problems.push("trade/dock gap");
  if (metrics.placeItems.length !== 12) problems.push(`address count ${metrics.placeItems.length}`);
  if (metrics.placeItems.some((row) => !near(row.height, x))) problems.push("address rows are not 1x");
  if (metrics.marketRows.length !== 9) problems.push(`market row count ${metrics.marketRows.length}`);
  if (metrics.marketRows.some((row) => !near(row.height, x))) problems.push("market rows are not 1x");
  if (metrics.marketGaps.some((gap) => !near(gap, 0))) problems.push(`market row gaps ${metrics.marketGaps.join(",")}`);
  if (metrics.marketRows.some((row) => row.animation !== "none" || row.transform !== "none")) problems.push("market rows still animate into lines");
  if (!metrics.buyMode) problems.push("market selection did not enter buy mode");
  if (!metrics.sellMode) problems.push("inventory selection did not enter sell mode");
  if (!metrics.accountModalVisible) problems.push("player account entry did not open");
  if (metrics.sharePayload?.title !== "杭州浮生记战报") problems.push("share title is not city-aware");
  if (!metrics.sharePayload?.text?.includes("《杭州浮生记》") || !metrics.sharePayload?.url?.startsWith(metrics.origin)) problems.push("share payload is incomplete");
  if (!metrics.pwa.active) problems.push("service worker is not active");
  for (const asset of ["index.html", "styles.css", "layout-v2.css", "main.js", "platform.js", "config.js"]) {
    if (!metrics.pwa.assets.includes(asset)) problems.push(`PWA cache missing ${asset}`);
  }
  if (problems.length) throw new Error(`${viewport.width}x${viewport.height}: ${problems.join("; ")}`);
}

async function runViewport(serverUrl, viewport) {
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bfsj-grid-"));
  const chrome = spawn(chromePath(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-allow-origins=*",
    `--remote-debugging-address=${HOST}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${viewport.width},${viewport.height}`,
    "about:blank",
  ], { stdio: "ignore" });
  let cdp;
  try {
    cdp = new CDP(await browserTarget(port));
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    const pageUrl = new URL(serverUrl);
    pageUrl.searchParams.set("qa", String(Date.now()));
    await cdp.send("Page.navigate", { url: pageUrl.href });
    await waitReady(cdp);
    await evaluate(cdp, `document.getElementById("startConfirmBtn")?.click(); true`);
    await sleep(250);
    const metrics = await evaluate(cdp, `(() => new Promise(async (resolve) => {
      const box = (selector) => {
        const element = document.querySelector(selector);
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width };
      };
      const boxElement = (element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width };
      };
      document.querySelector("#marketPanel")?.classList.add("market-refresh");
      document.querySelector("#marketTable tbody tr")?.click();
      const buyMode = document.querySelector("#mobileTradeDock")?.classList.contains("mode-buy")
        && document.querySelector("#mobileTradePrimaryBtn")?.textContent.includes("买入");
      document.querySelector("#mobileTradeMaxBtn")?.click();
      await new Promise((done) => setTimeout(done, 80));
      document.querySelector("#invTable tbody tr")?.click();
      const sellMode = document.querySelector("#mobileTradeDock")?.classList.contains("mode-sell")
        && document.querySelector("#mobileTradePrimaryBtn")?.textContent.includes("卖出")
        && document.querySelector("#mobileTradeMaxBtn")?.textContent.includes("全部卖出");
      document.querySelector("#mobileMenuBtn")?.click();
      document.querySelector("#menuAccountBtn")?.click();
      const accountModalVisible = !document.querySelector("#accountModal")?.classList.contains("hidden");
      document.querySelector("#accountCloseBtn")?.click();
      let sharePayload = null;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (payload) => { sharePayload = payload; },
      });
      await shareCurrentRun();
      const marketRows = [...document.querySelectorAll("#marketTable tbody tr")].map((row) => {
        const rect = row.getBoundingClientRect();
        const style = getComputedStyle(row);
        return { top: rect.top, bottom: rect.bottom, height: rect.height, animation: style.animationName, transform: style.transform };
      });
      const cache = await navigator.serviceWorker.ready.then(async (registration) => {
        const names = await caches.keys();
        const shell = names.find((name) => name.startsWith("bfsj-shell"));
        const requests = shell ? await (await caches.open(shell)).keys() : [];
        return { active: Boolean(registration.active), assets: requests.map((request) => new URL(request.url).pathname.split("/").pop() || "index.html") };
      });
      resolve({
        x: box("#miniTicker").height,
        app: box(".app"), topbar: box(".topbar"), ticker: box("#miniTicker"),
        cash: box("#mobileStatusStrip"), place: box("#placeDock"), placeGrid: box("#placeDockGrid"),
        trade: box("#tradeSection"), dock: box("#mobileTradeDock"),
        placeItems: [...document.querySelectorAll(".place-dock-item")].map(boxElement),
        marketRows,
        marketGaps: marketRows.slice(1).map((row, index) => row.top - marketRows[index].bottom),
        buyMode, sellMode, accountModalVisible, sharePayload, origin: location.origin, pwa: cache,
        overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
        scrollHeight: document.documentElement.scrollHeight,
      });
    }))()`);
    assertMetrics(metrics, viewport);
    console.log(`Mobile grid smoke passed: ${viewport.width}x${viewport.height}`);
  } finally {
    cdp?.close();
    const exited = new Promise((resolve) => {
      if (chrome.exitCode != null) resolve();
      else chrome.once("exit", resolve);
    });
    chrome.kill("SIGTERM");
    await Promise.race([exited, sleep(3000)]);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) console.warn(`Could not remove temporary Chrome profile: ${error.message}`);
        else await sleep(150 * (attempt + 1));
      }
    }
  }
}

const server = TARGET_URL ? null : await startServer();
try {
  const targetUrl = TARGET_URL || server.url;
  for (const viewport of VIEWPORTS) await runViewport(targetUrl, viewport);
} finally {
  await server?.close();
}
