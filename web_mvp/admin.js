"use strict";

const state = { client: null };
let adminVerified = false;
let selectedRunId = null;
let currentRunRows = [];
let currentCityRows = [];
let currentCampaignRows = [];
let currentExperimentRows = [];
let currentExperimentResults = new Map();
let currentFeedbackResults = new Map();
const selectedRunIds = new Set();
const selectedRunRows = new Map();
const EMPTY_CITY_CONTENT = {
  content_schema: "city-content-v1",
  short_title: "",
  full_title: "",
  start_title: "",
  scene_key: "",
  locations: [],
  product_overrides: [],
  district_labels: {},
  news_pool: [],
};
const PLATFORM_INFO = [
  {
    key: "github",
    name: "GitHub",
    version: "CLI 2.92.0 / Repo Workflow v0.1",
    role: "源码协作中心。负责分支管理、PR 审核、自动生成版本更新说明（Release Drafter）以及 CI 触发入口。",
    note: "代码真相源（Single Source of Truth）",
  },
  {
    key: "pages",
    name: "GitHub Pages",
    version: "Pages Actions v4",
    role: "Web 版本托管与发布。主分支验证通过后自动部署 web_mvp，并由自定义域名提供稳定访问入口。",
    note: "Web 发布与静态托管",
  },
  {
    key: "supabase",
    name: "Supabase",
    version: "supabase-js@2 / Platform migration 20260714",
    role: "游戏云端数据层。负责登录鉴权、排行榜、每局归档、事件复盘、城市配置与推广活动。",
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
  pages: { ok: null, msg: "检测中...", checkedAt: null, liveVersion: "-" },
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
function shortDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}分${String(total % 60).padStart(2, "0")}秒`;
}
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function mdEsc(value) {
  return String(value ?? "").replaceAll("\r\n", "\n");
}
function safeFileName(name) {
  const base = String(name ?? "run")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (base || "run").slice(0, 96);
}
function compactDate(value) {
  if (!value) return "unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function endedReasonLabel(code) {
  if (code === "completed") return "45天结束";
  if (code === "death") return "健康归零";
  if (code === "reputation") return "名声崩盘";
  return code || "-";
}
function sourceLabel(source) {
  return source === "account" ? "账号" : source === "guest" ? "游客" : source || "-";
}
function cityLabel(cityKey) {
  return cityKey === "hangzhou" ? "杭州" : cityKey || "-";
}
function campaignStatusLabel(status) {
  return ({ draft: "草稿", active: "投放中", paused: "已暂停", ended: "已结束" })[status] || status || "-";
}
function experimentStatusLabel(status) {
  return ({ draft: "草稿", active: "测试中", paused: "已暂停", archived: "已归档" })[status] || status || "-";
}
function campaignTypeLabel(type) {
  return ({ coupon: "优惠券", event: "本地活动", sponsor_news: "赞助新闻", sponsor_product: "赞助商品", sponsor_location: "赞助地点", settlement_offer: "结算合作" })[type] || type || "-";
}
function campaignPlacementLabel(placement) {
  return ({ news: "新闻后", product: "商品栏", location: "到达地点", settlement: "结算页" })[placement] || placement || "-";
}
function campaignTargetLabel(row = {}) {
  const type = row.target_entity_type || "";
  const key = row.target_entity_key ?? "";
  if (!type || key === "") return "不限";
  return `${type === "goods" ? "商品" : type === "location" ? "地点" : type} ${key}`;
}
function csvList(value) {
  return String(value || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}
function datetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function selectedRunsList() {
  return [...selectedRunIds]
    .map((id) => selectedRunRows.get(String(id)))
    .filter(Boolean);
}
function updateRunSelectionUi() {
  const info = q("runSelectionInfo");
  const selectedCount = selectedRunIds.size;
  if (info) info.textContent = `已选 ${selectedCount} 局`;
  const downloadBtn = q("runDownloadMdBtn");
  if (downloadBtn) downloadBtn.disabled = selectedCount === 0;
  const headerCheckbox = q("runsSelectAllCheckbox");
  if (!headerCheckbox) return;
  const rowIds = currentRunRows.map((row) => String(row.run_key));
  const selectedOnPage = rowIds.filter((id) => selectedRunIds.has(id)).length;
  headerCheckbox.checked = rowIds.length > 0 && selectedOnPage === rowIds.length;
  headerCheckbox.indeterminate = selectedOnPage > 0 && selectedOnPage < rowIds.length;
}
function setSelectionForCurrentPage(checked) {
  for (const row of currentRunRows) {
    const id = String(row.run_key);
    if (checked) {
      selectedRunIds.add(id);
      selectedRunRows.set(id, row);
    } else {
      selectedRunIds.delete(id);
      selectedRunRows.delete(id);
    }
  }
  renderRuns(currentRunRows);
}
function clearRunSelection() {
  selectedRunIds.clear();
  selectedRunRows.clear();
  renderRuns(currentRunRows);
}
function triggerBlobDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function buildRunMarkdown(run, events) {
  const createdAt = fmtDate(run.created_at);
  const player = run.display_name || run.email || "匿名玩家";
  const lines = [
    `# 杭州浮生记对局记录`,
    ``,
    `- 对局ID：${run.run_key}`,
    `- 玩家：${player}`,
    `- 来源：${sourceLabel(run.source)}`,
    `- 城市：${cityLabel(run.city_key)}（${run.city_version || "-"}）`,
    `- 开局时间：${createdAt}`,
    `- 分数：${cny(run.score)}`,
    `- 现金：${cny(run.cash)}`,
    `- 债务：${cny(run.debt)}`,
    `- 天数：${run.days_used}`,
    `- 结束原因：${endedReasonLabel(run.ended_reason)}`,
    `- 事件总数：${events.length}`,
    ``,
    `## 事件流`,
  ];
  if (!events.length) {
    lines.push(``, `暂无事件记录。`);
    return lines.join("\n");
  }
  for (const event of events) {
    const eventTime = fmtDate(event.created_at);
    lines.push(`- [#${event.event_index}] 第${event.day}天 · ${event.event_type} · ${eventTime}`);
    lines.push(`  ${mdEsc(event.message)}`);
  }
  return lines.join("\n");
}
async function downloadSelectedRunsAsMarkdown() {
  const runs = selectedRunsList();
  if (!runs.length) {
    q("adminStatus").textContent = "请先选择至少一局对局记录。";
    return;
  }
  const downloadBtn = q("runDownloadMdBtn");
  const prevText = downloadBtn.textContent;
  downloadBtn.disabled = true;
  downloadBtn.textContent = "正在打包...";
  q("adminStatus").textContent = `准备导出 ${runs.length} 局...`;
  try {
    const zip = window.JSZip ? new window.JSZip() : null;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      q("adminStatus").textContent = `导出中 ${i + 1}/${runs.length}：${run.display_name || run.email || run.run_key}`;
      const events = await callRpc("admin_events_v2", { p_run_key: run.run_key });
      const content = buildRunMarkdown(run, events || []);
      const fileName = `${compactDate(run.created_at)}_${safeFileName(run.display_name || run.email || "player")}_${safeFileName(run.run_key)}.md`;
      if (zip) {
        zip.file(fileName, content);
      } else {
        triggerBlobDownload(fileName, new Blob([content], { type: "text/markdown;charset=utf-8" }));
      }
    }
    if (zip) {
      const blob = await zip.generateAsync({ type: "blob" });
      const packName = `hangzhou-fushengji-runs-${compactDate(new Date().toISOString())}.zip`;
      triggerBlobDownload(packName, blob);
      q("adminStatus").textContent = `导出完成：已下载 ${runs.length} 个 .md（zip 包）。`;
    } else {
      q("adminStatus").textContent = `导出完成：已触发 ${runs.length} 个 .md 下载。`;
    }
  } catch (error) {
    q("adminStatus").textContent = `导出失败：${error.message || error}`;
  } finally {
    downloadBtn.textContent = prevText;
    updateRunSelectionUi();
  }
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
async function callOptionalRpc(name, args) {
  try {
    return await callRpc(name, args);
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/PGRST202|schema cache|could not find the function/i.test(message)) return [];
    throw error;
  }
}
async function verifyAdmin() {
  const data = await callRpc("admin_overview");
  if (data?.error === "forbidden") throw new Error("当前账号没有后台权限。");
  return true;
}
function renderOverview(data) {
  const items = [
    ["用户数", data.users],
    ["全部对局", data.game_runs],
    ["账号对局", data.account_runs],
    ["游客对局", data.guest_runs],
    ["今日局数", data.runs_today],
    ["事件数", data.events],
    ["有战绩玩家", data.players_with_runs],
    ["最高分", cny(data.best_score)],
    ["平均分", cny(data.avg_score)],
    ["城市版本", data.cities],
    ["投放中活动", data.active_campaigns],
    ["活动曝光", data.campaign_impressions],
    ["活动点击", data.campaign_clicks],
  ];
  q("overview").innerHTML = items.map(([label, value]) => `<article class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join("");
}
function renderUsers(rows) {
  q("usersHint").textContent = `${rows.length} 条`;
  q("usersTable").querySelector("tbody").innerHTML = rows.map((row) => `
    <tr>
      <td><strong>${esc(row.email || row.player_key)}</strong></td>
      <td>${esc(row.display_name || "-")}</td>
      <td>${esc(sourceLabel(row.source))}</td>
      <td>${esc(fmtDate(row.created_at))}</td>
      <td>${esc(fmtDate(row.last_seen_at))}</td>
      <td>${esc(row.run_count)}</td>
      <td>${esc(cny(row.best_score))}</td>
    </tr>
  `).join("");
}
function renderCities(rows) {
  currentCityRows = rows || [];
  q("citiesHint").textContent = `${rows.length} 个`;
  q("citiesTable").querySelector("tbody").innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td><strong>${esc(row.display_name)}</strong><div class="cell-sub">${esc(row.city_key)}</div></td>
      <td>${row.enabled ? "已启用" : "未启用"}</td>
      <td>${row.is_default ? "是" : "-"}</td>
      <td>${esc(row.content_version)}</td>
      <td><code class="config-code">${esc(JSON.stringify(row.config || {}))}</code></td>
      <td>${esc(fmtDate(row.updated_at))} <button class="run-action-btn city-edit-btn" data-city-key="${esc(row.city_key)}">编辑</button></td>
    </tr>
  `).join("") : `<tr><td colspan="6" class="empty-cell">还没有城市配置。</td></tr>`;
  q("citiesTable").querySelectorAll(".city-edit-btn").forEach((button) => {
    button.addEventListener("click", () => openCityEditor(
      currentCityRows.find((row) => row.city_key === button.dataset.cityKey),
    ));
  });
}
function renderExperiments(rows, resultRows = [], feedbackRows = []) {
  currentExperimentRows = rows || [];
  currentExperimentResults = new Map((resultRows || []).map((row) => [row.experiment_key, row]));
  currentFeedbackResults = new Map((feedbackRows || []).map((row) => [row.experiment_key, row]));
  q("experimentsHint").textContent = `${currentExperimentRows.length} 档内部方案，模式名不向玩家展示`;
  q("experimentsTable").querySelector("tbody").innerHTML = currentExperimentRows.length ? currentExperimentRows.map((row) => {
    const result = currentExperimentResults.get(row.experiment_key) || {};
    const feedback = currentFeedbackResults.get(row.experiment_key) || {};
    return `
    <tr>
      <td>${esc(experimentStatusLabel(row.status))}</td>
      <td><strong>${esc(row.internal_name)}</strong><div class="cell-sub">${esc(row.experiment_key)}</div></td>
      <td>${esc(row.hypothesis || "-")}</td>
      <td>${esc(row.allocation_weight)}</td>
      <td><strong>${esc(result.run_count || 0)} 局</strong><div class="cell-sub">${esc(result.player_count || 0)} 人｜均分 ${esc(cny(result.avg_score || 0))}</div></td>
      <td><strong>${esc(result.completion_rate || 0)}% / ${esc(result.replay_player_rate || 0)}%</strong>${Number(result.metrics_run_count || 0) > 0 ? `<div class="cell-sub">均时 ${esc(shortDuration(result.avg_duration_seconds))}｜主操作 ${esc(result.avg_primary_actions || 0)}｜10天回正 ${esc(result.day10_break_even_rate || 0)}%｜有盈利 ${esc(result.profitable_sale_rate || 0)}%</div>` : ""}</td>
      <td><strong>${esc(feedback.feedback_count || 0)} 条</strong><div class="cell-sub">惊喜 ${esc(feedback.avg_surprise || 0)}｜满足 ${esc(feedback.avg_satisfaction || 0)}｜再来 ${esc(feedback.avg_replay_intent || 0)}</div></td>
      <td><code class="config-code">${esc(row.config_version)}</code> <button class="run-action-btn experiment-edit-btn" data-experiment-key="${esc(row.experiment_key)}">编辑</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="8" class="empty-cell">还没有玩法实验。</td></tr>`;
  q("experimentsTable").querySelectorAll(".experiment-edit-btn").forEach((button) => {
    button.addEventListener("click", () => openExperimentEditor(
      currentExperimentRows.find((row) => row.experiment_key === button.dataset.experimentKey),
    ));
  });
}
function renderPlaytestFeedback(rows) {
  const items = rows || [];
  q("feedbackHint").textContent = `最近 ${items.length} 条`;
  q("feedbackTable").querySelector("tbody").innerHTML = items.length ? items.map((row) => `
    <tr>
      <td>${esc(fmtDate(row.created_at))}</td>
      <td><strong>${esc(row.experiment_key)}</strong></td>
      <td>${esc(cny(row.score))}</td>
      <td class="cell-sub">惊 ${esc(row.surprise)}｜满 ${esc(row.satisfaction)}｜主 ${esc(row.agency)}｜公 ${esc(row.fairness)}｜再 ${esc(row.replay_intent)}｜享 ${esc(row.share_intent)}</td>
      <td>${row.quit_day == null ? "-" : `第 ${esc(row.quit_day)} 天`}</td>
      <td>${esc(row.memorable_moment || "-")}</td>
    </tr>
  `).join("") : `<tr><td colspan="6" class="empty-cell">测试期开启反馈后，这里会显示玩家最记得的瞬间。</td></tr>`;
}
function renderCampaigns(rows) {
  currentCampaignRows = rows || [];
  q("campaignsHint").textContent = `${rows.length} 条`;
  q("campaignsTable").querySelector("tbody").innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${esc(campaignStatusLabel(row.status))}</td>
      <td>${esc(cityLabel(row.city_key))}</td>
      <td>${esc(campaignTypeLabel(row.campaign_type))}</td>
      <td>${esc(campaignPlacementLabel(row.placement_key || row.payload?.placement))}<div class="cell-sub">${esc(campaignTargetLabel(row))} · ${esc(row.disclosure_label || "合作内容")}</div></td>
      <td><strong>${esc(row.title)}</strong><div class="cell-sub">${esc(row.body)}</div></td>
      <td>${esc(fmtDate(row.starts_at))} - ${esc(fmtDate(row.ends_at))}</td>
      <td>${esc(row.weight)} / ${esc(row.frequency_cap)} <button class="run-action-btn campaign-edit-btn" data-campaign-id="${esc(row.id)}">编辑</button></td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty-cell">还没有推广活动。</td></tr>`;
  q("campaignsTable").querySelectorAll(".campaign-edit-btn").forEach((button) => {
    button.addEventListener("click", () => openCampaignEditor(
      currentCampaignRows.find((row) => row.id === button.dataset.campaignId),
    ));
  });
}
function renderRuns(rows) {
  currentRunRows = rows || [];
  q("runsHint").textContent = `${rows.length} 条`;
  q("runsTable").querySelector("tbody").innerHTML = rows.map((row) => `
    <tr>
      <td><input class="run-select-checkbox" type="checkbox" data-run-id="${esc(row.run_key)}" ${selectedRunIds.has(String(row.run_key)) ? "checked" : ""} /></td>
      <td>${esc(fmtDate(row.created_at))}</td>
      <td>${esc(row.display_name || row.email || "-")}</td>
      <td>${esc(sourceLabel(row.source))}</td>
      <td>${esc(cityLabel(row.city_key))}<div class="cell-sub">${esc(row.city_version || "-")}</div></td>
      <td>${esc(cny(row.score))}</td>
      <td>${esc(cny(row.cash))}</td>
      <td>${esc(cny(row.debt))}</td>
      <td>${esc(row.days_used)}</td>
      <td>${esc(endedReasonLabel(row.ended_reason))}</td>
      <td>${esc(row.event_count)}</td>
      <td><button class="run-action-btn" data-run-id="${esc(row.run_key)}" data-run-name="${esc(row.display_name || row.email || "-")}" data-run-time="${esc(fmtDate(row.created_at))}">查看事件</button></td>
    </tr>
  `).join("");
  const runMap = new Map(rows.map((row) => [String(row.run_key), row]));
  q("runsTable").querySelectorAll(".run-select-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = String(checkbox.dataset.runId || "");
      if (!id) return;
      if (checkbox.checked) {
        selectedRunIds.add(id);
        selectedRunRows.set(id, runMap.get(id));
      } else {
        selectedRunIds.delete(id);
        selectedRunRows.delete(id);
      }
      updateRunSelectionUi();
    });
  });
  q("runsTable").querySelectorAll(".run-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRunId = btn.dataset.runId || null;
      const who = btn.dataset.runName || "未知玩家";
      const when = btn.dataset.runTime || "-";
      q("eventsRunMeta").textContent = `当前对局：${who}｜${when}`;
      loadEventsForSelectedRun();
    });
  });
  updateRunSelectionUi();
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
    const events = await callRpc("admin_events_v2", { p_run_key: selectedRunId });
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
        const data = await checkJson("https://www.githubstatus.com/api/v2/components.json");
        const pages = data?.components?.find((component) => component.name === "GitHub Pages");
        runtimeStatus.pages.ok = pages?.status === "operational";
        runtimeStatus.pages.msg = pages?.status === "operational" ? "服务正常" : (pages?.status || "状态未知");
      } catch (error) {
        runtimeStatus.pages.ok = false;
        runtimeStatus.pages.msg = error.message;
      }
      runtimeStatus.pages.checkedAt = Date.now();
      runtimeStatus.pages.liveVersion = "Pages Actions v4";
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
      <div class="flow-node"><strong>GitHub Pages</strong><span>Web 自动发布</span></div>
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

