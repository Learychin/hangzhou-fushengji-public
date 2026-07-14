import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const MAIN_JS = path.join(ROOT, "web_mvp", "main.js");
const RUNS = Number(process.env.RUNS || 48);
const SEED_BASE = Number(process.env.SEED_BASE || 20260621);
const MAX_TAPS_PER_RUN = Number(process.env.MAX_TAPS_PER_RUN || 160);

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function loadEngine(seed) {
  const source = fs.readFileSync(MAIN_JS, "utf8");
  const marker = "\n})();\n\n\"use strict\";";
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error("Could not find engine module boundary in web_mvp/main.js");

  const seededMath = Object.create(Math);
  seededMath.random = seededRandom(seed);
  const context = {
    console,
    Date,
    Intl,
    Math: seededMath,
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(0, markerIndex + "\n})();".length)}
globalThis.__exports = globalThis.HZFSJEngine;`,
    context,
    { filename: "web_mvp/main.js" },
  );
  return context.__exports;
}

function cny(n) {
  return `CNY ${Number(n).toLocaleString("zh-CN")}`;
}

function percentile(sorted, pct) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * pct)));
  return sorted[idx];
}

function netWorth(game) {
  return game.cash + game.bank - game.debt;
}

function maxBuyCount(game, goodsId) {
  const mk = game.market.find((x) => x.id === goodsId);
  if (!mk) return 0;
  return Math.max(0, Math.min(
    Math.floor(game.cash / mk.price),
    Math.floor((game.coat - game.totalItems) / (mk.weight || 1)),
  ));
}

function newsEffectPct(game, goodsId) {
  return (game.todayNews?.effects || []).find((x) => x.goodsId === goodsId)?.pct || 0;
}

function bestBuyOpportunity(game) {
  const rows = game.market
    .map((m) => {
      const goods = game.goods.find((g) => g.id === m.id);
      const max = maxBuyCount(game, m.id);
      if (!goods || max <= 0) return null;
      const span = Math.max(1, goods.span || 1);
      const percentile = Math.max(-0.45, Math.min(1.45, (m.price - goods.base) / span));
      const newsPct = newsEffectPct(game, m.id);
      const capacityBoost = max >= 80 ? 10 : max >= 40 ? 6 : max >= 12 ? 3 : 0;
      const score = (1 - percentile) * 70 + Math.max(0, newsPct) * 0.8 + capacityBoost;
      return {
        id: m.id,
        name: m.name,
        max,
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const best = rows[0];
  return best && best.score >= 36 ? best : null;
}

function bestSellOpportunity(game) {
  const rows = game.inv
    .map((it) => {
      const mk = game.market.find((m) => m.id === it.id);
      if (!mk || it.count <= 0) return null;
      const pnl = (mk.price - it.buyPrice) * it.count;
      const pnlPct = it.buyPrice > 0 ? (mk.price - it.buyPrice) / it.buyPrice : 0;
      return {
        id: it.id,
        name: it.name,
        count: it.count,
        pnl,
        pnlPct,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.pnl - a.pnl);
  const best = rows[0];
  return best && best.pnl > 0 ? best : null;
}

function suggestedTravelLocation(game) {
  if (game.gameOver) return null;
  if (game.rumorBuff?.targetLoc && game.rumorBuff.targetLoc !== game.currentLoc) return game.rumorBuff.targetLoc;
  const total = game.cityLabels.length;
  const start = game.currentLoc > 0 ? game.currentLoc : 0;
  for (let i = 1; i <= total; i += 1) {
    const loc = ((start + i - 1) % total) + 1;
    if (loc !== game.currentLoc) return loc;
  }
  return null;
}

function debtRepayOpportunity(game) {
  if (game.gameOver || game.debt <= 0) return null;
  const reserve = 1000;
  const amount = Math.max(0, Math.min(game.debt, game.cash - reserve));
  if (amount <= 0) return null;
  const debtPressure = game.debt >= 12000 || game.daysUsed >= Math.ceil(game.totalDays * 0.45);
  const canClearDebt = amount >= game.debt;
  const canClearMostDebt = amount >= Math.min(game.debt, Math.max(8000, Math.floor(game.debt * 0.75)));
  if (!canClearDebt && !(debtPressure && canClearMostDebt)) return null;
  return { amount };
}

function primaryTap(game, state) {
  const sell = bestSellOpportunity(game);
  if (sell) {
    game.sell(sell.id, sell.count);
    state.sells += 1;
    return "sell";
  }

  if (debtRepayOpportunity(game)) {
    const before = game.debt;
    const paid = game.smartRepay();
    if (paid <= 0 || game.debt >= before) throw new Error("Debt opportunity did not repay");
    state.repays += 1;
    return "repay";
  }

  const buy = bestBuyOpportunity(game);
  if (buy && state.lastPrimaryBuyDay !== game.daysUsed) {
    state.lastPrimaryBuyDay = game.daysUsed;
    game.buy(buy.id, buy.max);
    state.buys += 1;
    return "buy";
  }

  const loc = suggestedTravelLocation(game);
  if (!loc) throw new Error("No suggested travel location");
  const beforeDay = game.daysUsed;
  game.oneTravelTurn(loc);
  if (!game.gameOver && game.daysUsed <= beforeDay) {
    throw new Error(`Travel did not advance day ${beforeDay} to loc ${loc}`);
  }
  state.travels += 1;
  return "travel";
}

function runOne(seed) {
  const { GameEngine, TOTAL_DAYS, GAME_VERSION_CODE } = loadEngine(seed);
  const game = new GameEngine();
  const state = {
    lastPrimaryBuyDay: null,
    buys: 0,
    sells: 0,
    repays: 0,
    travels: 0,
  };
  const actionTrail = [];

  while (!game.gameOver && game.timeLeft > 0) {
    const action = primaryTap(game, state);
    actionTrail.push(action);
    if (actionTrail.length > MAX_TAPS_PER_RUN) {
      throw new Error(`Seed ${seed} exceeded ${MAX_TAPS_PER_RUN} thumb taps without finishing`);
    }
  }

  return {
    seed,
    version: GAME_VERSION_CODE,
    score: game.score,
    netWorth: netWorth(game),
    cash: game.cash,
    debt: game.debt,
    bank: game.bank,
    daysUsed: game.daysUsed,
    totalDays: TOTAL_DAYS,
    timeLeft: game.timeLeft,
    gameOver: game.gameOver,
    taps: actionTrail.length,
    buys: state.buys,
    sells: state.sells,
    repays: state.repays,
    travels: state.travels,
    inventoryCount: game.inv.length,
    totalItems: game.totalItems,
    lastActions: actionTrail.slice(-8).join(","),
    lastLog: game.logs[game.logs.length - 1],
  };
}

function assertRun(result) {
  const problems = [];
  if (!result.gameOver) problems.push("game did not finish");
  if (result.daysUsed !== result.totalDays) problems.push(`daysUsed ${result.daysUsed}/${result.totalDays}`);
  if (result.timeLeft !== 0) problems.push(`timeLeft ${result.timeLeft}`);
  if (result.travels !== result.totalDays) problems.push(`travels ${result.travels}/${result.totalDays}`);
  if (result.buys <= 0) problems.push("thumb flow never found a buy opportunity");
  if (result.sells <= 0) problems.push("thumb flow never found a sell opportunity");
  if (result.repays <= 0) problems.push("thumb flow never surfaced debt repayment");
  if (result.taps > MAX_TAPS_PER_RUN) problems.push(`too many taps ${result.taps}/${MAX_TAPS_PER_RUN}`);
  if (!Number.isFinite(result.score) || !Number.isFinite(result.netWorth)) problems.push("score or net worth is not finite");
  if (result.inventoryCount !== 0 || result.totalItems !== 0) problems.push("inventory not cleared at final settlement");
  if (problems.length) {
    throw new Error(`Seed ${result.seed}: ${problems.join("; ")}. Last actions: ${result.lastActions}. Last log: ${result.lastLog || "(none)"}`);
  }
}

const results = [];
for (let i = 0; i < RUNS; i += 1) {
  const result = runOne(SEED_BASE + i);
  assertRun(result);
  results.push(result);
}

const scores = results.map((r) => r.score).sort((a, b) => a - b);
const taps = results.map((r) => r.taps).sort((a, b) => a - b);
const avg = (rows, key) => rows.reduce((sum, r) => sum + r[key], 0) / rows.length;
const avgScore = Math.round(avg(results, "score"));
const avgTaps = avg(results, "taps").toFixed(1);
const avgBuys = avg(results, "buys").toFixed(1);
const avgSells = avg(results, "sells").toFixed(1);
const avgRepays = avg(results, "repays").toFixed(1);

console.log(`Thumb-flow simulation passed: ${RUNS} runs, ${results[0]?.version || "unknown"}`);
console.log(`Days: ${results[0]?.totalDays || 0}; taps min/median/avg/max: ${taps[0]} / ${taps[Math.floor(taps.length / 2)]} / ${avgTaps} / ${taps[taps.length - 1]}`);
console.log(`Actions/run avg: buys ${avgBuys}, sells ${avgSells}, repays ${avgRepays}, travels ${results[0]?.totalDays || 0}`);
console.log(`Score min/median/avg/max: ${cny(scores[0])} / ${cny(scores[Math.floor(scores.length / 2)])} / ${cny(avgScore)} / ${cny(scores[scores.length - 1])}`);
console.log(`Score p10/p25/p75/p90: ${cny(percentile(scores, 0.10))} / ${cny(percentile(scores, 0.25))} / ${cny(percentile(scores, 0.75))} / ${cny(percentile(scores, 0.90))}`);
