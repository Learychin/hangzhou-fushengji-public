"use strict";
const GAME_VERSION_CODE = "HZFSJ-MARKET-ALPHA-8x10";
const EVENT_LOG_LIMIT = 800;
const PENDING_RUN_KEY = "bfsj_pending_run";
const CLAIM_TOKENS_KEY = "bfsj_claim_tokens";
const LAST_GUEST_NICK_KEY = "bfsj_last_guest_nickname";
const UI_MODE_PREF_KEY = "bfsj_ui_mode_pref";
const ENABLE_RANDOM_EVENT_POPUPS = false;
const ENABLE_STATUS_SYSTEM = false;
const HIDE_AUTH_UI = true;
const MAX_CAPACITY = 500;
const CAPACITY_STEP = 10;

function capacityStepCost(afterCap) {
  let cost = 22000;
  if (afterCap > 180) cost = 32000;
  if (afterCap > 240) cost = 48000;
  if (afterCap > 320) cost = 68000;
  if (afterCap > 400) cost = 92000;
  if (afterCap > 460) cost = 128000;
  return cost;
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

class GameEngine {
  constructor() {
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
      { freq: 80, msg: "平台抽佣规则调整，当日现金被多扣。", ratio: 8 },
      { freq: 95, msg: "临时仓储和配送附加费上涨。", ratio: 10 },
      { freq: 150, msg: "你冲动加了投放预算，回报一般。", ratio: 12 },
      { freq: 110, msg: "设备维护支出超预期。", ratio: 9 },
      { freq: 130, msg: "账户风控冻结部分余额，短期可用资金减少。", ratio: 10 },
    ];

    this.locations = [
      "西湖", "武林广场", "滨江", "钱江新城", "未来科技城",
      "城西银泰", "杭州东站", "灵隐", "运河", "萧山机场",
      "河坊街", "奥体中心", "之江", "良渚", "梦想小镇",
      "文三街区", "湘湖", "九堡", "下沙", "钱塘湾",
    ];

    this.locMultipliers = [];
    this.locationDistricts = [
      "xihu", "gongshu", "binjiang", "shangcheng", "yuhang",
      "yuhang", "shangcheng", "xihu", "gongshu", "xiaoshan",
      "shangcheng", "xiaoshan", "xihu", "yuhang", "yuhang",
      "xihu", "xiaoshan", "shangcheng", "qiantang", "qiantang",
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
    this.todayNews = null;
    this.newsPool = [
      {
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
        title: "【消费监管趋严】",
        desc: "平台抽检和营销规范升级，部分热门品类承压。",
        durationMin: 2,
        durationMax: 4,
        effects: [
          { goodsIds: [5, 11, 14], minPct: -22, maxPct: -9, tag: "政策影响" },
          { goodsIds: [3, 4], minPct: 8, maxPct: 20, tag: "稀缺" },
        ],
      },
    ];
    this.newGame();
  }

  rnd(n) { return Math.floor(Math.random() * n); }

  newGame() {
    this.cash = 3000;
    this.debt = 6000;
    this.bank = 0;
    this.health = 100;
    this.fame = 100;
    this.coat = 110;
    this.totalItems = 0;
    this.timeLeft = 45;
    this.currentLoc = -1;
    this.wangbaVisits = 0;
    this.market = [];
    this.inv = [];
    this.logs = [`新游戏开始：欢迎来到杭州。 版本代号 ${GAME_VERSION_CODE}`];
    this.eventLog = [];
    this.recordEvent("system", this.logs[0], { version: GAME_VERSION_CODE });
    this.lastMarketPopups = [];
    this.rumor = null;
    this.lastRumorLoc = 0;
    this.rumorBuff = null;
    this.activeNews = [];
    this.todayNews = {
      title: "【市场开盘】",
      desc: "先跑动起来，第一轮行情会在换地方后生成。",
      effects: [],
      day: 0,
    };
    this.tradeCount = 0;
    this.gameOver = false;
    this.lastTrade = null;
    this.rollLocationMultipliers();
    this.makeDrugPrices(3);
    this.displayDrugs();
  }

  get score() { return this.cash + this.bank - this.debt; }
  get dayText() { return `杭州浮生(${45 - this.timeLeft}/45天)`; }
  get cityLabels() { return this.locations; }

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
      day: 45 - this.timeLeft,
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
      currentLoc: this.currentLoc,
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

  makeDrugPrices(leaveout) {
    const day = 45 - this.timeLeft;
    const stage = day <= 15 ? "early" : day <= 30 ? "mid" : "late";
    const pools = {
      early: [0, 1, 2, 3, 5, 7, 10, 11, 12, 14, 18],
      mid: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 20],
      late: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
    };
    const allBase = this.goods.map((g) => g.id);
    const primary = pools[stage].slice();
    const targetCount = 9 + this.rnd(3); // 9~11

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
      prices[id] = g.base + this.rnd(g.span);
    }

    this.market = this.goods
      .filter((g) => prices[g.id] > 0)
      .map((g) => ({ id: g.id, name: g.name, price: prices[g.id], kind: g.kind, weight: g.weight }));
  }

  displayDrugs() { this.market.sort((a, b) => a.id - b.id); }

  rollLocationMultipliers() {
    this.locMultipliers = [];
    for (let loc = 0; loc < this.locations.length; loc++) {
      const row = {};
      for (const g of this.goods) {
        // 普通波动区间更稳，少量点位出现大行情
        let k = 0.7 + this.rnd(71) / 100; // 0.70 ~ 1.40
        if (this.rnd(100) < 18) {
          k = 0.35 + this.rnd(146) / 100; // 0.35 ~ 1.80 (稀有大波动)
        }
        row[g.id] = k;
      }
      this.locMultipliers.push(row);
    }
    if (this.rumorBuff && this.rumorBuff.turnsLeft > 0) {
      const { targetLoc, goodId, direction } = this.rumorBuff;
      const i = Math.max(0, targetLoc - 1);
      if (this.locMultipliers[i]) {
        if (direction === "up") this.locMultipliers[i][goodId] = Math.max(this.locMultipliers[i][goodId], 1.45 + this.rnd(36) / 100);
        else this.locMultipliers[i][goodId] = Math.min(this.locMultipliers[i][goodId], 0.55 + this.rnd(26) / 100);
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

  prepareNewsForDay() {
    const currentDay = 46 - this.timeLeft;
    this.activeNews = (this.activeNews || []).filter((n) => n.expiresOnDay >= currentDay);

    const spawnRate = this.timeLeft >= 35 ? 74 : this.timeLeft >= 18 ? 67 : 60;
    if (this.rnd(100) < spawnRate) {
      const tpl = this.newsPool[this.rnd(this.newsPool.length)];
      const duration = tpl.durationMin + this.rnd(tpl.durationMax - tpl.durationMin + 1);
      const impacts = tpl.effects.map((effect) => {
        const goodsId = effect.goodsIds[this.rnd(effect.goodsIds.length)];
        const pct = effect.minPct + this.rnd(effect.maxPct - effect.minPct + 1);
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
        day: currentDay,
        expiresOnDay: currentDay + duration - 1,
        impacts,
      };
      this.activeNews.push(news);
      const impactText = impacts
        .map((x) => `${this.goods[x.goodsId]?.name || "未知商品"}${x.pct > 0 ? "+" : ""}${x.pct}%`)
        .join("，");
      this.addLog(`${news.title} ${news.desc}（${impactText}）`, "market_news", {
        day: currentDay,
        expires_on_day: news.expiresOnDay,
        impacts,
      });
    }
    this.refreshTodayNews(currentDay);
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
    const currentDay = 46 - this.timeLeft;
    const map = new Map();
    for (const news of this.activeNews) {
      if (news.expiresOnDay < currentDay) continue;
      for (const impact of news.impacts || []) {
        const prev = map.get(impact.goodsId) ?? 1;
        map.set(impact.goodsId, prev * (1 + impact.pct / 100));
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
    const rate = this.timeLeft >= 38 ? 0.04 : 0.07;
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
        this.addLog(`45天结束，总分 ${this.score}`, "game_over", { reason: "completed", score: this.score });
      }
    }
  }

  doStealEvents() {
    for (let i = 0; i < this.stealEvents.length; i++) {
      const e = this.stealEvents[i];
      if (this.rnd(1000) % e.freq !== 0) continue;
      if (i !== 4 && i !== 5) {
        this.cash = Math.floor((this.cash / 100) * (100 - e.ratio));
        this.addLog(`${e.msg} 现金-${e.ratio}%`, "expense_event", { target: "cash", ratio: e.ratio, source: e.msg });
      } else if (this.bank > 0) {
        this.bank = Math.floor((this.bank / 100) * (100 - e.ratio));
        this.addLog(`${e.msg} 存款-${e.ratio}%`, "expense_event", { target: "bank", ratio: e.ratio, source: e.msg });
      }
      break;
    }
    if (this.cash < 0) this.cash = 0;
  }

  autoSellAtEnd() {
    for (const item of this.inv) {
      const mk = this.market.find(x => x.id === item.id);
      if (mk) this.cash += mk.price * item.count;
    }
    this.inv = [];
    this.totalItems = 0;
  }

  clearSameDayLocks() {
    for (const item of this.inv) {
      if (item && item.sameDayLocked) item.sameDayLocked = 0;
    }
  }

  getSellableCount(item) {
    if (!item) return 0;
    const locked = Math.max(0, Math.min(item.sameDayLocked || 0, item.count || 0));
    return Math.max(0, (item.count || 0) - locked);
  }

  buildFinalSettlementMarket() {
    const existing = new Map(this.market.map((m) => [m.id, m.price]));
    this.market = this.goods.map((g) => {
      const fallback = g.base + this.rnd(g.span);
      const rawPrice = existing.get(g.id) ?? fallback;
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
    this.lastRumorLoc = locIdx;
    this.rollLocationMultipliers();
    this.prepareNewsForDay();
    this.makeDrugPrices(this.timeLeft <= 2 ? 0 : 3);
    this.applyLocationSpread();
    this.handleCashDebt();
    this.doMarketEvents();
    this.displayDrugs();
    this.doHealthEvents();
    this.doStealEvents();
    this.checkCriticalStates();
    if (ENABLE_STATUS_SYSTEM && this.debt > 100000) {
      this.health -= 20;
      this.addLog("欠债压力爆表，身心状态恶化，健康-20。", "debt_pressure", { delta_health: -20, debt: this.debt });
      this.checkCriticalStates();
    }
    if (this.gameOver) return;
    this.timeLeft -= 1;
    this.clearSameDayLocks();
    this.addLog(this.dayText, "travel", {
      location_id: locIdx,
      location: this.cityLabels[locIdx - 1],
      district: this.locationDistricts[locIdx - 1],
    });
    if (this.timeLeft === 1) this.addLog("最后一天，建议清仓。", "system", { hint: "final_day" });
    if (this.timeLeft <= 0) {
      this.buildFinalSettlementMarket();
      this.autoSellAtEnd();
      this.gameOver = true;
      this.addLog(`45天结束，总分 ${this.score}`, "game_over", { reason: "completed", score: this.score });
    }
  }

  buy(goodsId, count) {
    const mk = this.market.find(x => x.id === goodsId);
    if (!mk) return this.addLog("请先选择黑市商品。", "input_error", { action: "buy", reason: "missing_market_goods" });
    const weight = mk.weight ?? 1;
    const max = Math.min(Math.floor(this.cash / mk.price), Math.floor((this.coat - this.totalItems) / (weight || 1)));
    if (max <= 0) return this.addLog("现金不足或房子已满。", "input_error", { action: "buy", reason: "insufficient_cash_or_capacity", goods_id: goodsId });
    const n = Math.max(1, Math.min(count, max));
    let unitPrice = mk.price;
    if (n >= 80) unitPrice = Math.floor(unitPrice * 0.88);
    else if (n >= 50) unitPrice = Math.floor(unitPrice * 0.92);
    else if (n >= 20) unitPrice = Math.floor(unitPrice * 0.97);
    const totalCost = n * unitPrice;
    this.cash -= totalCost;
    this.totalItems += n * (weight || 1);
    const discount = n >= 80 ? 12 : n >= 50 ? 8 : n >= 20 ? 3 : 0;
    const i = this.inv.findIndex(x => x.id === goodsId);
    if (i >= 0) {
      const old = this.inv[i];
      const totalCnt = old.count + n;
      old.buyPrice = Math.floor((old.buyPrice * old.count + unitPrice * n) / totalCnt);
      old.count = totalCnt;
      old.sameDayLocked = Math.max(0, old.sameDayLocked || 0) + (discount > 0 ? n : 0);
    } else {
      this.inv.unshift({ id: goodsId, name: mk.name, buyPrice: unitPrice, count: n, sameDayLocked: discount > 0 ? n : 0 });
    }
    const suffix = discount ? `（批发折扣 ${discount}%）` : "";
    this.addLog(`买入 ${mk.name} x${n}${suffix}`, "trade", {
      side: "buy",
      goods_id: goodsId,
      goods: mk.name,
      count: n,
      unit_price: unitPrice,
      total: totalCost,
      discount,
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
    if (!mk) return this.addLog("当前黑市无人收这个商品。", "input_error", { action: "sell", reason: "goods_not_in_market", goods_id: goodsId });
    const invItem = this.inv[invIdx];
    const sellable = this.getSellableCount(invItem);
    if (sellable <= 0) {
      return this.addLog("该商品今天刚批发进货，需隔天才能卖出。", "input_error", {
        action: "sell",
        reason: "same_day_discount_lock",
        goods_id: goodsId,
      });
    }
    const n = Math.max(1, Math.min(count, sellable));
    const avgCost = this.inv[invIdx].buyPrice || 0;
    this.inv[invIdx].count -= n;
    if (this.inv[invIdx].sameDayLocked) {
      this.inv[invIdx].sameDayLocked = Math.max(0, Math.min(this.inv[invIdx].sameDayLocked, this.inv[invIdx].count));
    }
    if (this.inv[invIdx].count === 0) this.inv.splice(invIdx, 1);
    this.cash += n * mk.price;
    this.totalItems -= n * (mk.weight || 1);
    if (goodsId === 4) this.fame = Math.max(0, this.fame - 7);
    if (goodsId === 3) this.fame = Math.max(0, this.fame - 10);
    const pnl = (mk.price - avgCost) * n;
    this.addLog(`卖出 ${mk.name} x${n}`, "trade", {
      side: "sell",
      goods_id: goodsId,
      goods: mk.name,
      count: n,
      unit_price: mk.price,
      total: n * mk.price,
      avg_cost: avgCost,
      pnl,
    });
    this.applyTradeImpact(goodsId, n, "sell");
    this.applyOneTradeEvent(goodsId, n, n * mk.price);
    this.checkCriticalStates();
    this.lastTrade = { type: "sell", goodsId, goods: mk.name, count: n, unit: mk.price, total: n * mk.price, avgCost, pnl };
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
  wangba() { if (this.wangbaVisits > 3) return this.addLog("共享工位老板提醒：今天别再熬了。", "input_error", { action: "side_job", reason: "daily_limit" }); if (this.cash < 20) return this.addLog("至少要带 20 元才能进共享工位。", "input_error", { action: "side_job", reason: "insufficient_cash" }); this.wangbaVisits += 1; const gain = 3 + this.rnd(16); this.cash += gain; this.addLog(`接到临时小单，赚了 ${gain} 元`, "side_job", { gain, visits: this.wangbaVisits }); }
  buyRumor() { if (this.cash < this.coffeeCost) { this.addLog("现金不足，买不起社交咖啡。", "input_error", { action: "buy_rumor", reason: "insufficient_cash", cost: this.coffeeCost }); return; } this.cash -= this.coffeeCost; const targetLoc = 1 + this.rnd(this.locations.length); const targetGood = this.goods[this.rnd(this.goods.length)]; const row = this.locMultipliers[targetLoc - 1] || {}; let pct; let direction; const hitRate = this.timeLeft >= 40 ? 90 : 85; if (this.rnd(100) < hitRate) { direction = "up"; pct = 50 + this.rnd(36); const turnsLeft = this.timeLeft >= 40 ? 4 : 3; this.rumorBuff = { targetLoc, goodId: targetGood.id, direction: "up", turnsLeft }; } else { direction = "down"; pct = -(20 + this.rnd(21)); this.rumorBuff = { targetLoc, goodId: targetGood.id, direction: "down", turnsLeft: 2 }; } const dir = pct >= 0 ? "更贵" : "更便宜"; const msg = `花了30元咖啡打听到：${this.cityLabels[targetLoc - 1]} 的 ${targetGood.name} 价格可能比当前站点${dir} ${Math.abs(pct)}%。（情报有效期 2-3 天）`; this.rumor = { msg, targetLoc, goodId: targetGood.id, pct, direction }; this.addLog("你通过社交拿到一条行情传闻。", "rumor", { cost: this.coffeeCost, target_location_id: targetLoc, target_location: this.cityLabels[targetLoc - 1], goods_id: targetGood.id, goods: targetGood.name, pct, direction }); }
  smartRepay() { if (this.debt <= 0 || this.cash <= 0) return 0; const reserve = 1000; const pay = Math.max(0, Math.min(this.debt, this.cash - reserve)); if (pay <= 0) return 0; this.repay(pay); return pay; }
}

const game = new GameEngine();
let selectedMarket = null;
let selectedInv = null;
let modalQueue = [];
let runId = 1;
let savedRunId = null;
let saveFailedRunId = null;
let saveInFlight = false;
let saveRetryTimer = null;
let saveRetryAttempt = 0;
let lastPresenceTrackAt = 0;
let startPromptShown = false;
let endPromptRunId = null;
let runUploadConsent = null;
let lastCelebratedTradeKey = null;
let lastSavedCloudRunId = null;
let capacityPlanTarget = 0;
let isMobileUi = false;
let mobileView = "trade";
let debtGuideDismissed = false;
let debtGuideShown = false;
let marketRefreshPending = false;
let marketRefreshTimer = null;
let lastDebtGuideTradeKey = null;
let lastBuyHundredTradeKey = null;
let expandGuideDismissed = false;
let forcedUiMode = null;
let mobileMenuOpen = false;
const SAVE_RETRY_DELAYS_MS = [2500, 5000, 9000, 15000];
const cloud = {
  client: null,
  user: null,
  profile: null,
  ready: false,
  presenceChannel: null,
  onlinePlayers: [],
};

function q(id) { return document.getElementById(id); }
function nval(id, d = 0) { const v = Number(q(id).value); return Number.isFinite(v) ? v : d; }
function cny(n) { return `¥${Number(n).toLocaleString("zh-CN")}`; }
function cnyCompact(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(2)}千万`;
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(2)}百万`;
  return `${sign}${abs.toLocaleString("zh-CN")}`;
}
function loadUiModePref() {
  const raw = window.localStorage.getItem(UI_MODE_PREF_KEY);
  if (raw === "mobile" || raw === "desktop") forcedUiMode = raw;
  else forcedUiMode = null;
}
function saveUiModePref(mode) {
  if (mode === "mobile" || mode === "desktop") window.localStorage.setItem(UI_MODE_PREF_KEY, mode);
  else window.localStorage.removeItem(UI_MODE_PREF_KEY);
}
function updateUiModeToggleButton() {
  const btn = q("uiModeToggleBtn");
  if (!btn) return;
  if (isMobileUi) {
    btn.textContent = "切桌面端";
    btn.title = "当前移动端视图，点击切换到桌面端";
  } else {
    btn.textContent = "切移动端";
    btn.title = "当前桌面端视图，点击切换到移动端";
  }
}
function applyAuthUiVisibility() {
  const body = document.body;
  if (!body) return;
  body.classList.toggle("hide-auth-ui", HIDE_AUTH_UI);
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
  info.textContent = `可用 ${cny(game.cash)} ｜ 欠债 ${cny(game.debt)}。建议先还一部分。`;
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
function renderPlaceDockGrid() {
  const grid = q("placeDockGrid");
  if (!grid) return;
  grid.innerHTML = "";
  game.cityLabels.forEach((name, idx) => {
    const loc = idx + 1;
    const district = game.locationDistricts[idx] || "shangcheng";
    const b = document.createElement("button");
    b.className = `place-dock-item district-${district}`;
    if (game.currentLoc === loc) b.classList.add("active");
    b.innerHTML = `<span>${name}</span>`;
    b.addEventListener("click", () => { travelToLocation(loc); });
    grid.appendChild(b);
  });
}
function travelToLocation(locIdx) {
  const prevLoc = game.currentLoc;
  game.oneTravelTurn(locIdx);
  if (game.currentLoc !== prevLoc) marketRefreshPending = true;
  render();
}
function detectMobileUi() {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const narrow = window.matchMedia?.("(max-width: 980px)").matches;
  const ua = navigator.userAgent || "";
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|Windows Phone/i.test(ua);
  return Boolean(coarse || narrow || mobileUa);
}
function applyMobileView(nextView = "trade") {
  const body = document.body;
  if (!body || !body.classList.contains("mobile-ui")) return;
  const views = ["trade", "status"];
  mobileView = views.includes(nextView) ? nextView : "trade";
  body.classList.remove("mobile-view-trade", "mobile-view-status");
  body.classList.add(`mobile-view-${mobileView}`);
  document.querySelectorAll(".mobile-tab").forEach((btn) => {
    const on = btn.dataset.mobileTab === mobileView;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
function applyDeviceUiMode() {
  const body = document.body;
  if (!body) return;
  const nextMobile = forcedUiMode ? forcedUiMode === "mobile" : detectMobileUi();
  if (isMobileUi === nextMobile && (body.classList.contains("mobile-ui") || body.classList.contains("desktop-ui"))) {
    if (nextMobile) applyMobileView(mobileView);
    updateUiModeToggleButton();
    return;
  }
  isMobileUi = nextMobile;
  body.classList.toggle("mobile-ui", isMobileUi);
  body.classList.toggle("desktop-ui", !isMobileUi);
  const tabs = q("mobileTabs");
  const strip = q("mobileStatusStrip");
  if (tabs) tabs.classList.toggle("hidden", !isMobileUi);
  if (strip) strip.classList.toggle("hidden", !isMobileUi);
  if (isMobileUi) applyMobileView(mobileView);
  else body.classList.remove("mobile-view-trade", "mobile-view-status");
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
function gameSnapshot() {
  return {
    score: game.score,
    cash: game.cash,
    bank: game.bank,
    debt: game.debt,
    health: game.health,
    fame: game.fame,
    coat: game.coat,
    days_used: 45 - game.timeLeft,
    location: game.currentLoc,
    inventory: game.inv,
    logs: game.logs.slice(-80),
    event_summary: summarizeEvents(game.eventLog || []),
    events: game.eventLog?.slice(-200) || [],
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
  if (code === "completed") return "45天期满";
  return "中途结束";
}
function pendingRunFromCurrentGame() {
  const snapshot = gameSnapshot();
  return {
    local_run_id: runId,
    version: GAME_VERSION_CODE,
    score: game.score,
    cash: game.cash,
    bank: game.bank,
    debt: game.debt,
    health: game.health,
    fame: game.fame,
    coat: game.coat,
    days_used: snapshot.days_used,
    ended_reason: endedReason(),
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
async function saveGuestRunToCloud(manual = false) {
  if (!cloud.client) {
    if (manual) setAuthMessage("云端未连接，无法保存游客战绩。");
    return false;
  }
  const defaultName = window.localStorage.getItem(LAST_GUEST_NICK_KEY) || "";
  const nameRaw = window.prompt("输入上榜昵称（1-24字）：", defaultName || "杭州路人甲");
  if (nameRaw === null) {
    if (manual) setAuthMessage("已取消本局上榜。");
    return false;
  }
  const nickname = String(nameRaw || "").trim().slice(0, 24);
  if (!nickname) {
    if (manual) setAuthMessage("昵称不能为空。");
    return false;
  }
  window.localStorage.setItem(LAST_GUEST_NICK_KEY, nickname);
  const claimToken = randomToken("claim");
  const snapshot = gameSnapshot();
  const guestPayload = {
    guest_id: getGuestId(),
    nickname,
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
    final_state: {
      ...snapshot,
      entry_mode: "guest",
      can_claim_with_login: true,
    },
  };
  const { data, error } = await cloud.client
    .from("guest_runs")
    .insert(guestPayload)
    .select("id")
    .single();
  if (error) {
    setAuthMessage(`游客上榜失败：${error.message}`);
    showSaveBanner(`上榜失败：${error.message}`, 5200, "error");
    return false;
  }
  storeClaimToken(claimToken);
  savedRunId = runId;
  saveFailedRunId = null;
  lastSavedCloudRunId = data?.id || null;
  setAuthMessage(`游客上榜成功：${nickname}。后续登录可自动认领历史战绩。`);
  showSaveBanner("写入成功：游客战绩已入榜。", 3200);
  game.addLog(`游客上榜成功，回绑码：${claimToken}`, "guest_save", { claim_token: claimToken, nickname });
  window.alert(`上榜成功！你的回绑码：\n${claimToken}\n\n建议截图保存，后续登录可认领战绩。`);
  refreshClaimTokenHint();
  await loadLeaderboard();
  return true;
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
  if (affordableText) {
    affordableText.textContent = `你当前现金 ${cny(game.cash)}，最多可扩 ${maxGain} 仓（到 ${maxAffordable.target}）。`;
  }
  summary.textContent = `当前仓位 ${game.coat}，最多还能增加 ${left}。本次将增加 ${plan.gain}（${plan.steps} 次升级）到 ${plan.target}。`;
  costText.textContent = `预计花费 ${cny(plan.cost)}。档位预览：${stepPreview}${plan.detail.length > 3 ? "..." : ""}`;
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
  const affordable = affordableCapacityByCash();
  const defaultGain = affordable.gain > 0 ? affordable.gain : CAPACITY_STEP;
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
    day: 45 - game.timeLeft,
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
async function saveRunToCloud(manual = false) {
  if (manual) saveFailedRunId = null;
  if (runUploadConsent !== true) {
    if (manual) setAuthMessage("你选择了本局不写入积分榜。");
    return;
  }
  if (!game.gameOver) {
    if (manual) setAuthMessage("本局还没有结束，结束后会自动保存。");
    return;
  }
  if (!cloud.client || !cloud.user) {
    return saveGuestRunToCloud(manual);
  }
  if (savedRunId === runId) {
    if (manual) setAuthMessage("本局结果已经保存过了。");
    return;
  }
  if (saveInFlight) {
    if (manual) showSaveBanner("正在提交成绩，请稍候…", 2600);
    return;
  }
  if (manual) showSaveBanner("正在提交成绩…", 2400);
  saveInFlight = true;
  const snapshot = gameSnapshot();
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
    return;
  }
  const runCloudId = data?.id;
  clearSaveRetry();
  savedRunId = runId;
  saveFailedRunId = null;
  saveInFlight = false;
  lastSavedCloudRunId = runCloudId || null;
  setAuthMessage("本局成绩已提交，正在同步榜单...");
  game.addLog("本局结果已保存到云端胜利榜。", "cloud_save", { status: "success", run_id: runCloudId });
  showSaveBanner("写入成功，正在刷新榜单…", 2800);
  q("rankModal")?.classList.remove("hidden");
  void finalizeRunSave(runCloudId, (game.eventLog || []).slice(-EVENT_LOG_LIMIT));
  render();
}
async function finalizeRunSave(runCloudId, events) {
  let eventsOk = true;
  if (runCloudId && events?.length) {
    const eventRows = normalizeEventRows(events, cloud.user.id, runCloudId);
    const { error: eventError } = await cloud.client.from("game_events").insert(eventRows);
    if (eventError) {
      eventsOk = false;
      game.addLog(`对局事件保存失败：${eventError.message}`, "cloud_save", { status: "events_error", error: eventError.message });
    }
  }
  await loadLeaderboard();
  const inTop20 = runCloudId ? await checkRunInTop20(runCloudId) : false;
  if (inTop20) showSaveBanner("写入成功：你已进入全服前 20。");
  else showSaveBanner("写入成功：成绩已保存。");
  if (eventsOk) {
    setAuthMessage("本局结果已保存到云端。");
  } else {
    setAuthMessage("成绩已保存，事件日志同步有延迟，不影响上榜。");
  }
}
async function uploadPendingRunIfReady() {
  const pending = readPendingRun();
  if (!pending || !cloud.client || !cloud.user || saveInFlight) return;
  saveInFlight = true;
  setAuthMessage("正在补传刚才暂存的本局成绩...");
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
  showSaveBanner("补传成功，正在刷新榜单…", 2600);
  void finalizePendingRunSave(runCloudId, pending.events || []);
  clearPendingRun();
  if (pending.local_run_id === runId) savedRunId = runId;
  saveFailedRunId = null;
  saveInFlight = false;
  setAuthMessage("刚才暂存的本局结果已写入云端。");
  q("rankModal")?.classList.remove("hidden");
  render();
}
async function finalizePendingRunSave(runCloudId, events) {
  if (runCloudId && events?.length) {
    const { error: eventError } = await cloud.client
      .from("game_events")
      .insert(normalizeEventRows(events, cloud.user.id, runCloudId));
    if (eventError) setAuthMessage("成绩已补传，事件日志同步有延迟。");
  }
  await loadLeaderboard();
  const inTop20 = runCloudId ? await checkRunInTop20(runCloudId) : false;
  if (inTop20) showSaveBanner("补传成功：你已进入全服前 20。");
  else showSaveBanner("补传成功：成绩已保存。");
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
  await handleOAuthRedirect();
  const { data } = await cloud.client.auth.getSession();
  cloud.user = data.session?.user || null;
  await loadProfile();
  updateAccountUi();
  initPresence();
  await loadLeaderboard();
  await uploadPendingRunIfReady();
  cloud.client.auth.onAuthStateChange(async (_event, session) => {
    cloud.user = session?.user || null;
    await loadProfile();
    updateAccountUi();
    await trackPresence(true);
    if (cloud.user) await claimGuestRunsAfterLogin();
    await uploadPendingRunIfReady();
    if (cloud.user && game.gameOver && savedRunId !== runId) await saveRunToCloud();
  });
}
function maxBuyCount(goodsId) { const mk = game.market.find((x) => x.id === goodsId); if (!mk) return 0; return Math.max(0, Math.min(Math.floor(game.cash / mk.price), Math.floor((game.coat - game.totalItems) / (mk.weight || 1)))); }
function maxSellCount(goodsId) {
  const inv = game.inv.find((x) => x.id === goodsId);
  if (!inv) return 0;
  return Math.max(0, game.getSellableCount(inv));
}
function prefillTradeCounts(opts = {}) { const { buy = false, sell = false } = opts; if (buy && selectedMarket != null) q("buyCount").value = String(Math.max(1, maxBuyCount(selectedMarket))); if (sell && selectedInv != null) q("sellCount").value = String(Math.max(1, maxSellCount(selectedInv))); }
function prefillRepayAll() { q("repayAmount").value = String(Math.max(0, Math.min(game.cash, game.debt))); }
function showNextModal() { const modal = q("eventModal"); const body = q("eventBody"); if (modalQueue.length === 0) { modal.classList.add("hidden"); body.textContent = ""; return; } body.textContent = modalQueue.shift(); modal.classList.remove("hidden"); }
function showStartModal() {
  const modal = q("startModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  startPromptShown = true;
}
function closeStartModal() {
  const modal = q("startModal");
  if (!modal) return;
  modal.classList.add("hidden");
}
function showEndModal() {
  const modal = q("endModal");
  const body = q("endSummaryBody");
  if (!modal || !body) return;
  const daysUsed = 45 - game.timeLeft;
  const net = game.cash + game.bank - game.debt;
  body.innerHTML = `
总分：<strong>${cny(game.score)}</strong>
净资产：<strong>${cny(net)}</strong>
现金：${cny(game.cash)} ｜ 存款：${cny(game.bank)} ｜ 欠债：${cny(game.debt)}
生存天数：${daysUsed}/45
结束原因：${endedReasonText()}
  `.trim();
  modal.classList.remove("hidden");
}
function closeEndModal() {
  const modal = q("endModal");
  if (!modal) return;
  modal.classList.add("hidden");
}
function renderTable(tableId, rows, cols, selectedId, onSelect) { const tb = document.querySelector(`#${tableId} tbody`); tb.innerHTML = ""; rows.forEach((row, idx) => { const tr = document.createElement("tr"); tr.style.setProperty("--row-index", String(idx)); if (row.id === selectedId) tr.classList.add("selected"); tr.addEventListener("click", () => onSelect(row.id)); for (const col of cols) { const td = document.createElement("td"); td.textContent = row[col]; tr.appendChild(td); } tb.appendChild(tr); }); }
function renderInventoryTable() {
  const tb = document.querySelector("#invTable tbody");
  if (!tb) return;
  tb.innerHTML = "";
  let totalCost = 0;
  let totalValue = 0;
  for (const row of game.inv) {
    const tr = document.createElement("tr");
    if (row.id === selectedInv) tr.classList.add("selected");
    tr.addEventListener("click", () => {
      selectedInv = row.id;
      prefillTradeCounts({ sell: true });
      render();
    });
    const mk = game.market.find((x) => x.id === row.id);
    const marketPrice = mk ? mk.price : 0;
    const cost = row.buyPrice * row.count;
    const value = marketPrice * row.count;
    const pnl = value - cost;
    totalCost += cost;
    totalValue += value;

    const tdName = document.createElement("td");
    tdName.textContent = row.name;
    const tdPos = document.createElement("td");
    tdPos.innerHTML = `均价 ${cny(row.buyPrice)}<br>数量 ${row.count}`;
    const tdPnl = document.createElement("td");
    const pnlCls = pnl >= 0 ? "pnl-up" : "pnl-down";
    tdPnl.innerHTML = `市值 ${cny(value)}<br><span class="${pnlCls}">${pnl >= 0 ? "+" : ""}${cny(pnl)}</span>`;
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
      <span>总市值 ${cny(totalValue)}</span>
      <span class="${pnlCls}">总浮盈亏 ${totalPnl >= 0 ? "+" : ""}${cny(totalPnl)}</span>
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
function startNewGameFlow() {
  game.newGame();
  selectedMarket = null;
  selectedInv = null;
  runId += 1;
  savedRunId = null;
  saveFailedRunId = null;
  runUploadConsent = null;
  lastCelebratedTradeKey = null;
  endPromptRunId = null;
  startPromptShown = false;
  debtGuideDismissed = false;
  debtGuideShown = false;
  marketRefreshPending = false;
  lastDebtGuideTradeKey = null;
  lastBuyHundredTradeKey = null;
  expandGuideDismissed = false;
  setDebtGuideGlow(false);
  hideDebtGuideTip();
  hideExpandGuideTip();
  closeRepayModal();
  closeEndModal();
  closeMobileMenu();
  render();
}
function renderMap() {
  const c = q("mapButtons");
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
function render() {
  q("dayText").textContent = game.dayText;
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
  if (q("miniCash")) q("miniCash").textContent = `¥${cnyCompact(game.cash)}`;
  if (q("miniDebt")) q("miniDebt").textContent = cny(game.debt);
  if (q("miniItems")) q("miniItems").textContent = `${game.totalItems}/${game.coat}`;
  if (q("mobileTopCash")) q("mobileTopCash").textContent = `现金 ¥${cnyCompact(game.cash)}`;
  if (q("currentLocBadge")) {
    q("currentLocBadge").textContent = game.currentLoc > 0 ? game.cityLabels[game.currentLoc - 1] : "未出发";
  }
  if (q("marketPanel")) q("marketPanel").classList.toggle("market-loc-active", game.currentLoc > 0);
  if (game.debt <= 0) {
    setDebtGuideGlow(false);
    hideDebtGuideTip();
  }
  if (q("newsDayTag")) q("newsDayTag").textContent = `第${45 - game.timeLeft}天`;
  if (q("newsHeadline")) q("newsHeadline").textContent = game.todayNews?.title || "【市场平稳】";
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

  if (selectedMarket != null && !game.market.some((x) => x.id === selectedMarket)) selectedMarket = null;
  if (selectedInv != null && !game.inv.some((x) => x.id === selectedInv)) selectedInv = null;

  renderTable("marketTable", game.market, ["name", "price"], selectedMarket, (id) => {
    selectedMarket = id;
    prefillTradeCounts({ buy: true });
    render();
  });
  renderInventoryTable();

  const invSet = new Set(game.inv.map((x) => x.id));
  document.querySelectorAll("#marketTable tbody tr").forEach((tr, i) => {
    const m = game.market[i];
    if (m && invSet.has(m.id)) tr.classList.add("owned");
  });
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
  updateExpandGuideTip();

  const buyCap = selectedMarket != null ? maxBuyCount(selectedMarket) : 0;
  const sellCap = selectedInv != null ? maxSellCount(selectedInv) : 0;
  if (q("tradeHint")) {
    const buyText = selectedMarket == null ? "先在黑市选商品" : `最多可买 ${buyCap}`;
    const sellText = selectedInv == null ? "先在持仓选商品" : `最多可卖 ${sellCap}`;
    q("tradeHint").textContent = `${buyText} ｜ ${sellText}`;
  }

  if (game.lastTrade?.type === "sell") {
    const t = game.lastTrade;
    const tradeKey = `${runId}:${t.goodsId}:${t.count}:${t.total}:${t.pnl}`;
    maybeShowDebtGuideByProfit(tradeKey, Number(t.pnl || 0));
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
    }
  }
  q("logs").innerHTML = game.logs.slice().reverse().map((x) => `<div>${x}</div>`).join("");

  if (game.lastMarketPopups && game.lastMarketPopups.length > 0) {
    if (ENABLE_RANDOM_EVENT_POPUPS) {
      modalQueue.push(...game.lastMarketPopups);
      showNextModal();
    }
    game.lastMarketPopups = [];
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
  if (game.gameOver && runUploadConsent === true && savedRunId !== runId && saveFailedRunId !== runId) saveRunToCloud();
  trackPresence();
}
q("buyBtn").addEventListener("click", () => { if (selectedMarket == null) return; game.buy(selectedMarket, nval("buyCount", 1)); prefillTradeCounts({ buy: true }); render(); });
q("sellBtn").addEventListener("click", () => { if (selectedInv == null) return; game.sell(selectedInv, nval("sellCount", 1)); prefillTradeCounts({ sell: true }); render(); });
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
q("rumorBtn").addEventListener("click", () => { game.buyRumor(); render(); });
q("newGameBtnTop").addEventListener("click", () => { startNewGameFlow(); });
q("eventOkBtn").addEventListener("click", () => { showNextModal(); });
q("startConfirmBtn").addEventListener("click", () => { closeStartModal(); });
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
  if (!cloud.user) storePendingRun("end_save");
  closeEndModal();
  saveRunToCloud(true);
});
q("endSkipBtn").addEventListener("click", () => {
  runUploadConsent = false;
  closeEndModal();
  setAuthMessage("你选择了本局不写入积分榜。");
});
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
q("uiModeToggleBtn").addEventListener("click", () => {
  forcedUiMode = isMobileUi ? "desktop" : "mobile";
  saveUiModePref(forcedUiMode);
  applyDeviceUiMode();
  render();
  showSaveBanner(`已切换到${isMobileUi ? "移动端" : "桌面端"}视图。`, 1800);
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
q("menuDesktopBtn")?.addEventListener("click", () => {
  forcedUiMode = "desktop";
  saveUiModePref(forcedUiMode);
  applyDeviceUiMode();
  closeMobileMenu();
  render();
  showSaveBanner("已切到企业桌面端。", 1800);
});
document.addEventListener("click", (ev) => {
  const card = q("mobileMenuCard");
  const btn = q("mobileMenuBtn");
  if (!card || !btn || card.classList.contains("hidden")) return;
  const target = ev.target;
  if (target instanceof Node && !card.contains(target) && !btn.contains(target)) closeMobileMenu();
});
q("capacityTargetInput").addEventListener("input", () => { renderCapacityPlan(q("capacityTargetInput").value); });
q("capacityCancelBtn").addEventListener("click", () => { closeCapacityModal(); });
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
document.querySelectorAll(".mobile-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    applyMobileView(btn.dataset.mobileTab || "trade");
  });
});
q("miniDebtCard").addEventListener("click", () => { clearDebtGuide({ openRepay: true }); });
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
window.addEventListener("resize", applyDeviceUiMode);
window.addEventListener("orientationchange", applyDeviceUiMode);
render();
initCloud();
