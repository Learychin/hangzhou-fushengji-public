import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const HOST = process.env.HOST || "0.0.0.0";
const START_PORT = Number(process.env.PORT || 4173);
const WRITE_MANUAL_REPORT = process.env.WRITE_MANUAL_REPORT !== "0";
const OUT_DIR = path.join(ROOT, "reports", "manual_mobile_check");

function readGameVersion() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, "src", "engine", "game-engine.js"), "utf8");
    const match = raw.match(/GAME_VERSION_CODE\s*=\s*["']([^"']+)["']/);
    if (match?.[1]) return match[1];
  } catch {
    // Keep the preview usable even if the source file cannot be read.
  }
  return "unknown";
}

const GAME_VERSION = readGameVersion();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function sendNotFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
  });
  res.end(html);
}

function checkUrlFor(url) {
  return new URL("__mobile-check", url).href;
}

function requestOrigin(req) {
  const host = req.headers.host || `127.0.0.1:${START_PORT}`;
  return `http://${host}`;
}

function buildMobileCheckPage({ origin }) {
  const gameUrl = `${origin}/`;
  const freshGameUrl = `${origin}/?mobile_check_version=${encodeURIComponent(GAME_VERSION)}`;
  const checkItems = [
    "首屏无横向滚动，底部主按钮没有被系统安全区遮挡。",
    "开局按钮显示本局目标：跟着下一步、冲目标或刷新纪录。",
    "尽量只点底部主按钮，能跑完 45 天。",
    "中途刷新一次，能回到同一局进度继续玩。",
    "盈利后能看到距下一档、连赚或破纪录反馈。",
    "结算页能看到评级、下一局目标、本局高光、本机生涯和徽章。",
    "再来一局按钮带明确目标，并且愿意再开一把。",
    "第 2 或第 3 局添加到主屏，图标、标题、主题色、底部安全区正常。",
  ];
  const runTemplate = [
    "iPhone Safari 1：用时 / 分数 / 是否 8-12 分钟 / 是否想再开",
    "iPhone Safari 2：用时 / 分数 / 是否 8-12 分钟 / 是否想再开",
    "iPhone Safari 3：用时 / 分数 / 是否 8-12 分钟 / 是否想再开",
    "Android Chrome 1：用时 / 分数 / 是否 8-12 分钟 / 是否想再开",
    "Android Chrome 2：用时 / 分数 / 是否 8-12 分钟 / 是否想再开",
    "Android Chrome 3：用时 / 分数 / 是否 8-12 分钟 / 是否想再开",
  ].join("\n");
  const runRows = [
    { device: "iPhone", browser: "Safari", run: 1 },
    { device: "iPhone", browser: "Safari", run: 2 },
    { device: "iPhone", browser: "Safari", run: 3 },
    { device: "Android", browser: "Chrome", run: 1 },
    { device: "Android", browser: "Chrome", run: 2 },
    { device: "Android", browser: "Chrome", run: 3 },
  ];
  const checklistHtml = checkItems
    .map(
      (item, index) => `
        <label class="check-row">
          <input type="checkbox" data-check-index="${index}">
          <span>${escapeHtml(item)}</span>
        </label>`,
    )
    .join("");
  const runCardsHtml = runRows
    .map(
      (row, index) => `
        <article class="run-card" data-run-card data-run-index="${index}">
          <div class="run-card-head">
            <strong>${escapeHtml(row.device)} ${escapeHtml(row.browser)} · 第 ${row.run} 局</strong>
            <span class="status-pill" data-run-badge>未填</span>
          </div>
          <button class="quick-pass-btn" type="button" data-run-quick-pass>本局顺畅：主按钮 / 无遮挡 / 愿意再开 / 恢复正常</button>
          <div class="field-grid">
            <label class="field">用时分钟
              <input inputmode="decimal" type="number" min="0" step="0.1" data-run-field="minutes" placeholder="9.4">
            </label>
            <label class="field">最终分
              <input inputmode="numeric" type="number" data-run-field="score" placeholder="908678">
            </label>
            <label class="field">只用主按钮
              <select data-run-field="mainButton">
                <option value="">未填</option>
                <option value="yes">是</option>
                <option value="mostly">基本是</option>
                <option value="no">否</option>
              </select>
            </label>
            <label class="field">卡住/遮挡
              <select data-run-field="blocked">
                <option value="">未填</option>
                <option value="no">没有</option>
                <option value="minor">轻微</option>
                <option value="yes">明显</option>
              </select>
            </label>
            <label class="field field-wide">开局目标
              <input data-run-field="startGoal" placeholder="跟着下一步 / 冲 50 万">
            </label>
            <label class="field field-wide">再来一局目标
              <input data-run-field="replayGoal" placeholder="破纪录 / 冲 ¥1,000,000">
            </label>
            <label class="field">愿意再开
              <select data-run-field="replayIntent">
                <option value="">未填</option>
                <option value="yes">愿意</option>
                <option value="maybe">一般</option>
                <option value="no">不愿意</option>
              </select>
            </label>
            <label class="field">刷新恢复
              <select data-run-field="restore">
                <option value="">未测</option>
                <option value="yes">正常</option>
                <option value="no">异常</option>
              </select>
            </label>
          </div>
        </article>`,
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <link rel="icon" href="/app-icon.svg" type="image/svg+xml">
  <title>杭州浮生记 真机验收</title>
  <style>
    :root {
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f2e9;
      color: #221a12;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(180deg, rgba(255, 248, 232, 0.95), rgba(245, 237, 222, 0.96)),
        #f6f2e9;
      padding: max(18px, env(safe-area-inset-top)) 16px max(28px, env(safe-area-inset-bottom));
    }
    main {
      max-width: 680px;
      margin: 0 auto;
    }
    .hero {
      display: grid;
      gap: 12px;
      padding: 8px 0 18px;
    }
    .eyebrow {
      margin: 0;
      font-size: 12px;
      font-weight: 800;
      color: #8b4b1d;
      letter-spacing: 0;
    }
    h1 {
      margin: 0;
      font-size: clamp(28px, 9vw, 40px);
      line-height: 1.04;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #5d4a38;
      line-height: 1.6;
    }
    .primary-link,
    button {
      min-height: 48px;
      border: 0;
      border-radius: 8px;
      padding: 13px 16px;
      font: inherit;
      font-weight: 800;
    }
    .primary-link {
      display: flex;
      align-items: center;
      justify-content: center;
      background: #17130f;
      color: #fff8e9;
      text-decoration: none;
    }
    button {
      width: 100%;
      background: #eadcc7;
      color: #2a2118;
    }
    .grid {
      display: grid;
      gap: 12px;
    }
    .panel {
      border: 1px solid rgba(60, 42, 24, 0.13);
      border-radius: 8px;
      background: rgba(255, 252, 244, 0.86);
      padding: 14px;
      box-shadow: 0 10px 24px rgba(74, 48, 22, 0.08);
    }
    .panel h2 {
      margin: 0 0 10px;
      font-size: 17px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    .meta-grid {
      display: grid;
      gap: 10px;
    }
    .meta {
      border-radius: 8px;
      background: #f2e6d3;
      padding: 12px;
      min-height: 74px;
    }
    .meta strong {
      display: block;
      margin-bottom: 4px;
      font-size: 18px;
    }
    .url-box {
      overflow-wrap: anywhere;
      border-radius: 8px;
      background: #fff8ea;
      padding: 10px;
      font-size: 13px;
      color: #6c4b28;
    }
    .check-row {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      min-height: 44px;
      padding: 9px 0;
      border-top: 1px solid rgba(60, 42, 24, 0.1);
      line-height: 1.45;
    }
    .check-row:first-child {
      border-top: 0;
    }
    input[type="checkbox"] {
      width: 22px;
      height: 22px;
      margin: 0;
      accent-color: #15120f;
    }
    textarea {
      display: block;
      width: 100%;
      min-height: 178px;
      resize: vertical;
      border: 1px solid rgba(60, 42, 24, 0.18);
      border-radius: 8px;
      padding: 12px;
      background: #fffaf0;
      color: #241b13;
      font: inherit;
      line-height: 1.55;
    }
    input,
    select {
      width: 100%;
      min-height: 44px;
      border: 1px solid rgba(60, 42, 24, 0.18);
      border-radius: 8px;
      padding: 9px 10px;
      background: #fffaf0;
      color: #241b13;
      font: inherit;
    }
    .run-grid {
      display: grid;
      gap: 10px;
    }
    .run-card {
      border: 1px solid rgba(60, 42, 24, 0.13);
      border-radius: 8px;
      background: #fff8ea;
      padding: 12px;
    }
    .run-card.current-device {
      border-color: rgba(55, 128, 67, 0.32);
      background: #f4fbef;
    }
    .run-card.next-run {
      box-shadow: 0 0 0 3px rgba(91, 148, 72, 0.18);
    }
    .run-card-head {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .quick-pass-btn {
      min-height: 44px;
      margin-bottom: 10px;
      background: #dff1df;
      color: #245b31;
      font-size: 13px;
      line-height: 1.25;
    }
    .status-pill {
      flex: 0 0 auto;
      border-radius: 999px;
      background: #eadcc7;
      padding: 5px 9px;
      color: #5c432c;
      font-size: 12px;
      font-weight: 900;
    }
    .status-pill.good {
      background: #dff1df;
      color: #245b31;
    }
    .status-pill.warn {
      background: #fff0bf;
      color: #7a4d00;
    }
    .status-pill.bad {
      background: #f8d7cf;
      color: #7a2416;
    }
    .field-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .field {
      display: grid;
      gap: 5px;
      color: #6f5439;
      font-size: 12px;
      font-weight: 900;
    }
    .field-wide {
      grid-column: 1 / -1;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 12px 0;
    }
    .summary-tile {
      border-radius: 8px;
      background: #f2e6d3;
      padding: 10px;
    }
    .summary-tile strong {
      display: block;
      font-size: 22px;
    }
    .summary-tile span {
      color: #72583e;
      font-size: 12px;
      font-weight: 800;
    }
    .gate-list {
      display: grid;
      gap: 7px;
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
    }
    .gate-list li {
      border-radius: 8px;
      background: #fff4cc;
      color: #704c10;
      padding: 8px 10px;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.35;
    }
    .gate-list li.good {
      background: #dff1df;
      color: #245b31;
    }
    .current-device-hint {
      display: grid;
      gap: 8px;
      margin: 8px 0 12px;
      border: 1px solid rgba(55, 128, 67, 0.2);
      border-radius: 8px;
      background: #eef8ec;
      padding: 10px;
      color: #285532;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.4;
    }
    .current-device-hint button {
      min-height: 40px;
      background: #dff1df;
      color: #245b31;
      font-size: 13px;
    }
    .export-box {
      min-height: 132px;
      margin-top: 10px;
      font-size: 13px;
    }
    .hint {
      margin-top: 8px;
      font-size: 13px;
      color: #76583c;
    }
    .stack {
      display: grid;
      gap: 10px;
    }
    .device-check {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .device-row {
      display: grid;
      grid-template-columns: minmax(96px, 0.36fr) minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      border: 1px solid rgba(60, 42, 24, 0.12);
      border-radius: 8px;
      background: #fff8ea;
      padding: 9px 10px;
      font-size: 13px;
      line-height: 1.35;
    }
    .device-row strong {
      color: #4d3824;
    }
    .device-row span {
      overflow-wrap: anywhere;
      color: #624a31;
    }
    .device-row.good {
      border-color: rgba(55, 128, 67, 0.28);
      background: #eef8ec;
    }
    .device-row.warn {
      border-color: rgba(174, 115, 0, 0.28);
      background: #fff4cc;
    }
    .device-row.bad {
      border-color: rgba(150, 47, 28, 0.28);
      background: #fae0d8;
    }
    @media (min-width: 620px) {
      body {
        padding-inline: 24px;
      }
      .meta-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .stack {
        grid-template-columns: 1fr 1fr;
      }
      .run-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <p class="eyebrow">${escapeHtml(GAME_VERSION)}</p>
      <h1>杭州浮生记 真机验收</h1>
      <p>先打开游戏，按底部主按钮完整跑局；跑完回到这里勾清单、记结果。目标是两类手机各 3 局，至少 4 局落在 8-12 分钟。</p>
      <div class="stack">
        <a class="primary-link" href="${escapeHtml(freshGameUrl)}">打开游戏</a>
        <button type="button" data-copy-url="${escapeHtml(gameUrl)}">复制游戏地址</button>
        <button type="button" data-clear-cache-open>清缓存后打开</button>
      </div>
      <div class="url-box">${escapeHtml(gameUrl)}</div>
    </section>

    <div class="grid">
      <section class="panel">
        <h2>验收目标</h2>
        <div class="meta-grid">
          <div class="meta"><strong>6 局</strong><p>iPhone Safari 3 局，Android Chrome 3 局。</p></div>
          <div class="meta"><strong>8-12 分钟</strong><p>至少 4/6 局命中，一局约 85-95 次主按钮。</p></div>
        </div>
      </section>

      <section class="panel">
        <h2>手机环境自检</h2>
        <p class="hint">先点“刷新自检”，确认版本一致；如果手机疑似还在跑旧包，点“清缓存后打开”。</p>
        <div class="device-check" data-device-check>
          <div class="device-row warn"><strong>状态</strong><span>等待自检</span></div>
        </div>
        <div class="stack">
          <button type="button" data-refresh-env>刷新自检</button>
          <button type="button" data-clear-cache-open>清缓存后打开</button>
        </div>
      </section>

      <section class="panel">
        <h2>必过清单</h2>
        ${checklistHtml}
      </section>

      <section class="panel">
        <h2>每局记录</h2>
        <div class="current-device-hint" data-current-device-hint>
          <span data-current-device-copy>正在识别当前手机，识别后会高亮对应记录卡。</span>
          <button type="button" data-jump-current-run hidden>跳到建议记录</button>
        </div>
        <div class="run-grid">${runCardsHtml}</div>
        <div class="summary-grid" aria-live="polite" data-summary-grid>
          <div class="summary-tile"><strong data-summary-field="filled">0/6</strong><span>已记录局数</span></div>
          <div class="summary-tile"><strong data-summary-field="duration">0/6</strong><span>8-12 分钟</span></div>
          <div class="summary-tile"><strong data-summary-field="clean">0/6</strong><span>无卡住遮挡</span></div>
          <div class="summary-tile"><strong data-summary-field="replay">0/6</strong><span>愿意再开</span></div>
          <div class="summary-tile"><strong data-summary-field="mainButton">0/6</strong><span>主按钮完成</span></div>
          <div class="summary-tile"><strong data-summary-field="restore">0/6</strong><span>刷新恢复</span></div>
        </div>
        <p class="hint" data-verdict>先跑满 6 局。通过线：至少 4 局 8-12 分钟，且没有明显卡住或遮挡。</p>
        <ul class="gate-list" data-gate-list></ul>
        <div class="stack">
          <button type="button" data-generate-summary>生成验收摘要</button>
          <button type="button" data-copy-summary>复制摘要</button>
        </div>
        <textarea class="export-box" data-export-output readonly spellcheck="false" placeholder="生成后这里会出现可粘贴到 Markdown 记录里的验收摘要。"></textarea>
        <details>
          <summary>旧版自由记录</summary>
          <textarea data-notes="runs" spellcheck="false">${escapeHtml(runTemplate)}</textarea>
        </details>
        <p class="hint">记录会暂存在本机浏览器里，方便你边测边填。结构化摘要可直接复制回 Markdown 验收记录。</p>
      </section>

      <section class="panel">
        <h2>复盘判断</h2>
        <textarea data-notes="review" spellcheck="false">6 局里 8-12 分钟的局数：
6 局里愿意再开的局数：
玩家能复述的下一局目标：
最影响手感的问题：
下一轮优先修：</textarea>
      </section>
    </div>
  </main>
  <script>
    const gameVersion = ${JSON.stringify(GAME_VERSION)};
    const gameUrl = ${JSON.stringify(gameUrl)};
    const freshGameUrl = ${JSON.stringify(freshGameUrl)};
    const storeKey = "hzfsj-mobile-check-v1-" + gameVersion;
    const checkLabels = ${JSON.stringify(checkItems)};
    const runDefs = ${JSON.stringify(runRows)};
    let latestEnv = null;
    const stored = (() => {
      try {
        return JSON.parse(localStorage.getItem(storeKey) || "{}");
      } catch {
        return {};
      }
    })();
    const runCards = Array.from(document.querySelectorAll("[data-run-card]"));
    const labelFor = (value, labels) => labels[value] || "";
    const readRuns = () => runCards.map((card, index) => {
      const data = { ...runDefs[index] };
      card.querySelectorAll("[data-run-field]").forEach((input) => {
        data[input.dataset.runField] = input.value;
      });
      return data;
    });
    const runHasAny = (run) => Boolean(run.minutes || run.score || run.startGoal || run.replayGoal || run.mainButton || run.blocked || run.replayIntent || run.restore);
    const detectCurrentDevice = () => {
      const ua = navigator.userAgent || "";
      const isAndroid = /Android/i.test(ua);
      const isIphone = /iPhone|iPad|iPod/i.test(ua);
      const isChrome = /Chrome|CriOS/i.test(ua) && !/Edg|OPR|SamsungBrowser/i.test(ua);
      const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Edg|OPR|SamsungBrowser/i.test(ua);
      if (isIphone && isSafari) return { device: "iPhone", browser: "Safari", label: "iPhone Safari" };
      if (isAndroid && isChrome) return { device: "Android", browser: "Chrome", label: "Android Chrome" };
      return null;
    };
    const applyCurrentDeviceHint = (runs = readRuns()) => {
      const copy = document.querySelector("[data-current-device-copy]");
      const jump = document.querySelector("[data-jump-current-run]");
      runCards.forEach((card) => {
        card.classList.remove("current-device", "next-run");
      });
      if (!copy || !jump) return;
      const current = detectCurrentDevice();
      if (!current) {
        copy.textContent = "当前浏览器没有识别为 iPhone Safari 或 Android Chrome；请按实际设备手动填写对应记录。";
        jump.hidden = true;
        jump.onclick = null;
        return;
      }
      const indexes = runDefs
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.device === current.device && row.browser === current.browser)
        .map(({ index }) => index);
      indexes.forEach((index) => runCards[index]?.classList.add("current-device"));
      const nextIndex = indexes.find((index) => !runHasAny(runs[index])) ?? indexes[indexes.length - 1];
      const nextCard = runCards[nextIndex];
      nextCard?.classList.add("next-run");
      const nextRun = runDefs[nextIndex];
      copy.textContent = "当前识别为 " + current.label + "，建议填写第 " + nextRun.run + " 局记录。";
      jump.hidden = false;
      jump.onclick = () => {
        nextCard?.scrollIntoView({ behavior: "smooth", block: "center" });
        nextCard?.querySelector('[data-run-field="minutes"]')?.focus({ preventScroll: true });
      };
    };
    const minuteNumber = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const isDurationHit = (value) => {
      const n = minuteNumber(value);
      return n != null && n >= 8 && n <= 12;
    };
    const updateSummary = () => {
      const runs = readRuns();
      let filled = 0;
      let duration = 0;
      let clean = 0;
      let replay = 0;
      let mainButton = 0;
      let restoreOk = 0;
      let seriousIssues = 0;
      runs.forEach((run, index) => {
        const hasAny = runHasAny(run);
        const badge = runCards[index].querySelector("[data-run-badge]");
        const durationHit = isDurationHit(run.minutes);
        const noBlock = run.blocked === "no";
        const mostlyMain = run.mainButton === "yes" || run.mainButton === "mostly";
        if (hasAny) filled += 1;
        if (durationHit) duration += 1;
        if (noBlock) clean += 1;
        if (run.replayIntent === "yes") replay += 1;
        if (mostlyMain) mainButton += 1;
        if (run.restore === "yes") restoreOk += 1;
        if (run.blocked === "yes" || run.mainButton === "no" || run.restore === "no") seriousIssues += 1;
        if (!hasAny) {
          badge.textContent = "未填";
          badge.className = "status-pill";
        } else if (durationHit && noBlock && mostlyMain && run.replayIntent === "yes") {
          badge.textContent = "合格";
          badge.className = "status-pill good";
        } else if (run.blocked === "yes" || run.mainButton === "no" || !durationHit) {
          badge.textContent = "复查";
          badge.className = "status-pill bad";
        } else {
          badge.textContent = "待判断";
          badge.className = "status-pill warn";
        }
      });
      const setText = (name, value) => {
        const el = document.querySelector('[data-summary-field="' + name + '"]');
        if (el) el.textContent = value;
      };
      setText("filled", filled + "/6");
      setText("duration", duration + "/6");
      setText("clean", clean + "/6");
      setText("replay", replay + "/6");
      setText("mainButton", mainButton + "/6");
      setText("restore", restoreOk + "/6");
      const gateMessages = [];
      if (filled < 6) gateMessages.push("还差 " + (6 - filled) + " 局真机记录");
      if (duration < 4) gateMessages.push("8-12 分钟还差 " + (4 - duration) + " 局");
      if (clean < 6) gateMessages.push("无遮挡确认还差 " + (6 - clean) + " 局");
      if (mainButton < 6) gateMessages.push("主按钮完成确认还差 " + (6 - mainButton) + " 局");
      if (restoreOk < 6) gateMessages.push("刷新恢复确认还差 " + (6 - restoreOk) + " 局");
      if (replay < 4) gateMessages.push("愿意再开还差 " + (4 - replay) + " 局");
      if (seriousIssues > 0) gateMessages.push("存在明显卡住、主按钮失败或恢复异常，需要先复查");
      const passes = gateMessages.length === 0;
      const gateList = document.querySelector("[data-gate-list]");
      if (gateList) {
        const messages = passes ? ["已达到真机通过线，可以保存摘要并运行检查器"] : gateMessages;
        gateList.innerHTML = messages.map((message) => '<li class="' + (passes ? "good" : "") + '">' + message + '</li>').join("");
      }
      const verdict = document.querySelector("[data-verdict]");
      if (verdict) {
        if (filled < 6) {
          verdict.textContent = "还差 " + (6 - filled) + " 局真机记录。先把两类手机各 3 局跑满。";
        } else if (passes) {
          verdict.textContent = "真机记录达到通过线：节奏、主按钮、遮挡和再开意愿都可以进入封版判断。";
        } else {
          verdict.textContent = "真机记录还没达到通过线：关注 8-12 分钟、明显卡住/遮挡、主按钮依赖和愿意再开。";
        }
      }
      applyCurrentDeviceHint(runs);
      return { runs, filled, duration, clean, replay, mainButton, restoreOk, seriousIssues, passes, gateMessages };
    };
    const buildMarkdown = () => {
      const summary = updateSummary();
      const yesNo = { yes: "是", mostly: "基本是", no: "否", minor: "轻微", maybe: "一般" };
      const lines = [
        "# 杭州浮生记真机验收摘要",
        "",
        "- 版本：" + gameVersion,
        "- 页面：" + gameUrl,
        "- 生成时间：" + new Date().toISOString(),
        "- 已记录局数：" + summary.filled + "/6",
        "- 8-12 分钟：" + summary.duration + "/6",
        "- 无明显卡住/遮挡：" + summary.clean + "/6",
        "- 主按钮完成：" + summary.mainButton + "/6",
        "- 刷新恢复：" + summary.restoreOk + "/6",
        "- 愿意再开：" + summary.replay + "/6",
        "- 自动判定：" + (summary.passes ? "达到真机通过线" : "未达到真机通过线"),
        "",
      ];
      lines.push("## 自动判定", "");
      if (summary.passes) {
        lines.push("- 通过线已满足：两类手机各 3 局、节奏、主按钮、遮挡、刷新恢复和再开意愿均达标。", "");
      } else {
        const messages = summary.gateMessages.length ? summary.gateMessages : ["继续补充真机记录。"];
        for (const message of messages) lines.push("- " + message);
        lines.push("");
      }
      if (latestEnv) {
        lines.push(
          "## 手机环境",
          "",
          "- 期望版本：" + gameVersion,
          "- main.js 版本：" + (latestEnv.mainVersion || "未知"),
          "- 视口：" + latestEnv.viewport,
          "- 触控点：" + latestEnv.touchPoints,
          "- PWA 启动：" + latestEnv.standalone,
          "- Service Worker：" + latestEnv.serviceWorker,
          "- App Cache：" + latestEnv.cacheNames,
          "- UA：" + latestEnv.ua,
          "",
        );
      }
      lines.push(
        "## 每局记录",
        "",
        "| 设备 | 浏览器 | 局数 | 用时 | 8-12 分钟 | 只用主按钮 | 卡住/遮挡 | 最终分 | 开局目标 | 再来一局目标 | 愿意再开 | 刷新恢复 |",
        "| --- | --- | ---: | --- | --- | --- | --- | ---: | --- | --- | --- | --- |",
      );
      summary.runs.forEach((run) => {
        const minutes = run.minutes ? run.minutes + " 分钟" : "";
        const hit = run.minutes ? (isDurationHit(run.minutes) ? "是" : "否") : "";
        lines.push("| " + [
          run.device,
          run.browser,
          run.run,
          minutes,
          hit,
          labelFor(run.mainButton, yesNo),
          labelFor(run.blocked, { no: "没有", minor: "轻微", yes: "明显" }),
          run.score || "",
          run.startGoal || "",
          run.replayGoal || "",
          labelFor(run.replayIntent, yesNo),
          labelFor(run.restore, { yes: "正常", no: "异常" }),
        ].map((cell) => String(cell).replaceAll("|", "/")).join(" | ") + " |");
      });
      lines.push("", "## 必过清单", "");
      document.querySelectorAll("[data-check-index]").forEach((input) => {
        const marker = input.checked ? "x" : " ";
        lines.push("- [" + marker + "] " + checkLabels[Number(input.dataset.checkIndex)]);
      });
      const review = document.querySelector('[data-notes="review"]')?.value || "";
      if (review.trim()) lines.push("", "## 复盘判断", "", review.trim());
      return lines.join("\\n");
    };
    const save = () => {
      const data = { checks: {}, notes: {}, runs: readRuns() };
      document.querySelectorAll("[data-check-index]").forEach((input) => {
        data.checks[input.dataset.checkIndex] = input.checked;
      });
      document.querySelectorAll("[data-notes]").forEach((textarea) => {
        data.notes[textarea.dataset.notes] = textarea.value;
      });
      localStorage.setItem(storeKey, JSON.stringify(data));
      updateSummary();
    };
    document.querySelectorAll("[data-check-index]").forEach((input) => {
      input.checked = Boolean(stored.checks && stored.checks[input.dataset.checkIndex]);
      input.addEventListener("change", save);
    });
    runCards.forEach((card, index) => {
      const savedRun = stored.runs && stored.runs[index] ? stored.runs[index] : {};
      card.querySelectorAll("[data-run-field]").forEach((input) => {
        if (savedRun[input.dataset.runField] != null) input.value = savedRun[input.dataset.runField];
        input.addEventListener("input", save);
        input.addEventListener("change", save);
      });
      card.querySelector("[data-run-quick-pass]")?.addEventListener("click", () => {
        const set = (name, value) => {
          const el = card.querySelector('[data-run-field="' + name + '"]');
          if (!el) return;
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        set("mainButton", "yes");
        set("blocked", "no");
        set("replayIntent", "yes");
        set("restore", "yes");
        save();
      });
    });
    document.querySelectorAll("[data-notes]").forEach((textarea) => {
      if (stored.notes && stored.notes[textarea.dataset.notes]) textarea.value = stored.notes[textarea.dataset.notes];
      textarea.addEventListener("input", save);
    });
    document.querySelector("[data-generate-summary]").addEventListener("click", () => {
      const output = document.querySelector("[data-export-output]");
      output.value = buildMarkdown();
      output.focus();
      output.select();
    });
    document.querySelector("[data-copy-summary]").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const output = document.querySelector("[data-export-output]");
      if (!output.value.trim()) output.value = buildMarkdown();
      try {
        await navigator.clipboard.writeText(output.value);
        button.textContent = "已复制摘要";
      } catch {
        output.focus();
        output.select();
        button.textContent = "复制失败，已选中文本";
      }
      setTimeout(() => {
        button.textContent = "复制摘要";
      }, 1800);
    });
    document.querySelector("[data-copy-url]").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      try {
        await navigator.clipboard.writeText(button.dataset.copyUrl);
        button.textContent = "已复制";
      } catch {
        button.textContent = "复制失败，长按下方地址";
      }
      setTimeout(() => {
        button.textContent = "复制游戏地址";
      }, 1600);
    });
    const escapeClientHtml = (value) => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
    const renderEnvRows = (rows) => {
      const target = document.querySelector("[data-device-check]");
      if (!target) return;
      target.innerHTML = rows.map((row) => (
        '<div class="device-row ' + escapeClientHtml(row.status) + '"><strong>' + escapeClientHtml(row.label) + '</strong><span>' + escapeClientHtml(row.value) + '</span></div>'
      )).join("");
    };
    const loadMainVersion = async () => {
      const response = await fetch("/src/engine/game-engine.js?mobile_check=" + Date.now(), { cache: "no-store" });
      const text = await response.text();
      const match = text.match(/GAME_VERSION_CODE\\s*=\\s*["']([^"']+)["']/);
      return match && match[1] ? match[1] : "未知";
    };
    const swStatus = async () => {
      if (!("serviceWorker" in navigator)) return "不支持";
      try {
        const ready = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(() => resolve(null), 1200)),
        ]);
        if (navigator.serviceWorker.controller) return "已控制当前页";
        if (ready) return "已就绪，打开游戏后接管";
        return "未接管，打开游戏后再刷新自检";
      } catch {
        return "读取失败";
      }
    };
    const cacheStatus = async () => {
      if (!("caches" in window)) return "不支持";
      try {
        const names = await caches.keys();
        return names.length ? names.join(", ") : "暂无缓存";
      } catch {
        return "读取失败";
      }
    };
    const runEnvCheck = async () => {
      renderEnvRows([{ label: "状态", value: "正在读取手机环境", status: "warn" }]);
      const mainVersion = await loadMainVersion().catch(() => "读取失败");
      const serviceWorker = await swStatus();
      const cacheNames = await cacheStatus();
      const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone ? "是" : "否";
      latestEnv = {
        mainVersion,
        viewport: window.innerWidth + "x" + window.innerHeight + " / DPR " + (window.devicePixelRatio || 1),
        touchPoints: String(navigator.maxTouchPoints || 0),
        standalone,
        serviceWorker,
        cacheNames,
        ua: navigator.userAgent,
      };
      renderEnvRows([
        { label: "版本", value: "页面 " + gameVersion + " / main.js " + mainVersion, status: mainVersion === gameVersion ? "good" : "bad" },
        { label: "视口", value: latestEnv.viewport, status: window.innerWidth >= 340 ? "good" : "warn" },
        { label: "触控", value: latestEnv.touchPoints + " 个触控点", status: Number(latestEnv.touchPoints) > 0 ? "good" : "warn" },
        { label: "PWA", value: "主屏启动：" + standalone, status: standalone === "是" ? "good" : "warn" },
        { label: "SW", value: serviceWorker, status: serviceWorker.includes("不支持") || serviceWorker.includes("失败") ? "bad" : "warn" },
        { label: "缓存", value: cacheNames, status: cacheNames.includes("bfsj-shell") ? "good" : "warn" },
        { label: "UA", value: latestEnv.ua, status: "good" },
      ]);
      save();
    };
    const clearCacheAndOpen = async (event) => {
      const button = event.currentTarget;
      button.textContent = "正在清缓存";
      button.disabled = true;
      try {
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
        }
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch {
        // Opening with a cache-busting URL is still useful if browser cleanup fails.
      }
      const url = new URL(freshGameUrl);
      url.searchParams.set("fresh", Date.now());
      window.location.href = url.href;
    };
    document.querySelectorAll("[data-clear-cache-open]").forEach((button) => {
      button.addEventListener("click", clearCacheAndOpen);
    });
    document.querySelector("[data-refresh-env]")?.addEventListener("click", runEnvCheck);
    updateSummary();
    runEnvCheck();
  </script>
