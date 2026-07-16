import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GameEngine,
  TOTAL_DAYS,
  GAME_VERSION_CODE,
  MAX_CAPACITY,
  buildCapacityPlan,
  maxAffordableBuyCount,
} = require("../src/engine/game-engine.js");

const ROOT = process.cwd();
const experimentsPath = path.join(ROOT, "src", "config", "gameplay-experiments.json");
const experiments = JSON.parse(fs.readFileSync(experimentsPath, "utf8"));
const requestedExperimentId = String(process.env.EXPERIMENT_ID || "").trim();
const selectedExperiment = requestedExperimentId
  ? experiments.variants.find((variant) => variant.id === requestedExperimentId)
  : null;
if (requestedExperimentId && !selectedExperiment) {
  throw new Error(`Unknown EXPERIMENT_ID: ${requestedExperimentId}`);
}
const EXPERIMENT_ID = selectedExperiment?.id || "engine_default";
const OUT_DIR = process.env.OUT_DIR
  ? path.resolve(ROOT, process.env.OUT_DIR)
  : path.join(ROOT, "reports", "balance_backtest");
const RUNS = Number(process.env.RUNS || 100);
const SEED_BASE = Number(process.env.SEED_BASE || 2026070301);
const MAX_ACTIONS = 260;
const CHECKPOINT_DAYS = [5, 10, 15, 30, 45];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function withSeed(seed, fn) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function cny(n) {
  return `¥${Math.round(Number(n) || 0).toLocaleString("zh-CN")}`;
}

function pct(n) {
  return `${Math.round((Number(n) || 0) * 100)}%`;
}

function avg(rows, key) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0) / rows.length;
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function eventSummary(events = []) {
  const out = {};
  for (const event of events) {
    const type = event?.event_type || "unknown";
    out[type] = (out[type] || 0) + 1;
  }
  return out;
}

function economyMetrics(events = []) {
  const metrics = {
    heldJackpots: 0,
    superSpikes: 0,
    liquidityCost: 0,
    buyDiscount: 0,
    warehouseFees: 0,
    realizedPnl: 0,
  };
  for (const event of events) {
    const payload = event?.payload || {};
    if (payload.held_jackpot) metrics.heldJackpots += 1;
    if (payload.super_spike) metrics.superSpikes += 1;
    if (event?.event_type === "trade" && payload.side === "sell") {
      metrics.liquidityCost += Number(payload.liquidity_cost) || 0;
      metrics.realizedPnl += Number(payload.pnl) || 0;
    }
    if (event?.event_type === "trade" && payload.side === "buy") {
      metrics.buyDiscount += Number(payload.discount_total) || 0;
    }
    if (event?.event_type === "warehouse_fee") metrics.warehouseFees += Number(payload.fee) || 0;
  }
  return metrics;
}

function storyMetrics(events = []) {
  const news = events.filter((event) => event?.event_type === "market_news");
  const chainStages = new Map();
  const newsByDay = new Map();
  const narrativeKeys = new Set();
  let smallGoodsSwings = 0;
  let heldJackpots = 0;
  let maxImpactPct = 0;

  for (const event of news) {
    const payload = event?.payload || {};
    const day = Number(payload.day) || 0;
    newsByDay.set(day, (newsByDay.get(day) || 0) + 1);
    const chainId = String(payload.chain_id || "");
    const chainStage = String(payload.chain_stage || "");
    if (chainId) {
      const stages = chainStages.get(chainId) || new Set();
      if (chainStage) stages.add(chainStage);
      chainStages.set(chainId, stages);
      narrativeKeys.add(`chain:${chainId}:${chainStage}`);
    } else if (payload.template_id) {
      narrativeKeys.add(`template:${payload.template_id}`);
    } else if (payload.small_goods_swing) {
      smallGoodsSwings += 1;
      narrativeKeys.add("small_goods_swing");
    } else if (payload.held_jackpot) {
      heldJackpots += 1;
      narrativeKeys.add("held_jackpot");
    }
    for (const impact of payload.impacts || []) {
      maxImpactPct = Math.max(maxImpactPct, Math.abs(Number(impact?.pct) || 0));
    }
  }

  let chainStarts = 0;
  let chainCompletions = 0;
  for (const stages of chainStages.values()) {
    if (stages.has("signal")) chainStarts += 1;
    if (stages.has("payoff") || stages.has("resolution")) chainCompletions += 1;
  }
  const maxNewsSameDay = Math.max(0, ...newsByDay.values());
  return {
    marketNews: news.length,
    uniqueNarratives: narrativeKeys.size,
    chainStarts,
    chainCompletions,
    smallGoodsSwings,
    heldJackpots,
    maxImpactPct,
    maxNewsSameDay,
    overloaded: maxNewsSameDay >= 3,
  };
}

