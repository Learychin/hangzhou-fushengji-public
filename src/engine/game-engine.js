"use strict";
(function initHZFSJEngine() {
const GAME_VERSION_CODE = "HZFSJ-TRADE-45D-RC2";
const TOTAL_DAYS = 45;
const TARGET_SESSION_MINUTES = 15;
const TARGET_SECONDS_PER_TURN = Math.round((TARGET_SESSION_MINUTES * 60) / TOTAL_DAYS);
const CITY_EXPANSION_ROUTES = [
  { score: 1000000, city: "苏州", label: "苏州浮生记", hook: "园林、丝绸、科创园和老街烟火气" },
  { score: 3000000, city: "上海", label: "上海浮生记", hook: "外滩、张江、咖啡馆和资本浪潮" },
  { score: 10000000, city: "宁波", label: "宁波浮生记", hook: "港口、外贸、海鲜市集和甬江夜色" },
  { score: 50000000, city: "深圳", label: "深圳浮生记", hook: "硬件、低空经济、城中村和湾区速度" },
  { score: 100000000, city: "北京", label: "北京浮生记", hook: "中关村、胡同、展会和全国资源局" },
];
const CAREER_STAGES = [
  { id: "runner", name: "跑街学徒", minScore: -3000, focus: "先把净身价从负数拉回零" },
  { id: "survivor", name: "站稳脚跟", minScore: 0, focus: "低买高卖，冲击 10 万" },
  { id: "buyer", name: "城市买手", minScore: 100000, focus: "控制仓储成本，冲击 100 万" },
  { id: "firm", name: "杭城商号", minScore: 1000000, focus: "集中做高价值机会，冲击 1000 万" },
  { id: "legend", name: "钱塘传奇", minScore: 10000000, focus: "守住利润，冲击跨城资格" },
];
const STARTER_BUFFER_DAYS = Math.ceil(TOTAL_DAYS * 0.22);
const STARTER_CASH_FLOOR = 900;
const STARTER_BUFFER_MAX_USES = 3;
const EVENT_LOG_LIMIT = 800;
const ACTIVE_RUN_KEY = "bfsj_active_run_v1";
const PENDING_RUN_KEY = "bfsj_pending_run";
const CLAIM_TOKENS_KEY = "bfsj_claim_tokens";
const LAST_GUEST_NICK_KEY = "bfsj_last_guest_nickname";
const UI_MODE_PREF_KEY = "bfsj_ui_mode_pref";
const LOCAL_RUN_STATS_KEY = "bfsj_local_run_stats";
const ENABLE_RANDOM_EVENT_POPUPS = false;
const ENABLE_STATUS_SYSTEM = false;
const HIDE_AUTH_UI = true;
const MARKET_NEWS_SPAWN_RATE = 22;
const MARKET_NEWS_MIN_GAP_DAYS = 2;
const MARKET_NEWS_FORCE_AFTER_DAYS = 5;
const INITIAL_CAPACITY = 110;
const MAX_CAPACITY = 500;
const CAPACITY_STEP = 10;
const MARKET_BUY_DISPLAY_LIMIT = 9;
const LOCAL_RESALE_RATE = 0.9;
const MAX_NEWS_PRICE_MULTIPLIER = 12;
const DEFAULT_EXPERIMENT_CONFIG = Object.freeze({
  experimentId: "control",
  priceSpanScale: 1,
  lowGoodsPriceSpanScale: 1,
  highValuePriceSpanScale: 1,
  locationSpreadScale: 1,
  lowGoodsLocationSpreadScale: 1,
  highValueLocationSpreadScale: 1,
  locationRareChance: 9,
  newsSpawnRate: MARKET_NEWS_SPAWN_RATE,
  newsMinGapDays: MARKET_NEWS_MIN_GAP_DAYS,
  newsForceAfterDays: MARKET_NEWS_FORCE_AFTER_DAYS,
  newsEffectScale: 1,
  smallGoodsStartDay: 3,
  smallGoodsSwingRate: 14,
  smallGoodsUpRate: 64,
  smallGoodsUpMin: 45,
  smallGoodsUpMax: 115,
  smallGoodsDownMin: 25,
  smallGoodsDownMax: 60,
  jackpotStartDay: 24,
  jackpotChanceFloor: 4,
  jackpotChanceCap: 18,
  jackpotRegularMin: 180,
  jackpotRegularMax: 420,
  jackpotSuperRate: 12,
  jackpotSuperMin: 700,
  jackpotSuperMax: 1200,
  jackpotQuotaDistribution: [25, 55, 17, 3],
  debtGraceRate: 0.03,
  debtLateRate: 0.055,
});
const WAREHOUSE_FEE_TIERS = [
  { uptoExtra: 30, unitFee: 8 },
  { uptoExtra: 80, unitFee: 30 },
  { uptoExtra: 180, unitFee: 120 },
  { uptoExtra: Infinity, unitFee: 280 },
];

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function normalizeQuotaDistribution(value) {
  const source = Array.isArray(value) && value.length === 4
    ? value
    : DEFAULT_EXPERIMENT_CONFIG.jackpotQuotaDistribution;
  const weights = source.map((item) => Math.max(0, Number(item) || 0));
  const total = weights.reduce((sum, item) => sum + item, 0);
  if (total <= 0) return [0.25, 0.55, 0.17, 0.03];
  return weights.map((item) => item / total);
}

function normalizeExperimentConfig(config = {}) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const defaults = DEFAULT_EXPERIMENT_CONFIG;
  const normalized = {
    experimentId: String(source.experimentId || source.experiment_id || defaults.experimentId)
      .replace(/[^a-z0-9_-]/gi, "")
      .slice(0, 48) || defaults.experimentId,
    priceSpanScale: clampNumber(source.priceSpanScale, defaults.priceSpanScale, 0.45, 2.2),
    lowGoodsPriceSpanScale: clampNumber(source.lowGoodsPriceSpanScale, defaults.lowGoodsPriceSpanScale, 0.4, 2.5),
    highValuePriceSpanScale: clampNumber(source.highValuePriceSpanScale, defaults.highValuePriceSpanScale, 0.35, 2.2),
    locationSpreadScale: clampNumber(source.locationSpreadScale, defaults.locationSpreadScale, 0.35, 2.5),
    lowGoodsLocationSpreadScale: clampNumber(source.lowGoodsLocationSpreadScale, defaults.lowGoodsLocationSpreadScale, 0.35, 2.5),
    highValueLocationSpreadScale: clampNumber(source.highValueLocationSpreadScale, defaults.highValueLocationSpreadScale, 0.35, 2.2),
    locationRareChance: clampInteger(source.locationRareChance, defaults.locationRareChance, 0, 40),
    newsSpawnRate: clampInteger(source.newsSpawnRate, defaults.newsSpawnRate, 0, 100),
    newsMinGapDays: clampInteger(source.newsMinGapDays, defaults.newsMinGapDays, 1, 10),
    newsForceAfterDays: clampInteger(source.newsForceAfterDays, defaults.newsForceAfterDays, 1, 15),
    newsEffectScale: clampNumber(source.newsEffectScale, defaults.newsEffectScale, 0.25, 3),
    smallGoodsStartDay: clampInteger(source.smallGoodsStartDay, defaults.smallGoodsStartDay, 1, TOTAL_DAYS),
    smallGoodsSwingRate: clampInteger(source.smallGoodsSwingRate, defaults.smallGoodsSwingRate, 0, 100),
    smallGoodsUpRate: clampInteger(source.smallGoodsUpRate, defaults.smallGoodsUpRate, 0, 100),
    smallGoodsUpMin: clampInteger(source.smallGoodsUpMin, defaults.smallGoodsUpMin, 0, 1000),
    smallGoodsUpMax: clampInteger(source.smallGoodsUpMax, defaults.smallGoodsUpMax, 0, 1200),
    smallGoodsDownMin: clampInteger(source.smallGoodsDownMin, defaults.smallGoodsDownMin, 0, 95),
    smallGoodsDownMax: clampInteger(source.smallGoodsDownMax, defaults.smallGoodsDownMax, 0, 95),
    jackpotStartDay: clampInteger(source.jackpotStartDay, defaults.jackpotStartDay, 1, TOTAL_DAYS),
    jackpotChanceFloor: clampInteger(source.jackpotChanceFloor, defaults.jackpotChanceFloor, 0, 100),
    jackpotChanceCap: clampInteger(source.jackpotChanceCap, defaults.jackpotChanceCap, 0, 100),
    jackpotRegularMin: clampInteger(source.jackpotRegularMin, defaults.jackpotRegularMin, 0, 1200),
    jackpotRegularMax: clampInteger(source.jackpotRegularMax, defaults.jackpotRegularMax, 0, 1200),
    jackpotSuperRate: clampInteger(source.jackpotSuperRate, defaults.jackpotSuperRate, 0, 100),
    jackpotSuperMin: clampInteger(source.jackpotSuperMin, defaults.jackpotSuperMin, 0, 1200),
    jackpotSuperMax: clampInteger(source.jackpotSuperMax, defaults.jackpotSuperMax, 0, 1200),
    jackpotQuotaDistribution: normalizeQuotaDistribution(source.jackpotQuotaDistribution),
    debtGraceRate: clampNumber(source.debtGraceRate, defaults.debtGraceRate, 0, 0.2),
    debtLateRate: clampNumber(source.debtLateRate, defaults.debtLateRate, 0, 0.25),
  };
  normalized.newsForceAfterDays = Math.max(normalized.newsMinGapDays, normalized.newsForceAfterDays);
  normalized.smallGoodsUpMax = Math.max(normalized.smallGoodsUpMin, normalized.smallGoodsUpMax);
  normalized.smallGoodsDownMax = Math.max(normalized.smallGoodsDownMin, normalized.smallGoodsDownMax);
  normalized.jackpotChanceCap = Math.max(normalized.jackpotChanceFloor, normalized.jackpotChanceCap);
  normalized.jackpotRegularMax = Math.max(normalized.jackpotRegularMin, normalized.jackpotRegularMax);
  normalized.jackpotSuperMax = Math.max(normalized.jackpotSuperMin, normalized.jackpotSuperMax);
  return normalized;
}

function localResalePrice(buyPrice) {
  return Math.max(1, Math.floor((Number(buyPrice) || 0) * LOCAL_RESALE_RATE));
}

function marketDepthForGoods(goods) {
  const base = Math.max(1, Number(goods?.base) || 1);
  if (goods?.kind === "financial") return base >= 12000 ? 12 : 20;
  if (goods?.kind === "virtual") return base >= 10000 ? 18 : 35;
  return base >= 3000 ? 24 : 70;
}

function marketSaleQuote(goods, marketPrice, count, alreadySold = 0) {
  const unit = Math.max(1, Math.floor(Number(marketPrice) || 0));
  const requested = Math.max(0, Math.floor(Number(count) || 0));
  const prior = Math.max(0, Math.floor(Number(alreadySold) || 0));
  const depth = marketDepthForGoods(goods);
  const tiers = [
    { upto: depth, rate: 1 },
    { upto: depth * 2, rate: 0.92 },
    { upto: Infinity, rate: 0.78 },
  ];
  let remaining = requested;
  let cursor = prior;
  let total = 0;
  for (const tier of tiers) {
    if (remaining <= 0) break;
    if (cursor >= tier.upto) continue;
    const available = Number.isFinite(tier.upto) ? tier.upto - cursor : remaining;
    const take = Math.min(remaining, available);
    total += take * Math.max(1, Math.floor(unit * tier.rate));
    cursor += take;
    remaining -= take;
  }
  const fullPriceTotal = requested * unit;
  return {
    count: requested,
    total,
    avgUnit: requested > 0 ? Math.floor(total / requested) : 0,
    liquidityCost: Math.max(0, fullPriceTotal - total),
    depth,
    alreadySold: prior,
  };
}

function warehouseDailyFeeForCapacity(capacity) {
  const extra = Math.max(0, Math.floor(Number(capacity) || 0) - INITIAL_CAPACITY);
  let fee = 0;
  let previous = 0;
  for (const tier of WAREHOUSE_FEE_TIERS) {
    if (extra <= previous) break;
    const size = Math.min(extra, tier.uptoExtra) - previous;
    fee += size * tier.unitFee;
    previous = tier.uptoExtra;
  }
  return Math.floor(fee);
}

function capacityStepCost(afterCap) {
  if (afterCap <= 140) return 9000;
  if (afterCap <= 180) return 18000;
  if (afterCap <= 240) return 42000;
  if (afterCap <= 320) return 90000;
  if (afterCap <= 400) return 180000;
  if (afterCap <= 460) return 360000;
  return 650000;
}

function normalizeCapacityTarget(targetCap, currentCap = 0) {
  const raw = Number(targetCap);
  const stepped = Number.isFinite(raw) ? Math.floor(raw / CAPACITY_STEP) * CAPACITY_STEP : currentCap + CAPACITY_STEP;
  return Math.max(currentCap + CAPACITY_STEP, Math.min(MAX_CAPACITY, stepped));
}

function buildCapacityPlan(currentCap, targetCap) {
  const target = normalizeCapacityTarget(targetCap, currentCap);
  let after = currentCap;
  let cost = 0;
  let steps = 0;
  const detail = [];
  while (after < target) {
    after += CAPACITY_STEP;
    const stepCost = capacityStepCost(after);
    cost += stepCost;
    steps += 1;
    detail.push({ after, cost: stepCost });
  }
  return {
    from: currentCap,
    target: after,
    gain: after - currentCap,
    steps,
    cost,
    detail,
  };
}

function getCareerStageState(score, achievedIndex = 0) {
  const value = Number.isFinite(Number(score)) ? Number(score) : 0;
  let earnedIndex = 0;
  for (let index = 1; index < CAREER_STAGES.length; index += 1) {
    if (value >= CAREER_STAGES[index].minScore) earnedIndex = index;
  }
  const rememberedIndex = Math.max(0, Math.min(CAREER_STAGES.length - 1, Math.floor(Number(achievedIndex) || 0)));
  const index = Math.max(earnedIndex, rememberedIndex);
  const stage = CAREER_STAGES[index];
  const next = CAREER_STAGES[index + 1] || null;
  const floor = Number.isFinite(stage.minScore) ? stage.minScore : Math.min(0, value);
  const progress = next
    ? Math.max(0, Math.min(100, ((value - floor) / Math.max(1, next.minScore - floor)) * 100))
    : 100;
  return {
    index,
    earnedIndex,
    stage,
    next,
    progress,
    gap: next ? Math.max(0, next.minScore - value) : 0,
  };
}

class GameEngine {
  constructor(options = {}) {
    this.experimentConfig = normalizeExperimentConfig(options.experimentConfig || options.experiment || options);
    this.experimentKey = this.experimentConfig.experimentId;
    this.goods = [
      { id: 0, name: "便利店特调饮料", kind: "physical", weight: 1, base: 6, span: 54 },
      { id: 1, name: "景区文创冰箱贴", kind: "physical", weight: 1, base: 16, span: 180 },
      { id: 2, name: "二手充电宝", kind: "physical", weight: 1, base: 28, span: 240 },
      { id: 3, name: "龙井新茶", kind: "physical", weight: 1, base: 96, span: 360 },
      { id: 4, name: "国潮丝绸", kind: "physical", weight: 1, base: 1800, span: 2200 },
      { id: 5, name: "汉服妆造套餐", kind: "virtual", weight: 0, base: 900, span: 1600 },
      { id: 6, name: "AI算力券", kind: "financial", weight: 0, base: 4000, span: 7000 },
      { id: 7, name: "低空飞行体验券", kind: "virtual", weight: 0, base: 1500, span: 3000 },
      { id: 8, name: "钱塘湾基金份额", kind: "financial", weight: 0, base: 6000, span: 11000 },
      { id: 9, name: "西湖文旅ETF", kind: "financial", weight: 0, base: 5000, span: 9000 },
      { id: 10, name: "机器人零部件", kind: "physical", weight: 2, base: 3500, span: 6500 },
      { id: 11, name: "数字藏品卡", kind: "virtual", weight: 0, base: 800, span: 2600 },
      { id: 12, name: "亚运纪念票", kind: "virtual", weight: 0, base: 600, span: 1800 },
      { id: 13, name: "跨境电商仓单", kind: "financial", weight: 0, base: 7000, span: 13000 },
      { id: 14, name: "直播电商流量包", kind: "financial", weight: 0, base: 2000, span: 5000 },
      { id: 15, name: "数据中心机柜配额", kind: "financial", weight: 0, base: 9000, span: 15000 },
      { id: 16, name: "并购过桥债权包", kind: "financial", weight: 0, base: 18000, span: 42000 },
      { id: 17, name: "量化对冲策略份额", kind: "financial", weight: 0, base: 26000, span: 56000 },
      { id: 18, name: "桌面AI伴侣", kind: "virtual", weight: 0, base: 1800, span: 5200 },
      { id: 19, name: "云栖大会通票", kind: "virtual", weight: 0, base: 12000, span: 18000 },
      { id: 20, name: "钱塘夜航包厢", kind: "virtual", weight: 0, base: 18000, span: 24000 },
      { id: 21, name: "产业基金份额Ⅱ", kind: "financial", weight: 0, base: 26000, span: 38000 },
      { id: 22, name: "高端机柜预约权", kind: "financial", weight: 0, base: 42000, span: 60000 },
    ];

    this.marketEvents = [
      { freq: 120, msg: "亚运后劲仍在，西湖文旅ETF被抢购。", drug: 9, plus: 3, minus: 0, add: 0 },
      { freq: 95, msg: "灵隐寺与湖滨商圈客流走高，汉服妆造订单暴增。", drug: 5, plus: 2, minus: 0, add: 0 },
      { freq: 88, msg: "头部主播带货龙井，茶叶需求被瞬间点燃。", drug: 3, plus: 3, minus: 0, add: 0 },
      { freq: 130, msg: "算力租赁平台紧张，AI算力券一天三价。", drug: 6, plus: 3, minus: 0, add: 0 },
      { freq: 140, msg: "低空经济应用试点扩容，飞行体验券突然走俏。", drug: 7, plus: 2, minus: 0, add: 0 },
      { freq: 115, msg: "游客暴增，文创冰箱贴被扫货。", drug: 1, plus: 3, minus: 0, add: 0 },
      { freq: 110, msg: "音乐节扎堆，便利店特调饮料被抢空。", drug: 0, plus: 2, minus: 0, add: 0 },
      { freq: 108, msg: "共享单车点位拥堵，二手充电宝需求激增。", drug: 2, plus: 2, minus: 0, add: 0 },
      { freq: 92, msg: "跨城游火爆，临时加场导致亚运纪念票波动。", drug: 12, plus: 3, minus: 0, add: 1 },
      { freq: 100, msg: "钱塘湾基金路演热，基金份额报价抬升。", drug: 8, plus: 2, minus: 0, add: 0 },
      { freq: 104, msg: "机器人展会开幕，零部件供不应求。", drug: 10, plus: 2, minus: 0, add: 0 },
      { freq: 98, msg: "直播间爆单，流量包价格拉升。", drug: 14, plus: 3, minus: 0, add: 0 },
      { freq: 102, msg: "数据中心机柜资源告急，配额持续走高。", drug: 15, plus: 2, minus: 0, add: 0 },
      { freq: 108, msg: "并购窗口期传闻发酵，过桥债权包剧烈波动。", drug: 16, plus: 3, minus: 0, add: 0 },
      { freq: 112, msg: "机构调仓引发量化策略踩踏，策略份额大起大落。", drug: 17, plus: 3, minus: 0, add: 0 },
      { freq: 96, msg: "云栖大会临近，通票与周边被提前锁定。", drug: 19, plus: 2, minus: 0, add: 0 },
      { freq: 101, msg: "钱塘夜游档期火爆，包厢价格抬升。", drug: 20, plus: 2, minus: 0, add: 0 },
      { freq: 107, msg: "产业基金路演密集，份额二级市场转热。", drug: 21, plus: 3, minus: 0, add: 0 },
      { freq: 109, msg: "高端机柜预约权紧俏，买家连夜排单。", drug: 22, plus: 2, minus: 0, add: 0 },
      { freq: 125, msg: "社群团购补货，龙井新茶给你留了额外配额。", drug: 3, plus: 0, minus: 0, add: 5 },
      { freq: 128, msg: "批发市场清仓，你低价拿到一批文创冰箱贴。", drug: 1, plus: 0, minus: 0, add: 8 },
      { freq: 118, msg: "活动赞助余货流出，你收到一批特调饮料。", drug: 0, plus: 0, minus: 0, add: 10 },
      { freq: 135, msg: "你被“行业内参”忽悠买了高价算力包，额外承担 3000 成本。", drug: 6, plus: 0, minus: 0, add: 1 },
    ];
    this.tradeEvents = {
      0: { up: { msg: "音乐节主办方临时补货，特调饮料被包圆。", cashMul: 0.28, fame: 1, health: 0 }, down: { msg: "临期抽检加严，你被迫打折清货。", cashMul: -0.18, fame: -2, health: 0 } },
      1: { up: { msg: "景区联名爆火，冰箱贴溢价成交。", cashMul: 0.35, fame: 2, health: 0 }, down: { msg: "同款泛滥，文创热度回落。", cashMul: -0.22, fame: -1, health: 0 } },
      2: { up: { msg: "会展中心限电，充电宝即租即空。", cashMul: 0.31, fame: 1, health: 0 }, down: { msg: "设备投诉集中爆发，赔付吞掉利润。", cashMul: -0.2, fame: -3, health: 0 } },
      3: { up: { msg: "名人探店带火龙井，茶价上冲。", cashMul: 0.4, fame: 2, health: 0 }, down: { msg: "被质疑拼配茶，渠道压价收货。", cashMul: -0.24, fame: -4, health: 0 } },
      4: { up: { msg: "剧组服化急单，你的丝绸直接翻单。", cashMul: 0.38, fame: 2, health: 0 }, down: { msg: "染色批次翻车，退货潮来袭。", cashMul: -0.3, fame: -4, health: -2 } },
      5: { up: { msg: "汉服巡游活动引流，妆造券被秒。", cashMul: 0.33, fame: 3, health: 0 }, down: { msg: "妆造差评冲榜，你被点名批评。", cashMul: -0.19, fame: -5, health: -1 } },
      6: { up: { msg: "新模型发布，算力券出现抢购潮。", cashMul: 0.42, fame: 2, health: 0 }, down: { msg: "平台宕机，算力券兑现受阻。", cashMul: -0.27, fame: -3, health: -2 } },
      7: { up: { msg: "低空游上首页推荐，体验券被疯抢。", cashMul: 0.36, fame: 2, health: 0 }, down: { msg: "天气突变停飞，改签成本飙升。", cashMul: -0.25, fame: -2, health: -3 } },
      8: { up: { msg: "路演消息刺激，基金份额跳涨。", cashMul: 0.3, fame: 1, health: 0 }, down: { msg: "传闻证伪，份额快速回撤。", cashMul: -0.23, fame: -2, health: -1 } },
      9: { up: { msg: "节庆客流超预期，文旅ETF拉升。", cashMul: 0.29, fame: 2, health: 0 }, down: { msg: "淡季预警落地，ETF转弱。", cashMul: -0.18, fame: -1, health: 0 } },
      10: { up: { msg: "机器人厂商加急回购，零部件断货。", cashMul: 0.41, fame: 3, health: -1 }, down: { msg: "参数不兼容，整批返工退货。", cashMul: -0.31, fame: -4, health: -2 } },
      11: { up: { msg: "藏品圈层联动，地板价抬升。", cashMul: 0.34, fame: 2, health: 0 }, down: { msg: "流动性抽干，挂单没人接。", cashMul: -0.28, fame: -2, health: -1 } },
      12: { up: { msg: "纪念周活动发酵，亚运票价补涨。", cashMul: 0.32, fame: 2, health: 0 }, down: { msg: "黄牛盘崩，票价瞬间打折。", cashMul: -0.24, fame: -2, health: -1 } },
      13: { up: { msg: "跨境舱位放开，仓单转手溢价。", cashMul: 0.37, fame: 2, health: 0 }, down: { msg: "关务抽检延迟，资金被压仓。", cashMul: -0.27, fame: -3, health: -2 } },
      14: { up: { msg: "主播爆单，流量包单价抬升。", cashMul: 0.43, fame: 3, health: 0 }, down: { msg: "投放失灵，预算几乎白烧。", cashMul: -0.33, fame: -3, health: -1 } },
      15: { up: { msg: "机柜配额告急，买方高价扫货。", cashMul: 0.45, fame: 3, health: 0 }, down: { msg: "政策窗口突变，配额报价下修。", cashMul: -0.29, fame: -3, health: -1 } },
      16: { up: { msg: "并购案超预期落地，过桥包大涨。", cashMul: 0.55, fame: 4, health: 0 }, down: { msg: "并购延期，债权包折价出清。", cashMul: -0.39, fame: -5, health: -2 } },
      17: { up: { msg: "波动率抬升，量化策略吃满行情。", cashMul: 0.62, fame: 4, health: 0 }, down: { msg: "策略踩踏，净值瞬间回撤。", cashMul: -0.46, fame: -6, health: -3 } },
      18: { up: { msg: "开箱视频爆火，桌面AI伴侣口碑疯传。", cashMul: 0.58, fame: 5, health: 0 }, down: { msg: "批次固件翻车，用户差评围攻。", cashMul: -0.41, fame: -6, health: -2 } },
      19: { up: { msg: "云栖大会门票被抢空，通票秒变硬通货。", cashMul: 0.45, fame: 2, health: 0 }, down: { msg: "会务临时改期，通票价格松动。", cashMul: -0.29, fame: -2, health: 0 } },
      20: { up: { msg: "钱塘夜航包厢被大客户包场，成交价上冲。", cashMul: 0.52, fame: 3, health: 0 }, down: { msg: "天气临时封航，包厢预订被退。", cashMul: -0.34, fame: -2, health: -1 } },
      21: { up: { msg: "基金路演踩中风口，份额出现连板。", cashMul: 0.64, fame: 4, health: 0 }, down: { msg: "净值回撤加速，份额高位松动。", cashMul: -0.43, fame: -4, health: -2 } },
      22: { up: { msg: "机柜预约权稀缺，买家追着加价。", cashMul: 0.72, fame: 4, health: 0 }, down: { msg: "扩容窗口被抢先，预约权开始降温。", cashMul: -0.5, fame: -5, health: -2 } },
    };

    this.healthEvents = [
      { freq: 100, msg: "连续跑单到深夜，你的状态明显下滑。", hurt: 2 },
      { freq: 135, msg: "暴雨天赶场，淋雨着凉。", hurt: 6 },
      { freq: 115, msg: "高峰期通勤拥堵，心态爆炸。", hurt: 2 },
      { freq: 90, msg: "通宵盯盘，睡眠不足。", hurt: 4 },
      { freq: 70, msg: "高温天外跑，体力透支。", hurt: 3 },
      { freq: 180, msg: "连轴转后短暂眩晕。", hurt: 5 },
    ];
    this.hospitalCases = [
      { name: "急性肺炎", msg: "你长期熬夜+暴雨奔波，诱发急性肺炎。", min: 38000, max: 76000, days: 2 },
      { name: "胃出血", msg: "你连续空腹跑市场，突发胃出血。", min: 45000, max: 92000, days: 2 },
      { name: "心律失常", msg: "高压交易导致心律失常，需要住院监护。", min: 52000, max: 110000, days: 3 },
      { name: "重度焦虑失眠", msg: "持续盯盘后精神崩溃，必须系统治疗。", min: 36000, max: 80000, days: 2 },
    ];

    this.stealEvents = [
      { freq: 86, msg: "暴雨夜从滨江赶到钱江新城，网约车排队费和夜间溢价一起上头。", ratio: 6, min: 180, max: 3800, severity: "light" },
      { freq: 92, msg: "临时摊位和场地方突然加收管理费，你只能先认栽。", ratio: 7, min: 260, max: 5200, severity: "light" },
      { freq: 118, msg: "你忙着出货没细看，收款码被人贴了同款假码。", ratio: 11, min: 800, max: 18000, severity: "medium" },
      { freq: 126, msg: "冒充平台客服来电，说账户异常要先做流水验证。", ratio: 14, min: 1200, max: 26000, severity: "medium", debtOnShortfall: true },
      { freq: 142, msg: "微信群里的“内部配额”要先付保证金，转完才发现群主消失了。", ratio: 16, min: 1800, max: 36000, severity: "medium", debtOnShortfall: true },
      { freq: 170, msg: "你被拉进“杭州产业内参群”，跟单一把回撤。", ratio: 22, min: 3800, max: 80000, severity: "heavy", fame: -2, debtOnShortfall: true },
      { freq: 155, msg: "大客户临时反悔，你为了保住圈内信用先垫了违约赔付。", ratio: 18, min: 2600, max: 56000, severity: "heavy", fame: 1, debtOnShortfall: true },
      { freq: 135, msg: "账户风控误伤，部分余额短期卡住，周转现金立刻变少。", ratio: 10, min: 900, max: 22000, severity: "medium" },
    ];

    this.locations = [
      "西湖", "武林广场", "滨江", "钱江新城", "未来科技城",
      "城西银泰", "杭州东站", "灵隐", "运河", "萧山机场",
      "河坊街", "奥体中心",
    ];

    this.locMultipliers = [];
    this.locationDistricts = [
      "xihu", "gongshu", "binjiang", "shangcheng", "yuhang",
      "yuhang", "shangcheng", "xihu", "gongshu", "xiaoshan",
      "shangcheng", "xiaoshan",
    ];
    this.districtLabels = {
      xihu: "西湖区",
      shangcheng: "上城区",
      gongshu: "拱墅区",
      binjiang: "滨江区",
      yuhang: "余杭区",
      xiaoshan: "萧山区",
      qiantang: "钱塘区",
    };
    this.rumor = null;
    this.lastRumorLoc = 0;
    this.coffeeCost = 30;
    this.rumorBuff = null;
    this.activeNews = [];
    this.pendingNewsStages = [];
    this.recentNewsTemplateIds = [];
    this.lastNewsSpawnDay = 0;
    this.lastNewsPopups = [];
    this.lastNewsPopupStrength = 0;
    this.todayNews = null;
    this.newsPool = [
      {
        id: "city-tourism",
        title: "【杭州文旅热度攀升】",
        desc: "假期客流叠加夜游活动，文旅消费情绪走强。",
        durationMin: 2,
        durationMax: 4,
        effects: [
          { goodsIds: [1, 3, 12, 20], minPct: 10, maxPct: 26, tag: "热门" },
          { goodsIds: [2, 11], minPct: -12, maxPct: -4, tag: "滞销" },
        ],
      },
      {
        id: "compute-demand",
        title: "【算力与硬件需求升温】",
        desc: "多家科技公司集中扩容，硬件与算力报价抬升。",
        durationMin: 2,
        durationMax: 3,
        effects: [
          { goodsIds: [6, 10, 15, 18, 22], minPct: 12, maxPct: 34, tag: "稀缺" },
          { goodsIds: [0, 1], minPct: -10, maxPct: -3, tag: "滞销" },
        ],
      },
      {
        id: "cross-border-delay",
        title: "【跨境履约受阻】",
        desc: "物流与清关节奏放缓，跨境链路出现折价抛盘。",
        durationMin: 2,
        durationMax: 4,
        effects: [
          { goodsIds: [13, 14, 16], minPct: -28, maxPct: -10, tag: "政策影响" },
          { goodsIds: [7, 9], minPct: 6, maxPct: 18, tag: "热门" },
        ],
      },
      {
        id: "capital-rotation",
        title: "【资本风格切换】",
        desc: "资金从稳健品撤离，向高波动品集中。",
        durationMin: 2,
        durationMax: 3,
        effects: [
          { goodsIds: [17, 21], minPct: 14, maxPct: 38, tag: "热门" },
          { goodsIds: [8, 9], minPct: -18, maxPct: -8, tag: "承压" },
        ],
      },
      {
        id: "consumer-inspection",
        title: "【消费监管趋严】",
        desc: "平台抽检和营销规范升级，部分热门品类承压。",
        durationMin: 2,
        durationMax: 4,
        effects: [
          { goodsIds: [5, 11, 14], minPct: -22, maxPct: -9, tag: "政策影响" },
          { goodsIds: [3, 4], minPct: 8, maxPct: 20, tag: "稀缺" },
        ],
      },
      {
        id: "lake-queue-rumor",
        chainId: "lake-queue",
        stage: "signal",
        weight: 90,
        nextId: "lake-queue-report",
        nextDelayMin: 2,
        nextDelayMax: 3,
        title: "【湖滨队伍拐了三个弯】",
        desc: "路人看见队伍就跟着排，前七位都说不清在买什么。",
        durationMin: 2,
        durationMax: 2,
        effects: [
          { goodsIds: [0, 1], minPct: 8, maxPct: 22, tag: "围观" },
        ],
      },
      {
        id: "lake-queue-report",
        chainId: "lake-queue",
        stage: "payoff",
        entry: false,
        title: "【排到第八位，终于问明白了】",
        desc: "一家小店发售会反光的联名冰箱贴；队伍知道答案后，排得更长了。",
        durationMin: 2,
        durationMax: 3,
        effects: [
          { goodsIds: [1], minPct: 70, maxPct: 120, tag: "爆单" },
          { goodsIds: [11], minPct: -18, maxPct: -6, tag: "失宠" },
        ],
      },
      {
        id: "ai-companion-launch",
        chainId: "ai-companion-service",
        stage: "signal",
        weight: 85,
        nextId: "ai-companion-complaint",
        nextDelayMin: 2,
        nextDelayMax: 3,
        title: "【桌面搭子突然走红】",
        desc: "新品号称能陪聊、记事、控灯，首批预约一路排到下周。",
        durationMin: 2,
        durationMax: 3,
        effects: [
          { goodsIds: [18], minPct: 24, maxPct: 42, tag: "新品" },
          { goodsIds: [6], minPct: 8, maxPct: 18, tag: "算力" },
        ],
      },
      {
        id: "ai-companion-complaint",
        chainId: "ai-companion-service",
        stage: "reversal",
        entry: false,
        nextId: "ai-companion-update",
        nextDelayMin: 2,
        nextDelayMax: 3,
        title: "【说好陪聊，到家只劝充电】",
        desc: "消费者发现它最熟练的一句话是“电量不足”；负责人正在开会，且会议很有续航。",
        durationMin: 2,
        durationMax: 3,
        effects: [
          { goodsIds: [18], minPct: -58, maxPct: -36, tag: "投诉" },
          { goodsIds: [2], minPct: 12, maxPct: 28, tag: "刚需" },
        ],
      },
      {
        id: "ai-companion-update",
        chainId: "ai-companion-service",
        stage: "resolution",
        entry: false,
        title: "【记者到场，会议准时结束】",
        desc: "厂商连夜推送固件并延长退换期，桌面搭子终于学会了第二句话。",
        durationMin: 2,
        durationMax: 3,
        effects: [
          { goodsIds: [18], minPct: 48, maxPct: 82, tag: "修复" },
          { goodsIds: [2], minPct: -16, maxPct: -6, tag: "降温" },
        ],
      },
      {
        id: "coupon-poster",
        chainId: "coupon-rules",
        stage: "signal",
        weight: 75,
        nextId: "coupon-checkout",
        nextDelayMin: 2,
        nextDelayMax: 3,
        title: "【消费券海报写得很大】",
        desc: "“不限使用张数”吸引顾客下单，妆造和文旅套餐先热了一轮。",
        durationMin: 2,
        durationMax: 2,
        effects: [
          { goodsIds: [5, 9], minPct: 16, maxPct: 34, tag: "促销" },
        ],
      },
      {
        id: "coupon-checkout",
        chainId: "coupon-rules",
        stage: "reversal",
        entry: false,
        nextId: "coupon-mediation",
        nextDelayMin: 2,
        nextDelayMax: 3,
        title: "【到了收银台，只能用一张】",
        desc: "海报、客服和结算系统第一次正式见面，三方对活动规则各有理解。",
        durationMin: 2,
        durationMax: 3,
        effects: [
          { goodsIds: [5, 9], minPct: -48, maxPct: -28, tag: "纠纷" },
          { goodsIds: [11], minPct: 8, maxPct: 20, tag: "替代" },
        ],
      },
      {
        id: "coupon-mediation",
        chainId: "coupon-rules",
        stage: "resolution",
        entry: false,
        title: "【规则终于同步成功】",
        desc: "调解后商家补兑并重写页面，消费者拿到了券，文案也拿到了标点。",
        durationMin: 2,
        durationMax: 3,
        effects: [
          { goodsIds: [5, 9], minPct: 18, maxPct: 32, tag: "回暖" },
        ],
      },
      {
        id: "repair-search-results",
        chainId: "official-repair-search",
        stage: "signal",
        weight: 70,
        nextId: "repair-two-hours",
        nextDelayMin: 2,
        nextDelayMax: 3,
        title: "【搜索一开，全是官方售后】",
        desc: "页面从官方专修排到官方直营网点，唯一没统一的是客服电话。",
        durationMin: 2,
        durationMax: 2,
        effects: [
          { goodsIds: [10], minPct: 18, maxPct: 34, tag: "维修热" },
          { goodsIds: [2], minPct: 8, maxPct: 18, tag: "备用" },
        ],
      },
      {
        id: "repair-two-hours",
        chainId: "official-repair-search",
        stage: "reversal",
        entry: false,
        nextId: "repair-real-official",
        nextDelayMin: 2,
        nextDelayMax: 3,
        title: "【主板换好两小时，又很有主见】",
        desc: "维修点建议再换一块；机器建议大家先冷静，虽然它自己不制冷。",
        durationMin: 2,
        durationMax: 3,
        effects: [
          { goodsIds: [10], minPct: -52, maxPct: -34, tag: "返修" },
          { goodsIds: [2], minPct: 16, maxPct: 30, tag: "刚需" },
        ],
      },
      {
        id: "repair-real-official",
        chainId: "official-repair-search",
        stage: "resolution",
        entry: false,
        title: "【真正官方终于接通】",
        desc: "客服先确认维修点不是他们的，再确认搜索结果也不是他们排的。",
        durationMin: 2,
        durationMax: 3,
        effects: [
          { goodsIds: [10], minPct: 24, maxPct: 44, tag: "正品" },
          { goodsIds: [2], minPct: -14, maxPct: -6, tag: "降温" },
        ],
      },
    ];
    this.newGame();
  }

  configureCityContent(config = {}) {
    if (!config || typeof config !== "object" || Array.isArray(config)) return false;
    let changed = false;

    const experiment = config.gameplay_experiment || config.experiment_config;
    if (experiment && this.configureExperiment(experiment)) changed = true;

    const productRows = Array.isArray(config.product_overrides)
      ? config.product_overrides
      : (Array.isArray(config.products) ? config.products : []);
    if (productRows.length) {
      const overrides = new Map(productRows
        .filter((row) => row && Number.isInteger(Number(row.id)))
        .map((row) => [Number(row.id), row]));
      this.goods = this.goods.map((goods) => {
        const row = overrides.get(goods.id);
        if (!row) return goods;
        const next = { ...goods };
        const name = String(row.name || "").trim();
        if (name) next.name = name.slice(0, 40);
        if (["physical", "virtual", "financial"].includes(row.kind)) next.kind = row.kind;
        if (Number.isFinite(Number(row.weight))) next.weight = Math.max(0, Math.floor(Number(row.weight)));
        if (Number.isFinite(Number(row.base))) next.base = Math.max(1, Math.floor(Number(row.base)));
        if (Number.isFinite(Number(row.span))) next.span = Math.max(1, Math.floor(Number(row.span)));
        if (JSON.stringify(next) !== JSON.stringify(goods)) changed = true;
        return next;
      });
    }

    if (Array.isArray(config.locations) && config.locations.length === this.locations.length) {
      const locations = config.locations.map((row, index) => {
        if (typeof row === "string") {
          return { name: row.trim().slice(0, 24), district: this.locationDistricts[index] };
        }
        return {
          name: String(row?.name || "").trim().slice(0, 24),
          district: String(row?.district || this.locationDistricts[index] || "city").trim().slice(0, 32),
        };
      });
      if (locations.every((row) => row.name)) {
        const nextNames = locations.map((row) => row.name);
        const nextDistricts = locations.map((row) => row.district || "city");
        if (JSON.stringify(nextNames) !== JSON.stringify(this.locations)
          || JSON.stringify(nextDistricts) !== JSON.stringify(this.locationDistricts)) changed = true;
        this.locations = nextNames;
        this.locationDistricts = nextDistricts;
      }
    }

    if (config.district_labels && typeof config.district_labels === "object") {
      const labels = Object.fromEntries(Object.entries(config.district_labels)
        .map(([key, value]) => [String(key).slice(0, 32), String(value || "").trim().slice(0, 24)])
        .filter(([, value]) => value));
      if (Object.keys(labels).length) {
        this.districtLabels = { ...this.districtLabels, ...labels };
        changed = true;
      }
    }

    if (Array.isArray(config.news_pool) && config.news_pool.length) {
      const goodsIds = new Set(this.goods.map((goods) => goods.id));
      const newsPool = config.news_pool.map((row, index) => {
        const effects = (Array.isArray(row?.effects) ? row.effects : []).map((effect) => {
          const ids = (Array.isArray(effect?.goodsIds) ? effect.goodsIds : [])
            .map(Number)
            .filter((id) => goodsIds.has(id));
          if (!ids.length) return null;
          const firstPct = Math.max(-95, Math.min(1200, Math.floor(Number(effect.minPct) || 0)));
          const secondPct = Math.max(-95, Math.min(1200, Math.floor(Number(effect.maxPct) || 0)));
          return {
            goodsIds: ids,
            minPct: Math.min(firstPct, secondPct),
            maxPct: Math.max(firstPct, secondPct),
            tag: String(effect.tag || "行情").slice(0, 16),
          };
        }).filter(Boolean);
        const title = String(row?.title || "").trim().slice(0, 80);
        if (!title || !effects.length) return null;
        return {
          id: String(row?.id || `news-${index + 1}`).replace(/[^a-z0-9_-]/gi, "").slice(0, 64),
          chainId: String(row?.chainId || row?.chain_id || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 64),
          stage: String(row?.stage || "single").replace(/[^a-z0-9_-]/gi, "").slice(0, 24),
          entry: row?.entry !== false,
          weight: Math.max(1, Math.min(1000, Math.floor(Number(row?.weight) || 100))),
          nextId: String(row?.nextId || row?.next_id || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 64),
          nextDelayMin: Math.max(1, Math.min(8, Math.floor(Number(row?.nextDelayMin || row?.next_delay_min) || 2))),
          nextDelayMax: Math.max(1, Math.min(10, Math.floor(Number(row?.nextDelayMax || row?.next_delay_max) || 3))),
          title,
          desc: String(row?.desc || "").trim().slice(0, 180),
          durationMin: Math.max(1, Math.min(6, Math.floor(Number(row.durationMin) || 2))),
          durationMax: Math.max(1, Math.min(8, Math.floor(Number(row.durationMax) || 4))),
          effects,
        };
      }).filter(Boolean);
      if (newsPool.length) {
        this.newsPool = newsPool;
        changed = true;
      }
    }

    this.cityContentKey = String(config.content_schema || config.scene_key || "city-content-v1").slice(0, 80);
    return changed;
  }

  configureExperiment(config = {}) {
    const next = normalizeExperimentConfig(config);
    const changed = JSON.stringify(next) !== JSON.stringify(this.experimentConfig);
    this.experimentConfig = next;
    this.experimentKey = next.experimentId;
    return changed;
  }

  rnd(n) { return Math.floor(Math.random() * n); }
  get totalDays() { return TOTAL_DAYS; }
  get targetSessionMinutes() { return TARGET_SESSION_MINUTES; }
  get daysUsed() { return TOTAL_DAYS - this.timeLeft; }
  get nextDayNumber() { return Math.min(TOTAL_DAYS, this.daysUsed + 1); }

  newGame() {
    this.cash = 3000;
    this.debt = 6000;
    this.bank = 0;
    this.health = 100;
    this.fame = 100;
    this.coat = INITIAL_CAPACITY;
    this.totalItems = 0;
    this.timeLeft = TOTAL_DAYS;
    this.currentLoc = 1;
    this.wangbaVisits = 0;
    this.market = [];
    this.inv = [];
    this.logs = [`新游戏开始：欢迎来到杭州。${TOTAL_DAYS} 天交易局。 版本代号 ${GAME_VERSION_CODE}`];
    this.eventLog = [];
    this.recordEvent("system", this.logs[0], {
      version: GAME_VERSION_CODE,
      experiment_id: this.experimentConfig.experimentId,
    });
    this.lastMarketPopups = [];
    this.rumor = null;
    this.lastRumorLoc = 0;
    this.rumorBuff = null;
    this.activeNews = [];
    this.pendingNewsStages = [];
    this.recentNewsTemplateIds = [];
    this.todayNews = {
      title: "【市场开盘】",
      desc: "先跑动起来，第一轮行情会在换地方后生成。",
      effects: [],
      day: 0,
    };
    this.tradeCount = 0;
    this.marketSoldToday = {};
    this.careerStageIndex = 0;
    this.starterBufferUsed = 0;
    this.magicEventQuota = this.rollMagicEventQuota();
    this.magicEventTriggered = 0;
    this.gameOver = false;
    this.lastTrade = null;
    this.rollLocationMultipliers();
    this.makeDrugPrices(3);
    this.applyLocationSpread();
    this.displayDrugs();
  }

  get score() { return this.cash + this.bank - this.debt; }
  get dayText() { return `杭州浮生(${this.daysUsed}/${TOTAL_DAYS}天)`; }
  get cityLabels() { return this.locations; }

  rollMagicEventQuota() {
    const weights = this.experimentConfig.jackpotQuotaDistribution;
    const r = Math.random();
    let cursor = 0;
    for (let quota = 0; quota < weights.length; quota += 1) {
      cursor += weights[quota];
      if (r < cursor) return quota;
    }
    return weights.length - 1;
  }

  addLog(msg, type = "log", payload = {}) {
    this.logs.push(msg);
    if (this.logs.length > 200) this.logs = this.logs.slice(-200);
    this.recordEvent(type, msg, payload);
  }

  recordEvent(type, message, payload = {}) {
    if (!this.eventLog) this.eventLog = [];
    const eventType = String(type || "log").slice(0, 40);
    this.eventLog.push({
      event_index: this.eventLog.length,
      event_type: eventType,
      day: this.daysUsed,
      message: String(message || "").slice(0, 240),
      state: this.compactState(),
      payload: this.compactPayload(payload),
      created_at: new Date().toISOString(),
    });
    if (this.eventLog.length > EVENT_LOG_LIMIT) {
      this.eventLog = this.eventLog.slice(-EVENT_LOG_LIMIT).map((event, index) => ({ ...event, event_index: index }));
    }
  }

  compactState() {
    return {
      score: this.score,
      cash: this.cash,
      bank: this.bank,
      debt: this.debt,
      health: this.health,
      fame: this.fame,
      coat: this.coat,
      items: this.totalItems,
      timeLeft: this.timeLeft,
      daysUsed: this.daysUsed,
      totalDays: TOTAL_DAYS,
      currentLoc: this.currentLoc,
      experimentId: this.experimentConfig.experimentId,
      starterBufferUsed: this.starterBufferUsed || 0,
      careerStageIndex: this.careerStageIndex || 0,
    };
  }

  compactPayload(payload = {}) {
    const out = {};
    for (const [key, value] of Object.entries(payload || {})) {
      if (value === undefined || typeof value === "function") continue;
      if (typeof value === "string") out[key] = value.slice(0, 160);
      else if (typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
      else if (Array.isArray(value)) out[key] = value.slice(0, 20);
      else if (typeof value === "object") out[key] = value;
    }
    return out;
  }

  rollGoodsPrice(g) {
    const base = Math.max(1, Number(g?.base) || 1);
    const span = Math.max(1, Number(g?.span) || 1);
    const r = this.rnd(100);
    let ratio;
    if (r < 15) ratio = 0.12 + this.rnd(23) / 100; // 0.12 ~ 0.34
    else if (r < 25) ratio = 0.66 + this.rnd(27) / 100; // 0.66 ~ 0.92
    else ratio = 0.35 + this.rnd(31) / 100; // 0.35 ~ 0.65
    const tierScale = base <= 2500
      ? this.experimentConfig.lowGoodsPriceSpanScale
      : (base >= 7000 ? this.experimentConfig.highValuePriceSpanScale : 1);
    const scaledRatio = Math.max(0.04, Math.min(1.2,
      0.5 + (ratio - 0.5) * this.experimentConfig.priceSpanScale * tierScale));
    return Math.max(1, Math.floor(base + span * scaledRatio));
  }

  makeDrugPrices(leaveout) {
    const day = this.daysUsed;
    const earlyCutoff = Math.ceil(TOTAL_DAYS / 3);
    const midCutoff = Math.ceil((TOTAL_DAYS * 2) / 3);
    const stage = day <= earlyCutoff ? "early" : day <= midCutoff ? "mid" : "late";
    const pools = {
      early: [0, 1, 2, 3, 5, 7, 10, 11, 12, 14, 18],
      mid: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 20],
      late: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
    };
    const allBase = this.goods.map((g) => g.id);
    const primary = pools[stage].slice();
    const targetCount = MARKET_BUY_DISPLAY_LIMIT;

    // 给每一天一点“惊喜外溢”，避免池子过于死板
    const wildcardNeed = 2;
    while (primary.length < targetCount + wildcardNeed) {
      const id = allBase[this.rnd(allBase.length)];
      if (!primary.includes(id)) primary.push(id);
      if (primary.length >= allBase.length) break;
    }

    const financialIds = [];
    const nonFinancialIds = [];
    for (const id of primary) {
      const g = this.goods[id];
      if (!g) continue;
      if (g.kind === "financial") financialIds.push(id);
      else nonFinancialIds.push(id);
    }

    const pickUnique = (arr, n) => {
      const copy = arr.slice();
      const out = [];
      while (copy.length && out.length < n) {
        const i = this.rnd(copy.length);
        out.push(copy.splice(i, 1)[0]);
      }
      return out;
    };

    const financialCap = stage === "early" ? 3 : stage === "mid" ? 4 : 5;
    const finPick = pickUnique(financialIds, Math.min(financialCap, targetCount));
    const needNonFin = Math.max(0, targetCount - finPick.length);
    const nonFinPick = pickUnique(nonFinancialIds, needNonFin);
    const stillNeed = Math.max(0, targetCount - finPick.length - nonFinPick.length);
    const extraFin = pickUnique(financialIds.filter((x) => !finPick.includes(x)), stillNeed);
    const selectedIds = [...finPick, ...nonFinPick, ...extraFin];

    const prices = {};
    for (const id of selectedIds) {
      const g = this.goods[id];
      prices[id] = this.rollGoodsPrice(g);
    }
    for (const item of this.inv || []) {
      if (prices[item.id] > 0) continue;
      const g = this.goods.find((x) => x.id === item.id);
      if (g) prices[g.id] = this.rollGoodsPrice(g);
    }

    this.market = this.goods
      .filter((g) => prices[g.id] > 0)
      .map((g) => ({ id: g.id, name: g.name, price: prices[g.id], kind: g.kind, weight: g.weight }));
    this.limitHighValueMarketSupply();
  }

  displayDrugs() { this.market.sort((a, b) => a.id - b.id); }

  highValueMarketCap() {
    const day = this.daysUsed;
    if (day < 15) return 0;
    if (day < 25) return 1;
    if (day < 35) return 2;
    return 3;
  }

  limitHighValueMarketSupply() {
    const heldIds = new Set((this.inv || []).map((item) => item.id));
    const cap = this.highValueMarketCap();
    let seen = 0;
    this.market = (this.market || []).filter((m) => {
      const g = this.goods.find((x) => x.id === m.id);
      if (!g || g.base < 7000 || heldIds.has(m.id)) return true;
      seen += 1;
      return seen <= cap;
    });
  }

  rollLocationMultipliers() {
    this.locMultipliers = [];
    for (let loc = 0; loc < this.locations.length; loc++) {
      const row = {};
      for (const g of this.goods) {
        // 常规地区差价收窄；大波动交给新闻和离谱事件，玩家更容易理解原因。
        let k = 0.86 + this.rnd(31) / 100; // 0.86 ~ 1.16
        if (this.rnd(100) < this.experimentConfig.locationRareChance) {
          k = 0.62 + this.rnd(77) / 100; // 0.62 ~ 1.38
        }
        const tierScale = g.base <= 2500
          ? this.experimentConfig.lowGoodsLocationSpreadScale
          : (g.base >= 7000 ? this.experimentConfig.highValueLocationSpreadScale : 1);
        row[g.id] = Math.max(0.2,
          1 + (k - 1) * this.experimentConfig.locationSpreadScale * tierScale);
      }
      this.locMultipliers.push(row);
    }
    if (this.rumorBuff && this.rumorBuff.turnsLeft > 0) {
      const { targetLoc, goodId, direction } = this.rumorBuff;
      const i = Math.max(0, targetLoc - 1);
      if (this.locMultipliers[i]) {
        if (direction === "up") this.locMultipliers[i][goodId] = Math.max(this.locMultipliers[i][goodId], 1.34 + this.rnd(29) / 100);
        else this.locMultipliers[i][goodId] = Math.min(this.locMultipliers[i][goodId], 0.58 + this.rnd(23) / 100);
      }
      this.rumorBuff.turnsLeft -= 1;
      if (this.rumorBuff.turnsLeft <= 0) this.rumorBuff = null;
    }
  }

  applyLocationSpread() {
    const locIdx = Math.max(0, (this.currentLoc || 1) - 1);
    const row = this.locMultipliers[locIdx] || {};
    this.market = this.market.map((m) => {
      const k = row[m.id] ?? 1;
      return { ...m, price: Math.max(1, Math.floor(m.price * k)) };
    });
  }
  ensureInventoryMarketQuotes() {
    if (!this.inv || this.inv.length === 0) return;
    const existing = new Set((this.market || []).map((m) => m.id));
    const locIdx = Math.max(0, (this.currentLoc || 1) - 1);
    const spread = this.locMultipliers?.[locIdx] || {};
    let added = false;
    for (const item of this.inv) {
      if (existing.has(item.id)) continue;
      const g = this.goods.find((x) => x.id === item.id);
      if (!g) continue;
      const basePrice = this.rollGoodsPrice(g);
      const k = spread[g.id] ?? 1;
      this.market.push({
        id: g.id,
        name: g.name,
        price: Math.max(1, Math.floor(basePrice * k)),
        kind: g.kind,
        weight: g.weight,
      });
      existing.add(g.id);
      added = true;
    }
    if (added) this.displayDrugs();
  }

  prepareNewsForDay() {
    const currentDay = this.nextDayNumber;
    const config = this.experimentConfig;
    this.activeNews = (this.activeNews || []).filter((n) => n.expiresOnDay >= currentDay);
    this.lastNewsPopups = [];
    this.lastNewsPopupStrength = 0;

    const daysSinceNews = currentDay - Math.max(0, Number(this.lastNewsSpawnDay || 0));
    const gapReady = this.lastNewsSpawnDay === 0 || daysSinceNews >= config.newsMinGapDays;
    const forceNews = this.lastNewsSpawnDay > 0 && daysSinceNews >= config.newsForceAfterDays;
    const pendingIndex = (this.pendingNewsStages || []).findIndex((item) => item.dueDay <= currentDay);
    const pending = pendingIndex >= 0 ? this.pendingNewsStages[pendingIndex] : null;
    if (gapReady && (pending || forceNews || this.rnd(100) < config.newsSpawnRate)) {
      const tpl = pending?.template || this.pickNewsTemplate();
      if (!tpl) return;
      if (pendingIndex >= 0) this.pendingNewsStages.splice(pendingIndex, 1);
      const duration = tpl.durationMin + this.rnd(tpl.durationMax - tpl.durationMin + 1);
      const impacts = tpl.effects.map((effect) => {
        const goodsId = effect.goodsIds[this.rnd(effect.goodsIds.length)];
        const rawPct = effect.minPct + this.rnd(effect.maxPct - effect.minPct + 1);
        const pct = Math.max(-95, Math.min(1200, Math.round(rawPct * config.newsEffectScale)));
        return {
          goodsId,
          pct,
          tag: effect.tag,
        };
      });
      const news = {
        id: `${currentDay}-${Date.now()}-${this.rnd(9999)}`,
        title: tpl.title,
        desc: tpl.desc,
        templateId: tpl.id || "",
        chainId: tpl.chainId || "",
        stage: tpl.stage || "single",
        day: currentDay,
        expiresOnDay: currentDay + duration - 1,
        impacts,
      };
      this.activeNews.push(news);
      this.rememberNewsTemplate(tpl);
      this.scheduleNewsFollowUp(tpl, currentDay);
      this.queueNewsPopup(news);
      const impactText = impacts
        .map((x) => `${this.goods[x.goodsId]?.name || "未知商品"}${x.pct > 0 ? "+" : ""}${x.pct}%`)
        .join("，");
      this.addLog(`${news.title} ${news.desc}（${impactText}）`, "market_news", {
        day: currentDay,
        expires_on_day: news.expiresOnDay,
        impacts,
        template_id: news.templateId,
        chain_id: news.chainId,
        chain_stage: news.stage,
      });
    }
    this.maybeCreateSmallGoodsSwingNews(currentDay);
    this.maybeCreateHeldJackpotNews(currentDay);
    this.refreshTodayNews(currentDay);
  }

  pickNewsTemplate() {
    const entries = (this.newsPool || []).filter((template) => template.entry !== false);
    if (!entries.length) return null;
    const recent = new Set((this.recentNewsTemplateIds || []).slice(-3));
    const fresh = entries.filter((template) => !recent.has(template.id));
    const candidates = fresh.length ? fresh : entries;
    const totalWeight = candidates.reduce((sum, template) => sum + Math.max(1, Number(template.weight) || 100), 0);
    let cursor = this.rnd(Math.max(1, Math.floor(totalWeight)));
    for (const template of candidates) {
      cursor -= Math.max(1, Number(template.weight) || 100);
      if (cursor < 0) return template;
    }
    return candidates[candidates.length - 1];
  }

  rememberNewsTemplate(template) {
    if (!template?.id) return;
    this.recentNewsTemplateIds = [...(this.recentNewsTemplateIds || []), template.id].slice(-8);
  }

  scheduleNewsFollowUp(template, currentDay) {
    if (!template?.nextId) return false;
    const next = (this.newsPool || []).find((candidate) => candidate.id === template.nextId);
    if (!next) return false;
    const minDelay = Math.max(1, Number(template.nextDelayMin) || 2);
    const maxDelay = Math.max(minDelay, Number(template.nextDelayMax) || minDelay);
    const dueDay = Math.min(TOTAL_DAYS, currentDay + minDelay + this.rnd(maxDelay - minDelay + 1));
    this.pendingNewsStages = (this.pendingNewsStages || [])
      .filter((item) => item.template?.id !== next.id);
    this.pendingNewsStages.push({ dueDay, template: next });
    this.pendingNewsStages.sort((left, right) => left.dueDay - right.dueDay);
    return true;
  }

  queueNewsPopup(news) {
    if (!news) return;
    const newsDay = Number(news.day || this.nextDayNumber);
    const sameDay = newsDay === Number(this.lastNewsSpawnDay || 0);
    if (!sameDay && this.lastNewsSpawnDay > 0
      && newsDay - this.lastNewsSpawnDay < this.experimentConfig.newsMinGapDays) return;
    const impacts = (news.impacts || []).map((impact) => {
      const goods = this.goods.find((item) => item.id === impact.goodsId);
      return `${goods?.name || "未知商品"} ${impact.pct > 0 ? "+" : ""}${impact.pct}%`;
    });
    const strength = Math.max(0, ...(news.impacts || []).map((impact) => Math.abs(Number(impact.pct || 0))));
    if (this.lastNewsPopups.length && strength <= this.lastNewsPopupStrength) return;
    this.lastNewsPopupStrength = strength;
    this.lastNewsSpawnDay = newsDay;
    this.lastNewsPopups = [
      `${news.title}\n${news.desc}\n${impacts.join("，")} · 影响至第${news.expiresOnDay}天`,
    ];
  }

  maybeCreateSmallGoodsSwingNews(currentDay) {
    const config = this.experimentConfig;
    if (currentDay < config.smallGoodsStartDay || this.rnd(100) >= config.smallGoodsSwingRate) return false;
    const candidates = this.goods.filter((g) => g.base <= 2500);
    if (!candidates.length) return false;
    const goods = candidates[this.rnd(candidates.length)];
    const isUp = this.rnd(100) < config.smallGoodsUpRate;
    const pct = isUp
      ? config.smallGoodsUpMin + this.rnd(config.smallGoodsUpMax - config.smallGoodsUpMin + 1)
      : -(config.smallGoodsDownMin + this.rnd(config.smallGoodsDownMax - config.smallGoodsDownMin + 1));
    const duration = 2 + this.rnd(2);
    const title = isUp ? "【小商品爆单】" : "【小商品塌价】";
    const desc = isUp
      ? `${goods.name} 被短视频和社群团购突然带火。`
      : `${goods.name} 同款铺货太多，渠道开始压价。`;
    const news = {
      id: `small-${currentDay}-${Date.now()}-${this.rnd(9999)}`,
      title,
      desc,
      day: currentDay,
      expiresOnDay: currentDay + duration - 1,
      impacts: [{ goodsId: goods.id, pct, tag: isUp ? "爆单" : "塌价" }],
    };
    this.activeNews.push(news);
    this.queueNewsPopup(news);
    this.addLog(`${title} ${desc}（${goods.name}${pct > 0 ? "+" : ""}${pct}%）`, "market_news", {
      day: currentDay,
      expires_on_day: news.expiresOnDay,
      impacts: news.impacts,
      small_goods_swing: true,
    });
    return true;
  }

  maybeCreateHeldJackpotNews(currentDay) {
    const config = this.experimentConfig;
    if (currentDay < config.jackpotStartDay) return false;
    const candidates = (this.inv || []).filter((item) => {
      const goods = this.goods.find((g) => g.id === item.id);
      return goods && goods.base <= 12000;
    });
    if (candidates.length === 0) return false;
    if ((this.magicEventTriggered || 0) >= (this.magicEventQuota || 0)) return false;
    const remainingQuota = (this.magicEventQuota || 0) - (this.magicEventTriggered || 0);
    const remainingDays = Math.max(1, TOTAL_DAYS - currentDay + 1);
    const chance = Math.min(config.jackpotChanceCap,
      Math.max(config.jackpotChanceFloor, Math.ceil((remainingQuota / remainingDays) * 100)));
    if (this.rnd(100) >= chance) return false;
    const held = candidates[this.rnd(candidates.length)];
    const goods = this.goods.find((g) => g.id === held.id);
    if (!goods) return false;
    const superSpike = currentDay >= 36 && this.rnd(100) < config.jackpotSuperRate;
    const pct = superSpike
      ? config.jackpotSuperMin + this.rnd(config.jackpotSuperMax - config.jackpotSuperMin + 1)
      : config.jackpotRegularMin + this.rnd(config.jackpotRegularMax - config.jackpotRegularMin + 1);
    const duration = 1 + this.rnd(2);
    const news = {
      id: `jackpot-${currentDay}-${Date.now()}-${this.rnd(9999)}`,
      title: "【离谱爆红】",
      desc: `你仓库里的 ${goods.name} 突然被全城疯抢。`,
      day: currentDay,
      expiresOnDay: currentDay + duration - 1,
      impacts: [{ goodsId: goods.id, pct, tag: superSpike ? "神局" : "爆红" }],
    };
    this.magicEventTriggered = (this.magicEventTriggered || 0) + 1;
    this.activeNews.push(news);
    this.queueNewsPopup(news);
    this.addLog(`${news.title} ${news.desc}（${goods.name}+${pct}%）`, "market_news", {
      day: currentDay,
      expires_on_day: news.expiresOnDay,
      impacts: news.impacts,
      held_jackpot: true,
      magic_index: this.magicEventTriggered,
      magic_quota: this.magicEventQuota,
      super_spike: superSpike,
      held_count: held.count,
    });
    return true;
  }

  refreshTodayNews(currentDay) {
    const merged = new Map();
    for (const news of this.activeNews) {
      if (news.expiresOnDay < currentDay) continue;
      for (const impact of news.impacts || []) {
        const row = merged.get(impact.goodsId) || { goodsId: impact.goodsId, pct: 0, tags: new Set() };
        row.pct += impact.pct;
        if (impact.tag) row.tags.add(impact.tag);
        merged.set(impact.goodsId, row);
      }
    }
    const effects = [...merged.values()]
      .map((x) => ({
        goodsId: x.goodsId,
        name: this.goods[x.goodsId]?.name || "未知商品",
        pct: Math.round(x.pct),
        tags: [...x.tags],
      }))
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
      .slice(0, 6);

    const latest = this.activeNews[this.activeNews.length - 1];
    if (latest) {
      this.todayNews = {
        title: latest.title,
        desc: latest.desc,
        day: currentDay,
        effects,
      };
      return;
    }
    this.todayNews = {
      title: "【市场平稳】",
      desc: "暂无重磅消息，区域价差主导交易机会。",
      day: currentDay,
      effects,
    };
  }

  buildNewsMultiplierMap() {
    const currentDay = this.nextDayNumber;
    const map = new Map();
    for (const news of this.activeNews) {
      if (news.expiresOnDay < currentDay) continue;
      for (const impact of news.impacts || []) {
        const prev = map.get(impact.goodsId) ?? 1;
        const next = prev * (1 + impact.pct / 100);
        map.set(impact.goodsId, Math.max(0.2, Math.min(MAX_NEWS_PRICE_MULTIPLIER, next)));
      }
    }
    return map;
  }

  applyNewsToMarketPrices() {
    if (!this.market || this.market.length === 0) return;
    const multi = this.buildNewsMultiplierMap();
    if (multi.size === 0) return;
    this.market = this.market.map((m) => {
      const k = multi.get(m.id);
      if (!k) return m;
      const nextPrice = Math.max(1, Math.floor(m.price * k));
      const delta = Math.round((k - 1) * 100);
      return {
        ...m,
        price: nextPrice,
        trendPct: delta,
        marketTag: delta >= 16 ? "热门" : delta <= -16 ? "承压" : "波动",
      };
    });
  }

  handleCashDebt() {
    const graceDays = Math.max(3, Math.ceil(TOTAL_DAYS * 0.16));
    const rate = this.daysUsed < graceDays
      ? this.experimentConfig.debtGraceRate
      : this.experimentConfig.debtLateRate;
    this.debt = this.debt + Math.floor(this.debt * rate);
    const dailyBankRate = 0.01;
    this.bank = this.bank + Math.floor(this.bank * dailyBankRate);
  }

  doMarketEvents() {
    const popups = [];
    const priceMap = new Map(this.market.map(x => [x.id, x.price]));
    for (let i = 0; i < this.marketEvents.length; i++) {
      const e = this.marketEvents[i];
      if (this.rnd(950) % e.freq !== 0) continue;
      if (!priceMap.has(e.drug) || priceMap.get(e.drug) <= 0) continue;
      this.addLog(e.msg, "market_event", {
        goods_id: e.drug,
        goods: this.goods[e.drug]?.name,
        price_multiplier: e.plus || (e.minus ? 1 / e.minus : 1),
        bonus_count: e.add || 0,
      });
      if (i === this.marketEvents.length - 1) this.debt += 2500;
      const oldPrice = priceMap.get(e.drug);
      let p = oldPrice;
      let priceNote = "";
      if (e.plus > 0) { p *= e.plus; priceNote = `${this.goods[e.drug].name} 价格上涨：${oldPrice} -> ${p} (x${e.plus})`; }
      if (e.minus > 0) { p = Math.floor(p / e.minus); priceNote = `${this.goods[e.drug].name} 价格下跌：${oldPrice} -> ${p} (/${e.minus})`; }
      priceMap.set(e.drug, p);
      if (priceNote) popups.push(`${e.msg}\n${priceNote}`);
      if (e.add > 0) {
        const goods = this.goods[e.drug];
        const cnt = Math.min(e.add, this.coat - this.totalItems);
        if (cnt > 0) {
          this.totalItems += cnt * (goods.weight || 1);
          const idx = this.inv.findIndex(x => x.id === e.drug);
          if (idx >= 0) this.inv[idx].count += cnt;
          else this.inv.unshift({ id: e.drug, name: this.goods[e.drug].name, buyPrice: 0, count: cnt });
          popups.push(`${e.msg}\n额外获得 ${this.goods[e.drug].name} x${cnt}`);
        } else {
          this.addLog("房子太小，赠送物品放不下。", "capacity_blocked", {
            goods_id: e.drug,
            goods: this.goods[e.drug]?.name,
            requested_count: e.add,
          });
          popups.push(`${e.msg}\n房子已满，赠送物品未能接收`);
        }
      }
    }
    this.market = this.goods.filter(g => priceMap.has(g.id) && priceMap.get(g.id) > 0).map(g => ({ id: g.id, name: g.name, price: priceMap.get(g.id), kind: g.kind, weight: g.weight }));
    this.applyLocationSpread();
    this.applyNewsToMarketPrices();
    this.displayDrugs();
    this.lastMarketPopups = popups;
  }


  doHealthEvents() {
    if (!ENABLE_STATUS_SYSTEM) return;
    for (const e of this.healthEvents) {
      if (this.rnd(1000) % e.freq === 0) {
        this.health -= e.hurt;
        this.addLog(`${e.msg} 健康-${e.hurt}`, "health_event", { delta_health: -e.hurt, source: e.msg });
        break;
      }
    }
    if (this.health < 0) {
      this.addLog("你已死亡，游戏结束。", "game_over", { reason: "death", score: this.score });
      this.gameOver = true;
    }
  }

  applyTradeImpact(goodsId, count, side) {
    if (!ENABLE_STATUS_SYSTEM) return;
    const g = this.goods[goodsId];
    if (!g || count <= 0) return;
    if (g.kind === "physical" && count >= 70 && this.rnd(100) < 26) {
      const hurt = 2 + this.rnd(5);
      this.health -= hurt;
      this.addLog(`大批量搬运 ${g.name} 导致过劳。 健康-${hurt}`, "trade_impact", {
        goods_id: goodsId,
        goods: g.name,
        side,
        count,
        delta_health: -hurt,
      });
    }
    if (g.kind === "financial" && count >= 50 && this.rnd(100) < 32) {
      const fameLoss = 2 + this.rnd(6);
      this.fame = Math.max(0, this.fame - fameLoss);
      this.addLog(`你高频倒手 ${g.name} 引发圈内质疑。 名声-${fameLoss}`, "trade_impact", {
        goods_id: goodsId,
        goods: g.name,
        side,
        count,
        delta_fame: -fameLoss,
      });
    } else if (side === "sell" && count >= 60 && this.rnd(100) < 18) {
      const fameGain = 1 + this.rnd(5);
      this.fame = Math.min(120, this.fame + fameGain);
      this.addLog(`你按时交付大单，客户口碑发酵。 名声+${fameGain}`, "trade_impact", {
        goods_id: goodsId,
        goods: g.name,
        side,
        count,
        delta_fame: fameGain,
      });
    }
  }

  applyOneTradeEvent(goodsId, count, turnover) {
    if (!ENABLE_STATUS_SYSTEM) return;
    const rule = this.tradeEvents[goodsId];
    if (!rule || count <= 0 || turnover <= 0) return;
    const triggerRate = 12 + Math.min(14, Math.floor(count / 8));
    if (this.rnd(100) >= triggerRate) return;
    const evt = this.rnd(100) < 56 ? rule.up : rule.down;
    this.fame = Math.max(0, Math.min(120, this.fame + evt.fame));
    this.health = Math.max(0, Math.min(100, this.health + evt.health));
    const fameTag = evt.fame === 0 ? "名声±0" : `名声${evt.fame > 0 ? "+" : ""}${evt.fame}`;
    const healthTag = evt.health === 0 ? "健康±0" : `健康${evt.health > 0 ? "+" : ""}${evt.health}`;
    const title = `交易突发：${this.goods[goodsId].name}`;
    const detail = `${evt.msg}\n（该事件仅影响状态，不直接改变现金）\n${fameTag}，${healthTag}`;
    this.addLog(`${title}：${evt.msg} ${fameTag} ${healthTag}`, "trade_event", {
      goods_id: goodsId,
      goods: this.goods[goodsId].name,
      count,
      turnover,
      delta_fame: evt.fame,
      delta_health: evt.health,
    });
    this.lastMarketPopups.push(`${title}\n${detail}`);
  }

  checkCriticalStates() {
    if (!ENABLE_STATUS_SYSTEM) return;
    if (this.fame < 30 && !this.gameOver) {
      this.addLog("名声跌破30，你在圈子里混不下去，只能打道回府回老家。", "game_over", { reason: "reputation", score: this.score });
      this.gameOver = true;
      return;
    }
    if (this.health < 60 && !this.gameOver && this.timeLeft > 0) {
      const c = this.hospitalCases[this.rnd(this.hospitalCases.length)];
      const cost = c.min + this.rnd(Math.max(1, c.max - c.min + 1));
      const days = Math.min(c.days, this.timeLeft);
      const payByCash = Math.min(this.cash, cost);
      this.cash -= payByCash;
      const shortfall = cost - payByCash;
      if (shortfall > 0) this.debt += Math.floor(shortfall * 1.2);
      this.health = Math.min(100, this.health + 28 + this.rnd(15));
      this.timeLeft = Math.max(0, this.timeLeft - days);
      this.addLog(`${c.msg} 住院 ${days} 天，治疗花费 ${cost}${shortfall > 0 ? `（现金不足，新增欠债 ${Math.floor(shortfall * 1.2)}）` : ""}。`, "hospital", {
        case: c.name,
        cost,
        days,
        debt_added: shortfall > 0 ? Math.floor(shortfall * 1.2) : 0,
      });
      if (this.timeLeft <= 0) {
        this.autoSellAtEnd();
        this.gameOver = true;
        this.addLog(`${TOTAL_DAYS}天结束，总分 ${this.score}`, "game_over", { reason: "completed", score: this.score });
      }
    }
  }

  doStealEvents() {
    for (const e of this.stealEvents) {
      if (this.rnd(1000) % e.freq !== 0) continue;
      const buffered = this.nextDayNumber <= STARTER_BUFFER_DAYS && this.score < 0 && this.cash < 2500;
      const ratio = buffered ? Math.max(4, Math.round(e.ratio * 0.55)) : e.ratio;
      const cap = buffered ? Math.max(500, Math.floor((e.max || 20000) * 0.45)) : (e.max || 20000);
      const floor = buffered ? Math.max(80, Math.floor((e.min || 200) * 0.45)) : (e.min || 200);
      const byRatio = Math.floor((Math.max(0, this.cash) * ratio) / 100);
      const desiredLoss = Math.max(floor, Math.min(cap, byRatio || floor));
      const paid = Math.min(this.cash, desiredLoss);
      this.cash -= paid;
      const shortfall = desiredLoss - paid;
      let debtAdded = 0;
      if (shortfall > 0 && e.debtOnShortfall) {
        debtAdded = Math.floor(shortfall * 1.15);
        this.debt += debtAdded;
      }
      if (e.fame) this.fame = Math.max(0, Math.min(120, this.fame + e.fame));
      const debtNote = debtAdded > 0 ? `，现金不够，新增欠债 ${debtAdded}` : "";
      const fameNote = e.fame ? `，名声${e.fame > 0 ? "+" : ""}${e.fame}` : "";
      const bufferNote = buffered ? "（首周缓冲）" : "";
      const msg = `${e.msg}${bufferNote} 破财 ${paid}${debtNote}${fameNote}`;
      this.addLog(msg, "expense_event", {
        target: "cash",
        ratio,
        original_ratio: e.ratio,
        loss: paid,
        desired_loss: desiredLoss,
        debt_added: debtAdded,
        buffered,
        severity: e.severity || "medium",
        source: e.msg,
      });
      this.lastMarketPopups.push(`意外破财\n${msg}`);
      break;
    }
    if (this.cash < 0) this.cash = 0;
  }

  applyStarterBuffer(reason = "cash_low") {
    if (this.gameOver || this.nextDayNumber > STARTER_BUFFER_DAYS) return false;
    if ((this.starterBufferUsed || 0) >= STARTER_BUFFER_MAX_USES) return false;
    if (this.cash >= STARTER_CASH_FLOOR) return false;
    if (this.inv.length > 0 || this.totalItems > 0) return false;
    if (this.score > -500 && this.cash >= Math.floor(STARTER_CASH_FLOOR * 0.55)) return false;
    const targetCash = STARTER_CASH_FLOOR + 120 + this.rnd(181);
    const gain = Math.max(260, Math.min(860, targetCash - this.cash));
    this.cash += gain;
    this.starterBufferUsed = (this.starterBufferUsed || 0) + 1;
    this.addLog(`接到熟人介绍的跑腿小单，现金+${gain}。`, "starter_buffer", {
      reason,
      gain,
      uses: this.starterBufferUsed,
      max_uses: STARTER_BUFFER_MAX_USES,
      cash_floor: STARTER_CASH_FLOOR,
    });
    return true;
  }

  autoSellAtEnd() {
    this.ensureInventoryMarketQuotes();
    for (const item of this.inv) {
      const preview = this.previewSell(item.id, item.count);
      if (preview.ok) this.cash += preview.total;
    }
    this.inv = [];
    this.totalItems = 0;
  }
  normalizeInventoryLots(item) {
    if (!item) return [];
    if (!Array.isArray(item.lots)) {
      const count = Math.max(0, Math.floor(Number(item.count) || 0));
      if (count <= 0) {
        item.lots = [];
        return item.lots;
      }
      item.lots = [{
        count,
        buyPrice: Math.max(0, Math.floor(Number(item.buyPrice) || 0)),
        buyLoc: Math.max(0, Math.floor(Number(item.buyLoc) || 0)),
      }];
    }
    item.lots = item.lots
      .map((lot) => ({
        count: Math.max(0, Math.floor(Number(lot.count) || 0)),
        buyPrice: Math.max(0, Math.floor(Number(lot.buyPrice) || 0)),
        buyLoc: Math.max(0, Math.floor(Number(lot.buyLoc) || 0)),
      }))
      .filter((lot) => lot.count > 0);
    return item.lots;
  }
  recalcInventoryItem(item) {
    const lots = this.normalizeInventoryLots(item);
    const count = lots.reduce((sum, lot) => sum + lot.count, 0);
    const totalCost = lots.reduce((sum, lot) => sum + lot.count * lot.buyPrice, 0);
    item.count = count;
    item.buyPrice = count > 0 ? Math.floor(totalCost / count) : 0;
    item.buyLoc = lots.length === 1 ? lots[0].buyLoc : 0;
    return item;
  }
  sellUnitPriceForLot(lot, marketPrice) {
    if (lot.buyLoc > 0 && lot.buyLoc === this.currentLoc) return localResalePrice(lot.buyPrice);
    return Math.max(1, Math.floor(Number(marketPrice) || 0));
  }
  previewSell(goodsId, count) {
    const item = this.inv.find((x) => x.id === goodsId);
    if (!item) return { ok: false, reason: "missing_inventory", count: 0, total: 0, pnl: 0, pnlPct: 0 };
    const mk = this.market.find((x) => x.id === goodsId);
    this.recalcInventoryItem(item);
    const lots = this.normalizeInventoryLots(item);
    const n = Math.max(1, Math.min(Math.floor(Number(count) || 1), item.count));
    let remaining = n;
    let total = 0;
    let cost = 0;
    let localCount = 0;
    let marketCount = 0;
    let liquidityCost = 0;
    let marketDepth = 0;
    const goods = this.goods.find((g) => g.id === goodsId);
    const alreadySold = Math.max(0, Math.floor(Number(this.marketSoldToday?.[goodsId]) || 0));
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.count);
      const isLocal = lot.buyLoc > 0 && lot.buyLoc === this.currentLoc;
      if (!isLocal && !mk) return { ok: false, reason: "goods_not_in_market", count: n, total: 0, pnl: 0, pnlPct: 0 };
      const unitPrice = this.sellUnitPriceForLot(lot, mk?.price || 0);
      if (isLocal) {
        total += take * unitPrice;
      } else {
        const quote = marketSaleQuote(goods, unitPrice, take, alreadySold + marketCount);
        total += quote.total;
        liquidityCost += quote.liquidityCost;
        marketDepth = quote.depth;
      }
      cost += take * lot.buyPrice;
      if (isLocal) localCount += take;
      else marketCount += take;
      remaining -= take;
    }
    if (remaining > 0) return { ok: false, reason: "insufficient_inventory", count: n, total: 0, pnl: 0, pnlPct: 0 };
    const avgCost = n > 0 ? Math.floor(cost / n) : 0;
    const avgUnit = n > 0 ? Math.floor(total / n) : 0;
    const pnl = total - cost;
    const pnlPct = cost > 0 ? pnl / cost : 0;
    return {
      ok: true,
      count: n,
      total,
      cost,
      avgCost,
      avgUnit,
      pnl,
      pnlPct,
      localCount,
      marketCount,
      liquidityCost,
      marketDepth,
      marketSoldBefore: alreadySold,
    };
  }
  dailyWarehouseFee() {
    return warehouseDailyFeeForCapacity(this.coat);
  }
  collectWarehouseManagementFee() {
    const fee = this.dailyWarehouseFee();
    if (fee <= 0) return 0;
    const paid = Math.min(this.cash, fee);
    this.cash -= paid;
    const shortfall = fee - paid;
    if (shortfall > 0) this.debt += shortfall;
    this.addLog(`仓库管理费 ${fee}${shortfall > 0 ? `（现金不足，转为欠债 ${shortfall}）` : ""}`, "warehouse_fee", {
      fee,
      paid,
      shortfall,
      capacity: this.coat,
      extra_capacity: Math.max(0, this.coat - INITIAL_CAPACITY),
      fee_model: "tiered",
    });
    return fee;
  }
  buildFinalSettlementMarket() {
    const existing = new Map(this.market.map((m) => [m.id, m.price]));
    this.market = this.goods.map((g) => {
      const fallbackPrice = this.rollGoodsPrice(g);
      const rawPrice = existing.get(g.id) ?? fallbackPrice;
      return {
        id: g.id,
        name: g.name,
        price: Math.max(1, Math.floor(rawPrice)),
        kind: g.kind,
        weight: g.weight,
      };
    });
    this.applyLocationSpread();
    this.displayDrugs();
  }

  oneTravelTurn(locIdx) {
    if (this.gameOver) return;
    if (this.currentLoc === locIdx) return;
    this.currentLoc = locIdx;
    this.marketSoldToday = {};
    this.lastRumorLoc = locIdx;
    this.rollLocationMultipliers();
    this.prepareNewsForDay();
    this.makeDrugPrices(this.timeLeft <= 2 ? 0 : 3);
    this.applyLocationSpread();
    this.handleCashDebt();
    this.collectWarehouseManagementFee();
    this.doMarketEvents();
    this.displayDrugs();
    this.doHealthEvents();
    this.doStealEvents();
    this.applyStarterBuffer("after_travel");
    this.checkCriticalStates();
    if (ENABLE_STATUS_SYSTEM && this.debt > 100000) {
      this.health -= 20;
      this.addLog("欠债压力爆表，身心状态恶化，健康-20。", "debt_pressure", { delta_health: -20, debt: this.debt });
      this.checkCriticalStates();
    }
    if (this.gameOver) return;
    this.timeLeft -= 1;
    this.addLog(this.dayText, "travel", {
      location_id: locIdx,
      location: this.cityLabels[locIdx - 1],
      district: this.locationDistricts[locIdx - 1],
    });
    if (this.timeLeft === 1) this.addLog("最后一天。", "system", { hint: "final_day" });
    if (this.timeLeft <= 0) {
      this.buildFinalSettlementMarket();
      this.autoSellAtEnd();
      this.gameOver = true;
      this.addLog(`${TOTAL_DAYS}天结束，总分 ${this.score}`, "game_over", { reason: "completed", score: this.score });
    }
  }

  buy(goodsId, count) {
    const mk = this.market.find(x => x.id === goodsId);
    if (!mk) return this.addLog("请先选择黑市商品。", "input_error", { action: "buy", reason: "missing_market_goods" });
    const weight = mk.weight ?? 1;
    const max = maxAffordableBuyCount(this.cash, mk.price, Math.floor((this.coat - this.totalItems) / (weight || 1)));
    if (max <= 0) return this.addLog("现金不足或房子已满。", "input_error", { action: "buy", reason: "insufficient_cash_or_capacity", goods_id: goodsId });
    const n = Math.max(1, Math.min(count, max));
    const unitPrice = discountedBuyUnitPrice(mk.price, n);
    const totalCost = n * unitPrice;
    this.cash -= totalCost;
    this.totalItems += n * (weight || 1);
    const i = this.inv.findIndex(x => x.id === goodsId);
    if (i >= 0) {
      const old = this.inv[i];
      this.normalizeInventoryLots(old);
      old.lots.push({ count: n, buyPrice: unitPrice, buyLoc: this.currentLoc });
      this.recalcInventoryItem(old);
    } else {
      this.inv.unshift({
        id: goodsId,
        name: mk.name,
        buyPrice: unitPrice,
        count: n,
        buyLoc: this.currentLoc,
        lots: [{ count: n, buyPrice: unitPrice, buyLoc: this.currentLoc }],
      });
    }
    const discount = Math.max(0, mk.price - unitPrice);
    const discountPct = mk.price > 0 ? Math.round((discount / mk.price) * 100) : 0;
    const suffix = discountPct > 0 ? `（批量议价 -${discountPct}%）` : "";
    this.addLog(`买入 ${mk.name} x${n}${suffix}`, "trade", {
      side: "buy",
      goods_id: goodsId,
      goods: mk.name,
      count: n,
      unit_price: unitPrice,
      total: totalCost,
      discount,
      discount_pct: discountPct,
      discount_total: discount * n,
    });
    this.applyTradeImpact(goodsId, n, "buy");
    this.applyOneTradeEvent(goodsId, n, totalCost);
    this.checkCriticalStates();
    this.lastTrade = { type: "buy", goodsId, goods: mk.name, count: n, unit: unitPrice, total: totalCost };
    this.tradeCount += 1;
  }

  sell(goodsId, count) {
    const invIdx = this.inv.findIndex(x => x.id === goodsId);
    if (invIdx < 0) return this.addLog("请先选择出租屋里的商品。", "input_error", { action: "sell", reason: "missing_inventory_goods" });
    const mk = this.market.find(x => x.id === goodsId);
    const preview = this.previewSell(goodsId, count);
    if (!preview.ok) return this.addLog("当前黑市无人收这个商品。", "input_error", { action: "sell", reason: preview.reason || "goods_not_in_market", goods_id: goodsId });
    const n = preview.count;
    const item = this.inv[invIdx];
    const goods = this.goods.find((g) => g.id === goodsId);
    const goodsName = mk?.name || goods?.name || item.name;
    const weight = mk?.weight ?? goods?.weight ?? 1;
    const lots = this.normalizeInventoryLots(item);
    let remaining = n;
    const nextLots = [];
    for (const lot of lots) {
      if (remaining <= 0) {
        nextLots.push(lot);
        continue;
      }
      const take = Math.min(remaining, lot.count);
      const left = lot.count - take;
      if (left > 0) nextLots.push({ ...lot, count: left });
      remaining -= take;
    }
    item.lots = nextLots;
    this.recalcInventoryItem(item);
    if (item.count <= 0) this.inv.splice(invIdx, 1);
    this.cash += preview.total;
    if (preview.marketCount > 0) {
      this.marketSoldToday = this.marketSoldToday || {};
      this.marketSoldToday[goodsId] = preview.marketSoldBefore + preview.marketCount;
    }
    this.totalItems = Math.max(0, this.totalItems - n * (weight || 1));
    if (goodsId === 4) this.fame = Math.max(0, this.fame - 7);
    if (goodsId === 3) this.fame = Math.max(0, this.fame - 10);
    this.addLog(`卖出 ${goodsName} x${n}`, "trade", {
      side: "sell",
      goods_id: goodsId,
      goods: goodsName,
      count: n,
      unit_price: preview.avgUnit,
      total: preview.total,
      avg_cost: preview.avgCost,
      pnl: preview.pnl,
      local_resale_count: preview.localCount,
      market_resale_count: preview.marketCount,
      local_resale_rate: LOCAL_RESALE_RATE,
      market_depth: preview.marketDepth,
      market_sold_before: preview.marketSoldBefore,
      liquidity_cost: preview.liquidityCost,
    });
    this.applyTradeImpact(goodsId, n, "sell");
    this.applyOneTradeEvent(goodsId, n, preview.total);
    this.checkCriticalStates();
    this.lastTrade = { type: "sell", goodsId, goods: goodsName, count: n, unit: preview.avgUnit, total: preview.total, avgCost: preview.avgCost, pnl: preview.pnl };
    this.tradeCount += 1;
  }

  deposit(n) { const v = Math.max(0, Math.min(n, this.cash)); this.cash -= v; this.bank += v; this.addLog(`存款 ${v}`, "finance", { action: "deposit", amount: v }); }
  withdraw(n) { const v = Math.max(0, Math.min(n, this.bank)); this.bank -= v; this.cash += v; this.addLog(`取款 ${v}`, "finance", { action: "withdraw", amount: v }); }
  repay(n) { if (this.debt <= 0) return this.addLog("你没有欠债。", "input_error", { action: "repay", reason: "no_debt" }); const v = Math.max(0, Math.min(n, this.cash, this.debt)); this.cash -= v; this.debt -= v; this.addLog(`还债 ${v}`, "finance", { action: "repay", amount: v }); }
  cure(points) { if (!ENABLE_STATUS_SYSTEM) return this.addLog("健康系统开发中，医院治疗暂时关闭。", "system", { action: "cure_paused" }); if (this.health >= 100) return this.addLog("你状态很好，不需要治疗。", "input_error", { action: "cure", reason: "full_health" }); const p = Math.max(1, Math.min(points, 100 - this.health)); const cost = p * 3500; if (this.cash < cost) return this.addLog("现金不足，无法治疗。", "input_error", { action: "cure", reason: "insufficient_cash", cost }); this.cash -= cost; this.health += p; this.addLog(`治疗 +${p}，花费 ${cost}`, "health_action", { action: "cure", points: p, cost }); }
  charity(amount) {
    if (!ENABLE_STATUS_SYSTEM) return this.addLog("名声系统开发中，慈善功能暂时关闭。", "system", { action: "charity_paused" });
    const pay = Math.max(500, Math.min(amount, this.cash));
    if (this.cash < 500) return this.addLog("现金不足，无法捐款。", "input_error", { action: "charity", reason: "insufficient_cash" });
    this.cash -= pay;
    const backfire = this.rnd(100) < 18;
    if (backfire) {
      const gain = Math.max(1, Math.floor(pay / 3000));
      this.fame = Math.min(120, this.fame + gain);
      const msg = `慈善捐款被质疑作秀，口碑加成打折。 名声+${gain}`;
      this.addLog(msg, "reputation_action", { action: "charity", amount: pay, delta_fame: gain, outcome: "backfire" });
      this.lastMarketPopups.push(`慈善事件\n${msg}`);
      return;
    }
    const gain = Math.max(2, Math.floor(pay / 1400));
    this.fame = Math.min(120, this.fame + gain);
    const msg = `你匿名做了公益项目，社会口碑提升。 名声+${gain}`;
    this.addLog(msg, "reputation_action", { action: "charity", amount: pay, delta_fame: gain, outcome: "success" });
    this.lastMarketPopups.push(`慈善事件\n${msg}`);
  }
  wellness(amount) {
    if (!ENABLE_STATUS_SYSTEM) return this.addLog("健康系统开发中，修养疗程暂时关闭。", "system", { action: "wellness_paused" });
    const pay = Math.max(1000, Math.min(amount, this.cash));
    if (this.cash < 1000) return this.addLog("现金不足，无法开启修养疗程。", "input_error", { action: "wellness", reason: "insufficient_cash" });
    this.cash -= pay;
    const scam = this.rnd(100) < 24;
    if (scam) {
      const hurt = 1 + this.rnd(5);
      this.health = Math.max(0, this.health - hurt);
      const msg = `你遇到“伪养生”机构，被忽悠消费还耽误恢复。 健康-${hurt}`;
      this.addLog(msg, "health_action", { action: "wellness", amount: pay, delta_health: -hurt, outcome: "scam" });
      this.lastMarketPopups.push(`修养疗程翻车\n${msg}`);
      return;
    }
    const heal = Math.max(3, Math.floor(pay / 2200));
    this.health = Math.min(100, this.health + heal);
    const msg = `你参加了靠谱修养计划，状态回升。 健康+${heal}`;
    this.addLog(msg, "health_action", { action: "wellness", amount: pay, delta_health: heal, outcome: "success" });
    this.lastMarketPopups.push(`修养疗程\n${msg}`);
  }
  rentHouse() {
    if (this.coat >= MAX_CAPACITY) {
      return this.addLog(`仓位已经到达上限 ${MAX_CAPACITY}。`, "input_error", {
        action: "rent_house",
        reason: "max_capacity",
        max_capacity: MAX_CAPACITY,
      });
    }
    return this.rentHouseTo(this.coat + CAPACITY_STEP);
  }
  rentHouseTo(targetCap) {
    if (this.coat >= MAX_CAPACITY) {
      return { ok: false, reason: "max_capacity", plan: buildCapacityPlan(this.coat, this.coat), affordableTarget: this.coat };
    }
    const plan = buildCapacityPlan(this.coat, targetCap);
    if (plan.steps <= 0) {
      return { ok: false, reason: "invalid_target", plan, affordableTarget: this.coat };
    }
    if (this.cash < plan.cost) {
      let affordableTarget = this.coat;
      let walk = this.coat;
      let spent = 0;
      while (walk < MAX_CAPACITY) {
        const next = walk + CAPACITY_STEP;
        const stepCost = capacityStepCost(next);
        if (spent + stepCost > this.cash) break;
        spent += stepCost;
        walk = next;
        affordableTarget = walk;
      }
      const short = plan.cost - this.cash;
      this.addLog(`当前目标升级需 ${plan.cost}，还差 ${short}。`, "input_error", {
        action: "rent_house",
        reason: "insufficient_cash",
        required_cash: plan.cost,
        shortfall: short,
        target_capacity: plan.target,
      });
      return { ok: false, reason: "insufficient_cash", plan, affordableTarget };
    }
    const before = this.coat;
    this.cash -= plan.cost;
    this.coat = plan.target;
    this.addLog(`升级仓位成功，容量提升到 ${this.coat}（花费 ${plan.cost}）`, "capacity_upgrade", {
      before,
      after: this.coat,
      cost: plan.cost,
      max_capacity: MAX_CAPACITY,
      steps: plan.steps,
    });
    return { ok: true, plan, affordableTarget: this.coat };
  }
  downsizeCapacityTo(targetCap) {
    if (this.coat <= INITIAL_CAPACITY) {
      return { ok: false, reason: "min_capacity", before: this.coat, after: this.coat };
    }
    const raw = Number(targetCap);
    const stepped = Number.isFinite(raw) ? Math.floor(raw / CAPACITY_STEP) * CAPACITY_STEP : this.coat - CAPACITY_STEP;
    const inventoryFloor = Math.ceil(Math.max(0, this.totalItems || 0) / CAPACITY_STEP) * CAPACITY_STEP;
    const minCap = Math.max(INITIAL_CAPACITY, inventoryFloor);
    const target = Math.max(minCap, Math.min(this.coat - CAPACITY_STEP, stepped));
    if (target >= this.coat) {
      return {
        ok: false,
        reason: "inventory_too_full",
        before: this.coat,
        after: this.coat,
        min_capacity: minCap,
        total_items: this.totalItems,
      };
    }
    const before = this.coat;
    const beforeFee = this.dailyWarehouseFee();
    this.coat = target;
    const afterFee = this.dailyWarehouseFee();
    this.addLog(`退仓成功，仓位从 ${before} 降到 ${this.coat}（每日管理费 ${beforeFee} -> ${afterFee}）`, "capacity_downsize", {
      before,
      after: this.coat,
      before_fee: beforeFee,
      after_fee: afterFee,
      saved_daily_fee: Math.max(0, beforeFee - afterFee),
      total_items: this.totalItems,
    });
    return { ok: true, before, after: this.coat, beforeFee, afterFee };
  }
  downsizeCapacity() {
    return this.downsizeCapacityTo(this.coat - CAPACITY_STEP);
  }
  wangba() { if (this.wangbaVisits > 3) return this.addLog("共享工位老板提醒：今天别再熬了。", "input_error", { action: "side_job", reason: "daily_limit" }); if (this.cash < 20) return this.addLog("至少要带 20 元才能进共享工位。", "input_error", { action: "side_job", reason: "insufficient_cash" }); this.wangbaVisits += 1; const gain = 3 + this.rnd(16); this.cash += gain; this.addLog(`接到临时小单，赚了 ${gain} 元`, "side_job", { gain, visits: this.wangbaVisits }); }
  buyRumor() { if (this.cash < this.coffeeCost) { this.addLog("现金不足，买不起社交咖啡。", "input_error", { action: "buy_rumor", reason: "insufficient_cash", cost: this.coffeeCost }); return; } this.cash -= this.coffeeCost; const targetLoc = 1 + this.rnd(this.locations.length); const targetGood = this.goods[this.rnd(this.goods.length)]; const row = this.locMultipliers[targetLoc - 1] || {}; let pct; let direction; const earlyDays = Math.ceil(TOTAL_DAYS * 0.18); const hitRate = this.daysUsed < earlyDays ? 90 : 85; if (this.rnd(100) < hitRate) { direction = "up"; pct = 50 + this.rnd(36); const turnsLeft = this.daysUsed < earlyDays ? 4 : 3; this.rumorBuff = { targetLoc, goodId: targetGood.id, direction: "up", turnsLeft }; } else { direction = "down"; pct = -(20 + this.rnd(21)); this.rumorBuff = { targetLoc, goodId: targetGood.id, direction: "down", turnsLeft: 2 }; } const dir = pct >= 0 ? "更贵" : "更便宜"; const msg = `花了30元咖啡打听到：${this.cityLabels[targetLoc - 1]} 的 ${targetGood.name} 价格可能比当前站点${dir} ${Math.abs(pct)}%。（情报有效期 2-3 天）`; this.rumor = { msg, targetLoc, goodId: targetGood.id, pct, direction }; this.addLog("你通过社交拿到一条行情传闻。", "rumor", { cost: this.coffeeCost, target_location_id: targetLoc, target_location: this.cityLabels[targetLoc - 1], goods_id: targetGood.id, goods: targetGood.name, pct, direction }); }
  smartRepay() { if (this.debt <= 0 || this.cash <= 0) return 0; const reserve = 1000; const pay = Math.max(0, Math.min(this.debt, this.cash - reserve)); if (pay <= 0) return 0; this.repay(pay); return pay; }
}

