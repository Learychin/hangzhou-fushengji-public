import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = process.cwd();
const HOST = "127.0.0.1";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTH = Number(process.env.MOBILE_WIDTH || 390);
const HEIGHT = Number(process.env.MOBILE_HEIGHT || 844);
const OUT_DIR = path.join(ROOT, "reports", "mobile_smoke");
const ANDROID_CHROME_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function findFreePort() {
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

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  return res.json();
}

async function waitForPreview(child) {
  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for mobile preview. Output:\n${output}`)), 15000);
    const onData = (chunk) => {
      output += String(chunk);
      const match = output.match(/Local check page:\s*(http:\/\/127\.0\.0\.1:\d+\/__mobile-check)/);
      if (!match) return;
      clearTimeout(timer);
      resolve({ checkUrl: match[1], output });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Mobile preview exited before ready: code ${code}, signal ${signal}\n${output}`));
    });
  });
}

async function waitForPageTarget(cdpPort, childState) {
  const base = `http://${HOST}:${cdpPort}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    if (childState.launchError) throw childState.launchError;
    if (childState.chromeExit) {
      throw new Error(`Chrome exited before DevTools was ready: code ${childState.chromeExit.code}, signal ${childState.chromeExit.signal}`);
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
    } catch {
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
  }

  async open() {
    if (typeof WebSocket !== "function") {
      throw new Error("This Node runtime does not provide a global WebSocket");
    }
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
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

async function waitFor(cdp, expression, label, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return;
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function screenshot(cdp, filePath) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(filePath, Buffer.from(data, "base64"));
}

function launchChrome(cdpPort) {
  const profile = path.join("/private/tmp", `hzfsj_check_${Date.now()}_${Math.random().toString(16).slice(2)}`);
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
    `--remote-debugging-port=${cdpPort}`,
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

function readGameVersion() {
  const raw = fs.readFileSync(path.join(ROOT, "src", "engine", "game-engine.js"), "utf8");
  const match = raw.match(/GAME_VERSION_CODE\s*=\s*["']([^"']+)["']/);
  if (!match?.[1]) throw new Error("Could not read GAME_VERSION_CODE from game engine");
  return match[1];
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const runStamp = stamp();
const artifacts = {
  checkPage: path.join(OUT_DIR, `${runStamp}_mobile_check_page.png`),
  afterClearOpen: path.join(OUT_DIR, `${runStamp}_mobile_check_after_clear_open.png`),
  report: path.join(OUT_DIR, `${runStamp}_mobile_check_report.json`),
};

const expectedVersion = readGameVersion();
const previewPort = await findFreePort();
const cdpPort = await findFreePort();
const preview = spawn(process.execPath, ["scripts/mobile_device_preview.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(previewPort),
    WRITE_MANUAL_REPORT: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let chrome;
let cdp;
let stderr = "";
const childState = { launchError: null, chromeExit: null };

try {
  const { checkUrl } = await waitForPreview(preview);
  chrome = launchChrome(cdpPort);
  chrome.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  chrome.on("error", (error) => {
    childState.launchError = error;
  });
  chrome.on("exit", (code, signal) => {
    childState.chromeExit = { code, signal };
  });

  const wsUrl = await waitForPageTarget(cdpPort, childState);
  cdp = new CDP(wsUrl);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.setUserAgentOverride", { userAgent: ANDROID_CHROME_UA, platform: "Android" });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp.send("Page.navigate", { url: checkUrl });
  await waitFor(cdp, `document.readyState === "complete" && Boolean(document.querySelector("[data-device-check]"))`, "check page readiness");
  await waitFor(cdp, `document.querySelector("[data-device-check]")?.innerText.includes("main.js")`, "environment check", 6000);

  const checkMetrics = await evaluate(cdp, `(() => {
    const rectOf = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        width: Math.round(r.width),
        height: Math.round(r.height),
        text: el.textContent || "",
        href: el.getAttribute("href") || "",
      };
    };
    const buttons = [...document.querySelectorAll("button")].map((button) => {
      const r = button.getBoundingClientRect();
      return { text: button.textContent || "", width: Math.round(r.width), height: Math.round(r.height) };
    });
    return {
      title: document.querySelector("h1")?.textContent || "",
      versionText: document.querySelector(".eyebrow")?.textContent || "",
      envText: document.querySelector("[data-device-check]")?.innerText || "",
      openLink: rectOf(".primary-link"),
      clearButtons: document.querySelectorAll("[data-clear-cache-open]").length,
      runCards: document.querySelectorAll("[data-run-card]").length,
      currentDeviceHint: document.querySelector("[data-current-device-hint]")?.innerText || "",
      currentDeviceCards: document.querySelectorAll("[data-run-card].current-device").length,
      nextRunCard: document.querySelector("[data-run-card].next-run .run-card-head strong")?.textContent || "",
      buttons,
      overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  })()`);

  const problems = [];
  if (checkMetrics.title !== "杭州浮生记 真机验收") problems.push(`unexpected title: ${checkMetrics.title}`);
  if (checkMetrics.versionText !== expectedVersion) problems.push(`version mismatch: ${checkMetrics.versionText} vs ${expectedVersion}`);
  if (!checkMetrics.envText.includes(`main.js ${expectedVersion}`)) problems.push(`environment check did not read current main.js version: ${checkMetrics.envText}`);
  if (!checkMetrics.openLink?.href.includes("mobile_check_version=")) problems.push(`open link is not versioned: ${checkMetrics.openLink?.href || ""}`);
  if (checkMetrics.clearButtons < 2) problems.push(`expected two clear-cache buttons, found ${checkMetrics.clearButtons}`);
  if (checkMetrics.runCards !== 6) problems.push(`expected 6 run cards, found ${checkMetrics.runCards}`);
  if (!checkMetrics.currentDeviceHint.includes("Android Chrome") || !checkMetrics.currentDeviceHint.includes("第 1 局")) {
    problems.push(`current-device hint did not target Android Chrome run 1: ${checkMetrics.currentDeviceHint}`);
  }
  if (checkMetrics.currentDeviceCards !== 3 || !checkMetrics.nextRunCard.includes("Android Chrome · 第 1 局")) {
    problems.push(`current-device cards not highlighted correctly: ${JSON.stringify({ currentDeviceCards: checkMetrics.currentDeviceCards, nextRunCard: checkMetrics.nextRunCard })}`);
  }
  if (checkMetrics.overflowX > 2) problems.push(`check page has horizontal overflow: ${checkMetrics.overflowX}px`);
  if (!checkMetrics.buttons.some((button) => button.text.includes("本局顺畅"))) {
    problems.push("quick pass buttons are missing from run cards");
  }
  const smallButtons = checkMetrics.buttons.filter((button) => button.height < 44 || button.width < 44);
  if (smallButtons.length) problems.push(`small check-page buttons: ${JSON.stringify(smallButtons)}`);
  if (problems.length) throw new Error(problems.join("; "));

  await evaluate(cdp, `(() => {
    const card = document.querySelector('[data-run-card][data-run-index="0"]');
    const set = (name, value) => {
      const el = card.querySelector('[data-run-field="' + name + '"]');
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("minutes", "9.4");
    set("score", "908678");
    set("startGoal", "跟着下一步");
    set("replayGoal", "冲 ¥1,000,000");
    card.querySelector("[data-run-quick-pass]").click();
    document.querySelector('[data-check-index="0"]').click();
    document.querySelector('[data-check-index="1"]').click();
    document.querySelector('[data-generate-summary]').click();
    true;
  })()`);

  const summaryMetrics = await evaluate(cdp, `(() => ({
    filled: document.querySelector('[data-summary-field="filled"]')?.textContent || "",
    duration: document.querySelector('[data-summary-field="duration"]')?.textContent || "",
    clean: document.querySelector('[data-summary-field="clean"]')?.textContent || "",
    replay: document.querySelector('[data-summary-field="replay"]')?.textContent || "",
    mainButton: document.querySelector('[data-summary-field="mainButton"]')?.textContent || "",
    restore: document.querySelector('[data-summary-field="restore"]')?.textContent || "",
    gateText: document.querySelector('[data-gate-list]')?.innerText || "",
    badge: document.querySelector('[data-run-card][data-run-index="0"] [data-run-badge]')?.textContent || "",
    output: document.querySelector('[data-export-output]')?.value || "",
  }))()`);
  if (
    summaryMetrics.filled !== "1/6"
    || summaryMetrics.duration !== "1/6"
    || summaryMetrics.clean !== "1/6"
    || summaryMetrics.replay !== "1/6"
    || summaryMetrics.mainButton !== "1/6"
    || summaryMetrics.restore !== "1/6"
  ) {
    throw new Error(`summary counters did not update: ${JSON.stringify(summaryMetrics)}`);
  }
  if (summaryMetrics.badge !== "合格") {
    throw new Error(`filled run did not get qualified badge: ${summaryMetrics.badge}`);
  }
  if (!summaryMetrics.gateText.includes("还差 5 局真机记录")) {
    throw new Error(`gate list did not show missing run count: ${summaryMetrics.gateText}`);
  }
  for (const required of ["# 杭州浮生记真机验收摘要", "## 自动判定", "主按钮完成：1/6", "刷新恢复：1/6", "未达到真机通过线", "## 手机环境", expectedVersion, "iPhone", "9.4 分钟", "908678", "跟着下一步"]) {
    if (!summaryMetrics.output.includes(required)) throw new Error(`generated summary missing ${required}`);
  }
  await screenshot(cdp, artifacts.checkPage);

  await evaluate(cdp, `document.querySelector("[data-clear-cache-open]")?.click(); true`);
  await waitFor(cdp, `location.pathname === "/" && location.search.includes("fresh=") && Boolean(document.getElementById("startConfirmBtn"))`, "clear-cache open to game", 12000);
  const gameMetrics = await evaluate(cdp, `(() => ({
    href: location.href,
    version: typeof GAME_VERSION_CODE === "string" ? GAME_VERSION_CODE : "",
    startText: document.getElementById("startConfirmBtn")?.textContent || "",
    bodyClass: document.body.className,
    overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  }))()`);
  if (gameMetrics.version !== expectedVersion) throw new Error(`game opened with wrong version: ${JSON.stringify(gameMetrics)}`);
  if (!gameMetrics.href.includes("mobile_check_version=") || !gameMetrics.href.includes("fresh=")) {
    throw new Error(`clear-cache open did not preserve cache-busting params: ${gameMetrics.href}`);
  }
  if (!gameMetrics.startText.includes("开始 ·")) throw new Error(`game did not load start CTA: ${gameMetrics.startText}`);
  if (!String(gameMetrics.bodyClass).includes("mobile-ui")) throw new Error(`game did not open in mobile mode: ${gameMetrics.bodyClass}`);
  if (gameMetrics.overflowX > 2) throw new Error(`game opened from check page with horizontal overflow: ${gameMetrics.overflowX}px`);
  await screenshot(cdp, artifacts.afterClearOpen);

  const report = {
    checkUrl,
    expectedVersion,
    viewport: { width: WIDTH, height: HEIGHT },
    checkMetrics,
    summaryMetrics: {
      filled: summaryMetrics.filled,
      duration: summaryMetrics.duration,
      clean: summaryMetrics.clean,
      replay: summaryMetrics.replay,
      mainButton: summaryMetrics.mainButton,
      restore: summaryMetrics.restore,
      gateText: summaryMetrics.gateText,
      badge: summaryMetrics.badge,
    },
    gameMetrics,
    artifacts,
  };
  fs.writeFileSync(artifacts.report, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Mobile check page smoke passed: ${WIDTH}x${HEIGHT}`);
  console.log(`Screenshots: ${artifacts.checkPage}, ${artifacts.afterClearOpen}`);
  console.log(`Report: ${artifacts.report}`);
} catch (error) {
  console.error(`Mobile check page smoke failed: ${error.message}`);
  if (stderr.trim()) console.error(stderr.trim().slice(-2000));
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (chrome && !chrome.killed) chrome.kill("SIGTERM");
  if (preview && !preview.killed) preview.kill("SIGTERM");
}