function maxBuyCount(game, row) {
  if (!row || row.price <= 0) return 0;
  const weight = row.weight || 1;
  return Math.max(0, maxAffordableBuyCount(
    game.cash,
    row.price,
    Math.floor((game.coat - game.totalItems) / weight),
  ));
}

function newsEffectPct(game, goodsId) {
  return (game.todayNews?.effects || []).find((x) => x.goodsId === goodsId)?.pct || 0;
}

function opportunityScore(game, row, profile) {
  const goods = game.goods.find((g) => g.id === row.id);
  const max = maxBuyCount(game, row);
  if (!goods || max <= 0) return null;
  const span = Math.max(1, goods.span || 1);
  const relativePrice = Math.max(-0.45, Math.min(1.45, (row.price - goods.base) / span));
  const newsPct = newsEffectPct(game, row.id);
  const capacityBoost = max >= 80 ? 10 : max >= 40 ? 6 : max >= 12 ? 3 : 0;
  const relativeVolatility = Math.min(2.5, Math.max(0, goods.span / Math.max(1, goods.base)));
  const volatilityBoost = profile.volatilityBias * relativeVolatility;
  const financialPenalty = goods.kind === "financial" ? profile.financialPenalty : 0;
  const score = (1 - relativePrice) * 70 + Math.max(0, newsPct) * 0.8 + capacityBoost + volatilityBoost - financialPenalty;
  return { id: row.id, name: row.name, max, price: row.price, score, kind: goods.kind };
}