function discountedBuyUnitPrice(price, count) {
  const raw = Math.max(1, Math.floor(Number(price) || 0));
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const rate = n >= 100 ? 0.85 : n >= 60 ? 0.93 : n >= 30 ? 0.97 : 1;
  return Math.max(1, Math.floor(raw * rate));
}

function maxAffordableBuyCount(cash, price, capacityLimit) {
  const cap = Math.max(0, Math.floor(Number(capacityLimit) || 0));
  const money = Math.max(0, Math.floor(Number(cash) || 0));
  let best = 0;
  for (let n = 1; n <= cap; n += 1) {
    if (n * discountedBuyUnitPrice(price, n) <= money) best = n;
  }
  return best;
}

const HZFSJEngine = {
  GameEngine,
  GAME_VERSION_CODE,
  TOTAL_DAYS,
  TARGET_SESSION_MINUTES,
  TARGET_SECONDS_PER_TURN,
  CITY_EXPANSION_ROUTES,
  CAREER_STAGES,
  INITIAL_CAPACITY,
  MAX_CAPACITY,
  CAPACITY_STEP,
  MARKET_BUY_DISPLAY_LIMIT,
  LOCAL_RESALE_RATE,
  MAX_NEWS_PRICE_MULTIPLIER,
  DEFAULT_EXPERIMENT_CONFIG,
  normalizeExperimentConfig,
  localResalePrice,
  marketDepthForGoods,
  marketSaleQuote,
  warehouseDailyFeeForCapacity,
  capacityStepCost,
  normalizeCapacityTarget,
  buildCapacityPlan,
  getCareerStageState,
  discountedBuyUnitPrice,
  maxAffordableBuyCount,
};

if (typeof module !== "undefined" && module.exports) module.exports = HZFSJEngine;
if (typeof globalThis !== "undefined") globalThis.HZFSJEngine = HZFSJEngine;

})();
