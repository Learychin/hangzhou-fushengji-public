import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const CANDIDATES = String(process.env.CANDIDATES || "small_goods_comeback,clue_balanced")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const RUNS = Math.max(100, Number(process.env.RUNS || 2000));
const BATCHES = Math.max(2, Math.min(10, Number(process.env.BATCHES || 5)));
const SEED_BASE = Number(process.env.SEED_BASE || 2026071601);
const OUT_ROOT = path.join(ROOT, "reports", "gameplay_experiments", "candidate_stability");
const experimentSet = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "config", "gameplay-experiments.json"), "utf8"));

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function cny(value) {
  return `¥${Math.round(Number(value) || 0).toLocaleString("zh-CN")}`;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function rate(rows, predicate) {
  return rows.length ? rows.filter(predicate).length / rows.length : 0;
}

function ratioRange(values) {
  const finite = values.filter(Number.isFinite);
  return {
    min: finite.length ? Math.min(...finite) : 0,
    max: finite.length ? Math.max(...finite) : 0,
  };
}

function profileMetrics(rows, id) {
  const selected = rows.filter((row) => row.profile === id);
  const starts = selected.reduce((sum, row) => sum + (row.story?.chainStarts || 0), 0);
  const completions = selected.reduce((sum, row) => sum + (row.story?.chainCompletions || 0), 0);
  return {
    runs: selected.length,
    day10Profit: rate(selected, (row) => row.experience?.firstProfitableSaleDay !== null && row.experience.firstProfitableSaleDay <= 10),
    day10BreakEven: rate(selected, (row) => row.experience?.firstBreakEvenDay !== null && row.experience.firstBreakEvenDay <= 10),
    earlySurprise: rate(selected, (row) => (row.experience?.maxEarlyTradePnl || 0) >= 10_000),
    negative: rate(selected, (row) => row.score < 0),
    tenMillion: rate(selected, (row) => row.score >= 10_000_000),
    traceableStory: rate(selected, (row) => (row.experience?.maxNewsAssistedPnl || 0) >= 3000),
    strongStory: rate(selected, (row) => (row.experience?.maxNewsAssistedPnl || 0) >= 10_000),
    overload: rate(selected, (row) => row.story?.overloaded === true),
    chainCompletion: starts > 0 ? completions / starts : 0,
    scoreMedian: median(selected.map((row) => row.score)),
    warnings: selected.reduce((sum, row) => sum + (row.warnings?.length || 0), 0),
  };
}

function cohortMetrics(runs) {
  const cohortSize = Math.ceil(RUNS / BATCHES);
  const cohorts = [];
  for (let index = 0; index < BATCHES; index += 1) {
    const firstSeed = SEED_BASE + index * cohortSize;
    const lastSeed = Math.min(SEED_BASE + RUNS, firstSeed + cohortSize);
    const selected = runs.filter((row) => row.seed >= firstSeed && row.seed < lastSeed);
    if (!selected.length) continue;
    cohorts.push({
      index: index + 1,
      firstSeed,
      lastSeed: lastSeed - 1,
      impulsive: profileMetrics(selected, "impulsive_novice"),
      thumb: profileMetrics(selected, "thumb_baseline"),
    });
  }
  return cohorts;
}

function stabilityRanges(cohorts) {
  const range = (profile, key) => ratioRange(cohorts.map((cohort) => cohort[profile][key]));
  return {
    impulsiveBreakEven: range("impulsive", "day10BreakEven"),
    impulsiveSurprise: range("impulsive", "earlySurprise"),
    impulsiveNegative: range("impulsive", "negative"),
    impulsiveStory: range("impulsive", "traceableStory"),
    impulsiveOverload: range("impulsive", "overload"),
    thumbMedian: range("thumb", "scoreMedian"),
    thumbTenMillion: range("thumb", "tenMillion"),
    thumbStory: range("thumb", "traceableStory"),
  };
}

function closeness(value, target, tolerance) {
  return Math.max(0, 1 - Math.abs(value - target) / tolerance);
}

function machineScore(result) {
  const novice = result.overall.impulsive;
  const thumb = result.overall.thumb;
  return (
    closeness(novice.day10BreakEven, 0.33, 0.28) * 24
    + closeness(novice.negative, 0.22, 0.25) * 18
    + closeness(novice.earlySurprise, 0.2, 0.22) * 14
    + closeness(thumb.tenMillion, 0.18, 0.25) * 12
    + Math.min(1, novice.traceableStory / 0.55) * 14
    + Math.min(1, thumb.chainCompletion / 0.9) * 10
    + (1 - Math.min(1, novice.overload / 0.4)) * 8
  );
}

fs.mkdirSync(OUT_ROOT, { recursive: true });
const results = [];
for (const candidateId of CANDIDATES) {
  const variant = experimentSet.variants.find((item) => item.id === candidateId);
  if (!variant) throw new Error(`Unknown candidate: ${candidateId}`);
  const relativeOut = path.join("reports", "gameplay_experiments", "candidate_stability", candidateId);
  const run = spawnSync(process.execPath, ["scripts/backtest_balance_ux.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      EXPERIMENT_ID: candidateId,
      RUNS: String(RUNS),
      SEED_BASE: String(SEED_BASE),
      OUT_DIR: relativeOut,
    },
    encoding: "utf8",
  });
  if (run.status !== 0) {
    process.stderr.write(run.stderr || run.stdout || `Candidate failed: ${candidateId}\n`);
    process.exit(run.status || 1);
  }
  process.stdout.write(run.stdout || "");
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, relativeOut, "runs.json"), "utf8"));
  const cohorts = cohortMetrics(data.runs);
  const result = {
    id: candidateId,
    name: variant.name,
    hypothesis: variant.hypothesis,
    overall: {
      impulsive: profileMetrics(data.runs, "impulsive_novice"),
      thumb: profileMetrics(data.runs, "thumb_baseline"),
    },
    cohorts,
    ranges: stabilityRanges(cohorts),
  };
  result.machineScore = machineScore(result);
  results.push(result);
}

