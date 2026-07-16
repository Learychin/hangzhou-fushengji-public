import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const ROOT = process.cwd();
const PREVIEW_ROOT = path.resolve(ROOT, process.env.MOBILE_PREVIEW_DIR || "web_mvp");
const TARGET_URL_FROM_ENV = process.env.TARGET_URL || "";
const QA_EXPERIMENT = String(process.env.QA_EXPERIMENT || "").trim();
const QA_FEEDBACK = process.env.QA_FEEDBACK === "1";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const REQUESTED_PORT = Number(process.env.CDP_PORT || 0);
let PORT = REQUESTED_PORT;
const WIDTH = Number(process.env.MOBILE_WIDTH || 390);
const HEIGHT = Number(process.env.MOBILE_HEIGHT || 844);
const RUNS = Number(process.env.RUNS || 3);
const MAX_TAPS_PER_RUN = Number(process.env.MAX_TAPS_PER_RUN || 240);
const HUMAN_SECONDS_PER_TAP = Number(process.env.HUMAN_SECONDS_PER_TAP || 6);
const TAP_SETTLE_MS = Math.max(280, Number(process.env.MOBILE_TAP_SETTLE_MS || 320));
const TARGET_SESSION_MINUTES = Number(process.env.TARGET_SESSION_MINUTES || 15);
const SEED = Number(process.env.SEED || 20260621);
const REPORT_LABEL = String(process.env.PLAYTEST_LABEL || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
const OUT_DIR = path.join(ROOT, "reports", "mobile_playtest");
const HOST = "127.0.0.1";

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
  }

  async open() {
    if (typeof WebSocket !== "function") {
      throw new Error("This Node runtime does not provide a global WebSocket");
    }
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject, timer } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(timer);
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
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(payload);
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

