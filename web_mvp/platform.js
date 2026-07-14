"use strict";

(() => {
  const SESSION_KEY = "bfsj_platform_session_v1";
  const CITY_CACHE_KEY = "bfsj_city_route_v1";
  const CAMPAIGN_CAP_KEY = "bfsj_campaign_caps_v1";

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
    let value = window.sessionStorage.getItem(SESSION_KEY);
    if (!value) {
      value = randomId("session");
      window.sessionStorage.setItem(SESSION_KEY, value);
    }
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
    campaigns: [],
  };

  function beginRun(meta = {}) {
    runtime.clientRunId = meta.clientRunId || randomId("run");
    runtime.shareCode = meta.shareCode || randomId("share").slice(0, 18);
    return runMeta();
  }

  function runMeta() {
    return {
      client_run_id: runtime.clientRunId,
      session_id: runtime.sessionId,
      city_key: runtime.city?.city_key || "hangzhou",
      city_version: runtime.city?.content_version || "hz-v1",
      game_version: window.BFSJ_GAME_VERSION || null,
      share_code: runtime.shareCode,
    };
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
    if (!runtime.client) return [];
    try {
      const cityKey = runtime.city?.city_key || "hangzhou";
      const { data, error } = await runtime.client
        .from("active_campaigns")
        .select("id, city_key, campaign_type, title, body, action_label, action_url, weight, frequency_cap, payload, starts_at, ends_at")
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
      const configuredPlacement = campaign.payload?.placement || "news";
      const shown = Number(caps.counts[campaign.id] || 0);
      const goodsId = campaign.payload?.goods_id;
      const goodsMatches = goodsId == null || String(goodsId) === String(context.goods_id ?? "");
      return configuredPlacement === placement
        && goodsMatches
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
    if (!campaign?.id || !runtime.client) return false;
    if (eventType === "impression") {
      const caps = campaignCaps();
      caps.counts[campaign.id] = Number(caps.counts[campaign.id] || 0) + 1;
      window.localStorage.setItem(CAMPAIGN_CAP_KEY, JSON.stringify(caps));
    }
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
    if (!runtime.client) return runtime;
    await resolveCity();
    await loadCampaigns();
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
    loadCampaigns,
    pickCampaign,
    recordCampaignEvent,
  };
})();
