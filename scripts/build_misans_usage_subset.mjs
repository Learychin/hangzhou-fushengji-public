import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const WEB_ROOT = path.join(ROOT, "web_mvp");
const SOURCE_ROOT = process.env.MISANS_PACKAGE_ROOT;
const OUTPUT_ROOT = path.join(WEB_ROOT, "fonts");
const WEIGHTS = [
  { source: "Regular", cssWeight: 400 },
  { source: "Medium", cssWeight: 500 },
  { source: "Semibold", cssWeight: 600 },
  { source: "Bold", cssWeight: 700 },
];

if (!SOURCE_ROOT) {
  throw new Error("Set MISANS_PACKAGE_ROOT to the extracted misans package directory");
}

const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".svg", ".webmanifest"]);
const codepoints = new Set();

function collectText(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "fonts") continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) collectText(file);
    else if (textExtensions.has(path.extname(entry.name))) {
      for (const char of fs.readFileSync(file, "utf8")) codepoints.add(char.codePointAt(0));
    }
  }
}

function parseRanges(value) {
  return value.split(",").map((part) => {
    const [start, end = start] = part.trim().replace(/^U\+/i, "").split("-");
    return [Number.parseInt(start, 16), Number.parseInt(end, 16)];
  });
}

function isUsed(rangeText) {
  const ranges = parseRanges(rangeText);
  for (const codepoint of codepoints) {
    if (ranges.some(([start, end]) => codepoint >= start && codepoint <= end)) return true;
  }
  return false;
}

collectText(WEB_ROOT);
fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

const outputCss = [
  "/* MiSans 4.003 usage subset; font copyright Xiaomi Inc. See NOTICE.txt. */",
];
let totalBytes = 0;
let totalFiles = 0;

for (const weight of WEIGHTS) {
  const sourceDir = path.join(SOURCE_ROOT, "lib", "Normal");
  const sourceCss = fs.readFileSync(path.join(sourceDir, `MiSans-${weight.source}.min.css`), "utf8");
  const blocks = sourceCss.match(/\/\*\[[^\]]+\]\*\/@font-face\{[^}]+\}/g) || [];
  for (const block of blocks) {
    const fileName = block.match(/url\('([^']+)'\)/)?.[1];
    const range = block.match(/unicode-range:([^;}]+)/)?.[1];
    if (!fileName || !range || !isUsed(range)) continue;
    const outputName = fileName.replace(`MiSans-${weight.source}`, `MiSans-${weight.cssWeight}`);
    const sourceFile = path.join(sourceDir, fileName);
    const outputFile = path.join(OUTPUT_ROOT, outputName);
    fs.copyFileSync(sourceFile, outputFile);
    const normalized = block
      .replace(/^\/\*\[[^\]]+\]\*\//, "")
      .replace(/font-weight:[0-9]+/, `font-weight:${weight.cssWeight}`)
      .replace(fileName, outputName);
    outputCss.push(normalized);
    totalBytes += fs.statSync(outputFile).size;
    totalFiles += 1;
  }
}

fs.writeFileSync(path.join(OUTPUT_ROOT, "misans.css"), `${outputCss.join("\n")}\n`);
fs.writeFileSync(path.join(OUTPUT_ROOT, "NOTICE.txt"), [
  "This software uses MiSans, copyright Xiaomi Inc.",
  "Font source: https://hyperos.mi.com/font/en/",
  "Web usage chunks sourced from misans 4.1.0 (MiSans 4.003): https://github.com/dsrkafuu/misans",
  "Only pre-generated WOFF2 chunks whose Unicode ranges intersect this game are included.",
  "The font binaries are not modified by this build step.",
  "",
].join("\n"));

console.log(`MiSans usage subset: ${totalFiles} WOFF2 files, ${(totalBytes / 1024).toFixed(1)} KiB`);
