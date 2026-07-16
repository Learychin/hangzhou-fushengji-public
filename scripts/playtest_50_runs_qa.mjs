import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const ENGINE_JS = path.join(ROOT, "src", "engine", "game-engine.js");
const require = createRequire(import.meta.url);
const { maxAffordableBuyCount } = require("../src/engine/game-engine.js");
const OUT_DIR = path.join(ROOT, "reports", "qa_50_runs");
const RUNS = Number(process.env.RUNS || 50);
const SEED_BASE = Number(process.env.SEED_BASE || 20260630);
const MARKET_VISIBLE_LIMIT = 9;
const TARGET_ACTIONS_PER_RUN = 130;
const HARD_MAX_ACTIONS_PER_RUN = 500;

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function loadEngine(seed) {
  const source = fs.readFileSync(ENGINE_JS, "utf8");

  const seededMath = Object.create(Math);
  seededMath.random = seededRandom(seed);
  const context = { console, Date, Intl, Math: seededMath };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "src/engine/game-engine.js" });
  return context.HZFSJEngine;
}

function cny(n) {
  return `¥${Math.round(Number(n) || 0).toLocaleString("zh-CN")}`;
}

function avg(rows, key) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0) / rows.length;
}

function median(sorted) {
  if (!sorted.length) return 0;
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(sorted, pct) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * pct)));
  return sorted[idx];
}

function eventSummary(events) {
  const out = {};
  for (const event of events || []) {
    const type = event?.event_type || "unknown";
    out[type] = (out[type] || 0) + 1;
  }
  return out;
}

function visibleMarket(game) {
  return (game.market || []).slice(0, MARKET_VISIBLE_LIMIT);
}

function syncUiQuoteLayer(game) {
  game.ensureInventoryMarketQuotes?.();
  game.displayDrugs?.();
}

function maxBuyCount(game, row) {
  if (!row || row.price <= 0) return 0;
  const weight = row.weight || 1;
  const capacitySlots = Math.floor((game.coat - game.totalItems) / weight);
  return Math.max(0, maxAffordableBuyCount(game.cash, row.price, capacitySlots));
}

function newsEffectPct(game, goodsId) {
  return (game.todayNews?.effects || []).find((x) => x.goodsId === goodsId)?.pct || 0;
}

function refreshDayTradeGuards(game, state) {
  if (state.guardDay === game.daysUsed) return;
  state.guardDay = game.daysUsed;
  state.boughtThisDay = new Set();
  state.soldThisDay = new Set();
}