</body>
</html>`;
}

function serveStaticRequest(req, res) {
  const requestUrl = new URL(req.url || "/", requestOrigin(req));
  const pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/__mobile-check" || pathname === "/__mobile-check/") {
    sendHtml(res, buildMobileCheckPage({ origin: requestOrigin(req) }));
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);

  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    sendNotFound(res);
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendNotFound(res);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serveStaticRequest);
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

async function startServerOnFreePort(startPort) {
  let lastError = null;
  for (let offset = 0; offset < 25; offset += 1) {
    const port = startPort + offset;
    try {
      const server = await startServer(port);
      return { server, port };
    } catch (error) {
      lastError = error;
      if (error.code !== "EADDRINUSE") break;
    }
  }
  throw lastError || new Error("Could not start local preview server");
}

function lanAddresses() {
  const addrs = [];
  const nets = os.networkInterfaces();
  for (const rows of Object.values(nets)) {
    for (const row of rows || []) {
      if (row.family === "IPv4" && !row.internal) addrs.push(row.address);
    }
  }
  return [...new Set(addrs)];
}

function buildManualReport(urls) {
  const firstUrl = urls[0] || "";
  const urlRows = urls.length
    ? urls.map((url) => `- ${url}`).join("\n")
    : "- 待填写";
  const checkUrlRows = urls.length
    ? urls.map((url) => `- ${checkUrlFor(url)}`).join("\n")
    : "- 待填写";
  return `# 移动端真机验收记录

