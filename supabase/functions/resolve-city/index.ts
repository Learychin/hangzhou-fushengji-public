const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "private, max-age=900",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded
    || req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_not_configured" }, 503);

  let country = req.headers.get("cf-ipcountry") || "";
  let region = "";
  let city = "";
  let matchedBy = "edge_country";
  const ip = clientIp(req);

  if (ip) {
    try {
      const lookupUrl = `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code,region,city`;
      const response = await fetch(lookupUrl, {
        headers: { "User-Agent": "hangzhou-fushengji-city-router/1.0" },
        signal: AbortSignal.timeout(1800),
      });
      if (response.ok) {
        const location = await response.json();
        if (location?.success !== false) {
          country = location?.country_code || country;
          region = location?.region || "";
          city = location?.city || "";
          matchedBy = "ip";
        }
      }
    } catch (_error) {
      // The database resolver will safely fall back to the configured default city.
    }
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_city_by_hint`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_country: country || null,
      p_region: region || null,
      p_city: city || null,
    }),
  });

  if (!response.ok) return json({ error: "city_resolution_failed" }, 502);
  const rows = await response.json();
  const selected = Array.isArray(rows) ? rows[0] : rows;
  if (!selected?.city_key) return json({ error: "no_enabled_city" }, 404);

  return json({
    ...selected,
    matched_by: selected.matched_by === "default" ? "default" : matchedBy,
  });
});
