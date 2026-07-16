import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const enginePath = path.join(ROOT, "src", "engine", "game-engine.js");
const rootMainPath = path.join(ROOT, "main.js");
const webMainPath = path.join(ROOT, "web_mvp", "main.js");
const experimentCatalogPath = path.join(ROOT, "src", "config", "gameplay-experiments.json");
const webExperimentCatalogPath = path.join(ROOT, "web_mvp", "assets", "gameplay-experiments.json");
const qaCatalogScriptPath = path.join(ROOT, "assets", "gameplay-experiments.js");
const webQaCatalogScriptPath = path.join(ROOT, "web_mvp", "assets", "gameplay-experiments.js");
const marker = "\nconst game = new GameEngine();";
const syncedUiBlocks = [
  ["function recommendedCapacityExpansion()", "function renderCapacityPlan("],
];

function replaceBlock(target, source, startMarker, endMarker) {
  const sourceStart = source.indexOf(startMarker);
  const sourceEnd = source.indexOf(endMarker, sourceStart);
  const targetStart = target.indexOf(startMarker);
  const targetEnd = target.indexOf(endMarker, targetStart);
  if ([sourceStart, sourceEnd, targetStart, targetEnd].some((index) => index < 0)) {
    throw new Error(`Could not sync UI block starting with ${startMarker}`);
  }
  return `${target.slice(0, targetStart)}${source.slice(sourceStart, sourceEnd)}${target.slice(targetEnd)}`;
}

const engine = fs.readFileSync(enginePath, "utf8").trimEnd();
const rootMain = fs.readFileSync(rootMainPath, "utf8");
const webMain = fs.readFileSync(webMainPath, "utf8");
const rootMarker = rootMain.indexOf(marker);
const webMarker = webMain.indexOf(marker);

if (rootMarker < 0 || webMarker < 0) throw new Error("Could not find GameEngine runtime boundary");

const runtimeHeader = rootMain.slice(0, rootMarker).trim();
let webUi = webMain.slice(webMarker);
const helperStart = webUi.indexOf("\nfunction discountedBuyUnitPrice(");
const helperEnd = helperStart >= 0 ? webUi.indexOf("\nfunction maxBuyCount(", helperStart) : -1;
if (helperStart >= 0 && helperEnd > helperStart) {
  webUi = `${webUi.slice(0, helperStart)}${webUi.slice(helperEnd)}`;
}
for (const [startMarker, endMarker] of syncedUiBlocks) {
  webUi = replaceBlock(webUi, rootMain, startMarker, endMarker);
}

fs.writeFileSync(webMainPath, `${engine}\n\n${runtimeHeader}${webUi.trimEnd()}\n`);
fs.mkdirSync(path.dirname(webExperimentCatalogPath), { recursive: true });
fs.copyFileSync(experimentCatalogPath, webExperimentCatalogPath);
const experimentCatalog = JSON.parse(fs.readFileSync(experimentCatalogPath, "utf8"));
const qaCatalogScript = `"use strict";\nwindow.BFSJ_QA_EXPERIMENTS = ${JSON.stringify(experimentCatalog)};\n`;
fs.mkdirSync(path.dirname(qaCatalogScriptPath), { recursive: true });
fs.writeFileSync(qaCatalogScriptPath, qaCatalogScript);
fs.writeFileSync(webQaCatalogScriptPath, qaCatalogScript);
console.log(`Synced engine and runtime header -> ${path.relative(ROOT, webMainPath)}`);
console.log(`Synced gameplay experiment catalog -> ${path.relative(ROOT, webExperimentCatalogPath)}`);
console.log(`Generated local QA experiment scripts -> ${path.relative(ROOT, qaCatalogScriptPath)}, ${path.relative(ROOT, webQaCatalogScriptPath)}`);
