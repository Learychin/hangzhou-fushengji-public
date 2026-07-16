import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readGameVersion() {
  const raw = fs.readFileSync(path.join(ROOT, "src", "engine", "game-engine.js"), "utf8");
  const match = raw.match(/GAME_VERSION_CODE\s*=\s*["']([^"']+)["']/);
  if (!match?.[1]) throw new Error("Could not read GAME_VERSION_CODE from game engine");
  return match[1];
}

function latestManualReport() {
  const dir = path.join(ROOT, "reports", "manual_mobile_check");
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".md")).sort()
    : [];
  if (!files.length) return "";
  return path.join(dir, files[files.length - 1]);
}

function cleanCell(value) {
  const text = String(value || "").trim();
  if (!text || text === "-" || text === "未填" || text === "未测") return "";
  return text;
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith("|")) continue;
    const header = splitRow(lines[i]);
    const separator = splitRow(lines[i + 1] || "");
    if (!isSeparator(separator)) continue;
    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith("|")) {
      const cells = splitRow(lines[j]);
      if (!isSeparator(cells)) rows.push(cells);
      j += 1;
    }
    tables.push({ header, rows });
    i = j - 1;
  }
  return tables;
}

function tableObjects(table) {
  return table.rows.map((row) => {
    const out = {};
    table.header.forEach((header, index) => {
      out[header] = cleanCell(row[index]);
    });
    return out;
  });
}

function parseMinutes(value) {
  const text = cleanCell(value).replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const minutes = Number(match[0]);
  return Number.isFinite(minutes) ? minutes : null;
}

function parseScore(value) {
  const text = cleanCell(value).replace(/[,，¥￥\s]/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const score = Number(match[0]);
  return Number.isFinite(score) ? score : null;
}

function yesish(value) {
  const text = cleanCell(value);
  return text === "是" || text === "正常" || text === "愿意" || text === "基本是" || /^yes$/i.test(text) || /^mostly$/i.test(text);
}

function noBlock(value) {
  const text = cleanCell(value);
  return text === "没有" || text === "无" || /^no$/i.test(text);
}

function durationHit(row, minutes) {
  const explicit = cleanCell(row["8-12 分钟"]);
  if (explicit) return yesish(explicit);
  return minutes != null && minutes >= 8 && minutes <= 12;
}

function normalizeRun(row) {
  const minutes = parseMinutes(row["用时"]);
  const score = parseScore(row["最终分"]);
  const device = cleanCell(row["设备"]);
  return {
    device,
    browser: cleanCell(row["浏览器"]),
    run: cleanCell(row["局数"]),
    minutes,
    durationHit: durationHit(row, minutes),
    mainButton: cleanCell(row["只用主按钮"]),
    mainButtonOk: yesish(row["只用主按钮"]),
    blocked: cleanCell(row["卡住/遮挡"]),
    noBlock: noBlock(row["卡住/遮挡"]),
    score,
    startGoal: cleanCell(row["开局目标"]),
    replayGoal: cleanCell(row["再来一局目标"]),
    replayIntent: cleanCell(row["愿意再开"] || row["愿不愿意再开"]),
    replayYes: yesish(row["愿意再开"] || row["愿不愿意再开"]),
    restore: cleanCell(row["刷新恢复"]),
    restoreOk: row["刷新恢复"] == null ? false : yesish(row["刷新恢复"]),
  };
}

function findRunRows(markdown) {
  const candidates = parseTables(markdown)
    .filter((table) => table.header.includes("设备") && table.header.includes("用时") && table.header.includes("卡住/遮挡"))
    .flatMap(tableObjects)
    .map(normalizeRun);
  return candidates.filter((row) => row.device);
}

function parseChecklist(markdown) {
  const checks = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.+?)\s*$/);
    if (!match) continue;
    checks.push({ checked: match[1].toLowerCase() === "x", label: match[2] });
  }
  return checks;
}

function parseVersion(markdown) {
  const match = markdown.match(/^- 版本：\s*(.+?)\s*$/m);
  return cleanCell(match?.[1] || "");
}

function parseMainJsVersion(markdown) {
  const match = markdown.match(/^- main\.js 版本：\s*(.+?)\s*$/m);
  return cleanCell(match?.[1] || "");
}

