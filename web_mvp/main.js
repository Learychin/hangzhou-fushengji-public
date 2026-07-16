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

"use strict";
const {
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
  discountedBuyUnitPrice,
  maxAffordableBuyCount,
  warehouseDailyFeeForCapacity,
  capacityStepCost,
  normalizeCapacityTarget,
  buildCapacityPlan,
  getCareerStageState,
} = globalThis.HZFSJEngine || {};

if (!GameEngine) {
  throw new Error("HZFSJEngine is not loaded before main.js");
}

const ACTIVE_RUN_KEY = "bfsj_active_run_v1";
const PENDING_RUN_KEY = "bfsj_pending_run";
const CLAIM_TOKENS_KEY = "bfsj_claim_tokens";
const LAST_GUEST_NICK_KEY = "bfsj_last_guest_nickname";
const UI_MODE_PREF_KEY = "bfsj_ui_mode_pref";
const LOCAL_RUN_STATS_KEY = "bfsj_local_run_stats";
const EVENT_LOG_LIMIT = 800;
const ENABLE_RANDOM_EVENT_POPUPS = false;
const ENABLE_STATUS_SYSTEM = false;
const HIDE_AUTH_UI = true;
const HIDE_START_AUTH_UI = true;
const game = new GameEngine();
const bootCityConfig = window.BFSJ_PLATFORM?.runtime?.city?.config;
if (bootCityConfig?.gameplay_experiment || bootCityConfig?.experiment_config) {
  game.configureCityContent(bootCityConfig);
  game.newGame();
}
let selectedMarket = null;
let selectedInv = null;
let modalQueue = [];
let runId = 1;
let lastRecordedEndStatsRunId = null;
let runStartedAtMs = Date.now();
let runEndedElapsedSeconds = null;
let runPrimaryActionCount = 0;
let savedRunId = null;
let saveFailedRunId = null;
let saveInFlight = false;
let saveRetryTimer = null;
let saveRetryAttempt = 0;
let lastPresenceTrackAt = 0;
let startPromptShown = false;
let endPromptRunId = null;
let runUploadConsent = null;
let endFeedbackSubmittedRunId = null;
let guestRunClaimToken = null;
let runPublished = false;
let activeCampaign = null;
let pendingCityRuntime = null;
let pendingNewsCampaignContext = null;
let lastCampaignNewsDay = -1;
let lastProductCampaignGoodsId = null;
let lastCelebratedTradeKey = null;
let lastSavedCloudRunId = null;
let capacityPlanTarget = 0;
let isMobileUi = false;
let mobileView = "market";
let mobileTradeMode = "buy";
let mobileTradeQty = 1;
let debtGuideDismissed = false;
let debtGuideShown = false;
let marketRefreshPending = false;
let marketRefreshTimer = null;
let lastDebtGuideTradeKey = null;
let lastBuyHundredTradeKey = null;
let lastTradeFeedbackKey = null;
let lastPrimaryBuyDay = null;
let lastExpansionPromptDay = null;
let profitStreak = 0;
let maxProfitStreak = 0;
let runBestProfit = 0;
let runBestProfitGoods = "";
let lastNetWorthMilestone = 0;
let lastGoalMomentKey = "";
let currentRunBounty = null;
let lastBountyCompletedKey = "";
let expandGuideDismissed = false;
let forcedUiMode = null;
let mobileMenuOpen = false;
let activeRunRestored = false;
let recommendedActionLockUntilMs = 0;
let lastMapRenderKey = "";
let lastPlaceDockRenderKey = "";
let careerStageAnnouncement = "";
const SAVE_RETRY_DELAYS_MS = [2500, 5000, 9000, 15000];
const NET_WORTH_MILESTONES = [
  100000,
  300000,
  500000,
  1000000,
  2000000,
  5000000,
  10000000,
  30000000,
  50000000,
  100000000,
];
const GRADE_TARGETS = [100000, 500000, 1000000, 3000000, 10000000, 50000000, 100000000];
const cloud = {
  client: null,
  user: null,
  profile: null,
  ready: false,
  presenceChannel: null,
  onlinePlayers: [],
};
const ACTIVE_RUN_GAME_FIELDS = [
  "experimentConfig",
  "experimentKey",
  "goods",
  "marketEvents",
  "tradeEvents",
  "locations",
  "locationDistricts",
  "districtLabels",
  "newsPool",
  "cityContentKey",
  "cash",
  "debt",
  "bank",
  "health",
  "fame",
  "coat",
  "totalItems",
  "timeLeft",
  "currentLoc",
  "wangbaVisits",
  "market",
  "inv",
  "logs",
  "eventLog",
  "lastMarketPopups",
  "rumor",
  "lastRumorLoc",
  "rumorBuff",
  "activeNews",
  "todayNews",
  "lastNewsSpawnDay",
  "lastNewsPopups",
  "tradeCount",
  "gameOver",
  "lastTrade",
  "locMultipliers",
  "starterBufferUsed",
  "careerStageIndex",
];

function clonePlain(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return null;
  }
}
function nullableNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
function activeRunSnapshot() {
  if (game.gameOver) return null;
  const gameState = {};
  for (const field of ACTIVE_RUN_GAME_FIELDS) gameState[field] = clonePlain(game[field]);
  return {
    version: GAME_VERSION_CODE,
    savedAt: Date.now(),
    game: gameState,
    ui: {
      selectedMarket,
      selectedInv,
      runId,
      elapsedSeconds: getRunElapsedSeconds(),
      runPrimaryActionCount,
      lastCelebratedTradeKey,
      lastDebtGuideTradeKey,
      lastBuyHundredTradeKey,
      lastTradeFeedbackKey,
      lastPrimaryBuyDay,
      profitStreak,
      maxProfitStreak,
      runBestProfit,
      runBestProfitGoods,
      lastNetWorthMilestone,
      lastGoalMomentKey,
      currentRunBounty,
      lastBountyCompletedKey,
      debtGuideDismissed,
      debtGuideShown,
      startPromptShown,
      mobileView,
      platform: window.BFSJ_PLATFORM?.runMeta?.() || null,
    },
  };
}
function writeActiveRunSnapshot() {
  try {
    if (game.gameOver) {
      window.localStorage.removeItem(ACTIVE_RUN_KEY);
      return;
    }
    const snapshot = activeRunSnapshot();
    if (snapshot) window.localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(snapshot));
  } catch (_error) {}
}
function clearActiveRunSnapshot() {
  try {
    window.localStorage.removeItem(ACTIVE_RUN_KEY);
  } catch (_error) {}
}
function restoreActiveRunSnapshot() {
  try {
    const raw = window.localStorage.getItem(ACTIVE_RUN_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const state = parsed?.game || {};
    if (parsed.version !== GAME_VERSION_CODE || state.gameOver || Number(state.timeLeft) <= 0) {
      clearActiveRunSnapshot();
      return false;
    }
    for (const field of ACTIVE_RUN_GAME_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(state, field)) game[field] = clonePlain(state[field]);
    }
    const ui = parsed.ui || {};
    selectedMarket = nullableNumber(ui.selectedMarket);
    selectedInv = nullableNumber(ui.selectedInv);
    runId = Number.isFinite(Number(ui.runId)) ? Math.max(1, Number(ui.runId)) : runId;
    runStartedAtMs = Date.now() - Math.max(0, Number(ui.elapsedSeconds || 0)) * 1000;
    runEndedElapsedSeconds = null;
    runPrimaryActionCount = Math.max(0, Number(ui.runPrimaryActionCount || 0));
    lastCelebratedTradeKey = ui.lastCelebratedTradeKey || null;
    lastDebtGuideTradeKey = ui.lastDebtGuideTradeKey || null;
    lastBuyHundredTradeKey = ui.lastBuyHundredTradeKey || null;
    lastTradeFeedbackKey = ui.lastTradeFeedbackKey || null;
    lastPrimaryBuyDay = nullableNumber(ui.lastPrimaryBuyDay);
    profitStreak = Math.max(0, Number(ui.profitStreak || 0));
    maxProfitStreak = Math.max(0, Number(ui.maxProfitStreak || 0));
    runBestProfit = Math.max(0, Number(ui.runBestProfit || 0));
    runBestProfitGoods = ui.runBestProfitGoods || "";
    lastNetWorthMilestone = Math.max(0, Number(ui.lastNetWorthMilestone || 0));
    lastGoalMomentKey = ui.lastGoalMomentKey || "";
    currentRunBounty = ui.currentRunBounty || null;
    lastBountyCompletedKey = ui.lastBountyCompletedKey || "";
    debtGuideDismissed = Boolean(ui.debtGuideDismissed);
    debtGuideShown = Boolean(ui.debtGuideShown);
    startPromptShown = true;
    endPromptRunId = null;
    runUploadConsent = null;
    savedRunId = null;
    saveFailedRunId = null;
    mobileView = ["market", "inventory", "status"].includes(ui.mobileView)
      ? ui.mobileView
      : "market";
    if (ui.platform) {
      window.BFSJ_PLATFORM?.beginRun?.({
        clientRunId: ui.platform.client_run_id,
        shareCode: ui.platform.share_code,
        experimentKey: game.experimentKey || game.experimentConfig?.experimentId || ui.platform.experiment_key,
      });
    }
    guestRunClaimToken = null;
    runPublished = false;
    activeRunRestored = game.daysUsed > 0 || game.tradeCount > 0 || game.cash !== 3000 || game.debt !== 6000;
    if (!Number.isFinite(Number(game.careerStageIndex))) {
      game.careerStageIndex = getCareerStageState(game.score, 0).earnedIndex;
    }
    return true;
  } catch (_error) {
    clearActiveRunSnapshot();
    return false;
  }
}

function q(id) { return document.getElementById(id); }
function nval(id, d = 0) { const v = Number(q(id).value); return Number.isFinite(v) ? v : d; }

function applyCityPresentation(city) {
  const config = city?.config || {};
  const cityKey = String(city?.city_key || "hangzhou").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "hangzhou";
  const sceneKey = String(config.scene_key || cityKey).replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || cityKey;
  document.body.dataset.city = cityKey;
  document.body.dataset.scene = sceneKey;
  const shortTitle = String(config.short_title || "").trim().slice(0, 24);
  const fullTitle = String(config.full_title || city?.display_name || "").trim().slice(0, 40);
  if (shortTitle) {
    const heading = document.querySelector(".topbar-brand h1");
    if (heading) heading.textContent = shortTitle;
  }
  const startTitle = String(config.start_title || "").trim().slice(0, 28);
  if (startTitle && q("startTitle")) q("startTitle").textContent = startTitle;
  if (fullTitle) document.title = fullTitle;
}

function syncResolvedCityContent() {
  const city = window.BFSJ_PLATFORM?.runtime?.city;
  if (!city) return false;
  pendingCityRuntime = city;
  applyCityPresentation(city);
  if (activeRunRestored || game.daysUsed > 0 || game.tradeCount > 0) return false;
  const changed = game.configureCityContent(city.config || {});
  pendingCityRuntime = null;
  if (!changed) return false;
  game.newGame();
  selectedMarket = null;
  selectedInv = null;
  currentRunBounty = buildRunBounty();
  lastMapRenderKey = "";
  lastPlaceDockRenderKey = "";
  return true;
}

function applyPendingCityContentForNewRun() {
  const city = pendingCityRuntime || window.BFSJ_PLATFORM?.runtime?.city;
  if (!city) return false;
  applyCityPresentation(city);
  pendingCityRuntime = null;
  return game.configureCityContent(city.config || {});
}