- 版本：${GAME_VERSION}
- 生成时间：${new Date().toISOString()}
- 预览地址：${firstUrl || "待填写"}
- 验收辅助页：${firstUrl ? checkUrlFor(firstUrl) : "待填写"}
- 验收人：

## 手机打开地址

${urlRows}

同一 Wi-Fi 下优先打开第一个局域网地址。打不开时检查：电脑和手机是否同一 Wi-Fi、macOS 防火墙是否阻止 Node、本机是否开了 VPN/隔离网络。

## 手机验收辅助页

${checkUrlRows}

辅助页包含游戏入口、手机环境自检、清缓存后打开、必过清单、6 局结构化记录、自动汇总和可复制 Markdown 摘要。记录会暂存在手机浏览器本机，正式结论仍以本 Markdown 文件为准。

## 设备记录

| 设备 | 浏览器 | 系统版本 | 屏幕宽度/机型 | 首屏/安全区 | PWA/主屏 | 刷新恢复 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iPhone | Safari |  |  | 未测 | 未测 | 未测 | 未测 |
| Android | Chrome |  |  | 未测 | 未测 | 未测 | 未测 |

## 单局步骤

每台手机完整跑 3 局。尽量只点底部主按钮；除输入昵称外，不要靠精细点表格推进。

1. 打开页面，确认开局按钮显示“开始 · 跟着下一步 / 开始 · 冲目标”。
2. 在辅助页先点“刷新自检”，确认页面版本和 main.js 版本一致；如不一致，点“清缓存后打开”。
3. 点击开局按钮，只用底部主按钮推进 45 天。
4. 中途至少刷新一次，确认能恢复当前局。
5. 结束时记录“再来一局 · 冲目标/破纪录”是否看得懂。
6. 第 2 或第 3 局尝试添加到主屏再启动一次，确认图标、标题、主题色和底部安全区正常。