function openCityEditor(row = null) {
  const item = row || {};
  q("cityKeyInput").value = item.city_key || "";
  q("cityKeyInput").disabled = Boolean(item.city_key);
  q("cityNameInput").value = item.display_name || "";
  q("cityVersionInput").value = item.content_version || "v1";
  q("cityPriorityInput").value = String(item.priority || 100);
  q("cityCountriesInput").value = (item.country_codes || ["CN"]).join(",");
  q("cityRegionsInput").value = (item.region_patterns || []).join(",");
  q("cityPatternsInput").value = (item.city_patterns || []).join(",");
  q("cityEnabledInput").checked = item.enabled ?? true;
  q("cityDefaultInput").checked = Boolean(item.is_default);
  q("cityConfigInput").value = JSON.stringify(item.city_key ? (item.config || {}) : EMPTY_CITY_CONTENT, null, 2);
  q("cityEditor").classList.remove("hidden");
}
function closeCityEditor() {
  q("cityEditor").classList.add("hidden");
}
async function saveCityEditor(event) {
  event.preventDefault();
  try {
    const config = JSON.parse(q("cityConfigInput").value || "{}");
    await callRpc("admin_upsert_city", {
      p_city_key: q("cityKeyInput").value.trim(),
      p_display_name: q("cityNameInput").value.trim(),
      p_enabled: q("cityEnabledInput").checked,
      p_is_default: q("cityDefaultInput").checked,
      p_content_version: q("cityVersionInput").value.trim(),
      p_config: config,
      p_country_codes: csvList(q("cityCountriesInput").value),
      p_region_patterns: csvList(q("cityRegionsInput").value),
      p_city_patterns: csvList(q("cityPatternsInput").value),
      p_priority: Number(q("cityPriorityInput").value || 100),
    });
    closeCityEditor();
    q("adminStatus").textContent = "城市配置已保存。";
    await refresh();
  } catch (error) {
    q("adminStatus").textContent = `城市保存失败：${error.message || error}`;
  }
}
function openExperimentEditor(row) {
  if (!row) return;
  q("experimentKeyInput").value = row.experiment_key || "";
  q("experimentKeyInput").disabled = true;
  q("experimentCityInput").value = row.city_key || "hangzhou";
  q("experimentNameInput").value = row.internal_name || "";
  q("experimentStatusInput").value = row.status || "draft";
  q("experimentWeightInput").value = String(row.allocation_weight || 100);
  q("experimentVersionInput").value = row.config_version || "gameplay-experiments-v1";
  q("experimentFeedbackInput").checked = row.config?.collectFeedback === true;
  q("experimentHypothesisInput").value = row.hypothesis || "";
  q("experimentConfigInput").value = JSON.stringify(row.config || {}, null, 2);
  q("experimentEditor").classList.remove("hidden");
}
function closeExperimentEditor() {
  q("experimentEditor").classList.add("hidden");
}
async function saveExperimentEditor(event) {
  event.preventDefault();
  try {
    const config = JSON.parse(q("experimentConfigInput").value || "{}");
    config.collectFeedback = q("experimentFeedbackInput").checked;
    await callRpc("admin_upsert_gameplay_experiment", {
      p_experiment_key: q("experimentKeyInput").value.trim(),
      p_city_key: q("experimentCityInput").value.trim() || "hangzhou",
      p_internal_name: q("experimentNameInput").value.trim(),
      p_hypothesis: q("experimentHypothesisInput").value.trim(),
      p_status: q("experimentStatusInput").value,
      p_allocation_weight: Number(q("experimentWeightInput").value || 100),
      p_config_version: q("experimentVersionInput").value.trim(),
      p_config: config,
    });
    closeExperimentEditor();
    q("adminStatus").textContent = "玩法实验已保存。";
    await refresh();
  } catch (error) {
    q("adminStatus").textContent = `实验保存失败：${error.message || error}`;
  }
}
function openCampaignEditor(row = null) {
  const item = row || {};
  q("campaignIdInput").value = item.id || "";
  q("campaignCityInput").value = item.city_key || "hangzhou";
  q("campaignTypeInput").value = item.campaign_type || "sponsor_news";
  q("campaignPlacementInput").value = item.placement_key || item.payload?.placement || "news";
  q("campaignTargetTypeInput").value = item.target_entity_type || "";
  q("campaignTargetKeyInput").value = item.target_entity_key ?? "";
  q("campaignDisclosureInput").value = item.disclosure_label || item.payload?.disclosure_label || "合作内容";
  q("campaignStatusInput").value = item.status || "draft";
  q("campaignWeightInput").value = String(item.weight || 100);
  q("campaignCapInput").value = String(item.frequency_cap || 1);
  q("campaignStartsInput").value = datetimeLocal(item.starts_at);
  q("campaignEndsInput").value = datetimeLocal(item.ends_at);
  q("campaignActionLabelInput").value = item.action_label || "";
  q("campaignTitleInput").value = item.title || "";
  q("campaignBodyInput").value = item.body || "";
  q("campaignActionUrlInput").value = item.action_url || "";
  q("campaignPayloadInput").value = JSON.stringify(item.payload || {}, null, 2);
  q("campaignEconomyInput").value = JSON.stringify(item.economy_effect || {}, null, 2);
  q("campaignEditor").classList.remove("hidden");
}
function closeCampaignEditor() {
  q("campaignEditor").classList.add("hidden");
}
async function saveCampaignEditor(event) {
  event.preventDefault();
  try {
    const payload = JSON.parse(q("campaignPayloadInput").value || "{}");
    const economyEffect = JSON.parse(q("campaignEconomyInput").value || "{}");
    const placement = q("campaignPlacementInput").value;
    const targetType = q("campaignTargetTypeInput").value || null;
    const targetKey = q("campaignTargetKeyInput").value.trim() || null;
    payload.placement = placement;
    payload.disclosure_label = q("campaignDisclosureInput").value.trim() || "合作内容";
    if (targetType === "goods" && targetKey != null) payload.goods_id = targetKey;
    if (targetType === "location" && targetKey != null) payload.location_id = targetKey;
    const starts = q("campaignStartsInput").value;
    const ends = q("campaignEndsInput").value;
    await callRpc("admin_upsert_native_campaign", {
      p_id: q("campaignIdInput").value || null,
      p_city_key: q("campaignCityInput").value.trim() || null,
      p_campaign_type: q("campaignTypeInput").value,
      p_status: q("campaignStatusInput").value,
      p_title: q("campaignTitleInput").value.trim(),
      p_body: q("campaignBodyInput").value.trim(),
      p_action_label: q("campaignActionLabelInput").value.trim() || null,
      p_action_url: q("campaignActionUrlInput").value.trim() || null,
      p_weight: Number(q("campaignWeightInput").value || 100),
      p_frequency_cap: Number(q("campaignCapInput").value || 1),
      p_starts_at: starts ? new Date(starts).toISOString() : null,
      p_ends_at: ends ? new Date(ends).toISOString() : null,
      p_placement_key: placement,
      p_target_entity_type: targetType,
      p_target_entity_key: targetKey,
      p_disclosure_label: payload.disclosure_label,
      p_creative: {},
      p_economy_effect: economyEffect,
      p_payload: payload,
    });
    closeCampaignEditor();
    q("adminStatus").textContent = "推广活动已保存。";
    await refresh();
  } catch (error) {
    q("adminStatus").textContent = `活动保存失败：${error.message || error}`;
  }
}

