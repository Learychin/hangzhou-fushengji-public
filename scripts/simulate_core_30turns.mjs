import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ENGINE = require("../src/engine/game-engine.js");
const RUNS = Number(process.env.RUNS || 24);
const SEED_BASE = Number(process.env.SEED_BASE || 20260621);
const MAX_PRE_TRAVEL_ACTIONS = 6;

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
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

function maxBuyCount(game, row) {
  if (!row || row.price <= 0) return 0;
  const weight = row.weight || 1;
  return Math.max(0, Math.min(
    Math.floor(game.cash / row.price),
    Math.floor((game.coat - game.totalItems) / weight),
  ));
}

function newsEffectPct(game, goodsId) {
  const effect = (game.todayNews?.effects || []).find((x) => x.goodsId === goodsId);
  return Number(effect?.pct || 0);
}

function bestBuy(game, totalDays) {
  const lastTrade = game.lastTrade || null;
  const reversalGuardDay = Math.max(2, totalDays - 2);
  const rows = game.market
    .map((m) => {
      const goods = game.goods.find((g) => g.id === m.id);
      const max = maxBuyCount(game, m);
      if (!goods || max <= 0) return null;
      if (lastTrade?.type === "sell" && lastTrade.goodsId === m.id && game.daysUsed < reversalGuardDay) return null;
      const percentile = Math.max(-0.45, Math.min(1.45, (m.price - goods.base) / Math.max(1, goods.span || 1)));
      const newsPct = newsEffectPct(game, m.id);
      const capacityBoost = max >= 80 ? 10 : max >= 40 ? 6 : max >= 12 ? 3 : 0;
      const score = (1 - percentile) * 70 + Math.max(0, newsPct) * 0.8 + capacityBoost;
      return { id: m.id, max, score, price: m.price, name: m.name };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const best = rows[0];
  return best && best.score >= 36 ? best : null;
}

function bestSell(game, totalDays) {
  const lastTrade = game.lastTrade || null;
  const reversalGuardDay = Math.max(2, totalDays - 2);
  const lateSellDay = Math.max(1, totalDays - 5);
  const fillRate = game.coat > 0 ? game.totalItems / game.coat : 0;
  const rows = game.inv
    .map((it) => {
      const mk = game.market.find((m) => m.id === it.id);
      if (!mk || it.count <= 0) return null;
      if (lastTrade?.type === "buy" && lastTrade.goodsId === it.id && game.daysUsed < reversalGuardDay) return null;
      const pnl = (mk.price - it.buyPrice) * it.count;
      const pnlPct = it.buyPrice > 0 ? (mk.price - it.buyPrice) / it.buyPrice : 0;
      return { id: it.id, count: it.count, pnl, pnlPct, name: it.name };
    })
    .filter(Boolean)
    .sort((a, b) => b.pnlPct - a.pnlPct);
  const best = rows[0];
  if (!best) return null;
  if (best.pnlPct > 0.2 || game.daysUsed >= lateSellDay || fillRate > 0.9) return best;
  return null;
}

function maybeExpand(game, buildCapacityPlan) {
  const fillRate = game.coat > 0 ? game.totalItems / game.coat : 0;
  if (game.coat >= 500 || fillRate < 0.68) return false;
  const target = Math.min(500, game.coat + 10);
  const plan = buildCapacityPlan(game.coat, target);
  if (!Number.isFinite(plan.cost) || game.cash < plan.cost * 1.25) return false;
  const result = game.rentHouseTo(target);
  return Boolean(result?.ok);
}

function maybeRepay(game) {
  if (game.debt <= 0 || game.cash <= game.debt * 2.8) return false;
  const before = game.debt;
  game.smartRepay();
  return game.debt < before;
}

function maybeBuyRumor(game, totalDays) {
  const rumorCadence = Math.max(4, Math.round(totalDays / 4));
  if (game.cash < 30 || game.rumorBuff || game.daysUsed <= 0 || game.daysUsed % rumorCadence !== 0) return false;
  game.buyRumor();
  return true;
}

function doPreTravelActions(game, totalDays, buildCapacityPlan) {
  let actions = 0;
  for (let i = 0; i < MAX_PRE_TRAVEL_ACTIONS; i += 1) {
    if (game.gameOver) break;
    const sell = bestSell(game, totalDays);
    if (sell) {
      game.sell(sell.id, sell.count);
      actions += 1;
      continue;
    }
    if (maybeRepay(game)) {
      actions += 1;
      continue;
    }
    if (maybeExpand(game, buildCapacityPlan)) {
      actions += 1;
      continue;
    }
    if (maybeBuyRumor(game, totalDays)) {
      actions += 1;
      continue;
    }
    const buy = bestBuy(game, totalDays);
    if (buy) {
      game.buy(buy.id, buy.max);
      actions += 1;
      continue;
    }
    break;
  }
  return actions;
}

function chooseTravelLocation(game, seed) {
  if (game.rumorBuff?.targetLoc && game.rumorBuff.targetLoc !== game.currentLoc) return game.rumorBuff.targetLoc;
  const choices = Array.from({ length: game.cityLabels.length }, (_, i) => i + 1)
    .filter((loc) => loc !== game.currentLoc);
  if (!choices.length) return 1;
  const idx = (seed + game.daysUsed * 7 + game.tradeCount * 3) % choices.length;
  return choices[idx];
}

function summarizeEvents(events) {
  const out = {};
  for (const event of events || []) {
    const type = event?.event_type || "unknown";
    out[type] = (out[type] || 0) + 1;
  }
  return out;
}

function runOne(seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const { GameEngine, TOTAL_DAYS, GAME_VERSION_CODE, buildCapacityPlan } = ENGINE;
    const game = new GameEngine();
    let travelTurns = 0;
    let preTravelActions = 0;

    while (!game.gameOver && game.timeLeft > 0) {
      preTravelActions += doPreTravelActions(game, TOTAL_DAYS, buildCapacityPlan);
      if (game.gameOver || game.timeLeft <= 0) break;

      const beforeDay = game.daysUsed;
      const loc = chooseTravelLocation(game, seed);
      game.oneTravelTurn(loc);
      travelTurns += 1;
      if (!game.gameOver && game.daysUsed <= beforeDay) {
        throw new Error(`Run ${seed} did not advance after travel to ${loc}`);
      }
      if (travelTurns > TOTAL_DAYS + 2) {
        throw new Error(`Run ${seed} exceeded travel safety limit`);
      }
    }

    const eventSummary = summarizeEvents(game.eventLog);
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
      travelTurns,
      preTravelActions,
      inventoryCount: game.inv.length,
      totalItems: game.totalItems,
      eventSummary,
      lastLog: game.logs[game.logs.length - 1],
    };
  } finally {
    Math.random = originalRandom;
  }
}

