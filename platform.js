"use strict";

(() => {
  const SESSION_KEY = "bfsj_platform_session_v1";
  const CITY_CACHE_KEY = "bfsj_city_route_v1";
  const CAMPAIGN_CAP_KEY = "bfsj_campaign_caps_v1";
  const FEEDBACK_QUEUE_KEY = "bfsj_playtest_feedback_queue_v1";

  function randomId(prefix) {
    const raw = (window.crypto?.randomUUID && window.crypto.randomUUID())
      || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}_${raw.replaceAll("-", "").slice(0, 28)}`;
  }

  function readJson(storage, key, fallback) {
    try {
      const value = JSON.parse(storage.getItem(key) || "null");
      return value ?? fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function getSessionId() {
    let value = window.localStorage.getItem(SESSION_KEY)
      || window.sessionStorage.getItem(SESSION_KEY);
    if (!value) {
      value = randomId("session");
    }
    window.localStorage.setItem(SESSION_KEY, value);
    window.sessionStorage.setItem(SESSION_KEY, value);
    return value;
  }

  const cachedCity = readJson(window.localStorage, CITY_CACHE_KEY, null);
  const runtime = {
    client: null,
    initialized: false,
    sessionId: getSessionId(),
    clientRunId: randomId("run"),
    shareCode: randomId("share").slice(0, 18),
    city: cachedCity || {
      city_key: "hangzhou",
      display_name: "杭州浮生记",
      content_version: "hz-v1",
      config: {
        scene_key: "hangzhou",
        product_catalog: "hangzhou-v1",
        location_catalog: "hangzhou-v1",
        theme_key: "swiss-grid-v1",
      },
      matched_by: "default",
    },
    experiment: null,
    runExperimentKey: null,
    campaigns: [],
    campaignEvents: [],
  };

  function localCampaignQaEnabled() {
    return ["localhost", "127.0.0.1"].includes(window.location.hostname)
      && new URLSearchParams(window.location.search).get("qa_campaigns") === "1";
  }

  function localCampaignQaFixtures() {
    if (!localCampaignQaEnabled()) return [];
    const common = {
      city_key: "hangzhou",
      weight: 100,
      frequency_cap: 1,
      disclosure_label: "合作内容",
      starts_at: null,
      ends_at: null,
      creative: {},
      economy_effect: {},
    };
    return [
      {
        ...common,
        id: "qa_product_drink",
        campaign_type: "sponsor_product",
        placement_key: "product",
        target_entity_type: "goods",
        target_entity_key: "0",
        title: "本地气泡水试饮",
        body: "老板说是城市限定口味，财务说先限定一下预算。",
        action_label: "看看口味",
        action_url: "https://example.com/hangzhou-preview",
        payload: { placement: "product", goods_id: 0 },
      },
      {
        ...common,
        id: "qa_location_lingyin",
        campaign_type: "sponsor_location",
        placement_key: "location",
        target_entity_type: "location",
        target_entity_key: "2",
        title: "灵隐早起补给站",
        body: "六点开门，七点排队，八点开始研究为什么大家都来得这么早。",
        action_label: "查看地点",
        action_url: "https://example.com/hangzhou-preview",
        payload: { placement: "location", location_id: 2 },
      },
      {
        ...common,
        id: "qa_news_queue",
        campaign_type: "sponsor_news",
        placement_key: "news",
        target_entity_type: null,
        target_entity_key: null,
        title: "今日合作播报：排队系统开始排队",
        body: "系统上线后运行稳定，唯一的问题是查询排队进度也需要先排队。",
        action_label: "查看详情",
        action_url: "https://example.com/hangzhou-preview",
        payload: { placement: "news" },
      },
    ];
  }

  function beginRun(meta = {}) {
    runtime.clientRunId = meta.clientRunId || randomId("run");
    runtime.shareCode = meta.shareCode || randomId("share").slice(0, 18);
    runtime.runExperimentKey = meta.experimentKey
      || meta.experiment_key
      || runtime.experiment?.experiment_key
      || runtime.city?.config?.gameplay_experiment?.experimentId
      || "control";
    return runMeta();
  }

  function runMeta() {
    return {
      client_run_id: runtime.clientRunId,
      session_id: runtime.sessionId,
      city_key: runtime.city?.city_key || "hangzhou",
      city_version: runtime.city?.content_version || "hz-v1",
      game_version: window.BFSJ_GAME_VERSION || null,
      experiment_key: runtime.runExperimentKey
        || runtime.experiment?.experiment_key
        || runtime.city?.config?.gameplay_experiment?.experimentId
        || "control",
      share_code: runtime.shareCode,
    };
  }

  function applyGameplayExperiment(selected) {
    if (!selected?.experiment_key || !selected?.config) return null;
    runtime.experiment = selected;
    runtime.city = {
      ...runtime.city,
      config: {
        ...(runtime.city?.config || {}),
        gameplay_experiment: {
          ...selected.config,
          experimentId: selected.experiment_key,
        },
      },
    };
    return runtime.experiment;
  }

  function applyLocalQaExperimentFromCatalog() {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) return null;
    const key = new URLSearchParams(window.location.search).get("qa_experiment");
    if (!key) return null;
    const catalog = window.BFSJ_QA_EXPERIMENTS;
    const variant = catalog?.variants?.find((item) => item.id === key);
    if (!variant?.config) return null;
    return applyGameplayExperiment({
      experiment_key: variant.id,
      config_version: catalog.schemaVersion || "local-qa",
      config: variant.config,
    });
  }

  async function loadLocalQaExperiment() {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) return null;
    const key = new URLSearchParams(window.location.search).get("qa_experiment");
    if (!key) return null;
    const synchronous = applyLocalQaExperimentFromCatalog();
    if (synchronous) return synchronous;
    for (const url of ["./assets/gameplay-experiments.json", "./src/config/gameplay-experiments.json"]) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) continue;
        const catalog = await response.json();
        const variant = catalog?.variants?.find((item) => item.id === key);
        if (variant?.config) {
          return applyGameplayExperiment({
            experiment_key: variant.id,
            config_version: catalog.schemaVersion || "local-qa",
            config: variant.config,
          });
        }
      } catch (_error) {}
    }
    return null;
  }

  function queuePlaytestFeedback(payload) {
    const queued = readJson(window.localStorage, FEEDBACK_QUEUE_KEY, []);
    const next = Array.isArray(queued) ? queued.filter((item) => item?.client_feedback_id !== payload.client_feedback_id) : [];
    next.push(payload);
    window.localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(next.slice(-20)));
  }

  async function sendPlaytestFeedback(payload) {
    if (!runtime.client) return false;
    try {
      const request = runtime.client.rpc("submit_playtest_feedback", { p_payload: payload })
        .then(({ error }) => !error)
        .catch(() => false);
      const timeout = new Promise((resolve) => window.setTimeout(() => resolve(false), 4000));
      return await Promise.race([request, timeout]);
    } catch (_error) {
      return false;
    }
  }

  async function submitPlaytestFeedback(input = {}) {
    const meta = runMeta();
    const payload = {
      ...meta,
      ...input,
      client_feedback_id: input.client_feedback_id || `feedback_${meta.client_run_id}`,
    };
    const ok = await sendPlaytestFeedback(payload);
    if (ok) return { ok: true, queued: false };
    queuePlaytestFeedback(payload);
    return { ok: false, queued: true };
  }

  async function flushPlaytestFeedbackQueue() {
    if (!runtime.client) return 0;
    const queued = readJson(window.localStorage, FEEDBACK_QUEUE_KEY, []);
    if (!Array.isArray(queued) || !queued.length) return 0;
    const remaining = [];
    let sent = 0;
    for (const payload of queued) {
      if (await sendPlaytestFeedback(payload)) sent += 1;
      else remaining.push(payload);
    }
    if (remaining.length) window.localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(remaining.slice(-20)));
    else window.localStorage.removeItem(FEEDBACK_QUEUE_KEY);
    return sent;
  }

  async function loadGameplayExperiment() {
    const localQa = await loadLocalQaExperiment();
    if (localQa) return localQa;
    if (!runtime.client) return null;
    try {
      const cityKey = runtime.city?.city_key || "hangzhou";
      const { data, error } = await runtime.client.rpc("resolve_gameplay_experiment", {
        p_city_key: cityKey,
        p_session_id: runtime.sessionId,
      });
      const selected = Array.isArray(data) ? data[0] : data;
      if (!error && selected?.experiment_key && selected?.config) {
        applyGameplayExperiment(selected);
      }
    } catch (_error) {
      runtime.experiment = null;
    }
    return runtime.experiment;
  }

  async function resolveCity() {
    if (!runtime.client) return runtime.city;
    let city = null;
    try {
      const { data, error } = await runtime.client.functions.invoke("resolve-city", { body: {} });
      if (!error && data?.city_key) city = data;
    } catch (_error) {}

    if (!city) {
      try {
        const { data, error } = await runtime.client.rpc("resolve_city_by_hint", {
          p_country: null,
          p_region: null,
          p_city: null,
        });
        if (!error && Array.isArray(data) && data[0]?.city_key) city = data[0];
      } catch (_error) {}
    }

    if (city) {
      runtime.city = city;
      window.localStorage.setItem(CITY_CACHE_KEY, JSON.stringify(city));
    }
    return runtime.city;
  }

  async function loadCampaigns() {
    const qaCampaigns = localCampaignQaFixtures();
    if (qaCampaigns.length) {
      runtime.campaigns = qaCampaigns;
      return runtime.campaigns;
    }
    if (!runtime.client) {
      runtime.campaigns = [];
      return runtime.campaigns;
    }
    try {
      const cityKey = runtime.city?.city_key || "hangzhou";
      const { data, error } = await runtime.client
        .from("active_campaigns")
        .select("id, city_key, campaign_type, title, body, action_label, action_url, weight, frequency_cap, payload, starts_at, ends_at, placement_key, target_entity_type, target_entity_key, disclosure_label, creative, economy_effect")
        .or(`city_key.is.null,city_key.eq.${cityKey}`);
      runtime.campaigns = error ? [] : (data || []);
    } catch (_error) {
      runtime.campaigns = [];
    }
    return runtime.campaigns;
  }

  function campaignCaps() {
    const today = new Date().toISOString().slice(0, 10);
    const saved = readJson(window.localStorage, CAMPAIGN_CAP_KEY, {});
    if (saved.date === today && saved.counts) return saved;
    return { date: today, counts: {} };
  }

  function placementCampaigns(placement, context = {}) {
    const caps = campaignCaps();
    return runtime.campaigns.filter((campaign) => {
      const configuredPlacement = campaign.placement_key || campaign.payload?.placement || "news";
      const shown = Number(caps.counts[campaign.id] || 0);
      const payload = campaign.payload || {};
      const targetType = campaign.target_entity_type
        || (payload.goods_id == null ? null : "goods")
        || (payload.location_id == null ? null : "location");
      const targetKey = campaign.target_entity_key
        ?? (targetType === "location" ? payload.location_id : payload.goods_id);
      const contextKey = targetType === "location" ? context.location_id : context.goods_id;
      const targetMatches = targetKey == null || String(targetKey) === String(contextKey ?? "");
      return configuredPlacement === placement
        && targetMatches
        && shown < Number(campaign.frequency_cap || 1);
    });
  }

  function pickCampaign(placement, context = {}) {
    const choices = placementCampaigns(placement, context);
    const total = choices.reduce((sum, item) => sum + Math.max(1, Number(item.weight || 1)), 0);
    if (!total) return null;
    let draw = Math.random() * total;
    for (const item of choices) {
      draw -= Math.max(1, Number(item.weight || 1));
      if (draw <= 0) return item;
    }
    return choices[choices.length - 1] || null;
  }

  async function recordCampaignEvent(campaign, eventType, metadata = {}) {
    if (!campaign?.id) return false;
    if (eventType === "impression") {
      const caps = campaignCaps();
      caps.counts[campaign.id] = Number(caps.counts[campaign.id] || 0) + 1;
      window.localStorage.setItem(CAMPAIGN_CAP_KEY, JSON.stringify(caps));
    }
    runtime.campaignEvents.push({
      campaign_id: campaign.id,
      event_type: eventType,
      metadata: { ...metadata },
      created_at: new Date().toISOString(),
    });
    if (!runtime.client || String(campaign.id).startsWith("qa_")) return true;
    try {
      const meta = runMeta();
      const { error } = await runtime.client.rpc("record_campaign_event", {
        p_campaign_id: campaign.id,
        p_event_type: eventType,
        p_city_key: meta.city_key,
        p_session_id: meta.session_id,
        p_client_run_id: meta.client_run_id,
        p_guest_id: null,
        p_metadata: metadata,
      });
      return !error;
    } catch (_error) {
      return false;
    }
  }

  async function init(client) {
    runtime.client = client || runtime.client;
    if (!runtime.client) {
      await loadCampaigns();
      runtime.initialized = true;
      window.dispatchEvent(new CustomEvent("bfsj:platform-ready", { detail: runtime }));
      return runtime;
    }
    await resolveCity();
    await loadGameplayExperiment();
    await loadCampaigns();
    await flushPlaytestFeedbackQueue();
    runtime.initialized = true;
    window.dispatchEvent(new CustomEvent("bfsj:platform-ready", { detail: runtime }));
    return runtime;
  }

  window.BFSJ_PLATFORM = {
    runtime,
    init,
    beginRun,
    runMeta,
    resolveCity,
    loadGameplayExperiment,
    loadCampaigns,
    pickCampaign,
    recordCampaignEvent,
    submitPlaytestFeedback,
    flushPlaytestFeedbackQueue,
  };
  applyLocalQaExperimentFromCatalog();
  const bootCampaignFixtures = localCampaignQaFixtures();
  if (bootCampaignFixtures.length) {
    runtime.campaigns = bootCampaignFixtures;
    runtime.initialized = true;
  }
})();