results.sort((left, right) => right.machineScore - left.machineScore);
const rangePct = (range) => `${pct(range.min)}-${pct(range.max)}`;
const lines = [
  "# 两档候选节奏稳定性与故事性复测",
  "",
  `生成时间：${new Date().toISOString()}`,
  `每档每类策略：${RUNS} 局；每档合计：${RUNS * 5} 局`,
  `独立种子批次：${BATCHES}`,
  "",
  "> 机器分只用于发现不稳定与不公平边界。最终上线选择仍以朋友盲测的自然重玩率、复述故事和公平感为准。",
  "",
  "## 总体对比",
  "",
  "| 内部方案 | 机器辅助分 | 冲动新手10天回正 | 冲动新手负资产 | 冲动新手早期惊喜 | 可追溯故事 | 信息过载 | 普通流中位分 | 普通流千万率 | 新闻链完成率 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...results.map((result) => {
    const novice = result.overall.impulsive;
    const thumb = result.overall.thumb;
    return `| ${result.name} | ${result.machineScore.toFixed(1)} | ${pct(novice.day10BreakEven)} | ${pct(novice.negative)} | ${pct(novice.earlySurprise)} | ${pct(novice.traceableStory)} | ${pct(novice.overload)} | ${cny(thumb.scoreMedian)} | ${pct(thumb.tenMillion)} | ${pct(thumb.chainCompletion)} |`;
  }),
  "",
  "## 批次波动范围",
  "",
  "| 内部方案 | 新手10天回正 | 新手负资产 | 新手早期惊喜 | 新手可追溯故事 | 新手信息过载 | 普通流中位分 | 普通流千万率 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  ...results.map((result) => `| ${result.name} | ${rangePct(result.ranges.impulsiveBreakEven)} | ${rangePct(result.ranges.impulsiveNegative)} | ${rangePct(result.ranges.impulsiveSurprise)} | ${rangePct(result.ranges.impulsiveStory)} | ${rangePct(result.ranges.impulsiveOverload)} | ${cny(result.ranges.thumbMedian.min)}-${cny(result.ranges.thumbMedian.max)} | ${rangePct(result.ranges.thumbTenMillion)} |`),
  "",
  "## 当前机器判断",
  "",
  `- 暂列第一：**${results[0]?.name || "无"}**。这表示其数值更接近当前门槛，不等于已经选为公开版本。`,
  "- 重点观察冲动新手：10 天回正目标 20%-45%，最终负资产目标 10%-35%，不能靠接近必胜换取爽感。",
  "- 话题性只认“新闻线索与玩家交易形成因果”的局；纯随机爆红不单独算作优秀故事。",
  "- 同一天出现三条以上新闻记为信息过载；真人测试仍需确认玩家实际看到的弹窗频率与疲劳感。",
  "",
];

const reportPath = path.join(OUT_ROOT, "comparison.md");
const rawPath = path.join(OUT_ROOT, "comparison.json");
fs.writeFileSync(reportPath, lines.join("\n"));
fs.writeFileSync(rawPath, JSON.stringify({ generatedAt: new Date().toISOString(), runsPerProfile: RUNS, batches: BATCHES, seedBase: SEED_BASE, results }, null, 2));
console.log(`Candidate stability report: ${reportPath}`);
console.log(`Candidate stability data: ${rawPath}`);
