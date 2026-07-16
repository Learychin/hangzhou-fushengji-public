import { spawn } from "node:child_process";

const TARGET_URL = process.env.TARGET_URL || "";
const MAX_ATTEMPTS = Number(process.env.MOBILE_SMOKE_ATTEMPTS || 2);
const VIEWPORTS = (process.env.MOBILE_VIEWPORTS || "360x740,390x844,430x932")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => {
    const match = item.match(/^(\d+)x(\d+)$/);
    if (!match) throw new Error(`Invalid viewport "${item}". Use WIDTHxHEIGHT, for example 390x844.`);
    return { width: Number(match[1]), height: Number(match[2]) };
  });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOneAttempt(viewport, attempt) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/smoke_mobile_cdp.mjs"], {
      env: {
        ...process.env,
        TARGET_URL,
        MOBILE_WIDTH: String(viewport.width),
        MOBILE_HEIGHT: String(viewport.height),
        CDP_PORT: process.env.CDP_PORT || "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const label = `${viewport.width}x${viewport.height}`;
      if (code === 0) {
        console.log(stdout.trim());
        resolve();
        return;
      }
      reject(new Error(`Mobile viewport smoke failed at ${label} (attempt ${attempt}/${MAX_ATTEMPTS})\n${stdout}${stderr}`.trim()));
    });
  });
}

async function runOne(viewport) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await runOneAttempt(viewport, attempt);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_ATTEMPTS) break;
      console.warn(`${error.message}\nRetrying ${viewport.width}x${viewport.height}...`);
      await sleep(800);
    }
  }
  throw lastError;
}

console.log(`Running mobile viewport smoke ${TARGET_URL ? `against ${TARGET_URL}` : "with temporary local previews"}`);
for (const viewport of VIEWPORTS) {
  await runOne(viewport);
}
console.log(`Mobile viewport smoke passed: ${VIEWPORTS.map((v) => `${v.width}x${v.height}`).join(", ")}`);