function evaluateReport(markdown, expectedVersion) {
  const problems = [];
  const warnings = [];
  const runs = findRunRows(markdown);
  const filledRuns = runs.filter((run) => (
    run.minutes != null
    && run.score != null
    && run.startGoal
    && run.replayGoal
    && run.mainButton
    && run.blocked
    && run.replayIntent
  ));
  const iphoneRuns = filledRuns.filter((run) => /iphone/i.test(run.device));
  const androidRuns = filledRuns.filter((run) => /android/i.test(run.device));
  const durationHits = filledRuns.filter((run) => run.durationHit);
  const cleanRuns = filledRuns.filter((run) => run.noBlock);
  const mainButtonRuns = filledRuns.filter((run) => run.mainButtonOk);
  const replayRuns = filledRuns.filter((run) => run.replayYes);
  const restoreRows = filledRuns.filter((run) => run.restore);
  const restoreOkRuns = filledRuns.filter((run) => run.restoreOk);
  const checklist = parseChecklist(markdown);
  const checkedLabels = checklist.filter((item) => item.checked).map((item) => item.label).join("\n");
  const unchecked = checklist.filter((item) => !item.checked);
  const version = parseVersion(markdown);
  const mainVersion = parseMainJsVersion(markdown);

  if (!version) problems.push("缺少版本号。");
  else if (version !== expectedVersion) problems.push(`验收摘要版本 ${version} 与当前游戏版本 ${expectedVersion} 不一致。`);
  if (!mainVersion) problems.push("缺少手机环境里的 main.js 版本。请先在辅助页点“刷新自检”再生成摘要。");
  else if (mainVersion !== expectedVersion) problems.push(`手机加载的 main.js 版本 ${mainVersion} 与当前游戏版本 ${expectedVersion} 不一致。`);
  if (filledRuns.length < 6) problems.push(`真机记录不足 6 局：当前 ${filledRuns.length}/6。`);
  if (iphoneRuns.length < 3) problems.push(`iPhone Safari 记录不足 3 局：当前 ${iphoneRuns.length}/3。`);
  if (androidRuns.length < 3) problems.push(`Android Chrome 记录不足 3 局：当前 ${androidRuns.length}/3。`);
  if (durationHits.length < 4) problems.push(`8-12 分钟命中不足：当前 ${durationHits.length}/6，要求至少 4/6。`);
  if (cleanRuns.length < filledRuns.length || cleanRuns.length < 6) problems.push(`存在卡住/遮挡记录或未确认无遮挡：无明显问题 ${cleanRuns.length}/6。`);
  if (mainButtonRuns.length < filledRuns.length || mainButtonRuns.length < 6) problems.push(`存在不能主要靠底部主按钮完成的记录：主按钮通过 ${mainButtonRuns.length}/6。`);
  if (replayRuns.length < 4) problems.push(`愿意再开不足：当前 ${replayRuns.length}/6，要求至少 4/6。`);
  if (restoreRows.length < 6) problems.push("每局记录缺少“刷新恢复”证据，请使用新版辅助页摘要。");
  else if (restoreOkRuns.length < 6) problems.push(`刷新恢复异常或未通过：当前正常 ${restoreOkRuns.length}/6。`);
  if (!checkedLabels.includes("首屏无横向滚动")) problems.push("必过项未确认：首屏无横向滚动。");
  if (!checkedLabels.includes("底部主按钮")) problems.push("必过项未确认：底部主按钮/安全区。");
  if (!checkedLabels.includes("结算页")) problems.push("必过项未确认：结算页信息完整。");
  if (!checkedLabels.includes("再来一局")) problems.push("必过项未确认：再来一局目标和再开意愿。");
  if (!checkedLabels.includes("主屏") && !checkedLabels.includes("PWA")) problems.push("必过项未确认：添加到主屏/PWA。");
  if (unchecked.length) warnings.push(`仍有 ${unchecked.length} 个未勾选清单项。`);

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    summary: {
      version,
      mainVersion,
      filledRuns: filledRuns.length,
      iphoneRuns: iphoneRuns.length,
      androidRuns: androidRuns.length,
      durationHits: durationHits.length,
      cleanRuns: cleanRuns.length,
      mainButtonRuns: mainButtonRuns.length,
      replayRuns: replayRuns.length,
      restoreOkRuns: restoreOkRuns.length,
      checklistChecked: checklist.filter((item) => item.checked).length,
      checklistTotal: checklist.length,
    },
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/check_manual_mobile_report.mjs [path/to/report.md]",
    "  cat report.md | node scripts/check_manual_mobile_report.mjs -",
    "",
    "If no path is provided, the latest reports/manual_mobile_check/*.md file is used.",
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const expectedVersion = readGameVersion();
const inputPath = args[0] || latestManualReport();
if (!inputPath) {
  console.error("No manual mobile report found.");
  console.error(usage());
  process.exit(1);
}
const markdown = inputPath === "-"
  ? fs.readFileSync(0, "utf8")
  : fs.readFileSync(path.resolve(ROOT, inputPath), "utf8");
const result = evaluateReport(markdown, expectedVersion);

if (args.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const source = inputPath === "-" ? "stdin" : path.relative(ROOT, path.resolve(ROOT, inputPath));
  console.log(`Mobile real-device report check: ${source}`);
  console.log(`Version: ${result.summary.version || "missing"} / main.js ${result.summary.mainVersion || "missing"}`);
  console.log(`Runs: ${result.summary.filledRuns}/6 (iPhone ${result.summary.iphoneRuns}/3, Android ${result.summary.androidRuns}/3)`);
  console.log(`8-12min: ${result.summary.durationHits}/6; clean: ${result.summary.cleanRuns}/6; replay: ${result.summary.replayRuns}/6; restore: ${result.summary.restoreOkRuns}/6`);
  for (const warning of result.warnings) console.log(`Warning: ${warning}`);
  if (result.ok) {
    console.log("Manual mobile report passed.");
  } else {
    console.error("Manual mobile report failed:");
    for (const problem of result.problems) console.error(`- ${problem}`);
  }
}

if (!result.ok) process.exit(1);
