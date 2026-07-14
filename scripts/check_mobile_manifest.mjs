import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PRODUCTION_ROOT = path.join(ROOT, "web_mvp");
const FILES = [path.join(PRODUCTION_ROOT, "manifest.webmanifest")];

for (const file of FILES) {
  const raw = fs.readFileSync(file, "utf8");
  const manifest = JSON.parse(raw);
  const problems = [];
  if (manifest.name !== "杭州浮生记") problems.push("name mismatch");
  if (manifest.display !== "standalone") problems.push("display must be standalone");
  if (manifest.orientation !== "portrait-primary") problems.push("orientation must be portrait-primary");
  if (!manifest.theme_color) problems.push("theme_color missing");
  if (!manifest.background_color) problems.push("background_color missing");
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 1) problems.push("icons missing");
  if (!manifest.icons?.some((icon) => String(icon.src || "").includes("app-icon.svg"))) problems.push("app-icon.svg missing");
  if (!manifest.icons?.some((icon) => icon.src === "./app-icon-192.png" && icon.sizes === "192x192" && icon.type === "image/png")) problems.push("192 png icon missing");
  if (!manifest.icons?.some((icon) => icon.src === "./app-icon-512.png" && icon.sizes === "512x512" && icon.type === "image/png")) problems.push("512 png icon missing");
  if (problems.length) throw new Error(`${file}: ${problems.join("; ")}`);
}

for (const file of [path.join(PRODUCTION_ROOT, "index.html")]) {
  const html = fs.readFileSync(file, "utf8");
  const problems = [];
  if (!html.includes('href="./app-icon.svg"')) problems.push("svg favicon missing");
  if (!html.includes('href="./app-icon-192.png"')) problems.push("192 png favicon missing");
  if (!html.includes('rel="apple-touch-icon" href="./app-icon-180.png"')) problems.push("apple touch png missing");
  if (problems.length) throw new Error(`${file}: ${problems.join("; ")}`);
}

for (const file of [path.join(PRODUCTION_ROOT, "app-icon.svg")]) {
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.includes("<svg") || !raw.includes("viewBox=\"0 0 512 512\"")) {
    throw new Error(`${file}: invalid app icon svg`);
  }
}

function checkPng(file, expectedSize) {
  const raw = fs.readFileSync(file);
  const signature = raw.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error(`${file}: invalid PNG signature`);
  const width = raw.readUInt32BE(16);
  const height = raw.readUInt32BE(20);
  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(`${file}: expected ${expectedSize}x${expectedSize}, got ${width}x${height}`);
  }
}

for (const dir of [PRODUCTION_ROOT]) {
  checkPng(path.join(dir, "app-icon-180.png"), 180);
  checkPng(path.join(dir, "app-icon-192.png"), 192);
  checkPng(path.join(dir, "app-icon-512.png"), 512);
}

for (const file of [path.join(PRODUCTION_ROOT, "sw.js")]) {
  const raw = fs.readFileSync(file, "utf8");
  const problems = [];
  if (!raw.includes("self.addEventListener(\"install\"")) problems.push("install handler missing");
  if (!raw.includes("self.addEventListener(\"fetch\"")) problems.push("fetch handler missing");
  if (!raw.includes("network-first")) problems.push("cache revision should mark network-first strategy");
  if (raw.includes("return cached || fresh")) problems.push("static assets must be network-first to avoid stale mobile builds");
  const requiredAssets = ["./index.html", "./styles.css", "./layout-v2.css", "./main.js", "./platform.js", "./config.js", "./manifest.webmanifest", "./app-icon.svg", "./app-icon-180.png", "./app-icon-192.png", "./app-icon-512.png"];
  for (const asset of requiredAssets) {
    if (!raw.includes(asset)) problems.push(`${asset} missing from app shell`);
  }
  if (problems.length) throw new Error(`${file}: ${problems.join("; ")}`);
}

console.log("Mobile manifest check passed");