function assertRun(result) {
  const problems = [];
  if (!result.gameOver) problems.push("game did not finish");
  if (result.daysUsed !== result.totalDays) problems.push(`daysUsed ${result.daysUsed}/${result.totalDays}`);
  if (result.timeLeft !== 0) problems.push(`timeLeft ${result.timeLeft}`);
  if (!Number.isFinite(result.score)) problems.push("score is not finite");
  if (!Number.isFinite(result.cash) || !Number.isFinite(result.debt) || !Number.isFinite(result.bank)) problems.push("money field is not finite");
  if (result.inventoryCount !== 0 || result.totalItems !== 0) problems.push("inventory not cleared at final settlement");
  if (!result.eventSummary.game_over) problems.push("missing game_over event");
  if (problems.length) {
    throw new Error(`Seed ${result.seed}: ${problems.join("; ")}. Last log: ${result.lastLog || "(none)"}`);
  }
}

function assertCityContentContract() {
  const game = new ENGINE.GameEngine();
  const locations = game.locations.map((_, index) => ({
    name: `测试地点${index + 1}`,
    district: index < 6 ? "north" : "south",
  }));
  const changed = game.configureCityContent({
    content_schema: "city-content-v1",
    locations,
    district_labels: { north: "城北", south: "城南" },
    product_overrides: [{ id: 0, name: "测试城市特产", base: 18, span: 42 }],
    news_pool: [{
      title: "【测试城市行情】",
      desc: "用于验证城市配置会驱动新闻与商品。",
      durationMin: 2,
      durationMax: 3,
      effects: [{ goodsIds: [0], minPct: 30, maxPct: 12, tag: "测试" }],
    }],
  });
  if (!changed) throw new Error("City content configuration was not applied");
  game.newGame();
  if (game.cityLabels[0] !== "测试地点1" || game.cityLabels.length !== 12) throw new Error("City locations were not applied");
  if (game.locationDistricts[11] !== "south" || game.districtLabels.north !== "城北") throw new Error("City districts were not applied");
  if (game.goods[0].name !== "测试城市特产" || game.goods[0].base !== 18) throw new Error("City product override was not applied");
  if (game.newsPool[0].title !== "【测试城市行情】" || game.newsPool[0].effects[0].minPct !== 12) throw new Error("City news pool was not normalized");
}

assertCityContentContract();

const results = [];
for (let i = 0; i < RUNS; i += 1) {
  const result = runOne(SEED_BASE + i);
  assertRun(result);
  results.push(result);
}

const scores = results.map((r) => r.score).sort((a, b) => a - b);
const avg = Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length);
const median = scores[Math.floor(scores.length / 2)];
const min = scores[0];
const max = scores[scores.length - 1];
const avgActions = (results.reduce((sum, r) => sum + r.preTravelActions + r.travelTurns, 0) / results.length).toFixed(1);

console.log(`Core simulation passed: ${RUNS} runs, ${results[0]?.version || "unknown"}`);
console.log(`Days: ${results[0]?.totalDays || 0}; score min/median/avg/max: ${cny(min)} / ${cny(median)} / ${cny(avg)} / ${cny(max)}`);
console.log(`Score p10/p25/p75/p90: ${cny(percentile(scores, 0.10))} / ${cny(percentile(scores, 0.25))} / ${cny(percentile(scores, 0.75))} / ${cny(percentile(scores, 0.90))}`);
console.log(`Average player actions per run: ${avgActions}`);
console.log(`Worst seed: ${results.find((r) => r.score === min)?.seed}; best seed: ${results.find((r) => r.score === max)?.seed}`);
