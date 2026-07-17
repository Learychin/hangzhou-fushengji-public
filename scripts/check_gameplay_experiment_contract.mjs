import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const catalogPath = path.join(ROOT, "src", "config", "gameplay-experiments.json");
const webCatalogPath = path.join(ROOT, "web_mvp", "assets", "gameplay-experiments.json");
const migrationPath = path.join(ROOT, "supabase", "migrations", "20260715160000_gameplay_experiments_and_native_ads.sql");
const activationMigrationPath = path.join(ROOT, "supabase", "migrations", "20260716150000_activate_friend_blind_test.sql");
const dashboardMigrationPath = path.join(ROOT, "supabase", "migrations", "20260716170000_friend_test_control_dashboard.sql");

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const webCatalog = JSON.parse(fs.readFileSync(webCatalogPath, "utf8"));
const migration = fs.readFileSync(migrationPath, "utf8");
const activationMigration = fs.readFileSync(activationMigrationPath, "utf8");
const dashboardMigration = fs.readFileSync(dashboardMigrationPath, "utf8");
const expectedIds = [
  "control_current",
  "clue_balanced",
  "small_goods_comeback",
  "high_risk_black_horse",
  "news_story_storm",
];

function fail(message) {
  throw new Error(message);
}

if (catalog.schemaVersion !== "gameplay-experiments-v1") fail("Unexpected gameplay experiment schema version");
if (JSON.stringify(catalog) !== JSON.stringify(webCatalog)) fail("Web experiment catalog is out of sync");

const variants = new Map((catalog.variants || []).map((variant) => [variant.id, variant]));
if (variants.size !== expectedIds.length || expectedIds.some((id) => !variants.has(id))) {
  fail(`Expected exactly five gameplay variants: ${expectedIds.join(", ")}`);
}

for (const id of expectedIds) {
  const variant = variants.get(id);
  if (variant.config?.experimentId !== id) fail(`${id}: experimentId does not match variant id`);
  if (variant.config?.collectFeedback !== true) fail(`${id}: collectFeedback must be enabled for blind testing`);
  for (const [key, value] of Object.entries(variant.config || {})) {
    if (typeof value === "number" && !Number.isFinite(value)) fail(`${id}: ${key} is not finite`);
  }
}

for (const id of expectedIds) {
  if (!activationMigration.includes(`'${id}'`)) fail(`${id}: activation migration is missing the variant`);
}
if (!activationMigration.includes("allocation_weight = 100")) fail("Activation migration must use equal allocation");
if (!activationMigration.includes("set status = 'draft'")) fail("Campaigns must remain draft during the first blind test");
if (!dashboardMigration.includes("admin_set_friend_test_state")) fail("Friend-test start and pause control is missing");
if (!dashboardMigration.includes("story_share_rate")) fail("Friend-test story/share decision metric is missing");
if (!dashboardMigration.includes("negative_asset_rate")) fail("Friend-test negative-asset guardrail is missing");

const migrationConfigs = new Map();
for (const match of migration.matchAll(/'(\{"experimentId":"([a-z0-9_-]+)"[^']*\})'::jsonb/g)) {
  migrationConfigs.set(match[2], JSON.parse(match[1]));
}
for (const id of expectedIds) {
  const seeded = migrationConfigs.get(id);
  if (!seeded) fail(`${id}: migration seed config is missing`);
  if (JSON.stringify(seeded) !== JSON.stringify(variants.get(id).config)) {
    fail(`${id}: migration seed differs from the source catalog`);
  }
}

const rootPlatform = fs.readFileSync(path.join(ROOT, "platform.js"), "utf8");
const webPlatform = fs.readFileSync(path.join(ROOT, "web_mvp", "platform.js"), "utf8");
if (rootPlatform !== webPlatform) fail("Root and Web platform runtimes are out of sync");

console.log("Gameplay experiment contract passed: five variants, feedback, migration, Web catalog, and platform runtime are aligned");