async function waitFor(cdp, expression, label, timeout = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
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

function launchChrome() {
  const profile = path.join("/private/tmp", `hzfsj_playtest_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const child = spawn(CHROME, [
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
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.profile = profile;
  return child;
}

async function stopChrome(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const graceful = await Promise.race([exited.then(() => true), sleep(2500).then(() => false)]);
  if (graceful || child.exitCode !== null) return;
  child.kill("SIGKILL");
  await Promise.race([exited, sleep(1200)]);
}

function seededRandomSource(seed) {
  return `
    (() => {
      window.__hzfsjQaErrors = [];
      window.addEventListener("error", (event) => {
        window.__hzfsjQaErrors.push({ message: event.message || "error", source: event.filename || "", line: event.lineno || 0 });
      });
      window.addEventListener("unhandledrejection", (event) => {
        window.__hzfsjQaErrors.push({ message: String(event.reason?.message || event.reason || "unhandled rejection"), source: "promise", line: 0 });
      });
      let state = ${seed >>> 0};
      Math.random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
      };
    })();
  `;
}

async function collectState(cdp) {
  return evaluate(cdp, `(() => {
    const rectOf = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        id,
        width: Math.round(r.width),
        height: Math.round(r.height),
        visible: r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden",
      };
    };
    const touchIds = ["thumbActionBtn", "actionOpportunityBtn", "buyOpportunityBtn", "sellOpportunityBtn", "quickTravelBtn", "quickExpandBtn", "mobileTabTrade", "mobileTabStatus"];
    const smallTouchTargets = touchIds
      .map(rectOf)
      .filter((r) => r && r.visible && (r.height < 40 || r.width < 44))
      .map((r) => ({ id: r.id, width: r.width, height: r.height }));
    const eventLog = game.eventLog || [];
    return {
      bodyClass: document.body.className,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      smallTouchTargets,
      qaErrors: Array.isArray(window.__hzfsjQaErrors) ? window.__hzfsjQaErrors.slice(-20) : [],
      dayText: document.getElementById("dayText")?.textContent || "",
      progressText: document.getElementById("roundProgressText")?.textContent || "",
      paceText: document.getElementById("roundPaceText")?.textContent || "",
      thumbKicker: document.getElementById("thumbActionKicker")?.textContent || "",
      thumbTitle: document.getElementById("thumbActionTitle")?.textContent || "",
      thumbButton: document.getElementById("thumbActionBtn")?.textContent || "",
      endSummary: document.getElementById("endSummaryBody")?.innerText || "",
      endVisible: Boolean(document.getElementById("endModal") && !document.getElementById("endModal").classList.contains("hidden")),
      replayVisible: Boolean(document.getElementById("endReplayBtn")?.offsetParent),
      game: {
        version: typeof GAME_VERSION_CODE === "string" ? GAME_VERSION_CODE : "unknown",
        experimentKey: game.experimentKey || game.experimentConfig?.experimentId || window.BFSJ_PLATFORM?.runMeta?.().experiment_key || "control",
        score: game.score,
        cash: game.cash,
        debt: game.debt,
        bank: game.bank,
        daysUsed: game.daysUsed,
        totalDays: game.totalDays,
        timeLeft: game.timeLeft,
        gameOver: game.gameOver,
        totalItems: game.totalItems,
        coat: game.coat,
        playtestMetrics: typeof buildPlaytestMetrics === "function" ? buildPlaytestMetrics() : null,
        logs: game.logs.slice(-16),
        eventSummary: eventLog.reduce((acc, event) => {
          const type = event.event_type || "unknown";
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {}),
        eventTotals: eventLog.reduce((acc, event) => {
          if (event.event_type !== "warehouse_fee") return acc;
          acc.warehouseFee += Number(event.payload?.fee) || 0;
          acc.warehouseFeePaid += Number(event.payload?.paid) || 0;
          acc.warehouseFeeDebt += Number(event.payload?.shortfall) || 0;
          return acc;
        }, { warehouseFee: 0, warehouseFeePaid: 0, warehouseFeeDebt: 0 }),
      },
    };
  })()`);
}

function assertMobileState(state, context) {
  const problems = [];
  if (!String(state.bodyClass || "").includes("mobile-ui")) problems.push("not in mobile-ui mode");
  if (state.overflowX > 2) problems.push(`horizontal overflow ${state.overflowX}px`);
  if (state.smallTouchTargets.length) {
    problems.push(`small touch targets: ${state.smallTouchTargets.map((x) => `${x.id} ${x.width}x${x.height}`).join(", ")}`);
  }
  if (!state.thumbButton) problems.push("missing thumb action button text");
  if (!state.thumbKicker) problems.push("missing thumb action goal text");
  if (problems.length) throw new Error(`${context}: ${problems.join("; ")}`);
}

function classifyAction(state) {
  const text = `${state.thumbTitle} ${state.thumbButton}`;
  if (text.includes("买")) return "buy";
  if (text.includes("卖") || text.includes("兑现")) return "sell";
  if (text.includes("还债") || text.includes("利息")) return "repay";
  if (text.includes("扩仓") || text.includes("仓位") || text.includes("升级")) return "expand";
  if (text.includes("换") || text.includes("去")) return "travel";
  if (text.includes("新局") || text.includes("再来")) return "replay";
  return "other";
}

async function closeBlockingModals(cdp) {
  return evaluate(cdp, `(() => {
    const result = { capacity: null, eventDismissals: 0, extraTaps: 0 };
    const eventModal = document.getElementById("eventModal");
    while (eventModal && !eventModal.classList.contains("hidden") && result.eventDismissals < 20) {
      document.getElementById("eventOkBtn")?.click();
      result.eventDismissals += 1;
      result.extraTaps += 1;
    }
    const capacityModal = document.getElementById("capacityModal");
    if (capacityModal && !capacityModal.classList.contains("hidden")) {
      result.capacity = {
        before: game.coat,
        cashBefore: game.cash,
        requestedGain: Number(document.getElementById("capacityTargetInput")?.value || 0),
      };
      // The game pre-fills the largest affordable expansion. Confirm that
      // recommendation so the bot follows the same two-tap path as a player.
      document.getElementById("capacityConfirmBtn")?.click();
      result.extraTaps += 1;
      result.capacity.after = game.coat;
      result.capacity.cashAfter = game.cash;
      result.capacity.confirmed = capacityModal.classList.contains("hidden");
      if (!result.capacity.confirmed) document.getElementById("capacityCancelBtn")?.click();
    }
    return result;
  })()`);
}

async function tapThumb(cdp) {
  const before = await closeBlockingModals(cdp);
  await evaluate(cdp, `document.getElementById("thumbActionBtn")?.click(); true`);
  await sleep(TAP_SETTLE_MS);
  const after = await closeBlockingModals(cdp);
  return {
    capacity: after.capacity || before.capacity,
    eventDismissals: (before.eventDismissals || 0) + (after.eventDismissals || 0),
    extraTaps: (before.extraTaps || 0) + (after.extraTaps || 0),
  };
}

async function exercisePlaytestFeedback(cdp) {
  const expected = new URL(targetUrl).searchParams.get("qa_feedback") === "1";
  if (!expected) return { expected: false, present: false, status: "", queued: 0 };
  const prepared = await evaluate(cdp, `(() => {
    const card = document.getElementById("endFeedbackCard");
    const form = document.getElementById("endFeedbackForm");
    if (!card || !form) return false;
    card.open = true;
    for (const name of ["surprise", "satisfaction", "agency", "fairness", "replay_intent", "share_intent"]) {
      const input = form.querySelector('input[name="' + name + '"][value="4"]');
      if (input) input.checked = true;
    }
    const moment = form.querySelector('textarea[name="memorable_moment"]');
    if (moment) moment.value = "冰箱贴翻盘很有记忆点";
    form.requestSubmit();
    return true;
  })()`);
  if (prepared) {
    await waitFor(cdp, `(() => {
      const text = document.getElementById("endFeedbackStatus")?.textContent || "";
      return Boolean(text) && text !== "提交中...";
    })()`, "playtest feedback result", 12000);
    await evaluate(cdp, `document.getElementById("endFeedbackCard")?.scrollIntoView({ block: "start" }); true`);
    await sleep(180);
  }
  return evaluate(cdp, `(() => {
    const queued = JSON.parse(localStorage.getItem("bfsj_playtest_feedback_queue_v1") || "[]");
    return {
      expected: true,
      present: Boolean(document.getElementById("endFeedbackCard")),
      status: document.getElementById("endFeedbackStatus")?.textContent || "",
      queued: Array.isArray(queued) ? queued.length : 0,
      experimentKeys: Array.isArray(queued) ? [...new Set(queued.map((item) => item?.experiment_key).filter(Boolean))] : [],
      latestExperimentKey: Array.isArray(queued) && queued.length ? queued[queued.length - 1]?.experiment_key || null : null,
    };
  })()`);
}

function buildMarkdown(report) {
  const scores = report.runs.map((run) => run.final.score);
  const taps = report.runs.map((run) => run.taps);
  const mainTaps = report.runs.map((run) => run.mainTaps);
  const avg = (arr) => arr.reduce((sum, n) => sum + n, 0) / Math.max(1, arr.length);
  const endSummaryLines = (summary) => {
    const lines = String(summary || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const netWorthIndex = lines.findIndex((line) => line.startsWith("净资产："));
    const endIndex = netWorthIndex >= 0 ? Math.min(lines.length, netWorthIndex + 4) : lines.length;
    return lines.slice(0, endIndex);
  };
  const lines = [];
  lines.push(`# 移动端长流程实玩报告（${report.runs.length}局）`);
  lines.push("");
  lines.push(`- 测试版本：${report.version}`);
  lines.push(`- 页面：${report.targetUrl}`);
  lines.push(`- 视口：${report.viewport.width}x${report.viewport.height}`);
  lines.push(`- 估算节奏：每次主按钮 ${report.humanSecondsPerTap} 秒`);
  lines.push(`- 总点击数：${Math.min(...taps)} ~ ${Math.max(...taps)}，平均 ${avg(taps).toFixed(1)}`);
  lines.push(`- 主按钮点击：${Math.min(...mainTaps)} ~ ${Math.max(...mainTaps)}，平均 ${avg(mainTaps).toFixed(1)}`);
  lines.push(`- 估算局长：${report.runs.map((run) => `${run.estimatedMinutes.toFixed(1)}min`).join(" / ")}`);
  lines.push(`- 分数：¥${Math.min(...scores).toLocaleString("zh-CN")} ~ ¥${Math.max(...scores).toLocaleString("zh-CN")}`);
  lines.push("");
  for (const run of report.runs) {
    lines.push(`## 第 ${run.run} 局`);
    lines.push(`- 点击：${run.taps} 次（主按钮 ${run.mainTaps}，弹窗/确认 ${run.extraTaps}），估算 ${run.estimatedMinutes.toFixed(1)} 分钟`);
    lines.push(`- 行动：买 ${run.actions.buy || 0}，卖 ${run.actions.sell || 0}，还债 ${run.actions.repay || 0}，换站 ${run.actions.travel || 0}`);
    lines.push(`- 结算：¥${run.final.score.toLocaleString("zh-CN")} ｜ 现金 ¥${run.final.cash.toLocaleString("zh-CN")} ｜ 欠债 ¥${run.final.debt.toLocaleString("zh-CN")}`);
    lines.push(`- 天数：${run.final.daysUsed}/${run.final.totalDays} ｜ 仓位：${run.final.totalItems}/${run.final.coat}`);
    lines.push("- 结束页：");
    for (const line of endSummaryLines(run.endSummary)) {
      lines.push(`  - ${line}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function runSingle(cdp, runIndex, shotDir) {
  if (runIndex > 0) {
    await evaluate(cdp, `document.getElementById("endReplayBtn")?.click(); true`);
    await sleep(300);
  }
  await closeBlockingModals(cdp);

  const actions = {};
  const tapTrail = [];
  let extraTaps = 0;
  const startedAt = Date.now();
  let state = await collectState(cdp);
  assertMobileState(state, `run ${runIndex + 1} start`);

  while (!state.game.gameOver && state.game.timeLeft > 0) {
    if (tapTrail.length >= MAX_TAPS_PER_RUN) {
      const tail = tapTrail.slice(-8)
        .map((tap) => `D${tap.day}:${tap.action}:${tap.button}:${tap.title}:${tap.score}`)
        .join(" | ");
      throw new Error(`Run ${runIndex + 1} exceeded ${MAX_TAPS_PER_RUN} thumb taps; ${tail}`);
    }
    const action = classifyAction(state);
    actions[action] = (actions[action] || 0) + 1;
    tapTrail.push({
      day: state.game.daysUsed,
      kicker: state.thumbKicker,
      action,
      title: state.thumbTitle,
      button: state.thumbButton,
      score: state.game.score,
    });
    const modalResult = await tapThumb(cdp);
    extraTaps += Number(modalResult?.extraTaps || 0);
    tapTrail[tapTrail.length - 1].modal = modalResult;
    state = await collectState(cdp);
    assertMobileState(state, `run ${runIndex + 1} tap ${tapTrail.length}`);
  }

  await waitFor(cdp, `Boolean(document.getElementById("endModal") && !document.getElementById("endModal").classList.contains("hidden"))`, "end modal", 5000);
  let finalState = await collectState(cdp);
  const feedback = await exercisePlaytestFeedback(cdp);
  if (feedback.expected) finalState = await collectState(cdp);
  const totalTaps = tapTrail.length + extraTaps;
  const estimatedMinutes = (totalTaps * HUMAN_SECONDS_PER_TAP) / 60;
  const problems = [];
  if (finalState.game.daysUsed !== finalState.game.totalDays) problems.push(`days ${finalState.game.daysUsed}/${finalState.game.totalDays}`);
  if (!finalState.endSummary.includes("本局评级")) problems.push("missing grade");
  if (!finalState.endSummary.includes("本局高光")) problems.push("missing run highlights");
  if (!finalState.endSummary.includes("总分")) problems.push("missing final score highlight");
  if (!finalState.endSummary.includes("下一局")) problems.push("missing next-run goal");
  if (!finalState.endSummary.includes("下一局挑战")) problems.push("missing next-run challenge");
  if (!finalState.endSummary.includes("下一局起手计划")) problems.push("missing next-run opening plan");
  if (!finalState.endSummary.includes("主按钮") || !finalState.endSummary.includes("最后 5 天")) problems.push("opening plan is not actionable");
  if (!finalState.endSummary.includes("本机生涯")) problems.push("missing local career panel");
  if (!finalState.endSummary.includes("最佳连赚")) problems.push("missing best streak career stat");
  if (!finalState.endSummary.includes("最大单笔")) problems.push("missing best single profit career stat");
  if (!finalState.endSummary.includes("最高连赚")) problems.push("missing profit streak summary");
  if (!finalState.endSummary.includes("本局徽章")) problems.push("missing achievement badges");
  if (finalState.qaErrors.length) {
    problems.push(`browser errors: ${finalState.qaErrors.map((error) => error.message).join(" | ")}`);
  }
  if (feedback.expected && (!feedback.present || !feedback.status)) {
    problems.push(`playtest feedback unavailable: ${JSON.stringify(feedback)}`);
  }
  const expectedExperiment = new URL(targetUrl).searchParams.get("qa_experiment");
  if (expectedExperiment && finalState.game.experimentKey !== expectedExperiment) {
    problems.push(`experiment mismatch expected=${expectedExperiment} actual=${finalState.game.experimentKey}`);
  }
  if (feedback.expected && expectedExperiment && feedback.latestExperimentKey !== expectedExperiment) {
    problems.push(`feedback experiment mismatch expected=${expectedExperiment} actual=${feedback.latestExperimentKey || "missing"}`);
  }
  const metrics = finalState.game.playtestMetrics;
  if (!metrics || typeof metrics !== "object") {
    problems.push("missing structured playtest metrics");
  } else {
    if (Number(metrics.primary_action_count) !== tapTrail.length) {
      problems.push(`primary action metric mismatch expected=${tapTrail.length} actual=${metrics.primary_action_count}`);
    }
    if (!metrics.checkpoint_net_worth || !Object.prototype.hasOwnProperty.call(metrics.checkpoint_net_worth, "10")) {
      problems.push("missing day 5/10/15 net-worth checkpoints");
    }
    if (!Number.isFinite(Number(metrics.duration_seconds)) || Number(metrics.duration_seconds) < 0) {
      problems.push(`invalid duration metric ${metrics.duration_seconds}`);
    }
    if (!metrics.event_counts || Number(metrics.event_counts.travel || 0) < Math.floor(finalState.game.totalDays * 0.6)) {
      problems.push("playtest metrics do not contain the completed action loop");
    }
  }
  if (tapTrail.length > MAX_TAPS_PER_RUN) problems.push(`too many taps ${tapTrail.length}`);
  const sessionUpperBound = TARGET_SESSION_MINUTES * 1.1;
  if (estimatedMinutes > sessionUpperBound) {
    problems.push(`estimated run too long ${estimatedMinutes.toFixed(1)}min (target ${TARGET_SESSION_MINUTES}min)`);
  }
  const completedTravelActions = Number(finalState.game.eventSummary.travel || 0);
  if ((actions.buy || 0) <= 0 || (actions.sell || 0) <= 0 || completedTravelActions < Math.floor(finalState.game.totalDays * 0.6)) {
    problems.push(`thin action loop buy=${actions.buy || 0} sell=${actions.sell || 0} completed-travel=${completedTravelActions}`);
  }
  if (problems.length) {
    const summaryPreview = String(finalState.endSummary || "").replace(/\s+/g, " ").slice(0, 700);
    throw new Error(`Run ${runIndex + 1}: ${problems.join("; ")}; end-summary=${JSON.stringify(summaryPreview)}`);
  }

  const shot = path.join(shotDir, `run_${runIndex + 1}_end.png`);
  await screenshot(cdp, shot);

  return {
    run: runIndex + 1,
    taps: totalTaps,
    mainTaps: tapTrail.length,
    extraTaps,
    estimatedMinutes,
    durationMs: Date.now() - startedAt,
    actions,
    final: finalState.game,
    qaErrors: finalState.qaErrors,
    feedback,
    endSummary: finalState.endSummary,
    screenshot: shot,
    capacityAttempts: tapTrail.filter((tap) => tap.modal?.capacity).map((tap) => ({ day: tap.day, ...tap.modal.capacity })),
    tapTrail: tapTrail.slice(-24),
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const runStamp = `${stamp()}${REPORT_LABEL ? `_${REPORT_LABEL}` : ""}`;
const shotDir = path.join(OUT_DIR, `${runStamp}_screens`);
fs.mkdirSync(shotDir, { recursive: true });

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
if (QA_FEEDBACK) {
  const url = new URL(targetUrl);
  url.searchParams.set("qa_feedback", "1");
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
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: seededRandomSource(SEED) });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp.send("Page.navigate", { url: targetUrl });
  await waitFor(cdp, `document.readyState !== "loading" && Boolean(document.getElementById("thumbActionBtn"))`, "game page readiness");
  await waitFor(cdp, `document.body.classList.contains("mobile-ui")`, "mobile mode");
  const startGoalText = await evaluate(cdp, `document.getElementById("startGoalCard")?.innerText || ""`);
  if (!startGoalText.includes("首局目标") && !startGoalText.includes("本局开跑目标")) {
    throw new Error(`Start goal card missing title: ${startGoalText}`);
  }
  if (!startGoalText.includes("45 天") && !startGoalText.includes("本机最佳")) {
    throw new Error(`Start goal card missing run target or career stats: ${startGoalText}`);
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
  if (!startConfirmRect?.visible || startConfirmRect.height < 44) {
    throw new Error(`Start confirm button is too small or hidden: ${JSON.stringify(startConfirmRect)}`);
  }
  if (startConfirmRect.cardWidth && startConfirmRect.width < startConfirmRect.cardWidth * 0.82) {
    throw new Error(`Start confirm button is not prominent enough: ${JSON.stringify(startConfirmRect)}`);
  }
  if (!startConfirmRect.textFits) {
    throw new Error(`Start confirm button text overflows: ${JSON.stringify(startConfirmRect)}`);
  }
  if (!/223,\s*242,\s*230/.test(startConfirmRect.backgroundColor || "")) {
    throw new Error(`Start confirm button does not match the primary action style: ${JSON.stringify(startConfirmRect)}`);
  }
  if (!startConfirmRect.text.includes("开始 ·") || !/(下一步|冲|刷新|破纪录)/.test(startConfirmRect.text)) {
    throw new Error(`Start confirm button does not carry the run goal: ${startConfirmRect.text}`);
  }
  await evaluate(cdp, `document.getElementById("startConfirmBtn")?.click(); true`);
  await sleep(300);

  const version = await evaluate(cdp, `typeof GAME_VERSION_CODE === "string" ? GAME_VERSION_CODE : "unknown"`);
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    runs.push(await runSingle(cdp, i, shotDir));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    targetUrl,
    viewport: { width: WIDTH, height: HEIGHT },
    humanSecondsPerTap: HUMAN_SECONDS_PER_TAP,
    targetSessionMinutes: TARGET_SESSION_MINUTES,
    seed: SEED,
    version,
    runs,
  };
  const jsonPath = path.join(OUT_DIR, `${runStamp}_report.json`);
  const mdPath = path.join(OUT_DIR, `${runStamp}_report.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, buildMarkdown(report));
  console.log(`Mobile long-run playtest passed: ${RUNS} runs at ${WIDTH}x${HEIGHT}`);
  console.log(`Report: ${jsonPath}`);
  console.log(`Summary: ${mdPath}`);
  console.log(`Screenshots: ${shotDir}`);
} catch (error) {
  let pageState = null;
  try {
    pageState = cdp ? await evaluate(cdp, `({
      url: location.href,
      readyState: document.readyState,
      hasThumbAction: Boolean(document.getElementById("thumbActionBtn")),
      title: document.title,
    })`) : null;
  } catch (_stateError) {}
  const hint = stderr.split("\\n").filter(Boolean).slice(-8).join("\\n");
  console.error(`Mobile long-run playtest failed: ${error.message}`);
  if (pageState) console.error(`Page state: ${JSON.stringify(pageState)}`);
  if (hint) console.error(hint);
  process.exitCode = 1;
} finally {
  cdp?.close();
  await stopChrome(chrome);
  if (chrome.profile) {
    try {
      fs.rmSync(chrome.profile, { recursive: true, force: true });
    } catch {}
  }
  await staticServer?.close();
}
