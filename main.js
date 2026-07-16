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
function buildShareText(stats = readLocalRunStats()) {
  const grade = runGrade(game.score);
  const city = cityExpansionState(game.score);
  const bestPart = stats?.isNewBest ? "本机新纪录" : `本机最佳 ${cny(stats?.bestScore || game.score)}`;
  const cityPart = city.canLeave
    ? `已解锁 ${city.latest.label}`
    : `距离 ${city.next?.label || "下一城"} 还差 ${cny(city.gap)}`;
  const link = window.location.href.split("#")[0];
  return [
    `我在《杭州浮生记》跑完一局：${grade.label}`,
    `总分 ${cny(game.score)}，${bestPart}`,
    `用时 ${formatDuration(runEndedElapsedSeconds ?? getRunElapsedSeconds())}，连赚最高 x${maxProfitStreak}，最大单笔 ${runBestProfit > 0 ? cnyCompact(runBestProfit) : "暂无"}`,
    cityPart,
    `${TARGET_SESSION_MINUTES} 分钟 ${TOTAL_DAYS} 天，你来超过我：${link}`,
  ].join("\n");
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
  const title = "杭州浮生记战报";
  const url = window.location.href.split("#")[0];
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
  game.cityLabels.forEach((name, idx) => {
    const loc = idx + 1;
    const district = game.locationDistricts[idx] || "shangcheng";
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
    selectedMarket = null;
    selectedInv = null;
    setMobileTradeMode("buy", false);
    marketRefreshPending = true;
  }
  render();
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
  if (isMobileUi) applyMobileView(mobileView);
  else body.classList.remove("mobile-view-trade", "mobile-view-market", "mobile-view-inventory", "mobile-view-status");
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
function gameSnapshot() {
  return {
    experiment_key: game.experimentKey || game.experimentConfig?.experimentId || "control",
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
  return {
    platform_meta: window.BFSJ_PLATFORM?.runMeta?.() || {},
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
async function saveGuestRunToCloud(manual = false, nicknameOverride = null) {
  if (!cloud.client) {
    if (manual) setAuthMessage("云端未连接，无法保存游客战绩。");
    return false;
  }
  if (savedRunId === runId) {
    if (manual) setAuthMessage("本局结果已经保存过了。");
    return true;
  }
  const defaultName = window.localStorage.getItem(LAST_GUEST_NICK_KEY) || "";
  const nameRaw = nicknameOverride == null
    ? window.prompt("输入上榜昵称（1-24字）：", defaultName || "杭州路人甲")
    : nicknameOverride;
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
  const platformMeta = window.BFSJ_PLATFORM?.runMeta?.() || {};
  const guestPayload = {
    ...platformMeta,
    experiment_key: snapshot.experiment_key,
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
  const platformMeta = window.BFSJ_PLATFORM?.runMeta?.() || {};
  const { data, error } = await cloud.client.from("game_runs").insert({
    ...platformMeta,
    experiment_key: snapshot.experiment_key,
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
    ...(pending.platform_meta || {}),
    experiment_key: pending.final_state?.experiment_key || "control",
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
    return {
      mode: "sell",
      title: inv ? inv.name : "选择持仓",
      meta: inv && quote?.ok
        ? `持有 ${inv.count} · 卖价 ${cny(quote.avgUnit)} · ${pnl >= 0 ? "+" : ""}${cny(pnl)}`
        : inv
          ? "本地暂不收，换个地点看看"
          : "点选持仓后卖出",
      cap,
      primary: "卖出",
      maxLabel: cap > 0 ? `全部卖出 ${cap}` : "全部卖出",
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
    maxLabel: cap > 0 ? `全部买入 ${cap}` : "全部买入",
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
  if (state.mode === "buy" && selectedMarket != null) {
    const row = game.market.find((item) => item.id === selectedMarket);
    if (row) {
      const unit = discountedBuyUnitPrice(row.price, qty);
      state.meta = `买价 ${cny(unit)}${unit < row.price ? " · 批量议价" : ""} · 最多 ${state.cap}`;
    }
  }
  dock.classList.toggle("mode-sell", state.mode === "sell");
  dock.classList.toggle("mode-buy", state.mode !== "sell");
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
      ? `<span>${state.mode === "sell" ? "全部卖出" : "全部买入"}</span><strong>${state.cap}</strong>`
      : `<span>${state.mode === "sell" ? "全部卖出" : "全部买入"}</span>`;
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
function showNextModal() { const modal = q("eventModal"); const body = q("eventBody"); if (modalQueue.length === 0) { modal.classList.add("hidden"); body.textContent = ""; return; } body.textContent = modalQueue.shift(); modal.classList.remove("hidden"); }
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
      setMobileTradeMode("buy", true);
      prefillTradeCounts({ buy: true });
      render();
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
    tb.innerHTML = `<tr class="empty-row"><td colspan="3">买入后会在这里显示卖价和盈亏</td></tr>`;
    return;
  }
  for (const row of game.inv) {
    const tr = document.createElement("tr");
    if (row.id === selectedInv) tr.classList.add("selected");
    tr.addEventListener("click", () => {
      selectedInv = row.id;
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
  game.newGame();
  selectedMarket = null;
  selectedInv = null;
  setMobileTradeMode("buy", true);
  runId += 1;
  savedRunId = null;
  saveFailedRunId = null;
  runUploadConsent = null;
  endFeedbackSubmittedRunId = null;
  lastRecordedEndStatsRunId = null;
  runStartedAtMs = Date.now();
  runEndedElapsedSeconds = null;
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
  softTap(state.mode === "sell" ? [10, 28, 14] : 8);
  if (state.mode === "sell") {
    game.sell(selectedInv, count);
    prefillTradeCounts({ sell: true });
  } else {
    game.buy(selectedMarket, count);
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
  if (!cloud.user) {
    storePendingRun("end_save");
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
  setAuthMessage("本局已暂存在本机，稍后仍可上榜。");
});
q("endSkipBtn").addEventListener("click", () => {
  runUploadConsent = false;
  closeEndModal();
  closeGuestSaveModal();
  setAuthMessage("你选择了本局不写入积分榜。");
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
q("uiModeToggleBtn")?.remove();
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