function bestBuy(game, state) {
  const rows = visibleMarket(game)
    .map((m) => {
      if (state.soldThisDay?.has(m.id)) return null;
      const goods = game.goods.find((g) => g.id === m.id);
      const max = maxBuyCount(game, m);
      if (!goods || max <= 0) return null;
      const span = Math.max(1, goods.span || 1);
      const pricePct = Math.max(-0.45, Math.min(1.45, (m.price - goods.base) / span));
      const newsPct = newsEffectPct(game, m.id);
      const capacityBoost = max >= 80 ? 10 : max >= 40 ? 6 : max >= 12 ? 3 : 0;
      const score = (1 - pricePct) * 70 + Math.max(0, newsPct) * 0.8 + capacityBoost;
      return { id: m.id, name: m.name, max, price: m.price, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const pick = rows[0];
  return pick && pick.score >= 36 ? pick : null;
}

function bestSell(game, state) {
  const rows = (game.inv || [])
    .map((it) => {
      if (state.boughtThisDay?.has(it.id) && game.timeLeft > 1) return null;
      const quote = game.previewSell?.(it.id, it.count);
      if (!quote?.ok || it.count <= 0) return null;
      return { id: it.id, name: it.name, count: it.count, pnl: quote.pnl, pnlPct: quote.pnlPct, price: quote.avgUnit, buyPrice: it.buyPrice };
    })
    .filter(Boolean)
    .sort((a, b) => b.pnlPct - a.pnlPct);
  const pick = rows[0];
  if (!pick) return null;
  const fillRate = game.coat > 0 ? game.totalItems / game.coat : 0;
  const late = game.timeLeft <= 6;
  if (pick.pnlPct >= 0.18 || fillRate >= 0.92 || late) return pick;
  return null;
}

function maybeRepay(game) {
  if (game.debt <= 0) return false;
  const pressure = game.debt >= 12000 || game.timeLeft <= 24;
  const enoughCash = game.cash >= game.debt * 1.55 || game.cash - game.debt >= 3500;
  if (!pressure || !enoughCash) return false;
  const before = game.debt;
  game.smartRepay();
  return game.debt < before;
}

function maybeExpand(game, buildCapacityPlan, maxCapacity) {
  if (game.coat >= maxCapacity) return false;
  const fillRate = game.coat > 0 ? game.totalItems / game.coat : 0;
  if (fillRate < 0.78) return false;
  const plan = buildCapacityPlan(game.coat, Math.min(maxCapacity, game.coat + 10));
  if (!Number.isFinite(plan.cost) || game.cash < plan.cost * 1.25) return false;
  const before = game.coat;
  const result = game.rentHouseTo(plan.target);
  return Boolean(result?.ok && game.coat > before);
}

function maybeBuyRumor(game) {
  if (game.cash < 30 || game.rumorBuff || game.timeLeft <= 7) return false;
  if (game.daysUsed <= 0 || game.daysUsed % 9 !== 0) return false;
  game.buyRumor();
  return true;
}

function chooseTravel(game, seed) {
  if (game.rumorBuff?.targetLoc && game.rumorBuff.targetLoc !== game.currentLoc) return game.rumorBuff.targetLoc;
  const choices = Array.from({ length: game.cityLabels.length }, (_, i) => i + 1)
    .filter((loc) => loc !== game.currentLoc);
  if (!choices.length) return 1;
  return choices[(seed + game.daysUsed * 5 + game.tradeCount * 3) % choices.length];
}

function snapshot(game) {
  return {
    day: game.daysUsed,
    timeLeft: game.timeLeft,
    loc: game.currentLoc,
    locName: game.cityLabels[game.currentLoc - 1] || "未出发",
    cash: game.cash,
    debt: game.debt,
    bank: game.bank,
    score: game.score,
    coat: game.coat,
    totalItems: game.totalItems,
    invKinds: game.inv.length,
    marketVisible: visibleMarket(game).length,
    marketInternal: game.market.length,
  };
}

function recordAction(actions, game, type, detail, before) {
  syncUiQuoteLayer(game);
  actions.push({
    step: actions.length + 1,
    type,
    detail,
    before,
    after: snapshot(game),
    lastLog: game.logs[game.logs.length - 1],
  });
}

function auditStep(game, issues, actionType) {
  if (!Number.isFinite(game.cash) || !Number.isFinite(game.debt) || !Number.isFinite(game.bank) || !Number.isFinite(game.score)) {
    issues.push({ severity: "high", message: "资金字段出现非有限数字", actionType, state: snapshot(game) });
  }
  if (game.cash < 0 || game.debt < 0 || game.bank < 0) {
    issues.push({ severity: "high", message: "资金字段出现负数", actionType, state: snapshot(game) });
  }
  if (game.totalItems > game.coat) {
    issues.push({ severity: "high", message: "持仓超过仓位上限", actionType, state: snapshot(game) });
  }
  const unsellable = game.inv.filter((it) => !game.market.some((m) => m.id === it.id));
  if (unsellable.length) {
    issues.push({ severity: "medium", message: "持仓商品缺少本地报价", actionType, goods: unsellable.map((x) => x.name), state: snapshot(game) });
  }
}

function runOne(seed) {
  const { GameEngine, TOTAL_DAYS, GAME_VERSION_CODE, buildCapacityPlan, MAX_CAPACITY } = loadEngine(seed);
  const game = new GameEngine();
  syncUiQuoteLayer(game);
  const actions = [];
  const issues = [];
  const counters = { buy: 0, sell: 0, travel: 0, repay: 0, expand: 0, rumor: 0, idle: 0 };
  const state = { guardDay: null, boughtThisDay: new Set(), soldThisDay: new Set() };
  let targetActionIssueRecorded = false;

  while (!game.gameOver && game.timeLeft > 0) {
    refreshDayTradeGuards(game, state);
    const before = snapshot(game);
    const sell = bestSell(game, state);
    if (sell) {
      game.sell(sell.id, sell.count);
      state.soldThisDay.add(sell.id);
      counters.sell += 1;
      recordAction(actions, game, "sell", sell, before);
      auditStep(game, issues, "sell");
    } else if (maybeRepay(game)) {
      counters.repay += 1;
      recordAction(actions, game, "repay", {}, before);
      auditStep(game, issues, "repay");
    } else if (maybeExpand(game, buildCapacityPlan, MAX_CAPACITY)) {
      counters.expand += 1;
      recordAction(actions, game, "expand", {}, before);
      auditStep(game, issues, "expand");
    } else if (maybeBuyRumor(game)) {
      counters.rumor += 1;
      recordAction(actions, game, "rumor", {}, before);
      auditStep(game, issues, "rumor");
    } else {
      const buy = bestBuy(game, state);
      if (buy) {
        game.buy(buy.id, buy.max);
        state.boughtThisDay.add(buy.id);
        counters.buy += 1;
        recordAction(actions, game, "buy", buy, before);
        auditStep(game, issues, "buy");
      } else {
        const loc = chooseTravel(game, seed);
        game.oneTravelTurn(loc);
        syncUiQuoteLayer(game);
        counters.travel += 1;
        recordAction(actions, game, "travel", { loc, locName: game.cityLabels[loc - 1] }, before);
        auditStep(game, issues, "travel");
      }
    }

    if (!targetActionIssueRecorded && actions.length > TARGET_ACTIONS_PER_RUN) {
      issues.push({ severity: "warning", message: "细粒度机器人操作数超过 130；需以移动端真实点击长测复核局长", state: snapshot(game) });
      targetActionIssueRecorded = true;
    }
    if (actions.length > HARD_MAX_ACTIONS_PER_RUN) {
      issues.push({ severity: "critical", message: "单局操作数超过硬上限，疑似循环卡死", state: snapshot(game) });
      break;
    }
  }

  return {
    seed,
    version: GAME_VERSION_CODE,
    final: snapshot(game),
    gameOver: game.gameOver,
    totalDays: TOTAL_DAYS,
    counters,
    actions,
    issues,
    logs: game.logs,
    eventSummary: eventSummary(game.eventLog),
    eventLog: game.eventLog,
  };
}

function collectFindings(runs) {
  const findings = [];
  const issueRows = runs.flatMap((run) => run.issues.map((issue) => ({ seed: run.seed, ...issue })));
  const highIssues = issueRows.filter((x) => x.severity === "high");
  const mediumIssues = issueRows.filter((x) => x.severity === "medium");
  const warnings = issueRows.filter((x) => x.severity === "warning");
  if (highIssues.length) findings.push(`高风险异常 ${highIssues.length} 条，优先看 seeds: ${[...new Set(highIssues.map((x) => x.seed))].slice(0, 8).join(", ")}`);
  if (mediumIssues.length) findings.push(`中风险异常 ${mediumIssues.length} 条，主要是持仓报价/状态不一致。`);
  if (warnings.length) findings.push(`节奏警告 ${warnings.length} 条：细粒度引擎机器人动作偏多，不能直接等同于手机主按钮点击。`);

  const scores = runs.map((r) => r.final.score).sort((a, b) => a - b);
  const actions = runs.map((r) => r.actions.length).sort((a, b) => a - b);
  const negative = runs.filter((r) => r.final.score <= 0);
  const million = runs.filter((r) => r.final.score >= 1_000_000);
  const huge = runs.filter((r) => r.final.score >= 10_000_000);
  if (negative.length) findings.push(`${negative.length}/${runs.length} 局最终净资产不为正，前期容错仍偏硬。`);
  if (huge.length >= Math.ceil(runs.length * 0.2)) findings.push(`${huge.length}/${runs.length} 局超过千万，后期财富曲线可能偏爆炸。`);
  if (actions[actions.length - 1] > 100) findings.push(`细粒度机器人最多 ${actions[actions.length - 1]} 步；发布门槛以包含新闻关闭和扩仓确认的移动端长测为准。`);
  if (million.length < Math.ceil(runs.length * 0.2)) findings.push(`只有 ${million.length}/${runs.length} 局达到百万，分享竞争的“爽点”可能不足。`);

  return { findings, scores, actions };
}

function writeReport(runs) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rawPath = path.join(OUT_DIR, "runs.json");
  fs.writeFileSync(rawPath, JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2));

  const { findings, scores, actions } = collectFindings(runs);
  const total = runs.length;
  const totals = runs.reduce((acc, run) => {
    for (const [key, value] of Object.entries(run.counters)) acc[key] = (acc[key] || 0) + value;
    return acc;
  }, {});
  const issues = runs.flatMap((run) => run.issues.map((issue) => ({ seed: run.seed, ...issue })));
  const best = runs.reduce((a, b) => (a.final.score > b.final.score ? a : b));
  const worst = runs.reduce((a, b) => (a.final.score < b.final.score ? a : b));

  const md = [
    "# 杭州浮生记 50 局自动试玩 QA",
    "",
    `生成时间：${new Date().toISOString()}`,
    `版本：${runs[0]?.version || "unknown"}`,
    `原始记录：\`${rawPath}\``,
    "",
    "## 总览",
    "",
    `- 局数：${total}`,
    `- 分数 min / p25 / median / avg / p75 / p90 / max：${cny(scores[0])} / ${cny(percentile(scores, 0.25))} / ${cny(median(scores))} / ${cny(avg(runs.map((r) => ({ score: r.final.score })), "score"))} / ${cny(percentile(scores, 0.75))} / ${cny(percentile(scores, 0.9))} / ${cny(scores[scores.length - 1])}`,
    `- 操作数 min / median / avg / max：${actions[0]} / ${median(actions)} / ${avg(runs.map((r) => ({ actions: r.actions.length })), "actions").toFixed(1)} / ${actions[actions.length - 1]}`,
    `- 平均动作：买入 ${(totals.buy / total).toFixed(1)}，卖出 ${(totals.sell / total).toFixed(1)}，换地方 ${(totals.travel / total).toFixed(1)}，还债 ${(totals.repay / total).toFixed(1)}，扩仓 ${(totals.expand / total).toFixed(1)}，情报 ${(totals.rumor / total).toFixed(1)}`,
    `- 最差局：seed ${worst.seed}，${cny(worst.final.score)}，${worst.actions.length} 步`,
    `- 最好局：seed ${best.seed}，${cny(best.final.score)}，${best.actions.length} 步`,
    "",
    "## 自动发现",
    "",
    ...(findings.length ? findings.map((x) => `- ${x}`) : ["- 未发现高风险数值异常。"]),
    "",
    "## 异常与警告样本",
    "",
    ...(issues.length
      ? issues.slice(0, 20).map((x) => `- [${x.severity}] seed ${x.seed}：${x.message}（day ${x.state?.day ?? "?"}，score ${cny(x.state?.score ?? 0)}）`)
      : ["- 无。"]),
    "",
    "## 每局摘要",
    "",
    "| seed | score | actions | buy | sell | travel | repay | expand | issues |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...runs.map((r) => `| ${r.seed} | ${cny(r.final.score)} | ${r.actions.length} | ${r.counters.buy} | ${r.counters.sell} | ${r.counters.travel} | ${r.counters.repay} | ${r.counters.expand} | ${r.issues.length} |`),
    "",
  ].join("\n");

  const reportPath = path.join(OUT_DIR, "report.md");
  fs.writeFileSync(reportPath, md);
  return { rawPath, reportPath, findings, scores, actions, issues };
}

const runs = [];
for (let i = 0; i < RUNS; i += 1) runs.push(runOne(SEED_BASE + i));
const result = writeReport(runs);

console.log(`Saved ${RUNS} QA runs`);
console.log(`Report: ${result.reportPath}`);
console.log(`Raw records: ${result.rawPath}`);
console.log(`Score min/median/avg/max: ${cny(result.scores[0])} / ${cny(median(result.scores))} / ${cny(avg(runs.map((r) => ({ score: r.final.score })), "score"))} / ${cny(result.scores[result.scores.length - 1])}`);
console.log(`Actions min/median/avg/max: ${result.actions[0]} / ${median(result.actions)} / ${avg(runs.map((r) => ({ actions: r.actions.length })), "actions").toFixed(1)} / ${result.actions[result.actions.length - 1]}`);
console.log(`Issues: ${result.issues.length}`);