async function refresh() {
  if (!adminVerified) return;
  q("adminStatus").textContent = "读取中...";
  try {
    const [overview, users, runs, eventSummary, cities, experiments, experimentResults, feedbackResults, recentFeedback, campaigns] = await Promise.all([
      callRpc("admin_overview"),
      callRpc("admin_players_v2"),
      callRpc("admin_runs_v2"),
      callRpc("admin_event_summary_v2"),
      callRpc("admin_cities"),
      callOptionalRpc("admin_gameplay_experiments"),
      callOptionalRpc("admin_gameplay_experiment_results"),
      callOptionalRpc("admin_playtest_feedback_results"),
      callOptionalRpc("admin_recent_playtest_feedback", { p_limit: 100 }),
      callRpc("admin_campaigns"),
    ]);
    renderOverview(overview);
    renderCities(cities);
    renderExperiments(experiments, experimentResults, feedbackResults);
    renderPlaytestFeedback(recentFeedback);
    renderCampaigns(campaigns);
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
q("runSelectAllBtn").addEventListener("click", () => { setSelectionForCurrentPage(true); });
q("runClearSelectionBtn").addEventListener("click", () => { clearRunSelection(); });
q("runsSelectAllCheckbox").addEventListener("change", (event) => { setSelectionForCurrentPage(event.target.checked); });
q("runDownloadMdBtn").addEventListener("click", () => { downloadSelectedRunsAsMarkdown(); });
q("cityCreateBtn").addEventListener("click", () => { openCityEditor(); });
q("cityEditorCancel").addEventListener("click", () => { closeCityEditor(); });
q("cityEditorForm").addEventListener("submit", saveCityEditor);
q("experimentEditorCancel").addEventListener("click", () => { closeExperimentEditor(); });
q("experimentEditorForm").addEventListener("submit", saveExperimentEditor);
q("campaignCreateBtn").addEventListener("click", () => { openCampaignEditor(); });
q("campaignEditorCancel").addEventListener("click", () => { closeCampaignEditor(); });
q("campaignEditorForm").addEventListener("submit", saveCampaignEditor);
init();