function bestBuy(game, state, profile) {
  const rows = game.market
    .map((row) => {
      if (state.soldToday.has(row.id) && game.timeLeft > 2) return null;
      const option = opportunityScore(game, row, profile);
      if (!option) return null;
      return option;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const eligible = rows.filter((row) => row.score >= profile.buyThreshold);
  const pick = profile.buyStyle === "random" && eligible.length
    ? eligible[Math.floor(Math.random() * eligible.length)]
    : rows[0];
  if (!pick || pick.score < profile.buyThreshold) return null;
  const count = Math.max(1, Math.floor(pick.max * profile.buyFraction));
  return { ...pick, count };
}

function bestSell(game, state, profile) {
  const fillRate = game.coat > 0 ? game.totalItems / game.coat : 0;
  const late = game.timeLeft <= profile.lateSellDays;
  const rows = game.inv
    .map((item) => {
      if (state.boughtToday.has(item.id) && game.timeLeft > 2) return null;
      const quote = game.previewSell(item.id, item.count);
      if (!quote?.ok || item.count <= 0) return null;
      return {
        id: item.id,
        name: item.name,
        count: item.count,
        pnl: quote.pnl,
        pnlPct: quote.pnlPct,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.pnlPct - a.pnlPct);
  const pick = rows[0];
  if (!pick) return null;
  if (profile.sellStyle === "random") {
    const randomPick = rows[Math.floor(Math.random() * rows.length)];
    if (late || fillRate >= profile.forceSellFillRate || Math.random() < profile.randomSellChance) return randomPick;
    return null;
  }
  if (pick.pnlPct >= profile.sellPnlPct || late || fillRate >= profile.forceSellFillRate) return pick;
  return null;
}

function maybeRepay(game, profile) {
  if (!profile.repay || game.debt <= 0) return false;
  const debtPressure = game.debt >= profile.repayDebtFloor || game.timeLeft <= profile.lateRepayDays;
  const enoughCash = game.cash >= game.debt * profile.repayCashMultiple || game.cash - game.debt >= profile.repayCashReserve;
  if (!debtPressure || !enoughCash) return false;
  const before = game.debt;
  game.smartRepay();
  return game.debt < before;
}

function maybeExpand(game, profile) {
  if (!profile.expand || game.coat >= MAX_CAPACITY) return false;
  const fillRate = game.coat > 0 ? game.totalItems / game.coat : 0;
  if (fillRate < profile.expandFillRate) return false;
  const target = Math.min(MAX_CAPACITY, game.coat + profile.expandStep);
  const plan = buildCapacityPlan(game.coat, target);
  if (!Number.isFinite(plan.cost) || game.cash < plan.cost * profile.expandCashMultiple) return false;
  const before = game.coat;
  const result = game.rentHouseTo(target);
  return Boolean(result?.ok && game.coat > before);
}

function maybeRumor(game, profile) {
  if (!profile.rumor || game.cash < 30 || game.rumorBuff || game.timeLeft <= 4) return false;
  if (game.daysUsed <= 0 || game.daysUsed % profile.rumorEveryDays !== 0) return false;
  game.buyRumor();
  return true;
}

function chooseTravel(game, seed, profile) {
  if (profile.followRumor && game.rumorBuff?.targetLoc && game.rumorBuff.targetLoc !== game.currentLoc) return game.rumorBuff.targetLoc;
  const choices = Array.from({ length: game.cityLabels.length }, (_, i) => i + 1)
    .filter((loc) => loc !== game.currentLoc);
  if (!choices.length) return 1;
  return choices[(seed + game.daysUsed * profile.travelStride + game.tradeCount * 3) % choices.length];
}

function resetDailyState(game, state) {
  if (state.day === game.daysUsed) return;
  state.day = game.daysUsed;
  state.boughtToday = new Set();
  state.soldToday = new Set();
  state.localActionsToday = 0;
}

function travel(game, seed, profile, counters) {
  const beforeDay = game.daysUsed;
  game.oneTravelTurn(chooseTravel(game, seed, profile));
  counters.travel += 1;
  return game.gameOver || game.daysUsed > beforeDay;
}

function runOne(seed, profile) {
  return withSeed(seed, () => {
    const game = new GameEngine({ experimentConfig: selectedExperiment?.config || {} });
    const state = {
      day: null,
      boughtToday: new Set(),
      soldToday: new Set(),
    };
    const counters = {
      buy: 0,
      sell: 0,
      travel: 0,
      repay: 0,
      expand: 0,
      rumor: 0,
      idle: 0,
    };
    const highWater = { cash: game.cash, score: game.score, debt: game.debt, capacity: game.coat };
    const checkpoints = {};
    const experience = {
      firstImprovementDay: null,
      firstBreakEvenDay: null,
      firstProfitableSaleDay: null,
      profitableSales: 0,
      losingSales: 0,
      maxTradePnl: 0,
      maxEarlyTradePnl: 0,
      uniqueGoods: new Set(),
      observedTradeCount: 0,
      newsAssistedProfitSales: 0,
      maxNewsAssistedPnl: 0,
      smallGoodsProfitSales: 0,
      biggestProfitGoodsId: null,
    };
    const warnings = [];
    let actions = 0;

    const captureExperience = () => {
      if (experience.firstImprovementDay === null && game.score > -3000) experience.firstImprovementDay = game.daysUsed;
      if (experience.firstBreakEvenDay === null && game.score >= 0) experience.firstBreakEvenDay = game.daysUsed;
      if (game.tradeCount > experience.observedTradeCount && game.lastTrade) {
        experience.observedTradeCount = game.tradeCount;
        experience.uniqueGoods.add(game.lastTrade.goodsId);
        if (game.lastTrade.type === "sell") {
          const pnl = Number(game.lastTrade.pnl) || 0;
          if (pnl > 0) {
            experience.profitableSales += 1;
            if (experience.firstProfitableSaleDay === null) experience.firstProfitableSaleDay = game.daysUsed;
            const goods = game.goods.find((item) => item.id === game.lastTrade.goodsId);
            if ((Number(goods?.base) || 0) <= 2500) experience.smallGoodsProfitSales += 1;
            const activePositiveNews = (game.activeNews || []).some((news) =>
              (news.impacts || []).some((impact) => impact.goodsId === game.lastTrade.goodsId && Number(impact.pct) > 0));
            if (activePositiveNews) {
              experience.newsAssistedProfitSales += 1;
              experience.maxNewsAssistedPnl = Math.max(experience.maxNewsAssistedPnl, pnl);
            }
          } else if (pnl < 0) {
            experience.losingSales += 1;
          }
          if (pnl > experience.maxTradePnl) experience.biggestProfitGoodsId = game.lastTrade.goodsId;
          experience.maxTradePnl = Math.max(experience.maxTradePnl, pnl);
          if (game.daysUsed <= 15) experience.maxEarlyTradePnl = Math.max(experience.maxEarlyTradePnl, pnl);
        }
      }
      for (const day of CHECKPOINT_DAYS) {
        if (game.daysUsed < day || checkpoints[day]) continue;
        checkpoints[day] = {
          day: game.daysUsed,
          score: game.score,
          cash: game.cash,
          debt: game.debt,
          capacity: game.coat,
          items: game.totalItems,
          trades: game.tradeCount,
        };
      }
    };

    while (!game.gameOver && game.timeLeft > 0) {
      resetDailyState(game, state);
      const mustTravel = state.localActionsToday >= profile.maxLocalActionsPerDay;
      if (mustTravel) {
        if (!travel(game, seed, profile, counters)) warnings.push("travel_did_not_advance");
      } else {
        const sell = bestSell(game, state, profile);
        if (sell) {
          game.sell(sell.id, sell.count);
          state.soldToday.add(sell.id);
          counters.sell += 1;
          state.localActionsToday += 1;
        } else if (maybeRepay(game, profile)) {
          counters.repay += 1;
          state.localActionsToday += 1;
        } else if (maybeExpand(game, profile)) {
          counters.expand += 1;
          state.localActionsToday += 1;
        } else if (maybeRumor(game, profile)) {
          counters.rumor += 1;
          state.localActionsToday += 1;
        } else {
          const buy = bestBuy(game, state, profile);
          if (buy) {
            game.buy(buy.id, buy.count);
            state.boughtToday.add(buy.id);
            counters.buy += 1;
            state.localActionsToday += 1;
          } else {
            counters.idle += 1;
            if (!travel(game, seed, profile, counters)) warnings.push("travel_did_not_advance");
          }
        }
      }

      actions += 1;
      highWater.cash = Math.max(highWater.cash, game.cash);
      highWater.score = Math.max(highWater.score, game.score);
      highWater.debt = Math.max(highWater.debt, game.debt);
      highWater.capacity = Math.max(highWater.capacity, game.coat);
      captureExperience();
      if (actions > MAX_ACTIONS) {
        warnings.push("too_many_actions");
        break;
      }
      if (!Number.isFinite(game.cash) || !Number.isFinite(game.debt) || !Number.isFinite(game.score)) {
        warnings.push("non_finite_money");
        break;
      }
    }

    const events = eventSummary(game.eventLog || []);
    const economy = economyMetrics(game.eventLog || []);
    const story = storyMetrics(game.eventLog || []);
    return {
      seed,
      profile: profile.id,
      experimentId: game.experimentConfig.experimentId,
      version: GAME_VERSION_CODE,
      score: game.score,
      cash: game.cash,
      bank: game.bank,
      debt: game.debt,
      capacity: game.coat,
      maxCash: highWater.cash,
      maxScore: highWater.score,
      maxDebt: highWater.debt,
      maxCapacity: highWater.capacity,
      actions,
      daysUsed: game.daysUsed,
      gameOver: game.gameOver,
      inventoryCount: game.inv.length,
      totalItems: game.totalItems,
      counters,
      events,
      economy,
      story,
      checkpoints,
      experience: {
        firstImprovementDay: experience.firstImprovementDay,
        firstBreakEvenDay: experience.firstBreakEvenDay,
        firstProfitableSaleDay: experience.firstProfitableSaleDay,
        profitableSales: experience.profitableSales,
        losingSales: experience.losingSales,
        maxTradePnl: experience.maxTradePnl,
        maxEarlyTradePnl: experience.maxEarlyTradePnl,
        uniqueGoods: experience.uniqueGoods.size,
        newsAssistedProfitSales: experience.newsAssistedProfitSales,
        maxNewsAssistedPnl: experience.maxNewsAssistedPnl,
        smallGoodsProfitSales: experience.smallGoodsProfitSales,
        biggestProfitGoodsId: experience.biggestProfitGoodsId,
      },
      warnings,
      lastLog: game.logs[game.logs.length - 1] || "",
    };
  });
}

const profiles = [
  {
    id: "impulsive_novice",
    label: "冲动新手",
    buyStyle: "random",
    sellStyle: "random",
    randomSellChance: 0.28,
    buyThreshold: 18,
    buyFraction: 0.62,
    sellPnlPct: 0.08,
    forceSellFillRate: 0.72,
    lateSellDays: 9,
    repay: true,
    repayDebtFloor: 9000,
    repayCashMultiple: 1.3,
    repayCashReserve: 1800,
    lateRepayDays: 10,
    expand: false,
    rumor: false,
    followRumor: false,
    travelStride: 3,
    volatilityBias: 0,
    financialPenalty: 5,
    maxLocalActionsPerDay: 2,
  },
  {
    id: "novice_conservative",
    label: "保守新手",
    buyThreshold: 54,
    buyFraction: 0.45,
    sellPnlPct: 0.13,
    forceSellFillRate: 0.8,
    lateSellDays: 7,
    repay: true,
    repayDebtFloor: 8000,
    repayCashMultiple: 1.35,
    repayCashReserve: 2500,
    lateRepayDays: 12,
    expand: false,
    rumor: false,
    followRumor: false,
    travelStride: 5,
    volatilityBias: 0,
    financialPenalty: 8,
    maxLocalActionsPerDay: 2,
  },
  {
    id: "thumb_baseline",
    label: "普通拇指流",
    buyThreshold: 42,
    buyFraction: 0.82,
    sellPnlPct: 0.18,
    forceSellFillRate: 0.92,
    lateSellDays: 6,
    repay: true,
    repayDebtFloor: 12000,
    repayCashMultiple: 1.55,
    repayCashReserve: 3500,
    lateRepayDays: 9,
    expand: true,
    expandFillRate: 0.78,
    expandStep: 10,
    expandCashMultiple: 1.25,
    rumor: false,
    followRumor: false,
    travelStride: 7,
    volatilityBias: 0,
    financialPenalty: 1,
    maxLocalActionsPerDay: 3,
  },
  {
    id: "aggressive_expand",
    label: "激进扩仓",
    buyThreshold: 34,
    buyFraction: 1,
    sellPnlPct: 0.22,
    forceSellFillRate: 0.96,
    lateSellDays: 5,
    repay: true,
    repayDebtFloor: 40000,
    repayCashMultiple: 2.2,
    repayCashReserve: 10000,
    lateRepayDays: 5,
    expand: true,
    expandFillRate: 0.62,
    expandStep: 20,
    expandCashMultiple: 1.05,
    rumor: false,
    followRumor: false,
    travelStride: 11,
    volatilityBias: 10,
    financialPenalty: -5,
    maxLocalActionsPerDay: 4,
  },
  {
    id: "rumor_chaser",
    label: "情报流",
    buyThreshold: 38,
    buyFraction: 0.9,
    sellPnlPct: 0.16,
    forceSellFillRate: 0.9,
    lateSellDays: 6,
    repay: true,
    repayDebtFloor: 15000,
    repayCashMultiple: 1.6,
    repayCashReserve: 4000,
    lateRepayDays: 8,
    expand: true,
    expandFillRate: 0.72,
    expandStep: 10,
    expandCashMultiple: 1.2,
    rumor: true,
    rumorEveryDays: 5,
    followRumor: true,
    travelStride: 13,
    volatilityBias: 4,
    financialPenalty: 0,
    maxLocalActionsPerDay: 3,
  },
];

function summarizeProfile(profile, rows) {
  const scores = rows.map((r) => r.score).sort((a, b) => a - b);
  const debts = rows.map((r) => r.debt).sort((a, b) => a - b);
  const actions = rows.map((r) => r.actions).sort((a, b) => a - b);
  const negative = rows.filter((r) => r.score < 0).length;
  const million = rows.filter((r) => r.score >= 1_000_000).length;
  const tenMillion = rows.filter((r) => r.score >= 10_000_000).length;
  const highDebt = rows.filter((r) => r.debt >= 100_000).length;
  const eventTotals = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.events)) eventTotals[key] = (eventTotals[key] || 0) + value;
  }
  const withFirstProfit = rows.filter((row) => row.experience?.firstProfitableSaleDay !== null);
  const checkpoint = (row, day) => row.checkpoints?.[day] || {};
  const rate = (predicate) => rows.filter(predicate).length / Math.max(1, rows.length);
  return {
    id: profile.id,
    label: profile.label,
    runs: rows.length,
    scoreMin: scores[0],
    scoreP10: percentile(scores, 0.1),
    scoreP25: percentile(scores, 0.25),
    scoreMedian: percentile(scores, 0.5),
    scoreAvg: avg(rows, "score"),
    scoreP75: percentile(scores, 0.75),
    scoreP90: percentile(scores, 0.9),
    scoreMax: scores[scores.length - 1],
    debtMedian: percentile(debts, 0.5),
    debtP90: percentile(debts, 0.9),
    actionMedian: percentile(actions, 0.5),
    actionAvg: avg(rows, "actions"),
    actionMax: actions[actions.length - 1],
    negativeRate: negative / rows.length,
    millionRate: million / rows.length,
    tenMillionRate: tenMillion / rows.length,
    highDebtRate: highDebt / rows.length,
    day5ScoreMedian: percentile(rows.map((row) => Number(checkpoint(row, 5).score) || 0).sort((a, b) => a - b), 0.5),
    day10ScoreMedian: percentile(rows.map((row) => Number(checkpoint(row, 10).score) || 0).sort((a, b) => a - b), 0.5),
    day15ScoreMedian: percentile(rows.map((row) => Number(checkpoint(row, 15).score) || 0).sort((a, b) => a - b), 0.5),
    day10ImprovedRate: rate((row) => row.experience?.firstImprovementDay !== null && row.experience.firstImprovementDay <= 10),
    day10BreakEvenRate: rate((row) => row.experience?.firstBreakEvenDay !== null && row.experience.firstBreakEvenDay <= 10),
    day15BreakEvenRate: rate((row) => row.experience?.firstBreakEvenDay !== null && row.experience.firstBreakEvenDay <= 15),
    day10FirstProfitRate: rate((row) => row.experience?.firstProfitableSaleDay !== null && row.experience.firstProfitableSaleDay <= 10),
    day15FirstProfitRate: rate((row) => row.experience?.firstProfitableSaleDay !== null && row.experience.firstProfitableSaleDay <= 15),
    avgFirstProfitDay: withFirstProfit.length ? avg(withFirstProfit.map((row) => ({ day: row.experience.firstProfitableSaleDay })), "day") : 0,
    avgProfitableSales: avg(rows.map((row) => ({ v: row.experience?.profitableSales || 0 })), "v"),
    avgLosingSales: avg(rows.map((row) => ({ v: row.experience?.losingSales || 0 })), "v"),
    avgMaxTradePnl: avg(rows.map((row) => ({ v: row.experience?.maxTradePnl || 0 })), "v"),
    avgMaxEarlyTradePnl: avg(rows.map((row) => ({ v: row.experience?.maxEarlyTradePnl || 0 })), "v"),
    earlySurpriseRate: rate((row) => (row.experience?.maxEarlyTradePnl || 0) >= 10_000),
    avgUniqueGoods: avg(rows.map((row) => ({ v: row.experience?.uniqueGoods || 0 })), "v"),
    avgIdleDays: avg(rows.map((row) => ({ v: row.counters?.idle || 0 })), "v"),
    avgMarketNews: (eventTotals.market_news || 0) / rows.length,
    avgUniqueNarratives: avg(rows.map((row) => ({ v: row.story?.uniqueNarratives || 0 })), "v"),
    avgChainStarts: avg(rows.map((row) => ({ v: row.story?.chainStarts || 0 })), "v"),
    avgChainCompletions: avg(rows.map((row) => ({ v: row.story?.chainCompletions || 0 })), "v"),
    chainCompletionRate: (() => {
      const starts = rows.reduce((sum, row) => sum + (row.story?.chainStarts || 0), 0);
      const completions = rows.reduce((sum, row) => sum + (row.story?.chainCompletions || 0), 0);
      return starts > 0 ? completions / starts : 0;
    })(),
    newsTraceableStoryRate: rate((row) => (row.experience?.maxNewsAssistedPnl || 0) >= 3000),
    strongNewsStoryRate: rate((row) => (row.experience?.maxNewsAssistedPnl || 0) >= 10000),
    smallGoodsProfitRate: rate((row) => (row.experience?.smallGoodsProfitSales || 0) > 0),
    newsOverloadRate: rate((row) => row.story?.overloaded === true),
    avgMaxNewsSameDay: avg(rows.map((row) => ({ v: row.story?.maxNewsSameDay || 0 })), "v"),
    avgBuys: avg(rows.map((r) => ({ v: r.counters.buy })), "v"),
    avgSells: avg(rows.map((r) => ({ v: r.counters.sell })), "v"),
    avgRepays: avg(rows.map((r) => ({ v: r.counters.repay })), "v"),
    avgExpands: avg(rows.map((r) => ({ v: r.counters.expand })), "v"),
    avgExpenses: (eventTotals.expense_event || 0) / rows.length,
    avgWarehouseFees: (eventTotals.warehouse_fee || 0) / rows.length,
    avgHeldJackpots: avg(rows.map((r) => ({ v: r.economy?.heldJackpots || 0 })), "v"),
    avgLiquidityCost: avg(rows.map((r) => ({ v: r.economy?.liquidityCost || 0 })), "v"),
    avgBuyDiscount: avg(rows.map((r) => ({ v: r.economy?.buyDiscount || 0 })), "v"),
    avgWarehouseCost: avg(rows.map((r) => ({ v: r.economy?.warehouseFees || 0 })), "v"),
    avgRealizedPnl: avg(rows.map((r) => ({ v: r.economy?.realizedPnl || 0 })), "v"),
    warnings: rows.reduce((sum, r) => sum + r.warnings.length, 0),
  };
}

function buildPairwiseMatrix(profileList, runs) {
  const byProfileAndSeed = new Map();
  for (const run of runs) byProfileAndSeed.set(`${run.profile}:${run.seed}`, run.score);

  const matrix = {};
  const averageWinRates = {};
  for (const left of profileList) {
    matrix[left.id] = {};
    let totalRate = 0;
    let opponents = 0;
    for (const right of profileList) {
      if (left.id === right.id) {
        matrix[left.id][right.id] = 0.5;
        continue;
      }
      let points = 0;
      let compared = 0;
      for (let i = 0; i < RUNS; i += 1) {
        const seed = SEED_BASE + i;
        const leftScore = byProfileAndSeed.get(`${left.id}:${seed}`);
        const rightScore = byProfileAndSeed.get(`${right.id}:${seed}`);
        if (!Number.isFinite(leftScore) || !Number.isFinite(rightScore)) continue;
        points += leftScore === rightScore ? 0.5 : leftScore > rightScore ? 1 : 0;
        compared += 1;
      }
      const rate = compared > 0 ? points / compared : 0;
      matrix[left.id][right.id] = rate;
      totalRate += rate;
      opponents += 1;
    }
    averageWinRates[left.id] = opponents > 0 ? totalRate / opponents : 0.5;
  }
  return { matrix, averageWinRates };
}

function makeRecommendations(summaries, pairwise) {
  const base = summaries.find((s) => s.id === "thumb_baseline");
  const aggressive = summaries.find((s) => s.id === "aggressive_expand");
  const novice = summaries.find((s) => s.id === "novice_conservative");
  const impulsive = summaries.find((s) => s.id === "impulsive_novice");
  const recs = [];

  if (base && base.negativeRate > 0.55) {
    recs.push("普通拇指流负资产率偏高，首局玩家很可能觉得“我是不是玩错了”。建议降低前 15 天债务复利或增加早期清晰获利机会。");
  }
  if (base && base.tenMillionRate > 0.55) {
    recs.push("普通拇指流千万率过高，排行榜会很快进入通胀，玩家之间的差异被压缩成“谁刷到更离谱”。建议压低扩仓后的复利收益或提高高价品换手风险。");
  }
  if (base && base.actionAvg > 150) {
    recs.push("普通拇指流平均操作数超过 150，单局 5-12 分钟目标会被点击成本吃掉。建议减少每局必要点击：增加长按连续买入、卖出全部、移动后默认聚焦最相关商品。");
  }
  if (base && base.scoreP90 < 500_000) {
    recs.push("普通流 p90 没有稳定进入可分享的夸张财富区间，排行榜和群分享爽点不足。建议把 20-35 天阶段的热点新闻收益做得更可读、更可追。");
  }
  if (base && base.day10FirstProfitRate < 0.65) {
    recs.push("普通拇指流前 10 天首次盈利率不足 65%，开局缺少确认感。优先提高早期可读波动，而不是直接送钱。");
  }
  if (impulsive && impulsive.day10BreakEvenRate < 0.35) {
    recs.push("冲动新手前 10 天回正率不足 35%，朋友第一次玩时容易过早判定自己无法翻身。应增加低价商品的反转窗口或更清楚的新闻线索。");
  }
  if (impulsive && impulsive.earlySurpriseRate < 0.25) {
    recs.push("冲动新手前 15 天出现单笔万元惊喜的比例不足 25%，早期故事性偏弱。可以增加有因果线索的小商品爆发，但要保留亏损与反转。");
  }
  if (aggressive && aggressive.tenMillionRate > 0.08) {
    recs.push("激进扩仓有少量千万级爆点，这是好事，但需要在结算页解释“怎么做到的”，否则玩家会把结果归因于纯随机。");
  }
  if (aggressive && aggressive.highDebtRate > 0.45) {
    recs.push("扩仓后的管理费和债务复利叠加过猛。UX 上必须在扩仓确认页展示“每日新增管理费”和预计 7 天成本。");
  }
  if (aggressive && aggressive.negativeRate > 0.2 && base && base.negativeRate < 0.05) {
    recs.push("激进扩仓比普通流明显更容易翻车，但普通流收益反而更高，扩仓的风险收益曲线不直觉。建议让扩仓带来明确机会，或降低扩仓管理费的早期惩罚。");
  }
  if (novice && novice.negativeRate > 0.65) {
    recs.push("保守新手也大量亏损，说明失败不只是高风险策略带来的。建议给新手前三次买入提供更强的低价提示或安全垫。");
  }
  if (novice && novice.millionRate > 0.9) {
    recs.push("保守新手百万率接近满格，早期商品套利空间可能过大。建议让低价品承担教学，不要承担主要财富爆发。");
  }
  const rates = Object.values(pairwise.averageWinRates || {});
  if (rates.length > 1 && Math.max(...rates) > 0.8) {
    recs.push("有策略对其他路线的平均胜率超过 80%，仍存在系统性优势路线。建议优先调整该路线独占的收益来源，而不是整体压低所有玩家收入。");
  }
  return recs;
}

function writeReport(runs, summaries, pairwise) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rawPath = path.join(OUT_DIR, "runs.json");
  const reportPath = path.join(OUT_DIR, "report.md");
  fs.writeFileSync(rawPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    experiment: selectedExperiment || { id: EXPERIMENT_ID, name: "引擎默认值", config: {} },
    runs,
    summaries,
    pairwise,
  }, null, 2));

  const recs = makeRecommendations(summaries, pairwise);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const lines = [
    "# 杭州浮生 版本平衡性回测",
    "",
    `生成时间：${new Date().toISOString()}`,
    `版本：${GAME_VERSION_CODE}`,
    `内部实验：${selectedExperiment?.name || "引擎默认值"}（${EXPERIMENT_ID}）`,
    `每类策略局数：${RUNS}`,
    `原始数据：\`${rawPath}\``,
    "",
    "## 策略分布",
    "",
    "| 策略 | 负资产率 | 百万率 | 千万率 | 中位分 | p90 | 最大分 | 中位债务 | p90债务 | 平均操作 | 买/卖/还/扩 | 意外/仓费 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...summaries.map((s) => [
      `| ${s.label}`,
      pct(s.negativeRate),
      pct(s.millionRate),
      pct(s.tenMillionRate),
      cny(s.scoreMedian),
      cny(s.scoreP90),
      cny(s.scoreMax),
      cny(s.debtMedian),
      cny(s.debtP90),
      s.actionAvg.toFixed(1),
      `${s.avgBuys.toFixed(1)}/${s.avgSells.toFixed(1)}/${s.avgRepays.toFixed(1)}/${s.avgExpands.toFixed(1)}`,
      `${s.avgExpenses.toFixed(1)}/${s.avgWarehouseFees.toFixed(1)} |`,
    ].join(" | ")),
    "",
    "## 策略两两胜率",
    "",
    "同一随机种子下比较最终净资产；50% 表示没有系统性优势。",
    "",
    `| 策略 | ${profiles.map((profile) => profile.label).join(" | ")} | 平均胜率 |`,
    `|---|${profiles.map(() => "---:").join("|")}|---:|`,
    ...profiles.map((left) => {
      const cells = profiles.map((right) => left.id === right.id ? "-" : pct(pairwise.matrix[left.id][right.id]));
      return `| ${profileById.get(left.id).label} | ${cells.join(" | ")} | ${pct(pairwise.averageWinRates[left.id])} |`;
    }),
    "",
    "## 前期手感",
    "",
    "| 策略 | 第5天中位分 | 第10天中位分 | 第15天中位分 | 10天首次盈利 | 10天回正 | 15天回正 | 首次盈利日 | 早期万元惊喜 | 空跑天数 | 场均新闻 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...summaries.map((s) => `| ${s.label} | ${cny(s.day5ScoreMedian)} | ${cny(s.day10ScoreMedian)} | ${cny(s.day15ScoreMedian)} | ${pct(s.day10FirstProfitRate)} | ${pct(s.day10BreakEvenRate)} | ${pct(s.day15BreakEvenRate)} | ${s.avgFirstProfitDay.toFixed(1)} | ${pct(s.earlySurpriseRate)} | ${s.avgIdleDays.toFixed(1)} | ${s.avgMarketNews.toFixed(1)} |`),
    "",
    "## 故事性代理指标",
    "",
    "机器只能验证新闻与交易是否形成可追溯因果，不能替代真人判断笑点和复述意愿。",
    "",
    "| 策略 | 场均叙事节点 | 新闻链完成率 | 可追溯盈利故事 | 强盈利故事 | 小商品盈利局 | 同日信息过载 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...summaries.map((s) => `| ${s.label} | ${s.avgUniqueNarratives.toFixed(1)} | ${pct(s.chainCompletionRate)} | ${pct(s.newsTraceableStoryRate)} | ${pct(s.strongNewsStoryRate)} | ${pct(s.smallGoodsProfitRate)} | ${pct(s.newsOverloadRate)} |`),
    "",
    "## 交易机制归因",
    "",
    "| 策略 | 场均爆红 | 场均批采优惠 | 场均流动性折价 | 场均仓储费 | 场均已实现利润 |",
    "|---|---:|---:|---:|---:|---:|",
    ...summaries.map((s) => `| ${s.label} | ${s.avgHeldJackpots.toFixed(2)} | ${cny(s.avgBuyDiscount)} | ${cny(s.avgLiquidityCost)} | ${cny(s.avgWarehouseCost)} | ${cny(s.avgRealizedPnl)} |`),
    "",
    "## 自动建议",
    "",
    ...(recs.length ? recs.map((x) => `- ${x}`) : ["- 当前阈值未触发自动风险建议。"]),
    "",
    "## 读数口径",
    "",
    "- 负资产率：最终净资产小于 0 的比例。",
    "- 百万率/千万率：用于评估排行榜和分享海报是否有足够“离谱结果”。",
    "- 意外/仓费：每局平均 `expense_event` 与 `warehouse_fee` 次数，用于评估债务解释压力。",
    "- 可追溯盈利故事：持有商品受当前正向新闻影响时卖出，且单笔利润至少 3000 元。",
    "- 强盈利故事：上述单笔利润至少 10000 元；它只表示有素材，不表示玩家一定觉得好笑或愿意分享。",
    "",
  ];

  fs.writeFileSync(reportPath, lines.join("\n"));
  return { rawPath, reportPath, recs };
}

const allRuns = [];
for (const profile of profiles) {
  for (let i = 0; i < RUNS; i += 1) {
    allRuns.push(runOne(SEED_BASE + i, profile));
  }
}

const summaries = profiles.map((profile) => summarizeProfile(
  profile,
  allRuns.filter((run) => run.profile === profile.id),
));
const pairwise = buildPairwiseMatrix(profiles, allRuns);
const output = writeReport(allRuns, summaries, pairwise);

console.log(`Balance backtest passed: ${profiles.length * RUNS} runs, ${GAME_VERSION_CODE}, ${EXPERIMENT_ID}`);
for (const s of summaries) {
  console.log(`${s.label}: day10 profit ${pct(s.day10FirstProfitRate)}, break-even ${pct(s.day10BreakEvenRate)}, early surprise ${pct(s.earlySurpriseRate)}, final median ${cny(s.scoreMedian)}, negative ${pct(s.negativeRate)}`);
}
console.log(`Report: ${output.reportPath}`);
console.log(`Raw records: ${output.rawPath}`);
