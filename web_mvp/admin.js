"use strict";

const state = { client: null };
let adminVerified = false;
let selectedRunId = null;
const PLATFORM_INFO = [
  {
    key: "github",
    name: "GitHub",
    version: "CLI 2.92.0 / Repo Workflow v0.1",
    role: "源码协作中心。负责分支管理、PR 审核、自动生成版本更新说明（Release Drafter）以及 CI 触发入口。",
    note: "代码真相源（Single Source of Truth）",
  },
  {
    key: "netlify",
    name: "Netlify",
    version: "待检测",
    role: "Web 版本托管与发布。每次主分支更新后可自动构建并上线，提供稳定访问入口。",
    note: "Web 发布与静态托管",
  },
  {
    key: "supabase",
    name: "Supabase",
    version: "supabase-js@2 / SQL migration 20260505",
    role: "游戏云端数据层。负责登录鉴权、排行榜、对局记录、事件日志、在线状态同步。",
    note: "数据与账号中台",
  },
  {
    key: "google",
    name: "Google Cloud",
    version: "OAuth Provider（Google 登录）",
    role: "身份入口。为玩家提供 Google 登录能力，并与 Supabase Auth 联动完成会话管理。",
    note: "统一身份提供方",
  },
];
const runtimeStatus = {
  github: { ok: null, msg: "检测中...", checkedAt: null, liveVersion: "-" },
  netlify: { ok: null, msg: "检测中...", checkedAt: null, liveVersion: "-" },
  supabase: { ok: null, msg: "检测中...", checkedAt: null, liveVersion: "-" },
  google: { ok: null, msg: "检测中...", checkedAt: null, liveVersion: "-" },
};

