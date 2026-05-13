import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";

const ROOT = process.cwd();
const GAME_URL = `file://${path.join(ROOT, "web_mvp", "index.html")}`;
const OUT_DIR = path.join(ROOT, "reports");
const RUNS = Number(process.env.RUNS || 3);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function ensureMobileMode(page) {
  await page.waitForSelector("#dayText");
  const startVisible = await page.evaluate(() => {
    const modal = document.getElementById("startModal");
    return modal && !modal.classList.contains("hidden");
  });
  if (startVisible) await page.click("#startConfirmBtn");

  await page.waitForTimeout(60);
  const isMobile = await page.evaluate(() => document.body.classList.contains("mobile-ui"));
  if (!isMobile) await page.click("#uiModeToggleBtn");
  await page.waitForFunction(() => document.body.classList.contains("mobile-ui"));
}

async function closeEventModalIfAny(page) {
  const visible = await page.evaluate(() => {
    const modal = document.getElementById("eventModal");
    return modal && !modal.classList.contains("hidden");
  });
  if (visible) {
    await page.click("#eventOkBtn");
    await page.waitForTimeout(60);
  }
}

async function closeCapacityModalIfAny(page) {
  const visible = await page.evaluate(() => {
    const modal = document.getElementById("capacityModal");
    return modal && !modal.classList.contains("hidden");
  });
  if (visible) {
    await page.evaluate(() => {
      const cancel = document.getElementById("capacityCancelBtn");
      if (cancel) cancel.click();
      const modal = document.getElementById("capacityModal");
      if (modal) modal.classList.add("hidden");
    });
    await page.waitForTimeout(40);
  }
}

async function snapshot(page) {
  return page.evaluate(() => {
    const byId = Object.fromEntries(game.market.map((m, idx) => [m.id, idx]));
    const invById = Object.fromEntries(game.inv.map((m, idx) => [m.id, idx]));
    return {
      runId,
      dayUsed: 45 - game.timeLeft,
      timeLeft: game.timeLeft,
      score: game.score,
      cash: game.cash,
      debt: game.debt,
      bank: game.bank,
      coat: game.coat,
      totalItems: game.totalItems,
      gameOver: game.gameOver,
      currentLoc: game.currentLoc,
      market: game.market.map((m) => ({ ...m, index: byId[m.id] })),
      inv: game.inv.map((i) => ({ ...i, index: invById[i.id] })),
      logs: [...game.logs],
      eventLog: [...game.eventLog],
      rumorBuff: game.rumorBuff ? { ...game.rumorBuff } : null,
    };
  });
}