## 每局记录

| 设备 | 浏览器 | 局数 | 用时 | 8-12 分钟 | 只用主按钮 | 卡住/遮挡 | 最终分 | 开局目标 | 再来一局目标 | 愿意再开 | 刷新恢复 |
| --- | --- | ---: | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| iPhone | Safari | 1 |  |  |  |  |  |  |  |  |  |
| iPhone | Safari | 2 |  |  |  |  |  |  |  |  |  |
| iPhone | Safari | 3 |  |  |  |  |  |  |  |  |  |
| Android | Chrome | 1 |  |  |  |  |  |  |  |  |  |
| Android | Chrome | 2 |  |  |  |  |  |  |  |  |  |
| Android | Chrome | 3 |  |  |  |  |  |  |  |  |  |

## 必过项

- [ ] 首屏无横向滚动。
- [ ] 底部主按钮没有被系统安全区遮挡。
- [ ] 只用底部主按钮能完成 45 天。
- [ ] 开局按钮能看出本局目标：跟着下一步、冲下一档或刷新纪录。
- [ ] 盈利后能看到“距下一档”和连赚反馈。
- [ ] 接近升档/破纪录时能看到冲刺提示，底部主按钮有明显高亮。
- [ ] 结算页能看到评级、下一局目标、本局高光、本机生涯和徽章。
- [ ] “再来一局”按钮带明确目标：冲下一档、破纪录或刷新纪录。
- [ ] 中途刷新或系统回收后能恢复当前局。
- [ ] 添加到主屏幕后图标、标题、主题色正常。
- [ ] 短暂离线后页面壳能重新打开。
- [ ] 辅助页自检显示版本一致；如果清过缓存，清缓存后打开仍能正常开始游戏。