function q(id) { return document.getElementById(id); }
function setGate(text, allow = false) {
  const gate = q("adminGate");
  const main = q("adminMain");
  const label = q("adminGateText");
  if (label) label.textContent = text;
  if (allow) {
    gate?.classList.add("hidden");
    main?.classList.remove("hidden");
    adminVerified = true;
  } else {
    gate?.classList.remove("hidden");
    main?.classList.add("hidden");
    adminVerified = false;
  }
}
function fmtDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
}
function cny(n) {
  return `¥${Number(n || 0).toLocaleString("zh-CN")}`;
}
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function loadSupabaseSdk() {
  if (window.supabase?.createClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.async = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("Supabase SDK 加载失败")), { once: true });
    document.head.appendChild(script);
  });
}
async function callRpc(name, args) {
  const { data, error } = await state.client.rpc(name, args || {});
  if (error) throw error;
  if (data?.error === "forbidden") throw new Error("当前账号没有后台权限。请先用管理员 Google 账号登录游戏。");
  return data || [];
}
async function verifyAdmin() {
  const data = await callRpc("admin_overview");
  if (data?.error === "forbidden") throw new Error("当前账号没有后台权限。");
  return true;
}
function renderOverview(data) {
  const items = [
    ["用户数", data.users],
    ["完成局数", data.game_runs],
    ["今日局数", data.runs_today],
    ["事件数", data.events],
    ["有战绩玩家", data.players_with_runs],
    ["最高分", cny(data.best_score)],
    ["平均分", cny(data.avg_score)],
    ["Profiles", data.profiles],
  ];
  q("overview").innerHTML = items.map(([label, value]) => `<article class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join("");
}
function renderUsers(rows) {
  q("usersHint").textContent = `${rows.length} 条`;
  q("usersTable").querySelector("tbody").innerHTML = rows.map((row) => `
    <tr>
      <td>${esc(row.email)}</td>
      <td>${esc(row.display_name || "-")}</td>
      <td>${esc(row.provider || "-")}</td>
      <td>${esc(fmtDate(row.created_at))}</td>
      <td>${esc(fmtDate(row.last_sign_in_at))}</td>
      <td>${esc(row.run_count)}</td>
      <td>${esc(cny(row.best_score))}</td>
    </tr>
  `).join("");
}
function renderRuns(rows) {
  q("runsHint").textContent = `${rows.length} 条`;
  q("runsTable").querySelector("tbody").innerHTML = rows.map((row) => `
    <tr>
      <td>${esc(fmtDate(row.created_at))}</td>
      <td>${esc(row.display_name || row.email || "-")}</td>
      <td>${esc(cny(row.score))}</td>
      <td>${esc(cny(row.cash))}</td>
      <td>${esc(cny(row.debt))}</td>
      <td>${esc(row.days_used)}</td>
      <td>${esc(row.ended_reason)}</td>
      <td>${esc(row.event_count)}</td>
      <td><button class="run-action-btn" data-run-id="${esc(row.id)}" data-run-name="${esc(row.display_name || row.email || "-")}" data-run-time="${esc(fmtDate(row.created_at))}">查看事件</button></td>
    </tr>
  `).join("");
  q("runsTable").querySelectorAll(".run-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRunId = btn.dataset.runId || null;
      const who = btn.dataset.runName || "未知玩家";
      const when = btn.dataset.runTime || "-";
      q("eventsRunMeta").textContent = `当前对局：${who}｜${when}`;
      loadEventsForSelectedRun();
    });
  });
}
function renderEventSummary(rows) {
  q("eventSummaryHint").textContent = `${rows.length} 类`;
  q("eventSummaryTable").querySelector("tbody").innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td><span class="event-type">${esc(row.event_type)}</span></td>
      <td>${esc(row.event_count)}</td>
      <td>${esc(row.player_count)}</td>
      <td>${esc(row.run_count)}</td>
      <td>${esc(fmtDate(row.last_seen_at))}</td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-cell">完成一局后这里会显示事件类型分布。</td></tr>`;
}
function renderEvents(rows) {
  q("eventsHint").textContent = selectedRunId ? `${rows.length} 条` : "请先选择一局";
  q("eventsList").innerHTML = rows.length ? rows.map((row) => `
    <article class="event">
      <div class="event-meta">
        <span>#${esc(row.event_index)}</span>
        <span class="event-type">${esc(row.event_type)}</span>
        <span>第 ${esc(row.day)} 天</span>
        <span>${esc(fmtDate(row.created_at))}</span>
      </div>
      <div>${esc(row.message)}</div>
    </article>
  `).join("") : `<div class="empty">还没有事件记录。完成一局后这里会出现玩家事件流。</div>`;
}
async function loadEventsForSelectedRun() {
  if (!selectedRunId) {
    renderEvents([]);
    return;
  }
  try {
    q("eventsHint").textContent = "读取中...";
    const events = await callRpc("admin_events", { p_run_id: selectedRunId });
    renderEvents(events || []);
  } catch (error) {
    q("eventsHint").textContent = "读取失败";
    q("eventsList").innerHTML = `<div class="empty">${esc(error.message || "加载事件失败")}</div>`;
  }
}
function serviceLogo(key) {
  if (key === "github") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .6a12 12 0 0 0-3.79 23.4c.6.1.82-.26.82-.58v-2.04c-3.34.73-4.04-1.42-4.04-1.42-.55-1.4-1.34-1.77-1.34-1.77-1.1-.74.08-.72.08-.72 1.22.09 1.86 1.25 1.86 1.25 1.08 1.85 2.84 1.32 3.53 1 .1-.8.42-1.32.76-1.62-2.66-.3-5.47-1.33-5.47-5.92 0-1.31.47-2.39 1.24-3.24-.12-.3-.54-1.52.12-3.17 0 0 1.02-.33 3.35 1.23a11.7 11.7 0 0 1 6.1 0c2.33-1.56 3.35-1.23 3.35-1.23.66 1.65.24 2.87.12 3.17.77.85 1.24 1.93 1.24 3.24 0 4.6-2.81 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.3c0 .32.22.68.83.58A12 12 0 0 0 12 .6Z"/></svg>`;
  }
  if (key === "netlify") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.5 3 3 7.5V12l4.5 4.5H12L16.5 12V7.5L12 3Zm1.4 2.8h6.2v6.2H8.9V5.8Zm-5.1 8.3H10v6.2H3.8v-6.2Zm10.2 0h6.2v6.2H14v-6.2Z"/></svg>`;
  }
  if (key === "supabase") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.3 3.4c.6-.76 1.83-.34 1.83.64V20.2a1.2 1.2 0 0 1-2.18.7l-4.9-6.7a1.2 1.2 0 0 1 .02-1.45l5.2-9.35Z"/><path fill="currentColor" d="M10.8 4.5a1.2 1.2 0 0 1 2.08 1.2L9.2 12.2a1.2 1.2 0 0 1-2.08-1.2l3.68-6.5Z" opacity=".55"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4a8 8 0 1 0 8 8h-8V4Z"/><path fill="currentColor" d="M20 10A8 8 0 0 0 12 2v8h8Z" opacity=".55"/></svg>`;
}
function statusText(value) {
  if (value === null) return "检测中";
  return value ? "运行正常" : "异常";
}
async function checkJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function refreshServiceRuntime() {
  const cfg = window.BFSJ_CONFIG || {};
  const tasks = [
    (async () => {
      try {
        const data = await checkJson("https://www.githubstatus.com/api/v2/status.json");
        runtimeStatus.github.ok = data?.status?.indicator === "none";
        runtimeStatus.github.msg = data?.status?.description || "状态未知";
      } catch (error) {
        runtimeStatus.github.ok = false;
        runtimeStatus.github.msg = error.message;
      }
      runtimeStatus.github.checkedAt = Date.now();
      runtimeStatus.github.liveVersion = "Status API v2";
    })(),
    (async () => {
      try {
        const data = await checkJson("https://www.netlifystatus.com/api/v2/status.json");
        runtimeStatus.netlify.ok = data?.status?.indicator === "none";
        runtimeStatus.netlify.msg = data?.status?.description || "状态未知";
      } catch (error) {
        runtimeStatus.netlify.ok = false;
        runtimeStatus.netlify.msg = error.message;
      }
      runtimeStatus.netlify.checkedAt = Date.now();
      runtimeStatus.netlify.liveVersion = "Status API v2";
    })(),
    (async () => {
      try {
        await checkJson("https://registry.npmjs.org/@supabase/supabase-js/latest");
        const statusUrl = cfg.supabaseUrl ? `${cfg.supabaseUrl}/rest/v1/` : null;
        if (statusUrl) {
          const response = await fetch(statusUrl, {
            method: "GET",
            headers: { apikey: cfg.supabaseAnonKey || "" },
            cache: "no-store",
          });
          runtimeStatus.supabase.ok = response.status < 500;
          runtimeStatus.supabase.msg = response.status < 500 ? "连接可用" : `HTTP ${response.status}`;
        } else {
          runtimeStatus.supabase.ok = false;
          runtimeStatus.supabase.msg = "缺少配置";
        }
        const pkg = await checkJson("https://registry.npmjs.org/@supabase/supabase-js/latest");
        runtimeStatus.supabase.liveVersion = `supabase-js@${pkg.version || "unknown"}`;
      } catch (error) {
        runtimeStatus.supabase.ok = false;
        runtimeStatus.supabase.msg = error.message;
      }
      runtimeStatus.supabase.checkedAt = Date.now();
    })(),
    (async () => {
      try {
        const data = await checkJson("https://accounts.google.com/.well-known/openid-configuration");
        runtimeStatus.google.ok = Boolean(data?.authorization_endpoint);
        runtimeStatus.google.msg = runtimeStatus.google.ok ? "OAuth 发现端点可用" : "端点不可用";
        runtimeStatus.google.liveVersion = "OpenID Discovery";
      } catch (error) {
        runtimeStatus.google.ok = false;
        runtimeStatus.google.msg = error.message;
      }
      runtimeStatus.google.checkedAt = Date.now();
    })(),
  ];
  await Promise.all(tasks);
}
function renderPlatformView() {
  q("platformFlow").innerHTML = `
    <div class="flow-row">
      <div class="flow-node"><strong>开发团队</strong><span>代码提交 / PR</span></div>
      <div class="flow-arrow">→</div>
      <div class="flow-node"><strong>GitHub</strong><span>版本管理与协作</span></div>
      <div class="flow-arrow">→</div>
      <div class="flow-node"><strong>Netlify</strong><span>Web 自动发布</span></div>
      <div class="flow-arrow">→</div>
      <div class="flow-node"><strong>玩家</strong><span>访问网页游戏</span></div>
    </div>
    <div class="flow-row">
      <div class="flow-node"><strong>玩家登录</strong><span>Google OAuth</span></div>
      <div class="flow-arrow">→</div>
      <div class="flow-node"><strong>Google Cloud</strong><span>身份提供</span></div>
      <div class="flow-arrow">→</div>
      <div class="flow-node"><strong>Supabase Auth</strong><span>会话与用户映射</span></div>
      <div class="flow-arrow">→</div>
      <div class="flow-node"><strong>游戏数据</strong><span>排行榜 / 对局 / 在线状态</span></div>
    </div>
  `;
  q("platformCards").innerHTML = PLATFORM_INFO.map((item) => `
    <article class="platform-card">
      <h3><span class="platform-logo">${serviceLogo(item.key)}</span>${esc(item.name)}</h3>
      <div class="platform-meta">版本信息：${esc(item.version)}</div>
      <div class="platform-meta">最新信息：${esc(runtimeStatus[item.key].liveVersion)}</div>
      <div class="platform-meta">状态：<span class="service-dot ${runtimeStatus[item.key].ok ? "ok" : runtimeStatus[item.key].ok === false ? "bad" : ""}"></span>${esc(statusText(runtimeStatus[item.key].ok))} · ${esc(runtimeStatus[item.key].msg)}</div>
      <div class="platform-meta">检查时间：${esc(runtimeStatus[item.key].checkedAt ? fmtDate(runtimeStatus[item.key].checkedAt) : "-")}</div>
      <div class="platform-meta">${esc(item.note)}</div>
      <div class="platform-role">${esc(item.role)}</div>
    </article>
  `).join("");
}
async function refresh() {
  if (!adminVerified) return;
  q("adminStatus").textContent = "读取中...";
  try {
    const [overview, users, runs, eventSummary] = await Promise.all([
      callRpc("admin_overview"),
      callRpc("admin_users"),
      callRpc("admin_runs"),
      callRpc("admin_event_summary"),
    ]);
    renderOverview(overview);
    renderUsers(users);
    renderRuns(runs);
    renderEventSummary(eventSummary);
    if (!selectedRunId) {
      q("eventsRunMeta").textContent = "当前未选择对局";
      renderEvents([]);
    } else {
      await loadEventsForSelectedRun();
    }
    const newestRun = runs[0]?.created_at ? `｜最近对局：${fmtDate(runs[0].created_at)}` : "｜最近对局：暂无";
    q("adminStatus").textContent = `已更新：${new Date().toLocaleString("zh-CN")} ${newestRun}`;
  } catch (error) {
    q("adminStatus").textContent = error.message;
  }
}
async function init() {
  setGate("正在校验管理员身份...");
  renderPlatformView();
  await refreshServiceRuntime();
  renderPlatformView();
  setInterval(async () => {
    await refreshServiceRuntime();
    renderPlatformView();
  }, 45000);
  await loadSupabaseSdk();
  const cfg = window.BFSJ_CONFIG || {};
  state.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
  });
  const { data } = await state.client.auth.getSession();
  if (!data.session) {
    setGate("请先在游戏页登录管理员账号，再进入后台。");
    return;
  }
  try {
    await verifyAdmin();
    setGate("验证通过。", true);
  } catch (error) {
    setGate(error.message || "当前账号没有后台权限。");
    q("adminStatus").textContent = "权限验证失败";
    return;
  }
  await refresh();
}

q("refreshBtn").addEventListener("click", () => { refresh(); });
q("adminRetryBtn").addEventListener("click", () => { init(); });
init();