function cny(n) { return `¥${Number(n).toLocaleString("zh-CN")}`; }
function formatDuration(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function getRunElapsedSeconds() {
  if (runEndedElapsedSeconds != null) return runEndedElapsedSeconds;
  return Math.max(0, Math.floor((Date.now() - runStartedAtMs) / 1000));
}
function paceStatusText(elapsedSeconds = getRunElapsedSeconds()) {
  if (game.gameOver) return `本局用时 ${formatDuration(elapsedSeconds)}`;
  const targetElapsed = Math.max(0, game.daysUsed * TARGET_SECONDS_PER_TURN);
  if (game.daysUsed <= 0) return `已用 ${formatDuration(elapsedSeconds)} · 约 ${TARGET_SECONDS_PER_TURN}秒/回合`;
  const drift = elapsedSeconds - targetElapsed;
  if (drift > 45) return `已用 ${formatDuration(elapsedSeconds)} · 慢 ${formatDuration(drift)}`;
  if (drift < -30) return `已用 ${formatDuration(elapsedSeconds)} · 快 ${formatDuration(Math.abs(drift))}`;
  return `已用 ${formatDuration(elapsedSeconds)} · 节奏正好`;
}
function isFinalSprintActive() {
  return !game.gameOver && game.timeLeft > 0 && game.timeLeft <= 5;
}
function decorateFinalSprintGoal(goal) {
  if (!isFinalSprintActive() || goal.type === "end") return goal;
  const left = Math.max(1, Number(game.timeLeft) || 1);
  return {
    ...goal,
    sprint: true,
    full: `最后 ${left} 天 · ${goal.full}`,
    short: `最后${left}天 · ${goal.short}`,
  };
}
function activeRunGoalState(net, stats = readLocalRunStats()) {
  if (game.gameOver) {
    const grade = runGrade(game.score).label;
    return { type: "end", full: `本局评级 ${grade}`, short: `本局 ${grade}` };
  }
  const value = Number(net) || 0;
  if (value < 0) {
    const gap = Math.abs(value);
    return decorateFinalSprintGoal({ type: "negative", gap, full: `先回正 · 差 ${cny(gap)}`, short: `回正差 ¥${cnyCompact(gap)}` });
  }

  const target = nextGradeTarget(value);
  const gradeGap = Math.max(0, target - value);
  const bestScore = Number(stats.bestScore || 0);
  const bestGap = Number.isFinite(bestScore) && bestScore > value ? Math.max(1, bestScore + 1 - value) : Infinity;
  const nearBest = bestGap < Infinity && bestGap <= Math.max(60000, Math.min(gradeGap || bestGap, value * 0.35));

  if (nearBest) {
    return decorateFinalSprintGoal({ type: "record", target: bestScore + 1, gap: bestGap, full: `破纪录 · 差 ${cny(bestGap)}`, short: `破纪录差 ¥${cnyCompact(bestGap)}` });
  }
  if (gradeGap <= 0) return decorateFinalSprintGoal({ type: "cleared", target, full: "已冲过本档 · 继续拉开", short: "已冲档" });
  if (gradeGap <= Math.max(30000, target * 0.12)) {
    return decorateFinalSprintGoal({ type: "near-grade", target, gap: gradeGap, full: `快升档 · 差 ${cny(gradeGap)}`, short: `升档差 ¥${cnyCompact(gradeGap)}` });
  }
  return decorateFinalSprintGoal({ type: "grade", target, gap: gradeGap, full: `下一档 ${cny(target)} · 差 ${cny(gradeGap)}`, short: `下档差 ¥${cnyCompact(gradeGap)}` });
}
function gradeProgressPercent(net) {
  const value = Math.max(0, Number(net) || 0);
  const target = nextGradeTarget(value);
  let floor = 0;
  for (const mark of GRADE_TARGETS) {
    if (mark < target && value >= mark) floor = mark;
  }
  const span = Math.max(1, target - floor);
  return Math.max(0, Math.min(100, Math.round(((value - floor) / span) * 100)));
}
function inRunGoalText(net) {
  return activeRunGoalState(net).full;
}
function nextGradeGapHint(net) {
  const value = Number(net) || 0;
  if (value < 0) return `回正还差 ${cny(Math.abs(value))}`;
  const target = nextGradeTarget(value);
  const gap = Math.max(0, target - value);
  return gap > 0 ? `距下一档 ${cny(gap)}` : "已冲过本档";
}
function streakStatusText() {
  if (game.gameOver) {
    const best = runBestProfit > 0 ? cnyCompact(runBestProfit) : "0";
    return `最高连赚 x${maxProfitStreak} · 单笔 ${best}`;
  }
  if (profitStreak >= 2) return `连赚 x${profitStreak} · 最佳 ${cnyCompact(runBestProfit)}`;
  if (profitStreak === 1) return `刚赚一笔 · 最佳 ${cnyCompact(runBestProfit)}`;
  if (runBestProfit > 0) return `最佳单笔 ${cnyCompact(runBestProfit)}`;
  return "等第一笔盈利";
}
function pulseThumbActionDock() {
  const dock = q("thumbActionDock");
  if (!dock || !document.body.classList.contains("mobile-ui")) return;
  dock.classList.remove("thumb-pop");
  void dock.offsetWidth;
  dock.classList.add("thumb-pop");
}
function softTap(pattern = 8) {
  if (navigator.vibrate) navigator.vibrate(pattern);
  pulseThumbActionDock();
}
function tryStartRecommendedAction(lockMs = 260) {
  const now = Date.now();
  if (now < recommendedActionLockUntilMs) return false;
  recommendedActionLockUntilMs = now + lockMs;
  const dock = q("thumbActionDock");
  dock?.classList.add("action-locked");
  window.setTimeout(() => {
    if (Date.now() >= recommendedActionLockUntilMs) q("thumbActionDock")?.classList.remove("action-locked");
  }, lockMs + 20);
  return true;
}
function runRecommendedAction(action) {
  if (!tryStartRecommendedAction()) return false;
  runPrimaryActionCount += 1;
  return action();
}
function cnyCompact(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(2)}千万`;
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(2)}百万`;
  return `${sign}${abs.toLocaleString("zh-CN")}`;
}
function cityExpansionState(score = game.score) {
  const value = Number(score) || 0;
  const unlocked = CITY_EXPANSION_ROUTES.filter((route) => value >= route.score);
  const next = CITY_EXPANSION_ROUTES.find((route) => value < route.score) || null;
  const latest = unlocked[unlocked.length - 1] || null;
  return {
    unlocked,
    latest,
    next,
    canLeave: Boolean(latest),
    gap: next ? Math.max(0, next.score - value) : 0,
  };
}
function cityExpansionCardHtml(score = game.score) {
  const state = cityExpansionState(score);
  if (state.canLeave) {
    const cityList = state.unlocked.map((route) => route.city).join(" / ");
    return `
<div class="end-city-card unlocked">
  <span>城市发展</span>
  <strong>已解锁 ${escapeHtml(state.latest.label)}</strong>
  <small>可去 ${escapeHtml(cityList)} 发展。${escapeHtml(state.latest.hook)}</small>
</div>`;
  }
  const first = state.next || CITY_EXPANSION_ROUTES[0];
  return `
<div class="end-city-card">
  <span>城市发展</span>
  <strong>${escapeHtml(first.label)} 还差 ${cny(state.gap)}</strong>
  <small>攒够 ${cny(first.score)} 后，可以离开杭州去别的城市发展。</small>
</div>`;
}
function currentGameTitle() {
  const city = window.BFSJ_PLATFORM?.runtime?.city;
  return String(city?.config?.full_title || city?.display_name || "杭州浮生记").trim().slice(0, 40) || "杭州浮生记";
}
function buildShareText(stats = readLocalRunStats()) {
  const grade = runGrade(game.score);
  const city = cityExpansionState(game.score);
  const bestPart = stats?.isNewBest ? "本机新纪录" : `本机最佳 ${cny(stats?.bestScore || game.score)}`;
  const cityPart = city.canLeave
    ? `已解锁 ${city.latest.label}`
    : `距离 ${city.next?.label || "下一城"} 还差 ${cny(city.gap)}`;
  const link = shareRunUrl();
  return [
    `我在《${currentGameTitle()}》跑完一局：${grade.label}`,
    `总分 ${cny(game.score)}，${bestPart}`,
    `用时 ${formatDuration(runEndedElapsedSeconds ?? getRunElapsedSeconds())}，连赚最高 x${maxProfitStreak}，最大单笔 ${runBestProfit > 0 ? cnyCompact(runBestProfit) : "暂无"}`,
    cityPart,
    `${TARGET_SESSION_MINUTES} 分钟 ${TOTAL_DAYS} 天，你来超过我：${link}`,
  ].join("\n");
}
function shareRunUrl() {
  const url = new URL(window.location.pathname, window.location.origin);
  const shareCode = window.BFSJ_PLATFORM?.runMeta?.().share_code;
  if (runPublished && shareCode) url.searchParams.set("r", shareCode);
  return url.href;
}
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("copy command failed");
  return true;
}
async function shareCurrentRun() {
  const text = buildShareText();
  const title = `${currentGameTitle()}战报`;
  const url = shareRunUrl();
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      showSaveBanner("战报已唤起系统分享。", 2400);
      return;
    }
    await copyTextToClipboard(text);
    showSaveBanner("战报已复制，打开微信就能粘贴。", 2800);
  } catch (_error) {
    try {
      await copyTextToClipboard(text);
      showSaveBanner("分享未完成，已改为复制战报。", 2800);
    } catch (_copyError) {
      showSaveBanner("复制失败，请长按结算内容手动复制。", 3200, "error");
    }
  }
}
async function copyShareText() {
  try {
    await copyTextToClipboard(buildShareText());
    showSaveBanner("微信战报已复制。", 2400);
  } catch (_error) {
    showSaveBanner("复制失败，请稍后再试。", 2600, "error");
  }
}
function projectedSellReason(nextNet) {
  const value = Number(nextNet) || 0;
  if (value < 0) return `卖完回正差 ¥${cnyCompact(Math.abs(value))}`;
  return `卖完约 ¥${cnyCompact(value)}`;
}
function loadUiModePref() {
  forcedUiMode = "mobile";
  window.localStorage.removeItem(UI_MODE_PREF_KEY);
}
function saveUiModePref(mode) {
  forcedUiMode = "mobile";
  window.localStorage.removeItem(UI_MODE_PREF_KEY);
}
function updateUiModeToggleButton() {
  const btn = q("uiModeToggleBtn");
  if (!btn) return;
  btn.hidden = true;
  btn.setAttribute("aria-hidden", "true");
}
function applyAuthUiVisibility() {
  const body = document.body;
  if (!body) return;
  body.classList.toggle("hide-auth-ui", HIDE_AUTH_UI);
  body.classList.toggle("hide-start-auth-ui", HIDE_START_AUTH_UI);
  if (!HIDE_AUTH_UI) return;
  q("accountModal")?.classList.add("hidden");
}
function nextCapacityStepCost() {
  if (game.coat >= MAX_CAPACITY) return Infinity;
  return capacityStepCost(game.coat + CAPACITY_STEP);
}
function canExpandNow() {
  return game.coat < MAX_CAPACITY && game.cash >= nextCapacityStepCost();
}
function expansionOpportunity() {
  if (game.gameOver || !canExpandNow()) return null;
  if (lastExpansionPromptDay === game.daysUsed) return null;
  const capacity = Math.max(1, game.coat);
  const items = Math.max(0, game.totalItems || 0);
  const nearlyFull = items >= capacity || items >= Math.max(0, capacity - 6) || items / capacity >= 0.88;
  if (!nearlyFull) return null;
  const recommended = recommendedCapacityExpansion();
  if (!recommended.gain) return null;
  return { ...recommended, items, capacity };
}
function debtRepayOpportunity() {
  if (game.gameOver || game.debt <= 0) return null;
  const reserve = 1000;
  const amount = Math.max(0, Math.min(game.debt, game.cash - reserve));
  if (amount <= 0) return null;
  const debtPressure = game.debt >= 12000 || game.daysUsed >= Math.ceil(TOTAL_DAYS * 0.45);
  const canClearDebt = amount >= game.debt;
  const canClearMostDebt = amount >= Math.min(game.debt, Math.max(8000, Math.floor(game.debt * 0.75)));
  const latePressure = game.daysUsed >= Math.ceil(TOTAL_DAYS * 0.68);
  const meaningfulPartial = amount >= Math.min(game.debt, Math.max(3000, Math.floor(game.debt * 0.35)));
  if (!canClearDebt && !(debtPressure && canClearMostDebt) && !(latePressure && meaningfulPartial)) return null;
  const partial = !canClearDebt;
  return { amount, partial };
}
function setDebtGuideGlow(on) {
  ["miniDebtCard", "debtStatCard"].forEach((id) => {
    const el = q(id);
    if (!el) return;
    el.classList.toggle("debt-guide-glow", Boolean(on));
    el.classList.toggle("debt-guide-ready", Boolean(on));
  });
}
function clearDebtGuide(opts = {}) {
  const { openRepay = false } = opts;
  debtGuideDismissed = true;
  setDebtGuideGlow(false);
  hideDebtGuideTip();
  if (openRepay) openRepayModal();
}
function showDebtGuideTip() {
  const tip = q("debtGuideTip");
  if (!tip) return;
  tip.classList.remove("hidden");
}
function hideDebtGuideTip() {
  const tip = q("debtGuideTip");
  if (!tip) return;
  tip.classList.add("hidden");
}
function showExpandGuideTip() {
  if (expandGuideDismissed) return;
  const tip = q("expandGuideTip");
  if (!tip) return;
  tip.classList.remove("hidden");
}
function hideExpandGuideTip() {
  const tip = q("expandGuideTip");
  if (!tip) return;
  tip.classList.add("hidden");
}
function updateExpandGuideTip() {
  if (canExpandNow() && !expandGuideDismissed) showExpandGuideTip();
  else hideExpandGuideTip();
}
function maybeShowDebtGuideByProfit(tradeKey, pnl) {
  if (game.debt <= 0) {
    setDebtGuideGlow(false);
    hideDebtGuideTip();
    return;
  }
  if (!(pnl > 0)) return;
  if (lastDebtGuideTradeKey === tradeKey) return;
  lastDebtGuideTradeKey = tradeKey;
  debtGuideDismissed = false;
  debtGuideShown = true;
  setDebtGuideGlow(true);
  showDebtGuideTip();
}
function openRepayModal() {
  const modal = q("repayModal");
  const input = q("repayModalAmount");
  const info = q("repayModalInfo");
  if (!modal || !input || !info) return;
  const maxPay = Math.max(0, Math.min(game.cash, game.debt));
  info.textContent = `可用 ${cny(game.cash)} ｜ 欠债 ${cny(game.debt)}。`;
  input.max = String(maxPay);
  input.value = String(maxPay > 0 ? maxPay : 0);
  modal.classList.remove("hidden");
  input.focus();
  input.select();
}
function closeRepayModal() {
  const modal = q("repayModal");
  if (!modal) return;
  modal.classList.add("hidden");
}
function repayFromModal(amount, opts = {}) {
  const { all = false } = opts;
  const pay = all ? Math.max(0, Math.min(game.cash, game.debt)) : Math.max(0, Math.min(amount, game.cash, game.debt));
  if (pay <= 0) {
    game.addLog("当前现金不足以触发还债。", "input_error", { action: "repay_modal", reason: "insufficient_cash" });
    render();
    return;
  }
  game.repay(pay);
  clearDebtGuide();
  closeRepayModal();
  showSaveBanner(`已还债 ${cny(pay)}。`, 2200);
  render();
}
function locationRenderKey() {
  return [
    game.currentLoc,
    game.cityLabels.join("|"),
    game.locationDistricts.join("|"),
    Object.keys(game.districtLabels).join("|"),
  ].join("::");
}
function setPlacePickerOpen(open) {
  document.body?.classList.toggle("place-picker-open", Boolean(open));
  q("placePickerBtn")?.setAttribute("aria-expanded", open ? "true" : "false");
}
function renderPlaceDockGrid() {
  const grid = q("placeDockGrid");
  if (!grid) return;
  const currentPlace = game.cityLabels[game.currentLoc - 1] || "选择地点";
  if (q("placePickerLabel")) q("placePickerLabel").textContent = currentPlace;
  const key = locationRenderKey();
  if (key === lastPlaceDockRenderKey && grid.childElementCount > 0) return;
  lastPlaceDockRenderKey = key;
  grid.innerHTML = "";
  const districtOrder = ["xihu", "gongshu", "shangcheng", "binjiang", "yuhang", "xiaoshan"];
  const places = game.cityLabels
    .map((name, idx) => {
      const district = game.locationDistricts[idx] || "shangcheng";
      const order = districtOrder.indexOf(district);
      return { name, loc: idx + 1, district, order: order < 0 ? 999 : order };
    })
    .sort((a, b) => a.order - b.order || a.loc - b.loc);
  places.forEach(({ name, loc, district }) => {
    const b = document.createElement("button");
    b.className = `place-dock-item district-${district}`;
    if (game.currentLoc === loc) b.classList.add("active");
    b.innerHTML = `<span>${escapeHtml(name)}</span>`;
    b.addEventListener("click", () => { travelToLocation(loc); });
    grid.appendChild(b);
  });
}
function suggestedTravelLocation() {
  if (game.gameOver) return null;
  if (game.rumorBuff?.targetLoc && game.rumorBuff.targetLoc !== game.currentLoc) return game.rumorBuff.targetLoc;
  const total = game.cityLabels.length;
  const start = game.currentLoc > 0 ? game.currentLoc : 0;
  for (let i = 1; i <= total; i++) {
    const loc = ((start + i - 1) % total) + 1;
    if (loc !== game.currentLoc) return loc;
  }
  return null;
}
function travelToLocation(locIdx) {
  const prevLoc = game.currentLoc;
  setPlacePickerOpen(false);
  softTap();
  game.oneTravelTurn(locIdx);
  if (game.currentLoc !== prevLoc) {
    selectedMarket = game.market[0]?.id ?? null;
    selectedInv = null;
    setMobileTradeMode("buy", false);
    marketRefreshPending = true;
  }
  render();
  if (game.currentLoc !== prevLoc) maybeDeliverLocationCampaign(game.currentLoc);
}
function detectMobileUi() {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const narrow = window.matchMedia?.("(max-width: 980px)").matches;
  const ua = navigator.userAgent || "";
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|Windows Phone/i.test(ua);
  return Boolean(coarse || narrow || mobileUa);
}
function applyMobileView(nextView = "market") {
  const body = document.body;
  if (!body || !body.classList.contains("mobile-ui")) return;
  const views = ["market", "status"];
  const normalizedView = ["trade", "inventory"].includes(nextView) ? "market" : nextView;
  const previousView = mobileView;
  mobileView = views.includes(normalizedView) ? normalizedView : "market";
  if (mobileView !== previousView || mobileView === "status") clearManualTradeSelection();
  body.classList.remove("mobile-view-trade", "mobile-view-market", "mobile-view-inventory", "mobile-view-status");
  body.classList.add(`mobile-view-${mobileView}`);
}
function applyDeviceUiMode() {
  const body = document.body;
  if (!body) return;
  const nextMobile = true;
  if (isMobileUi === nextMobile && (body.classList.contains("mobile-ui") || body.classList.contains("desktop-ui"))) {
    if (nextMobile) applyMobileView(mobileView);
    updateUiModeToggleButton();
    return;
  }
  isMobileUi = nextMobile;
  body.classList.toggle("mobile-ui", isMobileUi);
  body.classList.toggle("desktop-ui", !isMobileUi);
  const strip = q("mobileStatusStrip");
  if (strip) strip.classList.toggle("hidden", !isMobileUi);
  applyMobileView(mobileView);
  updateUiModeToggleButton();
}
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function cloudConfigured() {
  const cfg = window.BFSJ_CONFIG || {};
  return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
}
function supabaseSdkReady() {
  return Boolean(window.supabase?.createClient);
}
function loadSupabaseSdk() {
  if (supabaseSdkReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-supabase-sdk]");
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.async = true;
    script.dataset.supabaseSdk = "true";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("Supabase SDK 加载失败")), { once: true });
    document.head.appendChild(script);
  });
}
function setAuthMessage(msg) {
  const el = q("authMessage");
  if (el) el.textContent = msg || "";
}
function setCloudStatus(msg) {
  const el = q("cloudStatusText");
  if (el) el.textContent = msg;
}
function showSaveBanner(msg, durationMs = 5000, tone = "success") {
  const el = q("saveSuccessBanner");
  if (!el) return;
  el.classList.remove("error");
  if (tone === "error") el.classList.add("error");
  el.textContent = msg;
  el.classList.remove("hidden");
  if (showSaveBanner._timer) clearTimeout(showSaveBanner._timer);
  showSaveBanner._timer = setTimeout(() => {
    el.classList.add("hidden");
  }, durationMs);
}
function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (window.location.protocol === "file:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
function clearSaveRetry() {
  if (saveRetryTimer) {
    clearTimeout(saveRetryTimer);
    saveRetryTimer = null;
  }
  saveRetryAttempt = 0;
}
function scheduleSaveRetry(task, label = "成绩写入") {
  if (saveRetryAttempt >= SAVE_RETRY_DELAYS_MS.length) {
    showSaveBanner(`${label}多次重试仍失败，请稍后再试。`, 7000, "error");
    return;
  }
  const delay = SAVE_RETRY_DELAYS_MS[saveRetryAttempt];
  saveRetryAttempt += 1;
  if (saveRetryTimer) clearTimeout(saveRetryTimer);
  showSaveBanner(`${label}波动，${Math.ceil(delay / 1000)}秒后自动重试（${saveRetryAttempt}/${SAVE_RETRY_DELAYS_MS.length}）`, 4500, "error");
  saveRetryTimer = setTimeout(() => {
    saveRetryTimer = null;
    task();
  }, delay);
}
async function checkRunInTop20(runId) {
  if (!cloud.client) return false;
  const { data, error } = await cloud.client
    .from("leaderboard")
    .select("run_id")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(20);
  if (error || !data) return false;
  return data.some((row) => String(row.run_id) === String(runId));
}
function renderTopAvatar() {
  const slot = q("accountAvatar");
  if (!slot) return;
  const name = cloud.profile?.display_name || cloud.user?.user_metadata?.name || cloud.user?.email || "账号";
  const avatarUrl = cloud.profile?.avatar_url || cloud.user?.user_metadata?.avatar_url || cloud.user?.user_metadata?.picture || "";
  if (avatarUrl) {
    slot.classList.remove("avatar-fallback");
    slot.innerHTML = `<img src=\"${escapeHtml(avatarUrl)}\" alt=\"${escapeHtml(name)}\" referrerpolicy=\"no-referrer\" />`;
  } else {
    slot.classList.add("avatar-fallback");
    const initial = (name || "人").trim().slice(0, 1) || "人";
    slot.textContent = initial;
  }
}
function authRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}
function cleanAuthParamsFromUrl() {
  if (!window.location.search && !window.location.hash) return;
  window.history.replaceState({}, document.title, authRedirectUrl());
}
function authUrlParam(name) {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return search.get(name) || hash.get(name);
}
async function handleOAuthRedirect() {
  const error = authUrlParam("error_description") || authUrlParam("error");
  if (error) {
    setAuthMessage(`登录失败：${error}`);
    game.addLog(`Google 登录失败：${error}`, "auth", { provider: "google", status: "error", error });
    cleanAuthParamsFromUrl();
    return;
  }
  const code = authUrlParam("code");
  if (!code || !cloud.client) return;
  const { data, error: exchangeError } = await cloud.client.auth.exchangeCodeForSession(code);
  cleanAuthParamsFromUrl();
  if (exchangeError) {
    setAuthMessage(`登录回调处理失败：${exchangeError.message}`);
    game.addLog(`登录回调处理失败：${exchangeError.message}`, "auth", { provider: "google", status: "exchange_error", error: exchangeError.message });
    return;
  }
  cloud.user = data.session?.user || cloud.user;
  setAuthMessage("Google 登录成功。");
  game.addLog("Google 登录成功，游戏结束后会自动保存成绩。", "auth", { provider: "google", status: "success" });
  await uploadPendingRunIfReady();
}
function summarizeEvents(events) {
  const summary = {};
  for (const event of events || []) {
    const type = event.event_type || "log";
    summary[type] = (summary[type] || 0) + 1;
  }
  return summary;
}
function normalizeEventRows(events, userId, runCloudId) {
  return (events || []).slice(-EVENT_LOG_LIMIT).map((event, index) => ({
    run_id: runCloudId,
    user_id: userId,
    event_index: index,
    event_type: event.event_type || "log",
    day: event.day || 0,
    message: event.message || "",
    state: event.state || {},
    payload: event.payload || {},
    created_at: event.created_at || new Date().toISOString(),
  }));
}
function buildPlaytestMetrics() {
  const events = Array.isArray(game.eventLog) ? game.eventLog : [];
  const netWorth = (state = {}) => Number(state.cash || 0) + Number(state.bank || 0) - Number(state.debt || 0);
  const eventCounts = summarizeEvents(events);
  const firstProfitableSale = events.find((event) => (
    event?.event_type === "trade"
    && event?.payload?.side === "sell"
    && Number(event?.payload?.pnl || 0) > 0
  ));
  const firstBreakEven = events.find((event) => netWorth(event?.state) >= 0);
  const profitableSales = events.filter((event) => (
    event?.event_type === "trade"
    && event?.payload?.side === "sell"
    && Number(event?.payload?.pnl || 0) > 0
  ));
  const checkpointNetWorth = {};
  for (const day of [5, 10, 15]) {
    const checkpoint = events.find((event) => Number(event?.day || 0) >= day);
    checkpointNetWorth[String(day)] = checkpoint ? netWorth(checkpoint.state) : null;
  }
  const completedChains = new Set(
    events
      .filter((event) => event?.event_type === "market_news" && Number(event?.payload?.chain_stage || 0) >= 2)
      .map((event) => String(event.payload.chain_id || ""))
      .filter(Boolean),
  );
  return {
    duration_seconds: runEndedElapsedSeconds ?? getRunElapsedSeconds(),
    primary_action_count: runPrimaryActionCount,
    checkpoint_net_worth: checkpointNetWorth,
    first_profitable_sale_day: firstProfitableSale ? Number(firstProfitableSale.day || 0) : null,
    first_break_even_day: firstBreakEven ? Number(firstBreakEven.day || 0) : null,
    profitable_sale_count: profitableSales.length,
    max_single_profit: profitableSales.reduce((max, event) => Math.max(max, Number(event?.payload?.pnl || 0)), 0),
    market_news_count: Number(eventCounts.market_news || 0),
    completed_news_chain_count: completedChains.size,
    event_counts: eventCounts,
  };
}
function gameSnapshot() {
  const platformMeta = window.BFSJ_PLATFORM?.runMeta?.() || {};
  return {
    experiment_key: game.experimentKey || game.experimentConfig?.experimentId || platformMeta.experiment_key || "control",
    score: game.score,
    cash: game.cash,
    bank: game.bank,
    debt: game.debt,
    health: game.health,
    fame: game.fame,
    coat: game.coat,
    days_used: game.daysUsed,
    location: game.currentLoc,
    inventory: game.inv,
    logs: game.logs.slice(-80),
    event_summary: summarizeEvents(game.eventLog || []),
    playtest_metrics: buildPlaytestMetrics(),
    events: game.eventLog?.slice(-EVENT_LOG_LIMIT) || [],
    platform: platformMeta,
    ended_at: new Date().toISOString(),
  };
}
function endedReason() {
  if (game.health < 0) return "death";
  if (game.fame < 30) return "reputation";
  return game.timeLeft <= 0 ? "completed" : "ended";
}
function endedReasonText() {
  const code = endedReason();
  if (code === "death") return "健康归零";
  if (code === "reputation") return "名声崩盘";
  if (code === "completed") return `${TOTAL_DAYS}天期满`;
  return "中途结束";
}
function readLocalRunStats() {
  try {
    const raw = window.localStorage.getItem(LOCAL_RUN_STATS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      runs: Number(parsed.runs || 0),
      bestScore: Number.isFinite(Number(parsed.bestScore)) ? Number(parsed.bestScore) : null,
      bestAt: parsed.bestAt || null,
      lastScore: Number.isFinite(Number(parsed.lastScore)) ? Number(parsed.lastScore) : null,
      bestStreak: Number.isFinite(Number(parsed.bestStreak)) ? Number(parsed.bestStreak) : 0,
      bestSingleProfit: Number.isFinite(Number(parsed.bestSingleProfit)) ? Number(parsed.bestSingleProfit) : 0,
      bestSingleProfitGoods: parsed.bestSingleProfitGoods || "",
    };
  } catch (_error) {
    return { runs: 0, bestScore: null, bestAt: null, lastScore: null, bestStreak: 0, bestSingleProfit: 0, bestSingleProfitGoods: "" };
  }
}
function writeLocalRunStats(stats) {
  try {
    window.localStorage.setItem(LOCAL_RUN_STATS_KEY, JSON.stringify(stats));
  } catch (_error) {}
}
function recordLocalRunStats() {
  const previous = readLocalRunStats();
  const previousBest = previous.bestScore;
  const previousLastScore = previous.lastScore;
  if (lastRecordedEndStatsRunId === runId) {
    return { ...previous, previousBest, previousLastScore, isNewBest: previousBest === null || game.score >= previousBest };
  }
  const isNewBest = previousBest === null || game.score > previousBest;
  const previousBestStreak = Number(previous.bestStreak || 0);
  const previousBestSingleProfit = Number(previous.bestSingleProfit || 0);
  const isNewBestStreak = maxProfitStreak > previousBestStreak;
  const isNewBestSingleProfit = runBestProfit > previousBestSingleProfit;
  const next = {
    ...previous,
    runs: previous.runs + 1,
    lastScore: game.score,
    lastEndedAt: new Date().toISOString(),
    bestScore: isNewBest ? game.score : previousBest,
    bestAt: isNewBest ? new Date().toISOString() : previous.bestAt,
    bestVersion: isNewBest ? GAME_VERSION_CODE : previous.bestVersion,
    bestStreak: isNewBestStreak ? maxProfitStreak : previousBestStreak,
    bestSingleProfit: isNewBestSingleProfit ? runBestProfit : previousBestSingleProfit,
    bestSingleProfitGoods: isNewBestSingleProfit ? runBestProfitGoods : previous.bestSingleProfitGoods,
  };
  writeLocalRunStats(next);
  lastRecordedEndStatsRunId = runId;
  return { ...next, previousBest, previousLastScore, previousBestStreak, previousBestSingleProfit, isNewBest, isNewBestStreak, isNewBestSingleProfit };
}
function runGrade(score) {
  const value = Number(score) || 0;
  const grades = [
    { min: 50000000, key: "legend", label: "SSS 杭城传说", caption: "这把已经是可以截图炫耀的级别。" },
    { min: 10000000, key: "master", label: "SS 资本猎手", caption: "你已经抓住了大行情的脉搏。" },
    { min: 3000000, key: "ace", label: "S 风口玩家", caption: "高分局成型，下一把冲榜很近。" },
    { min: 1000000, key: "pro", label: "A 翻盘商人", caption: "节奏漂亮，已经跑出像样成绩。" },
    { min: 500000, key: "runner", label: "B 城市跑家", caption: "现金流稳住了，再抓一波就起飞。" },
    { min: 100000, key: "starter", label: "C 初见起势", caption: "债务压力被扛住，下一把会更顺。" },
    { min: 0, key: "survive", label: "D 活着离场", caption: "至少完整跑完了，下一把先盯低买高卖。" },
    { min: -Infinity, key: "comeback", label: "E 差点翻车", caption: "别急，先减少乱买，靠主按钮找机会。" },
  ];
  return grades.find((grade) => value >= grade.min) || grades[grades.length - 1];
}
function nextGradeTarget(score) {
  const value = Number(score) || 0;
  return GRADE_TARGETS.find((target) => value < target) || Math.ceil((value + 1) / 100000000) * 100000000;
}
function nextRunGoal(score, stats) {
  const nextGrade = nextGradeTarget(score);
  const previousBest = Number(stats.previousBest);
  if (Number.isFinite(previousBest) && previousBest > score) {
    return {
      title: "下一局先破个人最佳",
      value: cny(previousBest + 1),
      hint: `差 ${cny(previousBest + 1 - score)}`,
    };
  }
  return {
    title: "下一局目标",
    value: cny(nextGrade),
    hint: `再多 ${cny(nextGrade - score)} 升一档`,
  };
}
function replayCtaText(nextGoal) {
  if (String(nextGoal?.title || "").includes("个人最佳")) return "再来一局 · 破纪录";
  const value = String(nextGoal?.value || "").trim();
  if (!value || value.includes("刷新")) return "再来一局 · 刷新纪录";
  return `再来一局 · 冲 ${value}`;
}
function previousRunComparison(score, stats) {
  const previous = Number(stats.previousLastScore);
  if (!Number.isFinite(previous) || Number(stats.runs || 0) <= 1) {
    return {
      tone: "first",
      value: "首局完成",
      hint: "下一局开始会显示和上一局的差距。",
    };
  }
  const diff = Math.round((Number(score) || 0) - previous);
  if (diff > 0) {
    return {
      tone: "up",
      value: `比上局多 ${cny(diff)}`,
      hint: `上一局是 ${cny(previous)}，手感在升温。`,
    };
  }
  if (diff < 0) {
    return {
      tone: "down",
      value: `比上局少 ${cny(Math.abs(diff))}`,
      hint: `上一局是 ${cny(previous)}，下一把追回来。`,
    };
  }
  return {
    tone: "flat",
    value: "持平",
    hint: `和上一局 ${cny(previous)} 一样，下一把冲破。`,
  };
}
function nextRunChallenge({ score, debt, stats }) {
  const bestStreak = Math.max(0, Number(stats.bestStreak || 0));
  const bestSingleProfit = Math.max(0, Number(stats.bestSingleProfit || 0));
  if (debt > 0) {
    return {
      title: "下一局挑战",
      value: "无债收官",
      hint: "主按钮出现还债机会时优先清掉利息。",
    };
  }
  if (maxProfitStreak < 5) {
    const target = Math.max(3, Math.min(5, maxProfitStreak + 1));
    return {
      title: "下一局挑战",
      value: `连赚 x${target}`,
      hint: "盈利先兑现，再换站找下一波低位。",
    };
  }
  if (runBestProfit < 200000) {
    return {
      title: "下一局挑战",
      value: "做出爆款单",
      hint: `当前最大单笔 ${cnyCompact(runBestProfit)}，目标 20万+。`,
    };
  }
  if (score < 1000000) {
    return {
      title: "下一局挑战",
      value: "冲进百万局",
      hint: "中后段盯高波动品，别太早把现金闲置。",
    };
  }
  const streakTarget = Math.max(6, bestStreak + 1);
  return {
    title: "下一局挑战",
    value: `刷新纪录 x${streakTarget}`,
    hint: bestSingleProfit > 0 ? `本机最大单笔 ${cnyCompact(bestSingleProfit)}，继续往上顶。` : "保持节奏，冲更高连赚。",
  };
}
function nextRunOpeningPlan({ nextGoal, challenge }) {
  const target = String(nextGoal?.value || challenge?.value || "下一档");
  const challengeValue = String(challenge?.value || "");
  if (challengeValue.includes("无债")) {
    return ["开局跟主按钮低价装货", "卖出后优先还债", "最后 5 天清仓冲档"];
  }
  if (challengeValue.includes("连赚")) {
    return ["开局跟主按钮买低价", "一有浮盈先兑现", "最后 5 天保连赚"];
  }
  if (challengeValue.includes("爆款")) {
    return ["开局跟主按钮滚现金", "仓位够就装大单", "最后 5 天盈利立收"];
  }
  if (challengeValue.includes("百万") || target.includes("1,000,000")) {
    return ["开局跟主按钮滚现金", "中段扩仓抓大单", "最后 5 天清仓冲刺"];
  }
  if (String(nextGoal?.title || "").includes("个人最佳")) {
    return ["开局照主按钮跑", "破纪录前别乱存钱", "最后 5 天全力兑现"];
  }
  return ["开局跟主按钮跑", `中段盯住 ${target}`, "最后 5 天冲刺"];
}
function buildRunBounty(stats = readLocalRunStats()) {
  const runs = Number(stats.runs || 0);
  const bestScore = Math.max(0, Number(stats.bestScore || 0));
  const bestSingleProfit = Math.max(0, Number(stats.bestSingleProfit || 0));
  const bestStreak = Math.max(0, Number(stats.bestStreak || 0));
  if (runs <= 0 || stats.bestScore == null) {
    return {
      key: "complete-run",
      value: `跑满 ${TOTAL_DAYS} 天`,
      hint: "第一局只跟底部主按钮，把节奏跑完。",
      target: TOTAL_DAYS,
    };
  }
  if (bestScore < 500000) {
    return {
      key: "debt-free-500k",
      value: "无债冲 50 万",
      hint: "清债后抓一波高价卖，先跨过 B 档。",
      target: 500000,
    };
  }
  if (bestSingleProfit < 200000) {
    return {
      key: "single-profit-200k",
      value: "爆款单 20 万+",
      hint: "盯高波动商品，盈利够厚就兑现。",
      target: 200000,
    };
  }
  if (bestScore < 1000000) {
    return {
      key: "score-1m",
      value: "冲进百万局",
      hint: "中后段别让现金闲着，连续找高价出口。",
      target: 1000000,
    };
  }
  return {
    key: "streak-record",
    value: `连赚 x${Math.max(6, bestStreak + 1)}`,
    hint: "盈利先兑现，刷新本机手感纪录。",
    target: Math.max(6, bestStreak + 1),
  };
}
function ensureRunBounty() {
  if (!currentRunBounty || !currentRunBounty.key) currentRunBounty = buildRunBounty();
  return currentRunBounty;
}
function runBountyStatus(bounty = ensureRunBounty()) {
  const key = bounty?.key || "complete-run";
  const target = Math.max(0, Number(bounty?.target || 0));
  const score = Number(game.score || 0);
  const title = "本局悬赏";
  if (key === "complete-run") {
    const complete = game.daysUsed >= TOTAL_DAYS;
    return {
      title,
      value: bounty.value || `跑满 ${TOTAL_DAYS} 天`,
      hint: bounty.hint || "把节奏跑完。",
      complete,
      text: complete ? `悬赏完成 · 完整 ${TOTAL_DAYS} 天` : `本局悬赏 · 跑满 ${TOTAL_DAYS} 天，还剩 ${game.timeLeft} 天`,
      result: complete ? `已完成：完整 ${TOTAL_DAYS} 天` : `还剩 ${game.timeLeft} 天`,
    };
  }
  if (key === "debt-free-500k") {
    const gap = Math.max(0, target - score);
    const complete = score >= target && game.debt <= 0;
    const result = complete ? "已完成：无债冲档" : (game.debt > 0 ? `先清债 ${cny(game.debt)}` : `还差 ${cny(gap)}`);
    return {
      title,
      value: bounty.value || `无债冲 ${cny(target)}`,
      hint: bounty.hint || "清债后冲下一档。",
      complete,
      text: complete ? "悬赏完成 · 无债冲档" : `本局悬赏 · ${result}`,
      result,
    };
  }
  if (key === "single-profit-200k") {
    const gap = Math.max(0, target - runBestProfit);
    const complete = runBestProfit >= target;
    return {
      title,
      value: bounty.value || `爆款单 ${cnyCompact(target)}+`,
      hint: bounty.hint || "做出一笔大单。",
      complete,
      text: complete ? "悬赏完成 · 爆款单" : `本局悬赏 · 爆款单还差 ${cny(gap)}`,
      result: complete ? `已完成：${cnyCompact(runBestProfit)}` : `当前最大 ${runBestProfit > 0 ? cnyCompact(runBestProfit) : "暂无"}`,
    };
  }
  if (key === "score-1m") {
    const gap = Math.max(0, target - score);
    const complete = score >= target;
    return {
      title,
      value: bounty.value || `冲 ${cny(target)}`,
      hint: bounty.hint || "冲进下一档。",
      complete,
      text: complete ? "悬赏完成 · 百万局" : `本局悬赏 · 冲百万还差 ${cny(gap)}`,
      result: complete ? `已完成：${cny(score)}` : `还差 ${cny(gap)}`,
    };
  }
  const complete = maxProfitStreak >= target;
  return {
    title,
    value: bounty.value || `连赚 x${target}`,
    hint: bounty.hint || "刷新连赚纪录。",
    complete,
    text: complete ? `悬赏完成 · 连赚 x${maxProfitStreak}` : `本局悬赏 · 连赚 x${target}，当前最高 x${maxProfitStreak}`,
    result: complete ? `已完成：x${maxProfitStreak}` : `当前最高 x${maxProfitStreak}`,
  };
}
function maybeCelebrateRunBounty() {
  const status = runBountyStatus();
  const key = `${runId}:${ensureRunBounty().key}`;
  if (!status.complete || game.gameOver || key === lastBountyCompletedKey) return false;
  lastBountyCompletedKey = key;
  softTap([10, 24, 10]);
  pulseRoundProgress();
  showSaveBanner(`悬赏完成：${status.value}。`, 2600);
  return true;
}
function bountyActionHint(kind, data = {}) {
  const bounty = ensureRunBounty();
  const key = bounty?.key || "complete-run";
  if (game.gameOver) return "下一把继续追新悬赏";
  if (key === "complete-run") {
    if (kind === "travel") return `悬赏：跑满还剩 ${Math.max(0, game.timeLeft - 1)} 天`;
    if (kind === "buy") return "悬赏：先装货";
    if (kind === "sell") return "悬赏：兑现后继续跑";
    if (kind === "repay") return "悬赏：利息更轻";
    if (kind === "expand") return "悬赏：后半局更稳";
  }
  if (key === "debt-free-500k") {
    if (kind === "repay") return "悬赏：先清债";
    if (kind === "sell") return "悬赏：离 50 万更近";
    if (kind === "buy") return "悬赏：低位冲 50 万";
    if (kind === "expand") return "悬赏：冲档上限更高";
    if (kind === "travel") return "悬赏：找高价出口";
  }
  if (key === "single-profit-200k") {
    const target = Math.max(0, Number(bounty.target || 200000));
    const pnl = Math.max(0, Number(data.pnl || 0));
    if (kind === "sell" && pnl >= target) return "悬赏：爆款单到手";
    if (kind === "sell" && pnl > 0) return `悬赏：爆款差 ${cnyCompact(Math.max(0, target - pnl))}`;
    if (kind === "buy") return "悬赏：备爆款货";
    if (kind === "expand") return "悬赏：大单空间更足";
    if (kind === "travel") return "悬赏：找爆款卖点";
  }
  if (key === "score-1m") {
    if (kind === "sell") return "悬赏：兑现冲百万";
    if (kind === "buy") return "悬赏：现金变利润";
    if (kind === "expand") return "悬赏：单局上限更高";
    if (kind === "travel") return "悬赏：找高价差";
    if (kind === "repay") return "悬赏：分数更干净";
  }
  if (key === "streak-record") {
    const nextStreak = Math.max(profitStreak + 1, maxProfitStreak);
    if (kind === "sell") return `悬赏：连赚 x${nextStreak}`;
    if (kind === "buy") return "悬赏：给连赚备货";
    if (kind === "travel") return "悬赏：找可兑现机会";
    if (kind === "expand") return "悬赏：连赚更稳";
  }
  return "";
}
function actionReasonWithBounty(defaultReason, kind, data = {}) {
  const hint = bountyActionHint(kind, data);
  return hint ? `${hint} · ${defaultReason}` : defaultReason;
}
function startGoalSummary(stats = readLocalRunStats()) {
  const bounty = currentRunBounty || buildRunBounty(stats);
  const runs = Number(stats.runs || 0);
  if (runs <= 0 || stats.bestScore == null) {
    return {
      title: "首局目标",
      value: `跟着下一步跑满 ${TOTAL_DAYS} 天`,
      hint: "第一局不用看表格，底部主按钮会带你走完整局。",
      stats: [
        ["本局悬赏", bounty.value],
        ["底部主按钮", "自动推荐"],
        ["初始负债", cny(6000)],
        ["目标时长", `${TARGET_SESSION_MINUTES} 分钟`],
      ],
    };
  }
  const bestScore = Number(stats.bestScore || 0);
  const nextTarget = nextGradeTarget(bestScore);
  const lastScore = Number(stats.lastScore || 0);
  const gap = Math.max(1, Math.min(nextTarget - bestScore, nextTarget));
  return {
    title: "本局开跑目标",
    value: bestScore >= 100000000 ? "刷新亿级纪录" : `冲 ${cny(nextTarget)}`,
    hint: bestScore >= 100000000 ? `当前最佳 ${cny(bestScore)}。` : `距离下一档还差约 ${cny(gap)}。`,
    stats: [
      ["本局悬赏", bounty.value],
      ["本机最佳", cny(bestScore)],
      ["上一局", cny(lastScore)],
      ["最佳连赚", `x${Math.max(0, Number(stats.bestStreak || 0))}`],
      ["最大单笔", Number(stats.bestSingleProfit || 0) > 0 ? cnyCompact(stats.bestSingleProfit) : "暂无"],
    ],
  };
}
function startCtaText(summary) {
  const title = String(summary?.title || "");
  const value = String(summary?.value || "").trim();
  if (title.includes("首局")) return "开始 · 跟着下一步";
  if (!value) return "开始 · 跑一局";
  if (value.includes("刷新")) return "开始 · 刷新纪录";
  return `开始 · ${value}`;
}
function renderStartGoalCard() {
  const el = q("startGoalCard");
  if (!el) return;
  if (el.classList.contains("hidden")) {
    if (q("startConfirmBtn")) q("startConfirmBtn").textContent = "开始交易";
    return;
  }
  const summary = startGoalSummary();
  if (q("startConfirmBtn")) q("startConfirmBtn").textContent = startCtaText(summary);
  const rows = summary.stats.map(([label, value]) => `
    <div class="start-goal-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
  el.innerHTML = `
    <span>${escapeHtml(summary.title)}</span>
    <strong>${escapeHtml(summary.value)}</strong>
    <small>${escapeHtml(summary.hint)}</small>
    <div class="start-goal-grid">${rows}</div>
  `;
}
function careerStatCard(label, value, note = "", isRecord = false) {
  return `
    <div class="career-stat${isRecord ? " is-record" : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
      <small>${escapeHtml(note)}</small>
    </div>
  `;
}
function runBadges({ score, debt, daysUsed }) {
  const badges = [];
  if (daysUsed >= TOTAL_DAYS) badges.push({ label: `完整${TOTAL_DAYS}天`, note: "交易结束" });
  if (debt <= 0) badges.push({ label: "无债收官", note: "利息清零" });
  if (maxProfitStreak >= 3) badges.push({ label: `连赚 x${maxProfitStreak}`, note: "连续兑现" });
  else if (maxProfitStreak >= 2) badges.push({ label: "连赚起势", note: `最高 x${maxProfitStreak}` });
  if (runBestProfit >= 1000000) badges.push({ label: "百万单", note: cnyCompact(runBestProfit) });
  else if (runBestProfit >= 200000) badges.push({ label: "爆款单", note: cnyCompact(runBestProfit) });
  if (score >= 1000000) badges.push({ label: "百万局", note: "翻盘成型" });
  else if (score >= 500000) badges.push({ label: "半百万", note: "手感打开" });
  if (!badges.length) badges.push({ label: "活着离场", note: "下一把再冲" });
  return badges.slice(0, 5);
}
function pendingRunFromCurrentGame() {
  const snapshot = gameSnapshot();
  const platformMeta = window.BFSJ_PLATFORM?.runMeta?.() || {};
  return {
    local_run_id: runId,
    version: GAME_VERSION_CODE,
    ...platformMeta,
    score: game.score,
    cash: game.cash,
    bank: game.bank,
    debt: game.debt,
    health: game.health,
    fame: game.fame,
    coat: game.coat,
    days_used: snapshot.days_used,
    ended_reason: endedReason(),
    publish_intent: runUploadConsent === true,
    final_state: snapshot,
    events: (game.eventLog || []).slice(-EVENT_LOG_LIMIT),
    saved_at: new Date().toISOString(),
  };
}
function storePendingRun(reason = "manual") {
  if (!game.gameOver) return null;
  const pending = { ...pendingRunFromCurrentGame(), pending_reason: reason };
  window.localStorage.setItem(PENDING_RUN_KEY, JSON.stringify(pending));
  return pending;
}
function readPendingRun() {
  try {
    const raw = window.localStorage.getItem(PENDING_RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    window.localStorage.removeItem(PENDING_RUN_KEY);
    return null;
  }
}
function clearPendingRun() {
  window.localStorage.removeItem(PENDING_RUN_KEY);
}
function stableHash(text) {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
function buildDeviceFingerprint() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const lang = navigator.language || "";
  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";
  const cores = navigator.hardwareConcurrency || 0;
  const memory = navigator.deviceMemory || 0;
  const screenBits = `${screen?.width || 0}x${screen?.height || 0}x${screen?.colorDepth || 0}`;
  const raw = [tz, lang, platform, ua, cores, memory, screenBits].join("|");
  return `fp_${stableHash(raw)}`;
}
function randomToken(prefix = "c") {
  const raw = (window.crypto?.randomUUID && window.crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${raw.replaceAll("-", "").slice(0, 24)}`;
}
function readClaimTokens() {
  try {
    const raw = window.localStorage.getItem(CLAIM_TOKENS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_err) {
    return [];
  }
}
function storeClaimToken(token) {
  if (!token) return;
  const arr = readClaimTokens();
  if (!arr.includes(token)) arr.unshift(token);
  window.localStorage.setItem(CLAIM_TOKENS_KEY, JSON.stringify(arr.slice(0, 80)));
}
function removeClaimToken(token) {
  if (!token) return;
  const arr = readClaimTokens().filter((x) => x !== token);
  window.localStorage.setItem(CLAIM_TOKENS_KEY, JSON.stringify(arr));
}
function refreshClaimTokenHint() {
  const hint = q("claimTokenHint");
  const latestInput = q("latestClaimToken");
  if (!hint) return;
  const tokens = readClaimTokens();
  if (!tokens.length) {
    hint.textContent = "暂无待认领的游客回绑码。";
    if (latestInput) latestInput.value = "";
    return;
  }
  hint.textContent = `本设备待认领回绑码 ${tokens.length} 条，登录后会自动尝试认领。`;
  if (latestInput) latestInput.value = tokens[0];
}
async function copyLatestClaimToken() {
  const tokens = readClaimTokens();
  if (!tokens.length) {
    setAuthMessage("当前没有可复制的回绑码。");
    showSaveBanner("当前没有可复制的回绑码。", 2200, "error");
    return;
  }
  const token = tokens[0];
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(token);
    } else {
      const ta = document.createElement("textarea");
      ta.value = token;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setAuthMessage("回绑码已复制到剪贴板。");
    showSaveBanner("回绑码复制成功。", 2200);
  } catch (_error) {
    setAuthMessage("复制失败，请手动长按复制。");
    showSaveBanner("复制失败，请手动复制。", 2600, "error");
  }
}
async function claimGuestRunsAfterLogin() {
  if (!cloud.client || !cloud.user) return 0;
  let claimed = 0;
  const guestId = getGuestId();
  const { data: guestClaimed, error: guestErr } = await cloud.client.rpc("claim_guest_runs_by_guest_id", {
    p_guest_id: guestId,
  });
  if (!guestErr && Number(guestClaimed || 0) > 0) claimed += Number(guestClaimed);
  const tokens = readClaimTokens();
  for (const token of tokens) {
    const { data, error } = await cloud.client.rpc("claim_guest_runs", { p_claim_token: token });
    if (!error && Number(data || 0) > 0) {
      claimed += Number(data);
      removeClaimToken(token);
    }
  }
  if (claimed > 0) {
    setAuthMessage(`已为你认领 ${claimed} 条历史战绩。`);
    showSaveBanner(`成功认领 ${claimed} 条游客战绩。`, 3800);
    await loadLeaderboard();
  }
  refreshClaimTokenHint();
  return claimed;
}
async function claimByTokenManual() {
  if (!cloud.client || !cloud.user) {
    setAuthMessage("请先登录账号再认领。");
    return;
  }
  const input = q("claimTokenInput");
  const token = String(input?.value || "").trim();
  if (!token) {
    setAuthMessage("请先输入回绑码。");
    return;
  }
  const { data, error } = await cloud.client.rpc("claim_guest_runs", { p_claim_token: token });
  if (error) {
    setAuthMessage(`认领失败：${error.message}`);
    return;
  }
  const n = Number(data || 0);
  if (n > 0) {
    removeClaimToken(token);
    if (input) input.value = "";
    setAuthMessage(`认领成功：新增 ${n} 条战绩。`);
    showSaveBanner(`认领成功：${n} 条游客战绩已挂到账号。`, 3600);
    await loadLeaderboard();
  } else {
    setAuthMessage("该回绑码已使用或无效。");
  }
  refreshClaimTokenHint();
}
function guestRunPayload(claimToken) {
  const snapshot = gameSnapshot();
  const platformMeta = window.BFSJ_PLATFORM?.runMeta?.() || {};
  return {
    guest_id: getGuestId(),
    nickname: "匿名玩家",
    device_fingerprint: buildDeviceFingerprint(),
    claim_token: claimToken,
    score: game.score,
    cash: game.cash,
    bank: game.bank,
    debt: game.debt,
    health: game.health,
    fame: game.fame,
    coat: game.coat,
    days_used: snapshot.days_used,
    ended_reason: endedReason(),
    ...platformMeta,
    final_state: {
      ...snapshot,
      entry_mode: "guest_private_archive",
      can_claim_with_login: true,
    },
  };
}
async function archiveGuestRunToCloud(manual = false) {
  if (!cloud.client) {
    storePendingRun("guest_archive_offline");
    if (manual) setAuthMessage("云端未连接，本局已暂存在本机。");
    return false;
  }
  if (savedRunId === runId) {
    return true;
  }
  if (saveInFlight) return false;
  saveInFlight = true;
  const claimToken = guestRunClaimToken || randomToken("claim");
  const payload = guestRunPayload(claimToken);
  const { data, error } = await cloud.client.rpc("archive_guest_run", { p_payload: payload });
  saveInFlight = false;
  if (error) {
    saveFailedRunId = runId;
    storePendingRun("guest_archive_error");
    if (manual) {
      setAuthMessage(`云端存档失败：${error.message}`);
      showSaveBanner(`存档失败：${error.message}`, 5200, "error");
    }
    scheduleSaveRetry(() => { archiveGuestRunToCloud(false); }, "对局存档");
    return false;
  }
  clearSaveRetry();
  guestRunClaimToken = claimToken;
  storeClaimToken(claimToken);
  savedRunId = runId;
  saveFailedRunId = null;
  lastSavedCloudRunId = data || null;
  clearPendingRun();
  setAuthMessage("本局已匿名存档；填写昵称后才会进入排行榜。");
  game.addLog("本局已完成匿名云端存档。", "cloud_save", { status: "private_archive", run_id: data });
  refreshClaimTokenHint();
  return true;
}
async function saveGuestRunToCloud(manual = false, nicknameOverride = null) {
  const defaultName = window.localStorage.getItem(LAST_GUEST_NICK_KEY) || "";
  const nameRaw = nicknameOverride == null
    ? window.prompt("输入上榜昵称（1-24字）：", defaultName || "杭州路人甲")
    : nicknameOverride;
  if (nameRaw === null) return false;
  const nickname = String(nameRaw || "").trim().slice(0, 24);
  if (!nickname) {
    if (manual) setAuthMessage("昵称不能为空。");
    return false;
  }
  window.localStorage.setItem(LAST_GUEST_NICK_KEY, nickname);
  const archived = await archiveGuestRunToCloud(manual);
  if (!archived || !guestRunClaimToken) return false;
  const { data, error } = await cloud.client.rpc("publish_guest_run", {
    p_claim_token: guestRunClaimToken,
    p_nickname: nickname,
  });
  if (error) {
    setAuthMessage(`游客上榜失败：${error.message}`);
    showSaveBanner(`上榜失败：${error.message}`, 5200, "error");
    return false;
  }
  runPublished = true;
  runUploadConsent = true;
  lastSavedCloudRunId = data || lastSavedCloudRunId;
  setAuthMessage(`游客上榜成功：${nickname}。后续登录可自动认领历史战绩。`);
  showSaveBanner("写入成功：游客战绩已入榜。", 3200);
  game.addLog("游客战绩已发布到排行榜。", "guest_save", { nickname, run_id: data });
  clearPendingRun();
  await loadLeaderboard();
  return true;
}
function setGuestSaveHint(message, tone = "normal") {
  const el = q("guestSaveHint");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error-text", tone === "error");
}
function isGuestSaveOffline() {
  return !cloud.client || window.__BFSJ_FORCE_GUEST_SAVE_OFFLINE === true;
}
function openGuestSaveModal() {
  const modal = q("guestSaveModal");
  const input = q("guestNicknameInput");
  if (!modal || !input) return;
  input.value = window.localStorage.getItem(LAST_GUEST_NICK_KEY) || input.value || "杭州路人甲";
  if (isGuestSaveOffline()) {
    setGuestSaveHint("云端暂时未连接；本局已保存在本机，可点“稍后再说”继续，稍后再上榜。", "error");
  } else {
    setGuestSaveHint("游客上榜不需要登录，后续可用回绑码认领战绩。");
  }
  modal.classList.remove("hidden");
  setTimeout(() => {
    try {
      input.focus({ preventScroll: true });
      input.select();
    } catch (_error) {
      input.focus();
    }
  }, 80);
}
function closeGuestSaveModal() {
  q("guestSaveModal")?.classList.add("hidden");
}
async function submitGuestSaveFromModal() {
  const input = q("guestNicknameInput");
  const nickname = String(input?.value || "").trim();
  if (!nickname) {
    setGuestSaveHint("先输入一个 1-24 字的昵称。", "error");
    input?.focus();
    return;
  }
  if (isGuestSaveOffline()) {
    setGuestSaveHint("云端未连接，当前无法上榜；本局已保存在本机，可点“稍后再说”继续。", "error");
    showSaveBanner("本局已保存在本机，稍后仍可上榜。", 3200, "error");
    return;
  }
  runUploadConsent = true;
  const ok = await saveGuestRunToCloud(true, nickname);
  if (ok) closeGuestSaveModal();
}
function closeCapacityModal() {
  const modal = q("capacityModal");
  if (!modal) return;
  modal.classList.add("hidden");
}
function affordableCapacityByCash(cash = game.cash, currentCap = game.coat) {
  let walk = currentCap;
  let spent = 0;
  while (walk < MAX_CAPACITY) {
    const next = walk + CAPACITY_STEP;
    const stepCost = capacityStepCost(next);
    if (spent + stepCost > cash) break;
    spent += stepCost;
    walk = next;
  }
  return { target: walk, gain: walk - currentCap, cost: spent };
}
function recommendedCapacityExpansion() {
  const remainingDays = Math.max(0, Number(game.timeLeft) || 0);
  const recommendedCapacityLimit = 320;
  if (game.debt > 0 || remainingDays <= 7 || game.coat >= recommendedCapacityLimit) {
    return { target: game.coat, gain: 0, cost: 0, paybackPressure: 0 };
  }
  const feeBefore = warehouseDailyFeeForCapacity(game.coat);
  const maxRecommendedGain = Math.min(
    recommendedCapacityLimit - game.coat,
    game.cash >= 500000 ? 50 : game.cash >= 150000 ? 30 : 20,
  );
  const pressureBudget = Math.max(0, Math.floor(game.cash * 0.5));
  let recommended = null;
  for (let gain = CAPACITY_STEP; gain <= maxRecommendedGain; gain += CAPACITY_STEP) {
    const plan = buildCapacityPlan(game.coat, game.coat + gain);
    if (plan.target > MAX_CAPACITY || plan.cost > game.cash) break;
    const addedDailyFee = Math.max(0, warehouseDailyFeeForCapacity(plan.target) - feeBefore);
    const paybackPressure = plan.cost + addedDailyFee * remainingDays;
    if (paybackPressure > pressureBudget) break;
    recommended = { target: plan.target, gain: plan.gain, cost: plan.cost, paybackPressure };
  }
  return recommended || { target: game.coat, gain: 0, cost: 0, paybackPressure: 0 };
}
function renderCapacityPlan(expandValue) {
  const input = q("capacityTargetInput");
  const summary = q("capacitySummaryText");
  const affordableText = q("capacityAffordableText");
  const costText = q("capacityCostText");
  if (!input || !summary || !costText) return;
  const maxAffordable = affordableCapacityByCash();
  const maxGain = Math.max(0, maxAffordable.gain || 0);
  input.max = String(Math.max(CAPACITY_STEP, MAX_CAPACITY - game.coat));
  input.min = String(CAPACITY_STEP);
  input.step = String(CAPACITY_STEP);
  const rawGain = Number(expandValue);
  const steppedGain = Number.isFinite(rawGain) ? Math.floor(rawGain / CAPACITY_STEP) * CAPACITY_STEP : CAPACITY_STEP;
  const gain = Math.max(CAPACITY_STEP, Math.min(MAX_CAPACITY - game.coat, steppedGain));
  const target = normalizeCapacityTarget(game.coat + gain, game.coat);
  capacityPlanTarget = target;
  input.value = String(Math.max(CAPACITY_STEP, target - game.coat));
  const plan = buildCapacityPlan(game.coat, target);
  const left = Math.max(0, MAX_CAPACITY - game.coat);
  const stepPreview = plan.detail.slice(0, 3).map((x) => `${x.after}:${cny(x.cost)}`).join("，");
  const cashAfter = game.cash - plan.cost;
  const feeBefore = warehouseDailyFeeForCapacity(game.coat);
  const feeAfter = warehouseDailyFeeForCapacity(plan.target);
  const addedDailyFee = Math.max(0, feeAfter - feeBefore);
  const remainingDays = Math.max(0, game.timeLeft);
  const paybackPressure = plan.cost + addedDailyFee * remainingDays;
  if (affordableText) {
    affordableText.textContent = `现金 ${cny(game.cash)}，最多可扩 ${maxGain} 仓（到 ${maxAffordable.target}）。当前每日管理费 ${cny(feeBefore)}。`;
  }
  summary.textContent = `当前仓位 ${game.coat}，最多还能增加 ${left}。本次将增加 ${plan.gain} 到 ${plan.target}。`;
  costText.innerHTML = `
    <span>本次扩仓成本</span>
    <strong>${cny(plan.cost)}</strong>
    <small>扩仓后剩余现金：${cny(cashAfter)}</small>
    <small>扩仓后每日管理费：${cny(feeAfter)}${addedDailyFee ? `（新增 ${cny(addedDailyFee)}/天）` : ""}</small>
    <small>预计回本压力：${cny(paybackPressure)} = 本次成本 + 剩余 ${remainingDays} 天新增管理费</small>
    <small>档位预览：${escapeHtml(stepPreview)}${plan.detail.length > 3 ? "..." : ""}</small>
  `;
}
function openCapacityModal() {
  const modal = q("capacityModal");
  const input = q("capacityTargetInput");
  if (!modal || !input) return;
  if (game.coat >= MAX_CAPACITY) {
    game.addLog(`仓位已经到达上限 ${MAX_CAPACITY}。`, "input_error", { action: "rent_house", reason: "max_capacity", max_capacity: MAX_CAPACITY });
    render();
    return;
  }
  modal.classList.remove("hidden");
  const recommended = recommendedCapacityExpansion();
  const defaultGain = recommended.gain > 0 ? recommended.gain : CAPACITY_STEP;
  input.min = String(CAPACITY_STEP);
  input.max = String(MAX_CAPACITY - game.coat);
  input.step = String(CAPACITY_STEP);
  renderCapacityPlan(defaultGain);
}
function fallbackPlayerName() {
  return cloud.profile?.display_name || cloud.user?.user_metadata?.name || cloud.user?.email?.split("@")[0] || "游客";
}
function currentPresencePayload() {
  const name = fallbackPlayerName();
  const avatarUrl = cloud.profile?.avatar_url || cloud.user?.user_metadata?.avatar_url || cloud.user?.user_metadata?.picture || "";
  return {
    user_id: cloud.user?.id || null,
    session_id: getGuestId(),
    display_name: name,
    avatar_url: avatarUrl,
    score: game.score,
    day: game.daysUsed,
    online_at: new Date().toISOString(),
  };
}
function getGuestId() {
  const key = "bfsj_guest_id";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = (window.crypto?.randomUUID && window.crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(key, id);
  }
  return id;
}
function updateOnlineUi() {
  const countEl = q("onlineCountText");
  const avatarsEl = q("onlineAvatars");
  const players = cloud.onlinePlayers || [];
  if (countEl) countEl.textContent = `在线 ${players.length}`;
  if (q("mobileMenuOnlineText")) q("mobileMenuOnlineText").textContent = String(players.length);
  if (q("mobileVersionText")) q("mobileVersionText").textContent = `版本 ${GAME_VERSION_CODE}`;
  if (!avatarsEl) return;
  avatarsEl.innerHTML = players.slice(0, 5).map((player) => {
    const name = player.display_name || "游客";
    const initial = escapeHtml(name.trim().slice(0, 1) || "?");
    const title = escapeHtml(`${name} · 第${player.day || 0}天 · ${cny(player.score || 0)}`);
    if (player.avatar_url) {
      return `<span class="online-avatar" title="${title}"><img src="${escapeHtml(player.avatar_url)}" alt="${escapeHtml(name)}" referrerpolicy="no-referrer" /></span>`;
    }
    return `<span class="online-avatar avatar-fallback" title="${title}">${initial}</span>`;
  }).join("");
}
function syncPresenceState() {
  if (!cloud.presenceChannel) return;
  const state = cloud.presenceChannel.presenceState();
  const seen = new Map();
  for (const entries of Object.values(state)) {
    for (const entry of entries) {
      const key = entry.user_id || entry.session_id || entry.presence_ref;
      if (!key || seen.has(key)) continue;
      seen.set(key, entry);
    }
  }
  cloud.onlinePlayers = [...seen.values()].sort((a, b) => {
    const aSelf = a.user_id && cloud.user?.id === a.user_id ? 1 : 0;
    const bSelf = b.user_id && cloud.user?.id === b.user_id ? 1 : 0;
    return bSelf - aSelf || (b.score || 0) - (a.score || 0);
  });
  updateOnlineUi();
}
async function trackPresence(force = false) {
  if (!cloud.presenceChannel) return;
  const now = Date.now();
  if (!force && now - lastPresenceTrackAt < 12000) return;
  lastPresenceTrackAt = now;
  const payload = currentPresencePayload();
  await cloud.presenceChannel.track(payload);
  if (cloud.onlinePlayers.length === 0) {
    cloud.onlinePlayers = [payload];
    updateOnlineUi();
  }
}
function initPresence() {
  if (!cloud.client || cloud.presenceChannel) return;
  cloud.presenceChannel = cloud.client.channel("online-players", {
    config: { presence: { key: cloud.user?.id || getGuestId() } },
  });
  cloud.presenceChannel
    .on("presence", { event: "sync" }, syncPresenceState)
    .on("presence", { event: "join" }, syncPresenceState)
    .on("presence", { event: "leave" }, syncPresenceState)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") await trackPresence(true);
    });
}
async function loadProfile() {
  if (!cloud.client || !cloud.user) {
    cloud.profile = null;
    return null;
  }
  const { data, error } = await cloud.client
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", cloud.user.id)
    .maybeSingle();
  if (error) {
    setAuthMessage(`读取昵称失败：${error.message}`);
    return null;
  }
  cloud.profile = data;
  return data;
}
async function saveNickname(name) {
  if (!cloud.client || !cloud.user) return;
  const displayName = (name || "").trim().slice(0, 24);
  if (!displayName) {
    setAuthMessage("请先输入一个昵称。");
    return;
  }
  const row = {
    id: cloud.user.id,
    display_name: displayName,
    updated_at: new Date().toISOString(),
  };
  const { error } = await cloud.client.from("profiles").upsert(row, { onConflict: "id" });
  if (error) {
    setAuthMessage(`保存昵称失败：${error.message}`);
    return;
  }
  cloud.profile = { ...(cloud.profile || {}), display_name: displayName };
  setAuthMessage("昵称已保存。");
  updateAccountUi();
  await trackPresence();
  await loadLeaderboard();
}
async function publishAccountRun(runCloudId) {
  if (!cloud.client || !cloud.user || !runCloudId) return false;
  const { error } = await cloud.client.rpc("publish_account_run", { p_run_id: runCloudId });
  if (error) {
    setAuthMessage(`发布成绩失败：${error.message}`);
    showSaveBanner(`上榜失败：${error.message}`, 5000, "error");
    return false;
  }
  runPublished = true;
  return true;
}
async function saveRunToCloud(manual = false) {
  if (manual) saveFailedRunId = null;
  if (!game.gameOver) {
    if (manual) setAuthMessage("本局还没有结束，结束后会自动保存。");
    return;
  }
  if (!cloud.client) {
    storePendingRun("cloud_offline");
    if (manual) setAuthMessage("云端未连接，本局已暂存在本机。");
    return false;
  }
  if (!cloud.user) {
    return manual ? saveGuestRunToCloud(true) : archiveGuestRunToCloud(false);
  }
  if (savedRunId === runId) {
    if (runUploadConsent === true && !runPublished) {
      const published = await publishAccountRun(lastSavedCloudRunId);
      if (published) {
        await loadLeaderboard();
        q("rankModal")?.classList.remove("hidden");
        showSaveBanner("本局成绩已发布到排行榜。", 3000);
      }
      return published;
    }
    if (manual) setAuthMessage("本局已经匿名存档。");
    return true;
  }
  if (saveInFlight) {
    if (manual) showSaveBanner("正在提交成绩，请稍候…", 2600);
    return;
  }
  if (manual) showSaveBanner("正在提交成绩…", 2400);
  saveInFlight = true;
  const snapshot = gameSnapshot();
  const platformMeta = window.BFSJ_PLATFORM?.runMeta?.() || {};
  const { data, error } = await cloud.client.from("game_runs").insert({
    user_id: cloud.user.id,
    score: game.score,
    cash: game.cash,
    bank: game.bank,
    debt: game.debt,
    health: game.health,
    fame: game.fame,
    coat: game.coat,
    days_used: snapshot.days_used,
    ended_reason: endedReason(),
    ...platformMeta,
    is_public: false,
    final_state: snapshot,
  }).select("id").single();
  if (error) {
    saveInFlight = false;
    saveFailedRunId = runId;
    setAuthMessage(`保存本局失败：${error.message}`);
    showSaveBanner(`写入失败：${error.message}`, 5000, "error");
    scheduleSaveRetry(() => { saveRunToCloud(false); }, "成绩写入");
    game.addLog(`云端保存失败：${error.message}`, "cloud_save", { status: "run_error", error: error.message });
    render();
    return false;
  }
  const runCloudId = data?.id;
  clearSaveRetry();
  savedRunId = runId;
  saveFailedRunId = null;
  saveInFlight = false;
  lastSavedCloudRunId = runCloudId || null;
  runPublished = runUploadConsent === true
    ? await publishAccountRun(runCloudId)
    : false;
  setAuthMessage(runPublished ? "本局成绩已发布到排行榜。" : "本局已匿名存档。");
  game.addLog("本局结果已保存到云端。", "cloud_save", {
    status: runPublished ? "published" : "private_archive",
    run_id: runCloudId,
  });
  if (runPublished) q("rankModal")?.classList.remove("hidden");
  void finalizeRunSave(runCloudId, (game.eventLog || []).slice(-EVENT_LOG_LIMIT), runPublished);
  render();
  return true;
}
async function finalizeRunSave(runCloudId, events, isPublic = false) {
  let eventsOk = true;
  if (runCloudId && events?.length) {
    const eventRows = normalizeEventRows(events, cloud.user.id, runCloudId);
    const { error: eventError } = await cloud.client.from("game_events").insert(eventRows);
    if (eventError) {
      eventsOk = false;
      game.addLog(`对局事件保存失败：${eventError.message}`, "cloud_save", { status: "events_error", error: eventError.message });
    }
  }
  let inTop20 = false;
  if (isPublic) {
    await loadLeaderboard();
    inTop20 = runCloudId ? await checkRunInTop20(runCloudId) : false;
    if (inTop20) showSaveBanner("写入成功：你已进入全服前 20。");
    else showSaveBanner("写入成功：成绩已发布。");
  }
  if (eventsOk) {
    setAuthMessage(isPublic ? "本局结果已保存并发布。" : "本局已匿名存档，可稍后发布到榜单。");
  } else {
    setAuthMessage(isPublic ? "成绩已发布，事件日志同步有延迟。" : "对局已存档，事件日志同步有延迟。");
  }
}
async function uploadPendingRunIfReady() {
  const pending = readPendingRun();
  if (!pending || !cloud.client || !cloud.user || saveInFlight) return;
  saveInFlight = true;
  setAuthMessage("正在补传刚才暂存的本局成绩...");
  const pendingMeta = {
    client_run_id: pending.client_run_id || null,
    session_id: pending.session_id || null,
    city_key: pending.city_key || "hangzhou",
    city_version: pending.city_version || "hz-v1",
    game_version: pending.game_version || pending.version || GAME_VERSION_CODE,
    share_code: pending.share_code || null,
  };
  const { data, error } = await cloud.client.from("game_runs").insert({
    user_id: cloud.user.id,
    score: pending.score,
    cash: pending.cash,
    bank: pending.bank,
    debt: pending.debt,
    health: pending.health,
    fame: pending.fame,
    coat: pending.coat,
    days_used: pending.days_used,
    ended_reason: pending.ended_reason,
    ...pendingMeta,
    is_public: false,
    final_state: {
      ...(pending.final_state || {}),
      recovered_from_local_pending: true,
      pending_saved_at: pending.saved_at,
    },
  }).select("id").single();
  if (error) {
    saveInFlight = false;
    setAuthMessage(`补传本局失败：${error.message}`);
    showSaveBanner(`补传失败：${error.message}`, 7000, "error");
    scheduleSaveRetry(() => { uploadPendingRunIfReady(); }, "补传成绩");
    return;
  }
  clearSaveRetry();
  const runCloudId = data?.id;
  lastSavedCloudRunId = runCloudId || null;
  const published = pending.publish_intent === true
    ? await publishAccountRun(runCloudId)
    : false;
  runPublished = published;
  void finalizePendingRunSave(runCloudId, pending.events || [], published);
  clearPendingRun();
  if (pending.local_run_id === runId) savedRunId = runId;
  saveFailedRunId = null;
  saveInFlight = false;
  setAuthMessage(published ? "刚才暂存的本局结果已发布。" : "刚才暂存的本局结果已匿名入库。");
  if (published) q("rankModal")?.classList.remove("hidden");
  render();
}
async function finalizePendingRunSave(runCloudId, events, isPublic = false) {
  if (runCloudId && events?.length) {
    const { error: eventError } = await cloud.client
      .from("game_events")
      .insert(normalizeEventRows(events, cloud.user.id, runCloudId));
    if (eventError) setAuthMessage("成绩已补传，事件日志同步有延迟。");
  }
  if (!isPublic) return;
  await loadLeaderboard();
  const inTop20 = runCloudId ? await checkRunInTop20(runCloudId) : false;
  if (inTop20) showSaveBanner("补传成功：你已进入全服前 20。");
  else showSaveBanner("补传成功：成绩已发布。");
}
async function uploadPendingGuestRunIfReady() {
  const pending = readPendingRun();
  if (!pending || !cloud.client || cloud.user || saveInFlight) return false;
  const claimToken = pending.claim_token || randomToken("claim");
  const payload = {
    guest_id: getGuestId(),
    nickname: "匿名玩家",
    device_fingerprint: buildDeviceFingerprint(),
    claim_token: claimToken,
    score: pending.score,
    cash: pending.cash,
    bank: pending.bank,
    debt: pending.debt,
    health: pending.health,
    fame: pending.fame,
    coat: pending.coat,
    days_used: pending.days_used,
    ended_reason: pending.ended_reason,
    client_run_id: pending.client_run_id || randomToken("run"),
    session_id: pending.session_id || window.BFSJ_PLATFORM?.runtime?.sessionId || null,
    city_key: pending.city_key || "hangzhou",
    city_version: pending.city_version || "hz-v1",
    game_version: pending.game_version || pending.version || GAME_VERSION_CODE,
    share_code: pending.share_code || null,
    final_state: {
      ...(pending.final_state || {}),
      recovered_from_local_pending: true,
      pending_saved_at: pending.saved_at,
    },
  };
  saveInFlight = true;
  const { data, error } = await cloud.client.rpc("archive_guest_run", { p_payload: payload });
  saveInFlight = false;
  if (error) {
    scheduleSaveRetry(() => { uploadPendingGuestRunIfReady(); }, "游客对局补传");
    return false;
  }
  clearSaveRetry();
  guestRunClaimToken = claimToken;
  storeClaimToken(claimToken);
  lastSavedCloudRunId = data || null;
  if (pending.local_run_id === runId) savedRunId = runId;
  clearPendingRun();
  setAuthMessage("离线对局已匿名补传，可在本设备登录后认领。");
  refreshClaimTokenHint();
  return true;
}
function updateAccountUi() {
  const signedIn = Boolean(cloud.user);
  q("authPanel").classList.toggle("hidden", signedIn);
  q("userPanel").classList.toggle("hidden", !signedIn);
  q("accountUserText").textContent = signedIn ? (cloud.user.email || cloud.user.id) : "未登录";
  q("profileNameInput").value = cloud.profile?.display_name || "";
  const status = !cloudConfigured()
    ? "未配置 Supabase，云端保存不可用。"
    : !cloud.ready
      ? "游戏本体可用，正在连接云端..."
    : signedIn
      ? "已登录。游戏结束后会自动保存本局结果，并可认领游客战绩。"
      : readPendingRun()
        ? "有一局成绩已暂存。登录后会自动写入积分榜。"
        : "未登录也可直接上榜（游客模式）。登录后可认领历史战绩。";
  setCloudStatus(status);
  renderTopAvatar();
  refreshClaimTokenHint();
}
async function loadLeaderboard() {
  const list = q("leaderboardList");
  const note = q("leaderboardUpdated");
  if (!list || !note) return;
  if (!cloud.client) {
    note.textContent = "Supabase 未配置。";
    list.innerHTML = "";
    return;
  }
  note.textContent = "读取中...";
  const { data, error } = await cloud.client
    .from("leaderboard")
    .select("run_id, display_name, score, cash, bank, debt, health, days_used, created_at, entry_type")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    note.textContent = `读取失败：${error.message}`;
    list.innerHTML = "";
    return;
  }
  if (!data || data.length === 0) {
    note.textContent = "还没有上榜记录。";
    list.innerHTML = "";
    return;
  }
  note.textContent = `已更新：${new Date().toLocaleString("zh-CN")}`;
  list.innerHTML = data.map((row, idx) => {
    const when = row.created_at ? new Date(row.created_at).toLocaleDateString("zh-CN") : "";
    const isJustSaved = lastSavedCloudRunId && String(row.run_id) === String(lastSavedCloudRunId);
    const tag = row.entry_type === "guest" ? "游客" : "账号";
    return `<li class="${isJustSaved ? "just-saved" : ""}">
      <span class="rank-no">#${idx + 1}</span>
      <strong>${row.display_name || "匿名玩家"}</strong>
      <span>${cny(row.score)}</span>
      <small>${row.days_used}天 / 健康${row.health} / ${tag} / ${when}</small>
    </li>`;
  }).join("");
}
async function authWithEmail(mode) {
  if (!cloud.client) {
    setAuthMessage("正在连接 Supabase...");
    await initCloud();
  }
  if (!cloud.client) return setAuthMessage("Supabase 连接失败，请刷新页面后再试。");
  const email = q("accountEmail").value.trim();
  const password = q("accountPassword").value;
  const nickname = q("accountNickname").value.trim();
  if (!email || !password) return setAuthMessage("请输入邮箱和密码。");
  const options = nickname ? { data: { name: nickname, full_name: nickname } } : undefined;
  const result = mode === "signup"
    ? await cloud.client.auth.signUp({ email, password, options })
    : await cloud.client.auth.signInWithPassword({ email, password });
  if (result.error) return setAuthMessage(result.error.message);
  cloud.user = result.data?.session?.user || result.data?.user || cloud.user;
  if (mode === "signup" && nickname) await saveNickname(nickname);
  setAuthMessage(mode === "signup" ? "注册成功，已登录。" : "登录成功。");
  await loadProfile();
  updateAccountUi();
  await claimGuestRunsAfterLogin();
  await uploadPendingRunIfReady();
}
async function authWithProvider(provider) {
  if (!cloud.client) {
    setAuthMessage("正在连接 Supabase...");
    await initCloud();
  }
  if (!cloud.client) return setAuthMessage("Supabase 连接失败，请刷新页面后再试。");
  setAuthMessage(`正在跳转到 ${provider === "google" ? "Google" : provider} 登录...`);
  if (game.gameOver && runUploadConsent === true && savedRunId !== runId) storePendingRun("oauth_redirect");
  const { error } = await cloud.client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: authRedirectUrl() },
  });
  if (error) setAuthMessage(error.message);
}
async function signOut() {
  if (!cloud.client) return;
  const { error } = await cloud.client.auth.signOut();
  if (error) setAuthMessage(error.message);
  else setAuthMessage("已退出登录。");
}
async function initCloud() {
  if (!cloudConfigured()) {
    await window.BFSJ_PLATFORM?.init?.(null);
    updateAccountUi();
    return;
  }
  updateAccountUi();
  try {
    await loadSupabaseSdk();
  } catch (error) {
    setCloudStatus(`云端 SDK 加载失败：${error.message}`);
    return;
  }
  const cfg = window.BFSJ_CONFIG;
  cloud.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      persistSession: true,
    },
  });
  cloud.ready = true;
  await window.BFSJ_PLATFORM?.init?.(cloud.client);
  const cityContentChanged = syncResolvedCityContent();
  await handleOAuthRedirect();
  const { data } = await cloud.client.auth.getSession();
  cloud.user = data.session?.user || null;
  await loadProfile();
  updateAccountUi();
  initPresence();
  await loadLeaderboard();
  if (cloud.user) await uploadPendingRunIfReady();
  else await uploadPendingGuestRunIfReady();
  if (cityContentChanged) render();
  cloud.client.auth.onAuthStateChange(async (_event, session) => {
    cloud.user = session?.user || null;
    await loadProfile();
    updateAccountUi();
    await trackPresence(true);
    if (cloud.user) await claimGuestRunsAfterLogin();
    if (cloud.user) await uploadPendingRunIfReady();
    else await uploadPendingGuestRunIfReady();
    if (game.gameOver && savedRunId !== runId) await saveRunToCloud();
  });
}
function maxBuyCount(goodsId) { const mk = game.market.find((x) => x.id === goodsId); if (!mk) return 0; return Math.max(0, maxAffordableBuyCount(game.cash, mk.price, Math.floor((game.coat - game.totalItems) / (mk.weight || 1)))); }
function maxSellCount(goodsId) { const inv = game.inv.find((x) => x.id === goodsId); if (!inv) return 0; return Math.max(0, inv.count); }
function prefillTradeCounts(opts = {}) { const { buy = false, sell = false } = opts; if (buy && selectedMarket != null) q("buyCount").value = String(Math.max(1, maxBuyCount(selectedMarket))); if (sell && selectedInv != null) q("sellCount").value = String(Math.max(1, maxSellCount(selectedInv))); }
function setMobileTradeMode(mode, resetQty = false) {
  mobileTradeMode = mode === "sell" ? "sell" : "buy";
  if (resetQty) mobileTradeQty = 1;
}
function clearManualTradeSelection() {
  selectedMarket = null;
  selectedInv = null;
  setMobileTradeMode("buy", true);
  document.body?.classList.remove("mobile-manual-trade");
}
function mobileTradeState() {
  if (mobileTradeMode === "sell") {
    const inv = selectedInv != null ? game.inv.find((x) => x.id === selectedInv) : null;
    const quote = inv ? game.previewSell(inv.id, inv.count) : null;
    const cap = inv && quote?.ok ? maxSellCount(inv.id) : 0;
    const pnl = quote?.ok ? quote.pnl : 0;
    const tradeTone = pnl < 0 ? "loss" : pnl > 0 ? "profit" : "flat";
    const outcome = pnl < 0
      ? `预计亏 ${cny(Math.abs(pnl))}`
      : pnl > 0
        ? `预计赚 ${cny(pnl)}`
        : "预计保本";
    return {
      mode: "sell",
      title: inv ? inv.name : "选择持仓",
      meta: inv && quote?.ok
        ? outcome
        : inv
          ? "本地暂不收，换个地点看看"
          : "点选持仓后卖出",
      cap,
      primary: "卖出",
      maxActionText: "全部卖出",
      tradeTone,
      disabled: !inv || !quote?.ok || cap <= 0 || game.gameOver,
    };
  }
  const mk = selectedMarket != null ? game.market.find((x) => x.id === selectedMarket) : null;
  const cap = mk ? maxBuyCount(mk.id) : 0;
  return {
    mode: "buy",
    title: mk ? mk.name : "选择商品",
    meta: mk ? `买价 ${cny(mk.price)} · 最多 ${cap}` : "点选买入列表里的商品",
    cap,
    primary: "买入",
    maxActionText: "全部买入",
    tradeTone: "buy",
    disabled: !mk || cap <= 0 || game.gameOver,
  };
}
function clampMobileTradeQty(cap) {
  const limit = Math.max(1, Number(cap) || 1);
  mobileTradeQty = Math.max(1, Math.min(Math.floor(Number(mobileTradeQty) || 1), limit));
  return mobileTradeQty;
}
function renderMobileTradeDock() {
  const dock = q("mobileTradeDock");
  if (!dock) return;
  if (mobileTradeMode === "sell" && selectedInv == null) mobileTradeMode = "buy";
  const state = mobileTradeState();
  const hasSelection = state.mode === "sell" ? selectedInv != null : selectedMarket != null;
  document.body?.classList.toggle("mobile-manual-trade", Boolean(isMobileUi && hasSelection && mobileView !== "status"));
  const qty = clampMobileTradeQty(state.cap);
  dock.classList.toggle("mode-sell", state.mode === "sell");
  dock.classList.toggle("mode-buy", state.mode !== "sell");
  dock.classList.toggle("is-loss", state.tradeTone === "loss");
  dock.classList.toggle("is-profit", state.tradeTone === "profit");
  dock.classList.toggle("is-disabled", state.disabled);
  if (q("mobileTradeModeText")) q("mobileTradeModeText").textContent = state.mode === "sell" ? "卖出" : "买入";
  if (q("mobileTradeTitle")) q("mobileTradeTitle").textContent = state.title;
  if (q("mobileTradeMeta")) q("mobileTradeMeta").textContent = state.meta;
  if (q("mobileTradeCount")) q("mobileTradeCount").value = String(qty);
  if (q("mobileTradePrimaryBtn")) {
    q("mobileTradePrimaryBtn").textContent = `${state.primary} ${qty}`;
    q("mobileTradePrimaryBtn").disabled = state.disabled;
  }
  if (q("mobileTradeMaxBtn")) {
    q("mobileTradeMaxBtn").innerHTML = state.cap > 0
      ? `<span>${state.maxActionText}</span><strong>${state.cap}</strong>`
      : `<span>${state.maxActionText}</span>`;
    q("mobileTradeMaxBtn").disabled = state.disabled;
  }
  if (q("mobileQtyMinus")) q("mobileQtyMinus").disabled = state.disabled || qty <= 1;
  if (q("mobileQtyPlus")) q("mobileQtyPlus").disabled = state.disabled || qty >= Math.max(1, state.cap);
  if (q("mobileTradeCount")) q("mobileTradeCount").disabled = state.disabled;
}
function updateStatusGuideBadges() {
  const debtCard = q("miniDebtCard");
  const itemsCard = q("miniItemsCard");
  const showDebt = game.daysUsed >= 1 && game.debt > 0 && !debtGuideDismissed;
  const showItems = game.daysUsed >= 1 && game.coat < MAX_CAPACITY && !expandGuideDismissed;
  debtCard?.classList.toggle("status-guide-badge", showDebt);
  itemsCard?.classList.toggle("status-guide-badge", showItems);
}
function prefillRepayAll() { q("repayAmount").value = String(Math.max(0, Math.min(game.cash, game.debt))); }
function newsEffectPct(goodsId) {
  return (game.todayNews?.effects || []).find((x) => x.goodsId === goodsId)?.pct || 0;
}
function bestBuyOpportunity() {
  const rows = game.market
    .map((m) => {
      const goods = game.goods.find((g) => g.id === m.id);
      const max = maxBuyCount(m.id);
      if (!goods || max <= 0) return null;
      const span = Math.max(1, goods.span || 1);
      const percentile = Math.max(-0.45, Math.min(1.45, (m.price - goods.base) / span));
      const newsPct = newsEffectPct(m.id);
      const capacityBoost = max >= 80 ? 10 : max >= 40 ? 6 : max >= 12 ? 3 : 0;
      const score = (1 - percentile) * 70 + Math.max(0, newsPct) * 0.8 + capacityBoost;
      return {
        id: m.id,
        name: m.name,
        price: m.price,
        max,
        percentile,
        newsPct,
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const best = rows[0];
  return best && best.score >= 36 ? best : null;
}
function bestSellOpportunity() {
  const rows = game.inv
    .map((it) => {
      const quote = game.previewSell(it.id, it.count);
      if (!quote.ok || it.count <= 0) return null;
      return {
        id: it.id,
        name: it.name,
        count: it.count,
        price: quote.avgUnit,
        buyPrice: it.buyPrice,
        pnl: quote.pnl,
        pnlPct: quote.pnlPct,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.pnl - a.pnl);
  const best = rows[0];
  return best && best.pnl > 0 ? best : null;
}
function setOpportunityCard(cardId, titleId, metaId, buttonId, data = {}) {
  const card = q(cardId);
  if (card) {
    card.classList.toggle("opportunity-good", data.tone === "good");
    card.classList.toggle("opportunity-wait", data.tone === "wait");
    card.dataset.actionReason = data.reason || data.meta || "";
  }
  if (q(titleId)) q(titleId).textContent = data.title || "暂无";
  if (q(metaId)) q(metaId).textContent = data.meta || "";
  if (q(buttonId)) {
    q(buttonId).textContent = data.button || "执行";
    q(buttonId).disabled = Boolean(data.disabled);
  }
}
function syncThumbActionFromPrimary() {
  const card = q("actionOpportunityCard");
  const button = q("actionOpportunityBtn");
  const dock = q("thumbActionDock");
  const kicker = q("thumbActionKicker");
  const title = q("thumbActionTitle");
  const meta = q("thumbActionMeta");
  const why = q("thumbActionWhy");
  const thumbButton = q("thumbActionBtn");
  if (!dock || !button || !title || !meta || !thumbButton) return;
  dock.classList.toggle("hidden", !isMobileUi);
  dock.classList.toggle("opportunity-good", card?.classList.contains("opportunity-good"));
  dock.classList.toggle("opportunity-wait", card?.classList.contains("opportunity-wait"));
  const goalState = activeRunGoalState(game.cash + game.bank - game.debt);
  dock.classList.toggle("goal-hot", goalState.type === "near-grade" || goalState.type === "record");
  dock.classList.toggle("sprint-hot", Boolean(goalState.sprint));
  if (kicker) kicker.textContent = thumbKickerText();
  title.textContent = q("actionOpportunityTitle")?.textContent || "下一步";
  meta.textContent = q("actionOpportunityMeta")?.textContent || "";
  if (why) why.textContent = card?.dataset.actionReason || "跟着主按钮跑，少犹豫";
  thumbButton.textContent = button.textContent || "执行";
  thumbButton.disabled = Boolean(button.disabled);
}
function thumbKickerText() {
  const net = game.cash + game.bank - game.debt;
  return `下一步 · ${activeRunGoalState(net).short}`;
}
function renderOpportunityStrip(buyOpp, sellOpp) {
  q("opportunityStrip")?.classList.remove("hidden");
  const travelLoc = suggestedTravelLocation();
  const primaryCanBuy = Boolean(buyOpp && lastPrimaryBuyDay !== game.daysUsed);
  const repayOpp = debtRepayOpportunity();
  const expandOpp = expansionOpportunity();
  setOpportunityCard("buyOpportunityCard", "buyOpportunityTitle", "buyOpportunityMeta", "buyOpportunityBtn", buyOpp ? {
    title: buyOpp.name,
    meta: `${cny(buyOpp.price)} ｜ 可买 ${buyOpp.max}${buyOpp.newsPct ? ` ｜ 新闻${buyOpp.newsPct > 0 ? "+" : ""}${buyOpp.newsPct}%` : ""}`,
    button: "买满推荐",
    tone: "good",
  } : {
    title: "观察中",
    meta: "现金不足或价格不够好",
    button: "暂无机会",
    disabled: true,
    tone: "wait",
  });
  setOpportunityCard("sellOpportunityCard", "sellOpportunityTitle", "sellOpportunityMeta", "sellOpportunityBtn", sellOpp ? {
    title: sellOpp.name,
    meta: `浮盈 +${cny(sellOpp.pnl)} ｜ ${Math.round(sellOpp.pnlPct * 100)}%`,
    button: "卖光盈利",
    tone: "good",
  } : {
    title: "暂无盈利",
    meta: "持仓后自动计算",
    button: "暂无可卖",
    disabled: true,
    tone: "wait",
  });
  if (game.gameOver) {
    setOpportunityCard("actionOpportunityCard", "actionOpportunityTitle", "actionOpportunityMeta", "actionOpportunityBtn", {
      title: "再来一局",
      meta: `本局 ${cny(game.score)}，再冲一个高分`,
      reason: actionReasonWithBounty("新目标已备好，直接开", "replay"),
      button: "开始新局",
      tone: "good",
    });
  } else if (sellOpp) {
    const nextNet = game.cash + game.bank - game.debt + sellOpp.price * sellOpp.count;
    setOpportunityCard("actionOpportunityCard", "actionOpportunityTitle", "actionOpportunityMeta", "actionOpportunityBtn", {
      title: "先兑现利润",
      meta: `${sellOpp.name} 现在赚 ${cny(sellOpp.pnl)}`,
      reason: actionReasonWithBounty(`${projectedSellReason(nextNet)}，先落袋`, "sell", sellOpp),
      button: "卖光盈利",
      tone: "good",
    });
  } else if (repayOpp) {
    const debtAfter = Math.max(0, game.debt - repayOpp.amount);
    setOpportunityCard("actionOpportunityCard", "actionOpportunityTitle", "actionOpportunityMeta", "actionOpportunityBtn", {
      title: "先卸掉利息",
      meta: repayOpp.partial ? `先还 ${cny(repayOpp.amount)}，把利息压下来` : `建议还 ${cny(repayOpp.amount)}，少被利息追着跑`,
      reason: actionReasonWithBounty(debtAfter > 0 ? `还后欠 ${cnyCompact(debtAfter)}，压力更轻` : "清债后利润都归你", "repay", repayOpp),
      button: repayOpp.partial ? "先还一笔" : "一键还债",
      tone: "good",
    });
  } else if (primaryCanBuy) {
    setOpportunityCard("actionOpportunityCard", "actionOpportunityTitle", "actionOpportunityMeta", "actionOpportunityBtn", {
      title: "低位加仓",
      meta: `${buyOpp.name} 可买 ${buyOpp.max}`,
      reason: actionReasonWithBounty(buyOpp.newsPct > 0 ? "新闻顺风，先装满" : "低买后找高价卖", "buy", buyOpp),
      button: "买满推荐",
      tone: "good",
    });
  } else if (expandOpp) {
    setOpportunityCard("actionOpportunityCard", "actionOpportunityTitle", "actionOpportunityMeta", "actionOpportunityBtn", {
      title: "扩仓接下一波",
      meta: `仓位 ${expandOpp.items}/${expandOpp.capacity}，${cny(expandOpp.cost)} 到 ${expandOpp.target}`,
      reason: actionReasonWithBounty(`扩到 ${expandOpp.target}，下波多装`, "expand", expandOpp),
      button: "去扩仓",
      tone: "good",
    });
  } else if (travelLoc) {
    setOpportunityCard("actionOpportunityCard", "actionOpportunityTitle", "actionOpportunityMeta", "actionOpportunityBtn", {
      title: `去${game.cityLabels[travelLoc - 1]}`,
      meta: game.rumorBuff?.targetLoc === travelLoc ? "跟随刚买到的传闻" : "换站刷新行情",
      reason: actionReasonWithBounty(game.rumorBuff?.targetLoc === travelLoc ? "传闻有效，赶紧过去" : "换站找下一波", "travel", { loc: travelLoc }),
      button: "换一站",
      tone: "wait",
    });
  } else {
    setOpportunityCard("actionOpportunityCard", "actionOpportunityTitle", "actionOpportunityMeta", "actionOpportunityBtn", {
      title: "本局结束",
      meta: "看看成绩再来一局",
      reason: actionReasonWithBounty("看完结算，带着目标重开", "end"),
      button: "已结束",
      disabled: true,
      tone: "wait",
    });
  }
  syncThumbActionFromPrimary();
}
function showNextModal() {
  const modal = q("eventModal");
  const body = q("eventBody");
  if (modalQueue.length === 0) {
    modal.classList.add("hidden");
    body.textContent = "";
    if (pendingNewsCampaignContext) {
      const context = pendingNewsCampaignContext;
      pendingNewsCampaignContext = null;
      void deliverCampaign("news", context);
    }
    return;
  }
  body.textContent = modalQueue.shift();
  modal.classList.remove("hidden");
}
function safeCampaignUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_error) {
    return "";
  }
}
function campaignDisclosure(campaign) {
  return String(campaign?.disclosure_label || campaign?.payload?.disclosure_label || "合作内容").trim().slice(0, 24) || "合作内容";
}
function openCampaignModal(campaign, context = {}) {
  if (!campaign) return;
  activeCampaign = { ...campaign, __context: { ...context } };
  if (q("campaignDisclosureLabel")) q("campaignDisclosureLabel").textContent = campaignDisclosure(campaign);
  q("campaignTitle").textContent = campaign.title || "本地合作信息";
  q("campaignBody").textContent = campaign.body || "";
  const action = q("campaignActionBtn");
  const actionUrl = safeCampaignUrl(campaign.action_url);
  action.textContent = campaign.action_label || "查看详情";
  action.classList.toggle("hidden", !actionUrl);
  action.dataset.url = actionUrl;
  q("campaignModal")?.classList.remove("hidden");
}
function showCampaignSlot(campaign, placement, context = {}) {
  const slot = q("productSponsorSlot");
  if (!slot) return;
  slot.textContent = `${campaignDisclosure(campaign)} · ${campaign.title || "本地合作信息"}`;
  slot.dataset.placement = placement;
  slot.closest(".mobile-trade-info")?.classList.add("has-sponsor");
  slot.onclick = () => {
    void window.BFSJ_PLATFORM?.recordCampaignEvent?.(campaign, "click", { placement, action: "open_detail", ...context });
    openCampaignModal(campaign, { placement, ...context });
  };
}
function clearCampaignSlot() {
  const slot = q("productSponsorSlot");
  if (!slot) return;
  slot.textContent = "";
  slot.dataset.placement = "";
  slot.closest(".mobile-trade-info")?.classList.remove("has-sponsor");
  slot.onclick = null;
}
async function deliverCampaign(placement, context = {}) {
  const api = window.BFSJ_PLATFORM;
  const campaign = api?.pickCampaign?.(placement, context);
  if (!campaign) {
    if (placement === "product" || placement === "location") clearCampaignSlot();
    return null;
  }
  await api.recordCampaignEvent(campaign, "eligible", { placement, ...context });
  await api.recordCampaignEvent(campaign, "impression", { placement, ...context });
  if (placement === "product" || placement === "location") {
    showCampaignSlot(campaign, placement, context);
  } else {
    openCampaignModal(campaign, { placement, ...context });
  }
  return campaign;
}
function maybeDeliverProductCampaign(goodsId) {
  if (goodsId == null || String(goodsId) === String(lastProductCampaignGoodsId)) return;
  lastProductCampaignGoodsId = goodsId;
  void deliverCampaign("product", { goods_id: goodsId });
}
function maybeDeliverLocationCampaign(locationId) {
  if (locationId == null) return;
  void deliverCampaign("location", { location_id: locationId });
}
function showStartModal() {
  const modal = q("startModal");
  if (!modal) return;
  q("startGoalCard")?.classList.remove("hidden");
  renderStartGoalCard();
  modal.classList.remove("hidden");
  startPromptShown = true;
}
function closeStartModal() {
  const modal = q("startModal");
  if (!modal) return;
  modal.classList.add("hidden");
}
function playtestFeedbackEnabled() {
  const platform = window.BFSJ_PLATFORM?.runtime;
  const experimentEnabled = platform?.experiment?.config?.collectFeedback === true;
  const cityEnabled = platform?.city?.config?.playtest_feedback_enabled === true;
  const localQa = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    && new URLSearchParams(window.location.search).get("qa_feedback") === "1";
  return experimentEnabled || cityEnabled || localQa;
}
function feedbackRatingRow(name, label) {
  const choices = [1, 2, 3, 4, 5].map((value) => `
    <label class="feedback-score">
      <input type="radio" name="${name}" value="${value}" required />
      <span>${value}</span>
    </label>
  `).join("");
  return `<div class="feedback-rating-row"><strong>${label}</strong><div class="feedback-score-scale">${choices}</div></div>`;
}
function playtestFeedbackMarkup() {
  if (!playtestFeedbackEnabled() || endFeedbackSubmittedRunId === runId) return "";
  return `
<details id="endFeedbackCard" class="end-feedback-card">
  <summary>留下 30 秒试玩反馈</summary>
  <form id="endFeedbackForm" class="end-feedback-form">
    <div class="feedback-scale-caption"><span>1 低</span><span>5 高</span></div>
    ${feedbackRatingRow("surprise", "惊喜")}
    ${feedbackRatingRow("satisfaction", "满足")}
    ${feedbackRatingRow("agency", "我做主")}
    ${feedbackRatingRow("fairness", "公平")}
    ${feedbackRatingRow("replay_intent", "想再来")}
    ${feedbackRatingRow("share_intent", "想分享")}
    <label class="feedback-text-field">最记得的瞬间
      <textarea name="memorable_moment" maxlength="500" rows="2" placeholder="一条新闻、一次翻盘或一个离谱瞬间"></textarea>
    </label>
    <label class="feedback-quit-field">第一次想退出是第几天
      <input name="quit_day" type="number" min="0" max="45" inputmode="numeric" placeholder="没有就留空" />
    </label>
    <button id="endFeedbackSubmitBtn" type="submit">提交反馈</button>
    <p id="endFeedbackStatus" class="feedback-status" aria-live="polite"></p>
  </form>
</details>`;
}
function wirePlaytestFeedbackForm() {
  const form = q("endFeedbackForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = q("endFeedbackSubmitBtn");
    const status = q("endFeedbackStatus");
    if (button) button.disabled = true;
    if (status) status.textContent = "提交中...";
    const values = new FormData(form);
    const numeric = (name) => Number(values.get(name) || 0);
    const result = await window.BFSJ_PLATFORM?.submitPlaytestFeedback?.({
      score: game.score,
      days_used: game.daysUsed,
      surprise: numeric("surprise"),
      satisfaction: numeric("satisfaction"),
      agency: numeric("agency"),
      fairness: numeric("fairness"),
      replay_intent: numeric("replay_intent"),
      share_intent: numeric("share_intent"),
      quit_day: String(values.get("quit_day") || ""),
      memorable_moment: String(values.get("memorable_moment") || "").trim(),
    });
    endFeedbackSubmittedRunId = runId;
    if (status) status.textContent = result?.ok ? "已收到，谢谢。" : "已保存在本机，联网后自动提交。";
    form.querySelectorAll("input, textarea").forEach((element) => { element.disabled = true; });
    if (button) {
      button.disabled = true;
      button.textContent = result?.ok ? "已提交" : "已保存";
    }
  });
}
function showEndModal() {
  const modal = q("endModal");
  const body = q("endSummaryBody");
  if (!modal || !body) return;
  setDebtGuideGlow(false);
  hideDebtGuideTip();
  hideExpandGuideTip();
  if (runEndedElapsedSeconds == null) runEndedElapsedSeconds = getRunElapsedSeconds();
  const daysUsed = game.daysUsed;
  const net = game.cash + game.bank - game.debt;
  const stats = recordLocalRunStats();
  const bestLabel = stats.isNewBest
    ? `本机新纪录：<strong>${cny(stats.bestScore)}</strong>`
    : `本机最佳：<strong>${cny(stats.bestScore || 0)}</strong>`;
  const grade = runGrade(game.score);
  const comparison = previousRunComparison(game.score, stats);
  const nextGoal = nextRunGoal(game.score, stats);
  const challenge = nextRunChallenge({ score: game.score, debt: game.debt, stats });
  const openingPlan = nextRunOpeningPlan({ nextGoal, challenge });
  const bountyStatus = runBountyStatus();
  if (q("endReplayBtn")) q("endReplayBtn").textContent = "再来一局";
  const badges = runBadges({ score: game.score, debt: game.debt, daysUsed });
  const bestStreak = Math.max(maxProfitStreak, Number(stats.bestStreak || 0));
  const bestSingleProfit = Math.max(runBestProfit, Number(stats.bestSingleProfit || 0));
  const bestSingleProfitGoods = stats.bestSingleProfitGoods || runBestProfitGoods || "";
  const paceHit = runEndedElapsedSeconds <= TARGET_SESSION_MINUTES * 60;
  const runHighlightHtml = [
    careerStatCard("本局用时", `${formatDuration(runEndedElapsedSeconds)} / ${TARGET_SESSION_MINUTES}:00`, paceHit ? "节奏命中" : "慢热一局", paceHit),
    careerStatCard("最高连赚", `x${maxProfitStreak}`, maxProfitStreak >= 8 ? "连续兑现" : "再冲连赚", maxProfitStreak >= 8),
    careerStatCard("最大单笔", runBestProfit > 0 ? cnyCompact(runBestProfit) : "暂无", runBestProfitGoods || "爆款记录", runBestProfit >= 200000),
  ].join("");
  const careerHtml = [
    careerStatCard("完成局数", String(stats.runs), "本机累计", false),
    careerStatCard("最高分", cny(stats.bestScore || 0), stats.isNewBest ? "新纪录" : "本机最佳", stats.isNewBest),
    careerStatCard("最佳连赚", `x${bestStreak}`, stats.isNewBestStreak ? "新纪录" : "连续兑现", Boolean(stats.isNewBestStreak)),
    careerStatCard("最大单笔", bestSingleProfit > 0 ? cnyCompact(bestSingleProfit) : "暂无", stats.isNewBestSingleProfit ? "新纪录" : (bestSingleProfitGoods || "爆款记录"), Boolean(stats.isNewBestSingleProfit)),
  ].join("");
  const badgeHtml = badges.map((badge) => `
    <span class="end-badge">
      <strong>${escapeHtml(badge.label)}</strong>
      <small>${escapeHtml(badge.note)}</small>
    </span>
  `).join("");
  const shareText = buildShareText(stats);
  body.innerHTML = `
<div class="end-hero-card grade-${grade.key}">
  <div class="end-hero-main">
    <div class="end-hero-grade">
      <span>本局评级</span>
      <strong>${grade.label}</strong>
      <small>${grade.caption}</small>
    </div>
    <div class="end-hero-score">
      <span>总分</span>
      <strong>${cny(game.score)}</strong>
      <small>${bestLabel}</small>
    </div>
  </div>
  <div class="end-hero-goals">
    <div class="end-next-goal">
      <span>${nextGoal.title}</span>
      <strong>${nextGoal.value}</strong>
      <small>${nextGoal.hint}</small>
    </div>
    <div class="end-compare-card compare-${comparison.tone}">
      <span>上局对比</span>
      <strong>${escapeHtml(comparison.value)}</strong>
      <small>${escapeHtml(comparison.hint)}</small>
    </div>
  </div>
</div>
<div class="end-bounty-card">
  <span>${bountyStatus.title}</span>
  <strong>${escapeHtml(bountyStatus.value)}</strong>
  <small>${escapeHtml(bountyStatus.result)} ｜ ${escapeHtml(bountyStatus.hint)}</small>
</div>
<div class="end-challenge-card">
  <span>${challenge.title}</span>
  <strong>${challenge.value}</strong>
  <small>${challenge.hint}</small>
</div>
${cityExpansionCardHtml(game.score)}
<div class="end-opening-plan">
  <span>下一局起手计划</span>
  <ol>${openingPlan.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>
</div>
${playtestFeedbackMarkup()}
<div class="end-share-card">
  <span>微信战报</span>
  <p>${escapeHtml(shareText)}</p>
</div>
<div class="end-run-card">
  <span class="end-career-title">本局高光</span>
  <div class="end-career-grid">${runHighlightHtml}</div>
</div>
<div class="end-career-card">
  <span class="end-career-title">本机生涯</span>
  <div class="end-career-grid">${careerHtml}</div>
</div>
<div class="end-badges">
  <span class="end-badges-title">本局徽章</span>
  <div class="end-badge-list">${badgeHtml}</div>
</div>
<div class="end-summary-lines">
  <p>净资产：<strong>${cny(net)}</strong></p>
  <p>现金：${cny(game.cash)} ｜ 存款：${cny(game.bank)} ｜ 欠债：${cny(game.debt)}</p>
  <p>生存天数：${daysUsed}/${TOTAL_DAYS}</p>
  <p>结束原因：${endedReasonText()}</p>
  <p>${bestLabel}</p>
</div>
  `.trim();
  wirePlaytestFeedbackForm();
  modal.classList.remove("hidden");
}
function closeEndModal() {
  const modal = q("endModal");
  if (!modal) return;
  modal.classList.add("hidden");
}
function renderMarketTable(buyOpp) {
  const tb = document.querySelector("#marketTable tbody");
  if (!tb) return;
  tb.innerHTML = "";
  const invSet = new Set(game.inv.map((x) => x.id));
  const visibleRows = game.market.slice(0, MARKET_BUY_DISPLAY_LIMIT);
  visibleRows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.style.setProperty("--row-index", String(idx));
    if (row.id === selectedMarket) tr.classList.add("selected");
    if (invSet.has(row.id)) tr.classList.add("owned");
    if (buyOpp?.id === row.id) tr.classList.add("deal-buy-row");
    tr.addEventListener("click", () => {
      selectedMarket = row.id;
      selectedInv = null;
      setMobileTradeMode("buy", true);
      prefillTradeCounts({ buy: true });
      render();
      maybeDeliverProductCampaign(row.id);
    });
    const tdName = document.createElement("td");
    tdName.innerHTML = `<span>${escapeHtml(row.name)}</span>`;
    const tdPrice = document.createElement("td");
    const tag = row.marketTag ? `<small class="price-tag">${escapeHtml(row.marketTag)}</small>` : "";
    tdPrice.innerHTML = `<strong>${cny(row.price)}</strong>${tag}`;
    tr.appendChild(tdName);
    tr.appendChild(tdPrice);
    tb.appendChild(tr);
  });
}
function renderInventoryTable(sellOpp) {
  const tb = document.querySelector("#invTable tbody");
  if (!tb) return;
  tb.innerHTML = "";
  let totalCost = 0;
  let totalValue = 0;
  if (game.inv.length === 0) {
    const summary = q("invSummary");
    if (summary) summary.innerHTML = `<span class="empty-position">暂无持仓</span>`;
    tb.innerHTML = `<tr class="empty-row"><td colspan="3">暂无持仓</td></tr>`;
    return;
  }
  for (const row of game.inv) {
    const tr = document.createElement("tr");
    if (row.id === selectedInv) tr.classList.add("selected");
    tr.addEventListener("click", () => {
      selectedInv = row.id;
      selectedMarket = null;
      setMobileTradeMode("sell", true);
      prefillTradeCounts({ sell: true });
      render();
    });
    const quote = game.previewSell(row.id, row.count);
    if (quote.ok) tr.classList.add("sellable-row");
    const cost = row.buyPrice * row.count;
    const value = quote.ok ? quote.total : 0;
    totalCost += cost;
    if (quote.ok) totalValue += value;

    const tdName = document.createElement("td");
    tdName.innerHTML = `<span>${escapeHtml(row.name)}</span>${quote.ok ? '<small class="deal-badge">可卖</small>' : '<small class="price-tag">本地不收</small>'}`;
    const tdPos = document.createElement("td");
    tdPos.textContent = String(row.count);
    const tdPnl = document.createElement("td");
    tdPnl.textContent = cny(row.buyPrice);
    tr.appendChild(tdName);
    tr.appendChild(tdPos);
    tr.appendChild(tdPnl);
    tb.appendChild(tr);
  }
  const summary = q("invSummary");
  if (summary) {
    const totalPnl = totalValue - totalCost;
    const pnlCls = totalPnl >= 0 ? "pnl-up" : "pnl-down";
    summary.innerHTML = `
      <span>总成本 ${cny(totalCost)}</span>
      <span>本地可卖 ${cny(totalValue)}</span>
      <span class="${pnlCls}">按本地价 ${totalPnl >= 0 ? "+" : ""}${cny(totalPnl)}</span>
    `;
  }
}
function closeMobileMenu() {
  const card = q("mobileMenuCard");
  if (!card) return;
  mobileMenuOpen = false;
  card.classList.add("hidden");
}
function toggleMobileMenu() {
  const card = q("mobileMenuCard");
  if (!card) return;
  mobileMenuOpen = !mobileMenuOpen;
  card.classList.toggle("hidden", !mobileMenuOpen);
}
function startNewGameFlow(options = {}) {
  const { showIntro = false } = options;
  clearActiveRunSnapshot();
  activeRunRestored = false;
  applyPendingCityContentForNewRun();
  game.newGame();
  selectedMarket = null;
  selectedInv = null;
  setMobileTradeMode("buy", true);
  runId += 1;
  window.BFSJ_PLATFORM?.beginRun?.();
  savedRunId = null;
  saveFailedRunId = null;
  runUploadConsent = null;
  endFeedbackSubmittedRunId = null;
  guestRunClaimToken = null;
  runPublished = false;
  pendingNewsCampaignContext = null;
  lastCampaignNewsDay = -1;
  lastRecordedEndStatsRunId = null;
  runStartedAtMs = Date.now();
  runEndedElapsedSeconds = null;
  runPrimaryActionCount = 0;
  lastCelebratedTradeKey = null;
  lastTradeFeedbackKey = null;
  lastPrimaryBuyDay = null;
  lastExpansionPromptDay = null;
  endPromptRunId = null;
  profitStreak = 0;
  maxProfitStreak = 0;
  runBestProfit = 0;
  runBestProfitGoods = "";
  lastNetWorthMilestone = 0;
  lastGoalMomentKey = "";
  currentRunBounty = buildRunBounty();
  lastBountyCompletedKey = "";
  startPromptShown = !showIntro;
  debtGuideDismissed = false;
  debtGuideShown = false;
  marketRefreshPending = false;
  lastDebtGuideTradeKey = null;
  lastBuyHundredTradeKey = null;
  expandGuideDismissed = false;
  lastMapRenderKey = "";
  lastPlaceDockRenderKey = "";
  careerStageAnnouncement = "";
  setDebtGuideGlow(false);
  hideDebtGuideTip();
  hideExpandGuideTip();
  closeRepayModal();
  closeEndModal();
  closeGuestSaveModal();
  closeMobileMenu();
  render();
}
function renderMap() {
  const c = q("mapButtons");
  if (!c) return;
  const key = `${isMobileUi ? "m" : "d"}::${locationRenderKey()}`;
  if (key === lastMapRenderKey && c.childElementCount > 0) return;
  lastMapRenderKey = key;
  c.innerHTML = "";
  const order = ["xihu", "shangcheng", "gongshu", "binjiang", "yuhang", "xiaoshan", "qiantang"];
  const grouped = {};
  for (const key of order) grouped[key] = [];
  game.cityLabels.forEach((name, idx) => {
    const district = game.locationDistricts[idx] || "shangcheng";
    if (!grouped[district]) grouped[district] = [];
    grouped[district].push({ idx, name });
  });
  for (const district of order) {
    const spots = grouped[district];
    if (!spots || spots.length === 0) continue;
    const block = document.createElement("section");
    block.className = `district-block district-${district}`;
    const title = document.createElement("h3");
    title.className = "district-title";
    title.textContent = game.districtLabels[district];
    const wrap = document.createElement("div");
    wrap.className = "district-items";
    for (const spot of spots) {
      const b = document.createElement("button");
      b.textContent = spot.name;
      b.className = "map-btn";
      b.classList.add(`district-${district}`);
      if (game.currentLoc === spot.idx + 1) b.classList.add("active");
      b.addEventListener("click", () => { travelToLocation(spot.idx + 1); });
      wrap.appendChild(b);
    }
    block.appendChild(title);
    block.appendChild(wrap);
    c.appendChild(block);
  }
}
function fireProfit(pnl) {
  if (pnl < 600000) return;
  const host = document.createElement("div");
  host.className = "fireworks";
  document.body.appendChild(host);
  const colors = ["#ffd166", "#ef476f", "#06d6a0", "#118ab2", "#f78c6b", "#f1f5ff"];
  const centers = [
    [22, 28], [50, 22], [78, 30],
    [30, 56], [70, 58],
  ];
  for (const [cx, cy] of centers) {
    const bursts = 84;
    for (let i = 0; i < bursts; i++) {
      const el = document.createElement("span");
      const angle = (Math.PI * 2 * i) / bursts;
      const radius = 90 + Math.random() * 220;
      el.className = "firework";
      el.style.left = `${cx + (Math.random() * 5 - 2.5)}%`;
      el.style.top = `${cy + (Math.random() * 5 - 2.5)}%`;
      el.style.setProperty("--dx", `${Math.cos(angle) * radius}px`);
      el.style.setProperty("--dy", `${Math.sin(angle) * radius}px`);
      el.style.animationDelay = `${Math.random() * 0.7}s`;
      el.style.background = colors[(i + Math.floor(Math.random() * colors.length)) % colors.length];
      host.appendChild(el);
    }
  }
  setTimeout(() => host.remove(), 4300);
}
function pulseCashHeadline() {
  const el = q("cashHeadline");
  if (!el) return;
  el.classList.remove("cash-pulse");
  void el.offsetWidth;
  el.classList.add("cash-pulse");
}
function pulseRoundProgress() {
  const el = q("roundProgress");
  if (!el) return;
  el.classList.remove("combo-pop");
  void el.offsetWidth;
  el.classList.add("combo-pop");
}
function currentNetWorthMilestone(net) {
  const value = Math.max(0, Number(net) || 0);
  let milestone = 0;
  for (const mark of NET_WORTH_MILESTONES) {
    if (value >= mark) milestone = mark;
  }
  if (value >= 100000000) milestone = Math.floor(value / 100000000) * 100000000;
  return milestone;
}
function maybeShowNetWorthMilestone(net) {
  if (game.gameOver) return false;
  const milestone = currentNetWorthMilestone(net);
  if (!milestone || milestone <= lastNetWorthMilestone) return false;
  lastNetWorthMilestone = milestone;
  softTap([8, 24, 8]);
  pulseCashHeadline();
  showSaveBanner(`身价突破 ${cny(milestone)}，节奏起来了。`, 2600);
  return true;
}
function maybeShowGoalMoment(net) {
  if (game.gameOver || game.daysUsed < 2) return false;
  const goal = activeRunGoalState(net);
  if (goal.type !== "near-grade" && goal.type !== "record") return false;
  const key = `${goal.type}:${goal.target}`;
  if (key === lastGoalMomentKey) return false;
  lastGoalMomentKey = key;
  softTap(goal.type === "record" ? [10, 30, 10] : [8, 20, 8]);
  pulseRoundProgress();
  if (goal.type === "record") {
    showSaveBanner(`快破纪录了：再多 ${cny(goal.gap)} 刷新本机最佳。`, 2800);
  } else {
    showSaveBanner(`快升档了：再多 ${cny(goal.gap)} 到 ${cny(goal.target)}。`, 2600);
  }
  return true;
}
function updateRoundProgressUi() {
  const elapsed = getRunElapsedSeconds();
  const net = game.cash + game.bank - game.debt;
  const goal = activeRunGoalState(net);
  const bounty = runBountyStatus();
  const goalProgress = gradeProgressPercent(net);
  if (game.gameOver && runEndedElapsedSeconds == null) runEndedElapsedSeconds = elapsed;
  if (q("roundProgressText")) q("roundProgressText").textContent = `${game.daysUsed}/${TOTAL_DAYS} 天 · 已用 ${formatDuration(elapsed)}`;
  if (q("roundPaceText")) q("roundPaceText").textContent = paceStatusText(elapsed);
  if (q("roundGoalText")) q("roundGoalText").textContent = goal.full;
  if (q("roundBountyText")) q("roundBountyText").textContent = bounty.text;
  if (q("roundStreakText")) q("roundStreakText").textContent = streakStatusText();
  if (q("roundProgressFill")) {
    const pct = Math.max(0, Math.min(100, (game.daysUsed / TOTAL_DAYS) * 100));
    q("roundProgressFill").style.width = `${pct}%`;
  }
  if (q("roundGoalProgressFill")) {
    q("roundGoalProgressFill").style.width = `${goalProgress}%`;
    q("roundGoalProgressTrack")?.setAttribute("aria-valuenow", String(goalProgress));
  }
}
function updateCareerProgressUi() {
  const previousIndex = Math.max(0, Number(game.careerStageIndex) || 0);
  const state = getCareerStageState(game.score, previousIndex);
  if (state.index > previousIndex) {
    game.careerStageIndex = state.index;
    careerStageAnnouncement = `经营阶段晋升：${state.stage.name}`;
    game.addLog(careerStageAnnouncement, "career_stage", {
      stage_id: state.stage.id,
      stage_index: state.index,
      score: game.score,
    });
    const card = q("careerProgress");
    card?.classList.remove("stage-up");
    if (card) void card.offsetWidth;
    card?.classList.add("stage-up");
  }
  if (q("careerStageName")) q("careerStageName").textContent = state.stage.name;
  if (q("careerStageHint")) {
    q("careerStageHint").textContent = state.next
      ? `${state.stage.focus} · 还差 ${cnyCompact(state.gap)}`
      : state.stage.focus;
  }
  if (q("careerStageSteps")) {
    q("careerStageSteps").innerHTML = CAREER_STAGES.map((stage, index) => {
      const status = index < state.index ? "done" : index === state.index ? "current" : "locked";
      return `<span class="career-stage-step ${status}" title="${escapeHtml(stage.name)}"><i></i><b>${escapeHtml(stage.name)}</b></span>`;
    }).join("");
  }
  if (q("careerStageFill")) q("careerStageFill").style.width = `${state.progress}%`;
  q("careerStageTrack")?.setAttribute("aria-valuenow", String(Math.round(state.progress)));
  q("careerProgress")?.setAttribute("aria-label", `杭州经营阶段：${state.stage.name}`);
}
function render() {
  let bannerShownThisRender = false;
  q("dayText").textContent = isMobileUi ? `第${game.daysUsed}/${TOTAL_DAYS}天` : game.dayText;
  if (q("topRoundPill")) q("topRoundPill").textContent = `第${game.daysUsed}/${TOTAL_DAYS}天`;
  q("scoreText").textContent = cny(game.score);
  updateOnlineUi();
  const net = game.cash + game.bank - game.debt;
  if (q("cashHeadline")) q("cashHeadline").textContent = cny(game.cash);
  if (q("netWorth")) q("netWorth").textContent = cny(net);
  q("cash").textContent = cny(game.cash);
  q("bank").textContent = cny(game.bank);
  q("debt").textContent = cny(game.debt);
  q("health").textContent = String(game.health);
  q("fame").textContent = String(game.fame);
  q("items").textContent = `${game.totalItems}/${game.coat}`;
  if (q("miniCash")) q("miniCash").textContent = cny(game.cash);
  if (q("miniDebt")) q("miniDebt").textContent = cny(game.debt);
  if (q("miniItems")) q("miniItems").textContent = `${game.totalItems}/${game.coat}`;
  if (q("warehouseCapacityBtn")) q("warehouseCapacityBtn").textContent = `仓位 ${game.totalItems}/${game.coat}`;
  if (q("miniDays")) q("miniDays").textContent = `剩${game.timeLeft}天`;
  updateStatusGuideBadges();
  if (q("mobileTopCash")) q("mobileTopCash").textContent = `现金 ${cny(game.cash)}`;
  updateRoundProgressUi();
  updateCareerProgressUi();
  if (q("currentLocBadge")) {
    q("currentLocBadge").textContent = game.currentLoc > 0 ? game.cityLabels[game.currentLoc - 1] : "未出发";
  }
  if (q("marketPanel")) q("marketPanel").classList.toggle("market-loc-active", game.currentLoc > 0);
  if (game.debt <= 0) {
    setDebtGuideGlow(false);
    hideDebtGuideTip();
  }
  if (q("newsDayTag")) q("newsDayTag").textContent = `第${game.daysUsed}天`;
  if (q("newsHeadline")) q("newsHeadline").textContent = game.todayNews?.title || "【市场平稳】";
  if (q("topNewsTicker")) q("topNewsTicker").textContent = game.todayNews?.title || "【市场平稳】今天没有重磅消息。";
  if (q("miniTickerText")) {
    const latestLog = Array.isArray(game.logs) && game.logs.length ? game.logs[game.logs.length - 1] : "";
    const newsText = game.todayNews?.title
      ? `${game.todayNews.title} ${game.todayNews?.desc || ""}`.trim()
      : "市场观察中";
    q("miniTickerText").textContent = latestLog && !String(latestLog).startsWith("新游戏开始") ? latestLog : newsText;
  }
  if (q("newsDesc")) q("newsDesc").textContent = game.todayNews?.desc || "暂无重磅新闻。";
  if (q("newsEffects")) {
    const effects = game.todayNews?.effects || [];
    q("newsEffects").innerHTML = effects.length
      ? effects
          .map((effect) => {
            const pctClass = effect.pct >= 0 ? "up" : "down";
            const pctText = `${effect.pct >= 0 ? "+" : ""}${effect.pct}%`;
            const tags = (effect.tags || []).join(" / ");
            return `<div class="news-effect-row ${pctClass}">
              <strong>${escapeHtml(effect.name)}</strong>
              <span>${pctText}</span>
              <small>${escapeHtml(tags || "波动")}</small>
            </div>`;
          })
          .join("")
      : `<div class="news-effect-row flat"><strong>暂无指定商品</strong><span>0%</span><small>区域价差主导</small></div>`;
  }
  q("mapTitle").textContent = isMobileUi ? "换地方（点击站点移动一天）" : "杭州市全地点示意图（点击站点移动一天）";
  prefillRepayAll();
  game.ensureInventoryMarketQuotes();

  if (selectedMarket != null && !game.market.some((x) => x.id === selectedMarket)) selectedMarket = null;
  if (selectedInv != null && !game.inv.some((x) => x.id === selectedInv)) selectedInv = null;
  if (selectedMarket == null && selectedInv == null && game.market.length > 0 && !game.gameOver) {
    selectedMarket = game.market[0].id;
    setMobileTradeMode("buy", false);
  }

  renderMarketTable(null);
  renderInventoryTable(null);
  if (marketRefreshPending && q("marketPanel")) {
    const panel = q("marketPanel");
    panel.classList.remove("market-refresh");
    void panel.offsetWidth;
    panel.classList.add("market-refresh");
    if (marketRefreshTimer) clearTimeout(marketRefreshTimer);
    marketRefreshTimer = setTimeout(() => {
      panel.classList.remove("market-refresh");
      marketRefreshTimer = null;
    }, 680);
    marketRefreshPending = false;
  }

  renderMap();
  renderPlaceDockGrid();

  const buyCap = selectedMarket != null ? maxBuyCount(selectedMarket) : 0;
  const sellCap = selectedInv != null ? maxSellCount(selectedInv) : 0;
  if (q("buyMaxBtn")) {
    q("buyMaxBtn").disabled = buyCap <= 0;
    q("buyMaxBtn").textContent = buyCap > 0 ? `最大买入 ${buyCap}` : "最大买入";
  }
  if (q("sellMaxBtn")) {
    q("sellMaxBtn").disabled = sellCap <= 0;
    q("sellMaxBtn").textContent = sellCap > 0 ? `全部卖出 ${sellCap}` : "全部卖出";
  }
  if (q("quickTravelBtn")) {
    const loc = suggestedTravelLocation();
    q("quickTravelBtn").disabled = !loc || game.gameOver;
    q("quickTravelBtn").textContent = loc ? `去${game.cityLabels[loc - 1]}` : "换一站";
  }
  if (q("tradeHint")) {
    const buyText = selectedMarket == null ? "先在黑市选商品" : `最多可买 ${buyCap}`;
    const sellText = selectedInv == null ? "先在持仓选商品" : `最多可卖 ${sellCap}`;
    q("tradeHint").textContent = `${buyText} ｜ ${sellText}`;
  }
  const buyOpp = bestBuyOpportunity();
  const sellOpp = bestSellOpportunity();
  renderOpportunityStrip(buyOpp, sellOpp);
  renderMobileTradeDock();

  if (game.lastTrade?.type === "sell") {
    const t = game.lastTrade;
    const tradeKey = `${runId}:${t.goodsId}:${t.count}:${t.total}:${t.pnl}`;
    if (lastTradeFeedbackKey !== tradeKey) {
      lastTradeFeedbackKey = tradeKey;
      const pnl = Number(t.pnl || 0);
      if (pnl > 0) {
        profitStreak += 1;
        maxProfitStreak = Math.max(maxProfitStreak, profitStreak);
        const wasRunBestProfit = pnl > runBestProfit;
        if (pnl > runBestProfit) {
          runBestProfit = pnl;
          runBestProfitGoods = t.goods || "";
        }
        softTap([10, 28, 14]);
        updateRoundProgressUi();
        pulseRoundProgress();
        const streakText = profitStreak >= 2 ? ` 连赚 x${profitStreak}。` : "";
        const bestText = wasRunBestProfit ? " 本局最大单笔新高。" : "";
        const gapText = ` ${nextGradeGapHint(game.cash + game.bank - game.debt)}。`;
        showSaveBanner(`赚了 ${cny(pnl)}，漂亮兑现。${streakText}${bestText}${gapText}`, 2800);
        bannerShownThisRender = true;
      } else if (pnl < 0) {
        profitStreak = 0;
        updateRoundProgressUi();
        softTap(18);
        showSaveBanner(`止损 ${cny(Math.abs(pnl))}，换个机会。`, 2300, "error");
        bannerShownThisRender = true;
      } else {
        profitStreak = 0;
      }
    }
    if (lastCelebratedTradeKey !== tradeKey && Number(t.pnl || 0) >= 600000) {
      lastCelebratedTradeKey = tradeKey;
      fireProfit(t.pnl);
      pulseCashHeadline();
    }
  }
  if (game.lastTrade?.type === "buy") {
    const t = game.lastTrade;
    const tradeKey = `${runId}:${t.goodsId}:${t.count}:${t.total}`;
    if (t.count >= 100 && lastBuyHundredTradeKey !== tradeKey) {
      lastBuyHundredTradeKey = tradeKey;
      showSaveBanner(`你这笔买入已达 ${t.count} 件，注意仓位和现金节奏。`, 2600);
      bannerShownThisRender = true;
    }
  }
  if (!bannerShownThisRender) bannerShownThisRender = maybeShowNetWorthMilestone(net);
  if (!bannerShownThisRender && careerStageAnnouncement) {
    showSaveBanner(`${careerStageAnnouncement}，新的经营目标已更新。`, 3000);
    careerStageAnnouncement = "";
    bannerShownThisRender = true;
  }
  q("logs").innerHTML = game.logs.slice().reverse().map((x) => `<div>${x}</div>`).join("");

  if (game.lastMarketPopups && game.lastMarketPopups.length > 0) {
    if (ENABLE_RANDOM_EVENT_POPUPS) {
      modalQueue.push(...game.lastMarketPopups);
      showNextModal();
    }
    game.lastMarketPopups = [];
  }
  if (game.lastNewsPopups && game.lastNewsPopups.length > 0) {
    const newsDay = game.daysUsed;
    if (lastCampaignNewsDay !== newsDay) {
      lastCampaignNewsDay = newsDay;
      if (Math.random() < 0.38) {
        pendingNewsCampaignContext = { day: newsDay, trigger: "market_news" };
      }
    }
    modalQueue.push(...game.lastNewsPopups);
    showNextModal();
    game.lastNewsPopups = [];
  }
  if (game.rumor && game.rumor.msg) {
    if (ENABLE_RANDOM_EVENT_POPUPS) {
      modalQueue.push(`社交情报：\\n${game.rumor.msg}`);
      showNextModal();
    }
    game.rumor = null;
  }
  if (!game.gameOver && !startPromptShown) showStartModal();
  if (game.gameOver && endPromptRunId !== runId) {
    endPromptRunId = runId;
    showEndModal();
  }
  if (game.gameOver && savedRunId !== runId && saveFailedRunId !== runId) saveRunToCloud();
  writeActiveRunSnapshot();
  trackPresence();
}
function executeBuyOpportunity() {
  const opp = bestBuyOpportunity();
  if (!opp) {
    showSaveBanner("现在没有足够好的低买机会，换一站看看。", 2200, "error");
    return false;
  }
  selectedMarket = opp.id;
  softTap();
  game.buy(opp.id, opp.max);
  prefillTradeCounts({ buy: true });
  render();
  return true;
}
function executeSellOpportunity() {
  const opp = bestSellOpportunity();
  if (!opp) {
    showSaveBanner("当前持仓还没有盈利机会。", 2200, "error");
    return false;
  }
  selectedInv = opp.id;
  softTap([10, 28, 14]);
  game.sell(opp.id, opp.count);
  prefillTradeCounts({ sell: true });
  render();
  return true;
}
function executeDebtRepayOpportunity() {
  const opp = debtRepayOpportunity();
  if (!opp) {
    showSaveBanner("当前现金还不适合还债，先继续找机会。", 2200, "error");
    return false;
  }
  const before = game.debt;
  softTap([8, 18]);
  const paid = game.smartRepay();
  if (paid <= 0 || game.debt >= before) {
    showSaveBanner("当前现金还不适合还债，先继续找机会。", 2200, "error");
    render();
    return false;
  }
  clearDebtGuide();
  showSaveBanner(`已还债 ${cny(paid)}，利息压力下来了。`, 2400);
  render();
  return true;
}
function executePrimaryOpportunity() {
  if (game.gameOver) {
    startNewGameFlow();
    return;
  }
  if (bestSellOpportunity()) {
    executeSellOpportunity();
    return;
  }
  if (debtRepayOpportunity()) {
    executeDebtRepayOpportunity();
    return;
  }
  if (bestBuyOpportunity() && lastPrimaryBuyDay !== game.daysUsed) {
    const previousPrimaryBuyDay = lastPrimaryBuyDay;
    lastPrimaryBuyDay = game.daysUsed;
    if (!executeBuyOpportunity()) lastPrimaryBuyDay = previousPrimaryBuyDay;
    return;
  }
  if (expansionOpportunity()) {
    lastExpansionPromptDay = game.daysUsed;
    const recommended = recommendedCapacityExpansion();
    const result = game.rentHouseTo(recommended.target);
    if (result?.ok) {
      showSaveBanner(`已扩仓 +${recommended.gain}，当前 ${game.coat} 仓。`, 2200);
      softTap();
      render();
    }
    return;
  }
  const loc = suggestedTravelLocation();
  if (loc) travelToLocation(loc);
}
function setMobileTradeQty(nextQty) {
  const state = mobileTradeState();
  mobileTradeQty = nextQty;
  clampMobileTradeQty(state.cap);
  renderMobileTradeDock();
}
function executeMobileTrade(countOverride = null) {
  const state = mobileTradeState();
  if (state.disabled) return;
  if (countOverride != null) mobileTradeQty = countOverride;
  const count = clampMobileTradeQty(state.cap);
  const tradedId = state.mode === "sell" ? selectedInv : selectedMarket;
  softTap(state.mode === "sell" ? [10, 28, 14] : 8);
  if (state.mode === "sell") {
    game.sell(selectedInv, count);
    const stillHeld = game.inv.some((item) => item.id === tradedId);
    if (stillHeld) {
      selectedInv = tradedId;
      selectedMarket = null;
      setMobileTradeMode("sell", false);
      prefillTradeCounts({ sell: true });
    } else {
      selectedInv = null;
      selectedMarket = game.market[0]?.id ?? null;
      setMobileTradeMode("buy", true);
      prefillTradeCounts({ buy: true });
    }
  } else {
    game.buy(selectedMarket, count);
    selectedMarket = tradedId;
    selectedInv = null;
    setMobileTradeMode("buy", false);
    prefillTradeCounts({ buy: true });
  }
  render();
}
q("buyBtn").addEventListener("click", () => { if (selectedMarket == null) return; softTap(); game.buy(selectedMarket, nval("buyCount", 1)); prefillTradeCounts({ buy: true }); render(); });
q("sellBtn").addEventListener("click", () => { if (selectedInv == null) return; softTap(); game.sell(selectedInv, nval("sellCount", 1)); prefillTradeCounts({ sell: true }); render(); });
q("buyMaxBtn").addEventListener("click", () => {
  if (selectedMarket == null) return;
  const count = maxBuyCount(selectedMarket);
  if (count <= 0) return;
  softTap();
  game.buy(selectedMarket, count);
  prefillTradeCounts({ buy: true });
  render();
});
q("sellMaxBtn").addEventListener("click", () => {
  if (selectedInv == null) return;
  const count = maxSellCount(selectedInv);
  if (count <= 0) return;
  softTap();
  game.sell(selectedInv, count);
  prefillTradeCounts({ sell: true });
  render();
});
q("depositBtn").addEventListener("click", () => { game.deposit(nval("bankAmount")); render(); });
q("withdrawBtn").addEventListener("click", () => { game.withdraw(nval("bankAmount")); render(); });
q("repaySmartBtn").addEventListener("click", () => {
  const manual = Math.max(0, Math.min(nval("repayAmount"), game.cash, game.debt));
  if (manual > 0) game.repay(manual);
  const auto = game.smartRepay();
  if (manual <= 0 && auto <= 0) game.addLog("当前现金不足以触发还债。", "input_error", { action: "smart_repay", reason: "insufficient_cash" });
  if (manual > 0 || auto > 0 || game.debt <= 0) clearDebtGuide();
  render();
});
q("cureBtn").addEventListener("click", () => { game.cure(nval("curePoints", 1)); render(); });
q("charityBtn").addEventListener("click", () => { game.charity(nval("blessAmount", 3000)); game.checkCriticalStates(); render(); });
q("wellnessBtn").addEventListener("click", () => { game.wellness(nval("blessAmount", 3000)); game.checkCriticalStates(); render(); });
q("rentBtn").addEventListener("click", () => { openCapacityModal(); });
q("quickExpandBtn").addEventListener("click", () => { openCapacityModal(); });
q("warehouseCapacityBtn")?.addEventListener("click", () => {
  expandGuideDismissed = true;
  hideExpandGuideTip();
  showSaveBanner(`当前仓位 ${game.totalItems}/${game.coat}，可通过房屋中介扩仓。`, 2600);
  openCapacityModal();
});
q("quickTravelBtn").addEventListener("click", () => {
  const loc = suggestedTravelLocation();
  if (loc) travelToLocation(loc);
});
q("buyOpportunityBtn").addEventListener("click", () => { runRecommendedAction(() => executeBuyOpportunity()); });
q("sellOpportunityBtn").addEventListener("click", () => { runRecommendedAction(() => executeSellOpportunity()); });
q("actionOpportunityBtn").addEventListener("click", () => { runRecommendedAction(() => executePrimaryOpportunity()); });
q("thumbActionBtn")?.addEventListener("click", () => { runRecommendedAction(() => executePrimaryOpportunity()); });
q("mobileQtyMinus")?.addEventListener("click", () => { setMobileTradeQty(mobileTradeQty - 1); });
q("mobileTradeCloseBtn")?.addEventListener("click", () => { clearManualTradeSelection(); render(); });
q("mobileQtyPlus")?.addEventListener("click", () => { setMobileTradeQty(mobileTradeQty + 1); });
q("mobileTradeCount")?.addEventListener("input", () => { setMobileTradeQty(nval("mobileTradeCount", 1)); });
q("mobileTradeMaxBtn")?.addEventListener("click", () => {
  const state = mobileTradeState();
  if (!state.disabled) executeMobileTrade(state.cap);
});
q("mobileTradePrimaryBtn")?.addEventListener("click", () => { executeMobileTrade(); });
q("rumorBtn").addEventListener("click", () => { game.buyRumor(); render(); });
q("newGameBtnTop").addEventListener("click", () => { startNewGameFlow(); });
q("eventOkBtn").addEventListener("click", () => { showNextModal(); });
q("campaignCloseBtn")?.addEventListener("click", () => {
  if (activeCampaign) void window.BFSJ_PLATFORM?.recordCampaignEvent?.(activeCampaign, "dismiss", activeCampaign.__context || {});
  activeCampaign = null;
  q("campaignModal")?.classList.add("hidden");
});
q("campaignActionBtn")?.addEventListener("click", () => {
  const url = safeCampaignUrl(q("campaignActionBtn")?.dataset.url);
  if (!activeCampaign || !url) return;
  void window.BFSJ_PLATFORM?.recordCampaignEvent?.(activeCampaign, "click", { ...(activeCampaign.__context || {}), action: "outbound", action_url: url });
  window.open(url, "_blank", "noopener,noreferrer");
});
q("startConfirmBtn").addEventListener("click", () => {
  closeStartModal();
});
q("startGoogleBtn").addEventListener("click", () => {
  closeStartModal();
  authWithProvider("google");
});
q("startEmailBtn").addEventListener("click", () => {
  closeStartModal();
  q("accountModal")?.classList.remove("hidden");
  updateAccountUi();
});
q("endSaveBtn").addEventListener("click", () => {
  runUploadConsent = true;
  if (!cloud.user) {
    if (!cloud.client) storePendingRun("end_save_offline");
    closeEndModal();
    openGuestSaveModal();
    return;
  }
  closeEndModal();
  saveRunToCloud(true);
});
q("guestSaveSubmitBtn")?.addEventListener("click", () => { void submitGuestSaveFromModal(); });
q("guestSaveCancelBtn")?.addEventListener("click", () => {
  closeGuestSaveModal();
  setAuthMessage("本局已匿名存档，稍后仍可上榜。");
});
q("endSkipBtn").addEventListener("click", () => {
  runUploadConsent = false;
  closeEndModal();
  closeGuestSaveModal();
  setAuthMessage("本局已匿名存档，不会公开到排行榜。");
});
q("endReplayBtn")?.addEventListener("click", () => { startNewGameFlow(); });
q("endShareBtn")?.addEventListener("click", () => { void shareCurrentRun(); });
q("endCopyBtn")?.addEventListener("click", () => { void copyShareText(); });
q("accountBtnTop").addEventListener("click", () => { q("accountModal").classList.remove("hidden"); updateAccountUi(); });
q("rankBtnTop").addEventListener("click", () => { q("rankModal").classList.remove("hidden"); loadLeaderboard(); closeMobileMenu(); });
q("accountCloseBtn").addEventListener("click", () => { q("accountModal").classList.add("hidden"); });
q("rankCloseBtn").addEventListener("click", () => { q("rankModal").classList.add("hidden"); });
q("emailLoginBtn").addEventListener("click", () => { authWithEmail("login"); });
q("emailSignupBtn").addEventListener("click", () => { authWithEmail("signup"); });
q("googleLoginBtn").addEventListener("click", () => { authWithProvider("google"); });
q("saveNickBtn").addEventListener("click", () => { saveNickname(q("profileNameInput").value); });
q("retrySaveBtn").addEventListener("click", () => { saveRunToCloud(true); });
q("claimGuestBtn").addEventListener("click", () => { claimByTokenManual(); });
q("copyClaimTokenBtn")?.addEventListener("click", () => { copyLatestClaimToken(); });
q("signOutBtn").addEventListener("click", () => { signOut(); });
q("refreshLeaderboardBtn").addEventListener("click", () => { loadLeaderboard(); });
q("uiModeToggleBtn")?.addEventListener("click", () => {
  forcedUiMode = "mobile";
  saveUiModePref("mobile");
  applyDeviceUiMode();
  render();
});
q("mobileMenuBtn")?.addEventListener("click", (ev) => {
  ev.stopPropagation();
  toggleMobileMenu();
});
q("menuNewGameBtn")?.addEventListener("click", () => { startNewGameFlow(); });
q("menuRankBtn")?.addEventListener("click", () => {
  q("rankModal")?.classList.remove("hidden");
  closeMobileMenu();
  loadLeaderboard();
});
q("menuAccountBtn")?.addEventListener("click", () => {
  q("accountModal")?.classList.remove("hidden");
  closeMobileMenu();
  updateAccountUi();
});
q("menuDesktopBtn")?.remove();
document.addEventListener("click", (ev) => {
  const card = q("mobileMenuCard");
  const btn = q("mobileMenuBtn");
  if (!card || !btn || card.classList.contains("hidden")) return;
  const target = ev.target;
  if (target instanceof Node && !card.contains(target) && !btn.contains(target)) closeMobileMenu();
});
q("capacityTargetInput").addEventListener("input", () => { renderCapacityPlan(q("capacityTargetInput").value); });
q("capacityCancelBtn").addEventListener("click", () => { closeCapacityModal(); render(); });
q("capacityConfirmBtn").addEventListener("click", () => {
  const expandGain = Math.max(CAPACITY_STEP, nval("capacityTargetInput", CAPACITY_STEP));
  const target = normalizeCapacityTarget(game.coat + expandGain, game.coat);
  const result = game.rentHouseTo(target);
  if (!result.ok && result.reason === "insufficient_cash" && result.affordableTarget > game.coat) {
    renderCapacityPlan(result.affordableTarget - game.coat);
    showSaveBanner(`当前现金不足，已为你定位可升级到 ${result.affordableTarget}。`, 3200, "error");
    render();
    return;
  }
  if (result.ok) closeCapacityModal();
  render();
});
q("menuTradeBtn")?.addEventListener("click", () => {
  applyMobileView("market");
  closeMobileMenu();
});
q("menuLedgerBtn")?.addEventListener("click", () => {
  applyMobileView("status");
  closeMobileMenu();
});
q("placePickerBtn")?.addEventListener("click", () => {
  setPlacePickerOpen(!document.body?.classList.contains("place-picker-open"));
});
q("placePickerBackdrop")?.addEventListener("click", () => { setPlacePickerOpen(false); });
q("miniDebtCard").addEventListener("click", () => { clearDebtGuide({ openRepay: true }); });
q("miniItemsCard")?.addEventListener("click", () => {
  expandGuideDismissed = true;
  hideExpandGuideTip();
  openCapacityModal();
});
q("debtStatCard").addEventListener("click", () => { clearDebtGuide({ openRepay: true }); });
q("debtGuideTipBtn").addEventListener("click", () => { clearDebtGuide({ openRepay: true }); });
q("debtGuideTipClose").addEventListener("click", () => { clearDebtGuide(); });
q("expandGuideTipBtn").addEventListener("click", () => {
  hideExpandGuideTip();
  openCapacityModal();
});
q("expandGuideTipClose").addEventListener("click", () => {
  expandGuideDismissed = true;
  hideExpandGuideTip();
});
q("repayModalCancel").addEventListener("click", () => { closeRepayModal(); });
q("repayModalAll").addEventListener("click", () => { repayFromModal(0, { all: true }); });
q("repayModalConfirm").addEventListener("click", () => { repayFromModal(nval("repayModalAmount", 0)); });
loadUiModePref();
applyDeviceUiMode();
applyAuthUiVisibility();
restoreActiveRunSnapshot();
if (!currentRunBounty) currentRunBounty = buildRunBounty();
registerAppServiceWorker();
window.addEventListener("resize", applyDeviceUiMode);
window.addEventListener("orientationchange", applyDeviceUiMode);
render();
if (activeRunRestored) showSaveBanner(`已恢复上次进度：第 ${game.daysUsed}/${TOTAL_DAYS} 天。`, 2400);
window.setInterval(updateRoundProgressUi, 1000);
initCloud();