## 结论

- [ ] 通过：两类手机各 3 局，没有卡死、错位、遮挡、无法继续；至少 4/6 局落在 8-12 分钟。
- [ ] 不通过：见问题记录。

## 复盘判断

- 6 局里 8-12 分钟的局数：
- 6 局里愿意再开的局数：
- 玩家能复述的下一局目标：
- 最影响手感的问题：
- 下一轮优先修：

## 问题记录

- （待记录）
`;
}

function writeManualReport(urls) {
  if (!WRITE_MANUAL_REPORT) return "";
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `${stamp()}_manual_check.md`);
  fs.writeFileSync(filePath, buildManualReport(urls));
  return filePath;
}

const { server, port } = await startServerOnFreePort(START_PORT);
const localUrl = `http://127.0.0.1:${port}/`;
const urls = lanAddresses().map((addr) => `http://${addr}:${port}/`);
const reportPath = writeManualReport(urls.length ? urls : [localUrl]);

console.log("Mobile real-device preview is running.");
console.log(`Local: ${localUrl}`);
console.log(`Local check page: ${checkUrlFor(localUrl)}`);
if (urls.length) {
  console.log("Open one of these URLs on a phone connected to the same Wi-Fi:");
  for (const url of urls) console.log(`- ${url}`);
  console.log("Mobile check pages:");
  for (const url of urls) console.log(`- ${checkUrlFor(url)}`);
} else {
  console.log("No LAN IPv4 address found. Check Wi-Fi or network settings.");
}
if (reportPath) console.log(`Manual check report: ${reportPath}`);
console.log("Press Ctrl+C to stop.");

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
