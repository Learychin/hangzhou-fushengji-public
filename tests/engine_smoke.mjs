import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GameEngine,
  TOTAL_DAYS,
  GAME_VERSION_CODE,
  INITIAL_CAPACITY,
  CAREER_STAGES,
  buildCapacityPlan,
  discountedBuyUnitPrice,
  getCareerStageState,
  localResalePrice,
  marketSaleQuote,
  normalizeExperimentConfig,
  warehouseDailyFeeForCapacity,
  maxAffordableBuyCount,
} = require("../src/engine/game-engine.js");

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

function nextLocation(game) {
  const total = game.cityLabels.length;
  return (game.currentLoc % total) + 1;
}

withSeed(20260630, () => {
  const game = new GameEngine();

  assert.equal(GAME_VERSION_CODE, "HZFSJ-TRADE-45D-RC2");
  assert.equal(TOTAL_DAYS, 45);
  assert.equal(game.timeLeft, TOTAL_DAYS);
  assert.equal(game.daysUsed, 0);
  assert.equal(game.cash, 3000);
  assert.equal(game.debt, 6000);
  assert.equal(game.coat, INITIAL_CAPACITY);
  assert.equal(warehouseDailyFeeForCapacity(INITIAL_CAPACITY + 30), 240);
  assert.equal(discountedBuyUnitPrice(1000, 100), 850);
  assert.equal(discountedBuyUnitPrice(1000, 20), 1000);
  assert.equal(game.cityLabels.length, 12);
  assert.ok(game.market.length > 0, "new game should create an initial market");
  assert.ok(game.eventLog.length >= 1, "new game should record a system event");
  assert.equal(game.careerStageIndex, 0);
  assert.equal(game.experimentKey, "control");
  assert.deepEqual(normalizeExperimentConfig({}).jackpotQuotaDistribution, [0.25, 0.55, 0.17, 0.03]);
  assert.equal(CAREER_STAGES.length, 5);
  assert.equal(getCareerStageState(-3000).stage.id, "runner");
  assert.equal(Math.round(getCareerStageState(-1500).progress), 50);
  assert.equal(getCareerStageState(0).stage.id, "survivor");
  assert.equal(getCareerStageState(100000).stage.id, "buyer");
  assert.equal(getCareerStageState(90000, 2).stage.id, "buyer", "earned career stages should not regress");
  assert.equal(getCareerStageState(10000000).progress, 100);

  const row = game.market.find((item) => maxAffordableBuyCount(game.cash, item.price, game.coat) > 0);
  assert.ok(row, "expected at least one affordable market item");

  const beforeCash = game.cash;
  game.buy(row.id, 1);
  assert.equal(game.tradeCount, 1);
  assert.equal(game.inv.length, 1);
  assert.ok(game.cash < beforeCash, "buying should reduce cash");

  const quote = game.previewSell(row.id, 1);
  assert.equal(quote.ok, true);
  assert.equal(quote.total, localResalePrice(row.price));
  game.sell(row.id, 1);
  assert.equal(game.tradeCount, 2);
  assert.equal(game.inv.length, 0);

  const plan = buildCapacityPlan(game.coat, game.coat + 20);
  assert.equal(plan.gain, 20);
  assert.equal(plan.steps, 2);
  assert.ok(plan.cost > 0);

  const financial = { kind: "financial", base: 18000 };
  const oneOrder = marketSaleQuote(financial, 1000, 60, 0);
  const firstSplit = marketSaleQuote(financial, 1000, 20, 0);
  const secondSplit = marketSaleQuote(financial, 1000, 40, 20);
  assert.equal(oneOrder.depth, 12);
  assert.ok(oneOrder.liquidityCost > 0, "large market sales should pay a liquidity cost");
  assert.equal(oneOrder.total, firstSplit.total + secondSplit.total, "splitting an order should not bypass market depth");

  game.marketSoldToday = { [row.id]: 20 };
  game.oneTravelTurn(nextLocation(game));
  assert.deepEqual(game.marketSoldToday, {}, "travel should reset daily market depth");

  let safety = 0;
  while (!game.gameOver && game.timeLeft > 0) {
    const beforeDay = game.daysUsed;
    game.oneTravelTurn(nextLocation(game));
    assert.ok(game.gameOver || game.daysUsed > beforeDay, "travel should advance the day");
    safety += 1;
    assert.ok(safety <= TOTAL_DAYS + 1, "travel loop should not exceed total days");
  }

  assert.equal(game.gameOver, true);
  assert.equal(game.timeLeft, 0);
  assert.equal(game.daysUsed, TOTAL_DAYS);
  assert.ok(Number.isFinite(game.score));
  assert.ok(game.eventLog.some((event) => event.event_type === "game_over"));
});

withSeed(20260715, () => {
  const game = new GameEngine();
  const changed = game.configureCityContent({
    gameplay_experiment: {
      experimentId: "chain-smoke",
      newsSpawnRate: 100,
      newsMinGapDays: 1,
      newsForceAfterDays: 1,
      smallGoodsSwingRate: 0,
      jackpotQuotaDistribution: [100, 0, 0, 0],
    },
    news_pool: [
      {
        id: "signal",
        chainId: "test-chain",
        stage: "signal",
        nextId: "payoff",
        nextDelayMin: 1,
        nextDelayMax: 1,
        title: "测试预兆",
        desc: "测试事件链第一段。",
        durationMin: 1,
        durationMax: 1,
        effects: [{ goodsIds: [0], minPct: 10, maxPct: 10, tag: "预兆" }],
      },
      {
        id: "payoff",
        chainId: "test-chain",
        stage: "payoff",
        entry: false,
        title: "测试兑现",
        desc: "测试事件链第二段。",
        durationMin: 1,
        durationMax: 1,
        effects: [{ goodsIds: [0], minPct: 20, maxPct: 20, tag: "兑现" }],
      },
    ],
  });
  assert.equal(changed, true);
  game.newGame();
  assert.equal(game.experimentKey, "chain-smoke");
  game.oneTravelTurn(nextLocation(game));
  assert.equal(game.pendingNewsStages.length, 1, "first chain stage should schedule a follow-up");
  game.oneTravelTurn(nextLocation(game));
  const chainEvents = game.eventLog.filter((event) => event.event_type === "market_news" && event.payload.chain_id === "test-chain");
  assert.deepEqual(chainEvents.map((event) => event.payload.chain_stage), ["signal", "payoff"]);
});

console.log("engine smoke ok");