async function chooseAction(page) {
  return page.evaluate(() => {
    const day = 45 - game.timeLeft;
    const fillRate = game.coat > 0 ? game.totalItems / game.coat : 0;
    const marketById = new Map(game.market.map((m) => [m.id, m]));
    const goodsById = new Map(game.goods.map((g) => [g.id, g]));
    const lastTrade = game.lastTrade || null;
    const newsPctByName = new Map((game.todayNews?.effects || []).map((e) => [e.name, Number(e.pct || 0)]));

    if (game.debt > 0 && game.cash > game.debt * 2.8) return { type: "repay" };

    if (game.coat < 500 && fillRate > 0.68) {
      const target = Math.min(500, game.coat + 10);
      let nextStepCost = Infinity;
      if (typeof buildCapacityPlan === "function") nextStepCost = buildCapacityPlan(game.coat, target).cost;
      else if (typeof capacityStepCost === "function") nextStepCost = capacityStepCost(target);
      else nextStepCost = 22000;
      if (Number.isFinite(nextStepCost) && game.cash >= nextStepCost * 1.25) {
        return { type: "expand", target, nextStepCost };
      }
    }

    const sellCandidates = game.inv
      .map((it) => {
        const mk = marketById.get(it.id);
        if (!mk) return null;
        if (lastTrade?.type === "buy" && lastTrade.goodsId === it.id && day < 44) return null;
        const pnlPct = it.buyPrice > 0 ? (mk.price - it.buyPrice) / it.buyPrice : 0;
        return { id: it.id, pnlPct, count: it.count, price: mk.price, buyPrice: it.buyPrice };
      })
      .filter(Boolean)
      .sort((a, b) => b.pnlPct - a.pnlPct);
    const bestSell = sellCandidates[0];
    if (bestSell && (bestSell.pnlPct > 0.2 || day >= 40 || fillRate > 0.9)) return { type: "sell", id: bestSell.id };

    if (game.cash >= 30 && day % 9 === 0 && !game.rumorBuff) return { type: "rumor" };

    const buyCandidates = game.market
      .map((m) => {
        const g = goodsById.get(m.id);
        const weight = m.weight || 1;
        const maxByCash = Math.floor(game.cash / m.price);
        const maxByCap = Math.floor((game.coat - game.totalItems) / weight);
        const max = Math.min(maxByCash, maxByCap);
        if (max <= 0) return null;
        const ratioToBase = g?.base ? m.price / g.base : 1;
        const vol = g?.base ? g.span / g.base : 0;
        if (lastTrade?.type === "sell" && lastTrade.goodsId === m.id && day < 44) return null;
        const newsPct = newsPctByName.get(m.name) || 0;
        const newsBoost = newsPct / 100;
        const score = (1 - ratioToBase) + vol * 0.42 + (max >= 80 ? 0.3 : max >= 50 ? 0.18 : 0) + newsBoost * 0.9;
        return { id: m.id, score, max };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    const bestBuy = buyCandidates[0];
    if (bestBuy) return { type: "buy", id: bestBuy.id };

    return { type: "none" };
  });
}

async function doAction(page, action) {
  if (!action || action.type === "none") return false;
  if (action.type === "repay") {
    await page.evaluate(() => {
      if (document.body.classList.contains("mobile-ui")) {
        document.body.classList.remove("mobile-view-trade");
        document.body.classList.add("mobile-view-status");
      }
    });
    await page.waitForTimeout(30);
    await page.click("#repaySmartBtn");
    await sleep(80);
    return true;
  }
  if (action.type === "rumor") {
    await page.evaluate(() => {
      if (document.body.classList.contains("mobile-ui")) {
        document.body.classList.remove("mobile-view-status");
        document.body.classList.add("mobile-view-trade");
      }
    });
    await page.waitForTimeout(20);
    await page.click("#rumorBtn");
    await sleep(80);
    return true;
  }
  if (action.type === "expand") {
    const before = await page.evaluate(() => ({ coat: game.coat, logsLen: game.logs.length }));
    await closeCapacityModalIfAny(page);
    await page.click("#quickExpandBtn");
    await sleep(120);
    const visible = await page.evaluate(() => {
      const modal = document.getElementById("capacityModal");
      return modal && !modal.classList.contains("hidden");
    });
    if (visible) {
      await page.evaluate((target) => {
        const input = document.getElementById("capacityTargetInput");
        if (!input) return;
        const min = Number(input.min || 0);
        const max = Number(input.max || 500);
        const t = Math.max(min, Math.min(max, Number(target || input.value)));
        input.value = String(t);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, action.target || null);
      await page.waitForTimeout(40);
      await page.click("#capacityConfirmBtn");
      await sleep(100);
    }
    await closeCapacityModalIfAny(page);
    const after = await page.evaluate(() => ({ coat: game.coat, logsLen: game.logs.length, lastLog: game.logs[game.logs.length - 1] || "" }));
    if (after.coat > before.coat) return true;
    if (after.logsLen > before.logsLen && after.lastLog.includes("当前目标升级需")) return false;
    return false;
  }
  if (action.type === "buy") {
    await page.evaluate(() => {
      if (document.body.classList.contains("mobile-ui")) {
        document.body.classList.remove("mobile-view-status");
        document.body.classList.add("mobile-view-trade");
      }
    });
    await page.waitForTimeout(20);
    const idx = await page.evaluate((goodsId) => game.market.findIndex((m) => m.id === goodsId), action.id);
    if (idx < 0) return false;
    await page.locator("#marketTable tbody tr").nth(idx).click();
    await sleep(40);
    await page.click("#buyMaxBtn");
    await sleep(80);
    return true;
  }
  if (action.type === "sell") {
    await page.evaluate(() => {
      if (document.body.classList.contains("mobile-ui")) {
        document.body.classList.remove("mobile-view-status");
        document.body.classList.add("mobile-view-trade");
      }
    });
    await page.waitForTimeout(20);
    const idx = await page.evaluate((goodsId) => game.inv.findIndex((m) => m.id === goodsId), action.id);
    if (idx < 0) return false;
    await page.locator("#invTable tbody tr").nth(idx).click();
    await sleep(40);
    await page.click("#sellMaxBtn");
    await sleep(80);
    return true;
  }
  return false;
}

async function travelOneDay(page, prevDay) {
  const loc = await page.evaluate(() => {
    if (game.rumorBuff?.targetLoc && game.rumorBuff.targetLoc !== game.currentLoc) return game.rumorBuff.targetLoc;
    const all = Array.from({ length: game.cityLabels.length }, (_, i) => i + 1).filter((x) => x !== game.currentLoc);
    return all[Math.floor(Math.random() * all.length)] || 1;
  });
  const idx = Math.max(0, loc - 1);
  await page.locator("#placeDockGrid .place-dock-item").nth(idx).click();
  await page.waitForFunction((day) => (45 - game.timeLeft) > day, prevDay);
  await sleep(50);
}

function summarizeEvents(eventLog) {
  const out = {};
  for (const e of eventLog || []) {
    const t = e?.event_type || "unknown";
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}

async function runSingleGame(page, runIndex, shotDir) {
  if (runIndex > 0) {
    await page.click("#newGameBtnTop");
    await sleep(100);
    const startVisible = await page.evaluate(() => {
      const modal = document.getElementById("startModal");
      return modal && !modal.classList.contains("hidden");
    });
    if (startVisible) await page.click("#startConfirmBtn");
    await sleep(60);
  }

  let safety = 0;
  while (safety < 1400) {
    safety += 1;
    await closeEventModalIfAny(page);
    await closeCapacityModalIfAny(page);
    const snap = await snapshot(page);
    if (snap.gameOver || snap.timeLeft <= 0) break;

    for (let i = 0; i < 5; i++) {
      const action = await chooseAction(page);
      const done = await doAction(page, action);
      await closeEventModalIfAny(page);
      if (!done) break;
    }

    const before = await snapshot(page);
    if (before.gameOver || before.timeLeft <= 0) break;
    await travelOneDay(page, before.dayUsed);
  }

  await closeEventModalIfAny(page);
  const result = await snapshot(page);

  const endVisible = await page.evaluate(() => {
    const modal = document.getElementById("endModal");
    return modal && !modal.classList.contains("hidden");
  });
  if (endVisible) {
    await page.click("#endSkipBtn");
    await sleep(80);
  }

  await page.screenshot({ path: path.join(shotDir, `run_${runIndex + 1}.png`), fullPage: true });

  return {
    run: runIndex + 1,
    final: {
      score: result.score,
      cash: result.cash,
      debt: result.debt,
      bank: result.bank,
      dayUsed: result.dayUsed,
      coat: result.coat,
      items: result.totalItems,
    },
    eventSummary: summarizeEvents(result.eventLog),
    logTail: result.logs.slice(-28),
    fullLog: result.logs,
  };
}

function buildMarkdown(report) {
  const scores = report.runs.map((r) => r.final.score);
  const best = Math.max(...scores);
  const worst = Math.min(...scores);
  const avg = Math.floor(scores.reduce((a, b) => a + b, 0) / scores.length);
  const lines = [];
  lines.push(`# 移动端自动实玩报告（${report.runs.length}局）`);
  lines.push("");
  lines.push(`- 测试版本：${report.versionCode}`);
  lines.push(`- 时间：${report.generatedAt}`);
  lines.push(`- 设备：${report.device}`);
  lines.push(`- 成绩区间：¥${worst.toLocaleString("zh-CN")} ~ ¥${best.toLocaleString("zh-CN")}（均值 ¥${avg.toLocaleString("zh-CN")}）`);
  lines.push("");
  for (const run of report.runs) {
    lines.push(`## 第 ${run.run} 局`);
    lines.push(`- 最终总分：¥${run.final.score.toLocaleString("zh-CN")}`);
    lines.push(`- 现金：¥${run.final.cash.toLocaleString("zh-CN")} ｜ 存款：¥${run.final.bank.toLocaleString("zh-CN")} ｜ 欠债：¥${run.final.debt.toLocaleString("zh-CN")}`);
    lines.push(`- 仓位：${run.final.items}/${run.final.coat} ｜ 天数：${run.final.dayUsed}/45`);
    lines.push(`- 事件统计：${Object.entries(run.eventSummary).map(([k, v]) => `${k}:${v}`).join("，")}`);
    lines.push(`- 日志尾部：`);
    for (const row of run.logTail) lines.push(`  - ${row}`);
    lines.push("");
  }
  return lines.join("\n");
}

function findLocalChromeExecutable() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = nowStamp();
  const shotDir = path.join(OUT_DIR, `mobile_playtest_${stamp}_screens`);
  fs.mkdirSync(shotDir, { recursive: true });

  const localChrome = findLocalChromeExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(localChrome ? { executablePath: localChrome } : {}),
  });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();
  await page.goto(GAME_URL);
  await ensureMobileMode(page);

  const versionCode = await page.evaluate(() => GAME_VERSION_CODE || "unknown");

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const run = await runSingleGame(page, i, shotDir);
    runs.push(run);
  }
  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    device: "iPhone 13 (Playwright mobile emulation)",
    versionCode,
    gameUrl: GAME_URL,
    runs,
  };

  const jsonPath = path.join(OUT_DIR, `mobile_playtest_${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `mobile_playtest_${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(mdPath, buildMarkdown(report), "utf8");

  console.log(JSON.stringify({ ok: true, jsonPath, mdPath, shotDir }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
