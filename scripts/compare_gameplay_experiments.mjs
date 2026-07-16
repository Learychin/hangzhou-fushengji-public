import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const RUNS = Math.max(20, Number(process.env.RUNS || 300));
const configPath = path.join(ROOT, "src", "config", "gameplay-experiments.json");
const experimentSet = JSON.parse(fs.readFileSync(configPath, "utf8"));
const outputRoot = path.join(ROOT, "reports", "gameplay_experiments");

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function cny(value) {
  return `¥${Math.round(Number(value) || 0).toLocaleString("zh-CN")}`;
}

function profile(summary, id) {
  return summary.summaries.find((row) => row.id === id);
}

function closeness(value, target, tolerance) {
  return Math.max(0, 1 - Math.abs(value - target) / tolerance);
}

function candidateScore(data) {
  const impulsive = profile(data, "impulsive_novice");
  const novice = profile(data, "novice_conservative");
  const thumb = profile(data, "thumb_baseline");
  const aggressive = profile(data, "aggressive_expand");
  if (!impulsive || !novice || !thumb || !aggressive) return 0;
  return (
    closeness(impulsive.day10BreakEvenRate, 0.38, 0.38) * 22
    + closeness(impulsive.earlySurpriseRate, 0.28, 0.28) * 18
    + closeness(impulsive.negativeRate, 0.38, 0.38) * 16
    + closeness(novice.day10BreakEvenRate, 0.72, 0.45) * 10
    + closeness(thumb.tenMillionRate, 0.22, 0.3) * 12
    + (1 - Math.min(1, thumb.negativeRate / 0.2)) * 12
    + closeness(aggressive.negativeRate, 0.18, 0.3) * 10
  );
}

fs.mkdirSync(outputRoot, { recursive: true });
const results = [];

for (const variant of experimentSet.variants) {
  const relativeOut = path.join("reports", "gameplay_experiments", variant.id);
  const run = spawnSync(process.execPath, ["scripts/backtest_balance_ux.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      RUNS: String(RUNS),
      EXPERIMENT_ID: variant.id,
      OUT_DIR: relativeOut,
    },
    encoding: "utf8",
  });
  if (run.status !== 0) {
    process.stderr.write(run.stderr || run.stdout || `Experiment failed: ${variant.id}\n`);
    process.exit(run.status || 1);
  }
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, relativeOut, "runs.json"), "utf8"));
  results.push({
    id: variant.id,
    name: variant.name,
    hypothesis: variant.hypothesis,
    score: candidateScore(data),
    summaries: data.summaries,
  });
  process.stdout.write(`${variant.name}: ${RUNS * data.summaries.length} 局完成\n`);
}

results.sort((left, right) => right.score - left.score);
const lines = [
  "# 杭州浮生 五档内部节奏初筛",
  "",
  `生成时间：${new Date().toISOString()}`,
  `每档每类策略：${RUNS} 局`,
  `合计：${RUNS * results.length * 5} 局`,
  "",
  "> 此排序只用于缩小真人试玩范围，不是最终上线结论。分数偏好：新手前期有希望、熟练玩家仍有上限、激进路线保留翻车风险。",
  "",
  "| 初筛 | 内部方案 | 冲动新手10天回正 | 冲动新手早期惊喜 | 冲动新手负资产 | 保守新手10天回正 | 普通流中位分 | 普通流千万率 | 激进负资产 | 场均新闻 |",
  "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...results.map((result) => {
    const impulsive = profile(result, "impulsive_novice");
    const novice = profile(result, "novice_conservative");
    const thumb = profile(result, "thumb_baseline");
    const aggressive = profile(result, "aggressive_expand");
    return `| ${result.score.toFixed(1)} | ${result.name} | ${pct(impulsive.day10BreakEvenRate)} | ${pct(impulsive.earlySurpriseRate)} | ${pct(impulsive.negativeRate)} | ${pct(novice.day10BreakEvenRate)} | ${cny(thumb.scoreMedian)} | ${pct(thumb.tenMillionRate)} | ${pct(aggressive.negativeRate)} | ${thumb.avgMarketNews.toFixed(1)} |`;
  }),
  "",
  "## 方案假设",
  "",
  ...results.map((result) => `- **${result.name}**：${result.hypothesis}`),
  "",
  "## 下一轮门槛",
  "",
  "- 优先保留 2-3 档做自动试玩和手机真人盲测，不直接采用机器排名第一名。",
  "- 冲动新手前 10 天回正不能仍停留在个位数，也不应接近必胜。",
  "- 普通流不能继续出现接近一半的千万局，否则朋友间战绩很快失去区分度。",
  "- 新闻更多时，必须通过事件链和文案去重避免信息疲劳。",
  "",
];

const reportPath = path.join(outputRoot, "comparison.md");
const rawPath = path.join(outputRoot, "comparison.json");
fs.writeFileSync(reportPath, lines.join("\n"));
fs.writeFileSync(rawPath, JSON.stringify({ generatedAt: new Date().toISOString(), runsPerProfile: RUNS, results }, null, 2));

console.log(`Comparison: ${reportPath}`);
