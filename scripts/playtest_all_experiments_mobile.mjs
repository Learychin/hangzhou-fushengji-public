import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const RUNS = Math.max(1, Number(process.env.RUNS || 3));
const WIDTH = Number(process.env.MOBILE_WIDTH || 390);
const HEIGHT = Number(process.env.MOBILE_HEIGHT || 844);
const SEED_BASE = Number(process.env.SEED_BASE || 2026071601);
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "config", "gameplay-experiments.json"), "utf8"));
const outputDir = path.join(ROOT, "reports", "mobile_playtest");

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
}

function range(values, digits = 0) {
  if (!values.length) return "-";
  const format = (value) => Number(value).toFixed(digits);
  return `${format(Math.min(...values))}-${format(Math.max(...values))}`;
}

fs.mkdirSync(outputDir, { recursive: true });
const results = [];

for (const [index, variant] of catalog.variants.entries()) {
  const run = spawnSync(process.execPath, ["scripts/playtest_mobile_3runs.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      RUNS: String(RUNS),
      MOBILE_WIDTH: String(WIDTH),
      MOBILE_HEIGHT: String(HEIGHT),
      QA_EXPERIMENT: variant.id,
      QA_FEEDBACK: "1",
      SEED: String(SEED_BASE + index * 1000),
      PLAYTEST_LABEL: `all5_${variant.id}`,
    },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(run.stdout || "");
  if (run.status !== 0) {
    process.stderr.write(run.stderr || `Mobile playtest failed for ${variant.id}\n`);
    process.exit(run.status || 1);
  }
  const reportMatch = String(run.stdout || "").match(/Report: (.+_report\.json)/);
  if (!reportMatch?.[1]) throw new Error(`Could not locate mobile report for ${variant.id}`);
  const report = JSON.parse(fs.readFileSync(reportMatch[1], "utf8"));
  const invalid = report.runs.filter((item) => (
    item.final?.daysUsed !== item.final?.totalDays
    || item.feedback?.latestExperimentKey !== variant.id
    || (item.qaErrors || []).length > 0
  ));
  if (invalid.length) throw new Error(`${variant.id}: ${invalid.length} mobile runs failed the completion or attribution gate`);
  results.push({
    id: variant.id,
    name: variant.name,
    report: reportMatch[1],
    runs: report.runs,
  });
}

const lines = [
  "# 五档隐藏玩法移动端长局汇总",
  "",
  `生成时间：${new Date().toISOString()}`,
  `视口：${WIDTH}x${HEIGHT}；每档 ${RUNS} 局；反馈归档检查：开启`,
  "",
  "| 内部方案 | 完成 | 主流程点击 | 总点击 | 估算局长 | 分数范围 | 反馈档位 |",
  "|---|---:|---:|---:|---:|---:|---|",
  ...results.map((result) => {
    const mainTaps = result.runs.map((item) => item.mainTaps);
    const taps = result.runs.map((item) => item.taps);
    const minutes = result.runs.map((item) => item.estimatedMinutes);
    const scores = result.runs.map((item) => item.final.score);
    const feedbackKeys = [...new Set(result.runs.flatMap((item) => item.feedback.experimentKeys || []))].join(", ");
    return `| ${result.name} | ${result.runs.length}/${result.runs.length} | ${range(mainTaps)} | ${range(taps)} | ${range(minutes, 1)} 分钟 | ${range(scores)} | ${feedbackKeys} |`;
  }),
  "",
  "## 自动门槛",
  "",
  "- 每局完成 45 天，无浏览器错误。",
  "- 每份离线反馈的隐藏档位与实际运行档位一致。",
  "- 单档若超过 150 次总点击或 16.5 分钟，底层长测会直接失败。",
  "",
];

const runStamp = stamp();
const markdownPath = path.join(outputDir, `${runStamp}_all5_summary.md`);
const jsonPath = path.join(outputDir, `${runStamp}_all5_summary.json`);
fs.writeFileSync(markdownPath, lines.join("\n"));
fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), viewport: { width: WIDTH, height: HEIGHT }, runsPerVariant: RUNS, results }, null, 2));
console.log(`All five mobile playtests passed: ${RUNS * results.length} runs`);
console.log(`Summary: ${markdownPath}`);
console.log(`Data: ${jsonPath}`);
