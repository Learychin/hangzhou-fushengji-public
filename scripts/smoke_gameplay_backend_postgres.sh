#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
WORK_DIR="${TMPDIR:-/private/tmp}/hzfsj_backend_smoke_$$"
DATA_DIR="$WORK_DIR/data"
LOG_FILE="$WORK_DIR/postgres.log"
DB_NAME="hzfsj_backend_smoke"
PORT="${PGPORT:-$((55432 + ($$ % 500)))}"

if [[ ! -x "$PG_BIN/initdb" || ! -x "$PG_BIN/psql" ]]; then
  echo "PostgreSQL 17 tools were not found at $PG_BIN" >&2
  exit 1
fi

cleanup() {
  if [[ -d "$DATA_DIR" ]]; then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$WORK_DIR"
"$PG_BIN/initdb" -D "$DATA_DIR" -A trust --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA_DIR" -l "$LOG_FILE" \
  -o "-h 127.0.0.1 -p $PORT" -w start >/dev/null
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" "$DB_NAME"

PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -d "$DB_NAME")

echo "[1/6] Preparing the minimal Supabase-compatible identity layer"
"${PSQL[@]}" >/dev/null <<'SQL'
create extension if not exists pgcrypto;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
SQL

echo "[2/6] Applying every migration in order"
while IFS= read -r migration; do
  echo "      $(basename "$migration")"
  "${PSQL[@]}" -f "$migration" >/dev/null
done < <(find "$ROOT_DIR/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | sort)

echo "[3/6] Checking the five hidden variants and deterministic allocation"
"${PSQL[@]}" <<'SQL'
do $$
declare
  v_count integer;
  v_active integer;
  v_feedback_enabled integer;
begin
  select count(*), count(*) filter (where status = 'active'),
         count(*) filter (where config->>'collectFeedback' = 'true')
    into v_count, v_active, v_feedback_enabled
  from public.gameplay_experiments;
  if v_count <> 5 or v_active <> 5 or v_feedback_enabled <> 5 then
    raise exception 'expected five active variants with feedback enabled, got %, %, %',
      v_count, v_active, v_feedback_enabled;
  end if;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', 'qiankeyl@gmail.com', '{"name":"Admin"}', '{"provider":"email"}'),
  ('00000000-0000-0000-0000-000000000002', 'friend@example.com', '{"name":"Friend"}', '{"provider":"email"}');

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
begin
  if not public.is_admin() then raise exception 'admin identity was not recognized'; end if;
end;
$$;
reset role;
reset request.jwt.claim.sub;

set role anon;
do $$
begin
  begin
    perform count(*) from public.gameplay_experiments;
    raise exception 'anonymous direct experiment access unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

create temp table equal_assignment as
select resolved.experiment_key, count(*)::integer as assignments
from generate_series(1, 5000) sample_id
cross join lateral public.resolve_gameplay_experiment(
  'hangzhou', 'equal-session-' || sample_id::text
) resolved
group by resolved.experiment_key;

do $$
declare
  v_groups integer;
  v_total integer;
  v_spread integer;
  v_first text;
  v_second text;
begin
  select count(*), sum(assignments), max(assignments) - min(assignments)
    into v_groups, v_total, v_spread from equal_assignment;
  if v_groups <> 5 or v_total <> 5000 or v_spread > 180 then
    raise exception 'equal allocation failed: groups %, total %, spread %',
      v_groups, v_total, v_spread;
  end if;
  select experiment_key into v_first
    from public.resolve_gameplay_experiment('hangzhou', 'persistent-friend-session');
  select experiment_key into v_second
    from public.resolve_gameplay_experiment('hangzhou', 'persistent-friend-session');
  if v_first is null or v_first <> v_second then
    raise exception 'same session was not assigned deterministically';
  end if;
end;
$$;
table equal_assignment;
reset role;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
select public.admin_set_gameplay_experiment_status('high_risk_black_horse', 'active', 500);
reset role;
reset request.jwt.claim.sub;

set role anon;
create temp table weighted_assignment as
select resolved.experiment_key, count(*)::integer as assignments
from generate_series(1, 5000) sample_id
cross join lateral public.resolve_gameplay_experiment(
  'hangzhou', 'weighted-session-' || sample_id::text
) resolved
group by resolved.experiment_key;

do $$
declare
  v_high_risk integer;
  v_largest_other integer;
begin
  select assignments into v_high_risk from weighted_assignment
    where experiment_key = 'high_risk_black_horse';
  select max(assignments) into v_largest_other from weighted_assignment
    where experiment_key <> 'high_risk_black_horse';
  if v_high_risk is null or v_high_risk <= v_largest_other * 3 then
    raise exception 'weighted allocation did not react: target %, largest other %',
      v_high_risk, v_largest_other;
  end if;
end;
$$;
table weighted_assignment;
reset role;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
select public.admin_set_gameplay_experiment_status('high_risk_black_horse', 'active', 100);
reset role;
reset request.jwt.claim.sub;
SQL

echo "[4/6] Archiving anonymous runs and collecting blind-test feedback"
"${PSQL[@]}" <<'SQL'
set role anon;

select public.archive_guest_run(jsonb_build_object(
  'guest_id', 'guest-' || variant.ordinality,
  'nickname', '试玩者' || variant.ordinality,
  'device_fingerprint', 'device-' || variant.ordinality,
  'claim_token', 'claim-' || variant.ordinality,
  'client_run_id', 'run-' || variant.ordinality,
  'session_id', 'session-' || variant.ordinality,
  'score', 100000 * variant.ordinality,
  'cash', 1000, 'bank', 0, 'debt', 0, 'health', 100, 'fame', 0, 'coat', 0,
  'days_used', 45,
  'ended_reason', 'completed',
  'city_key', 'hangzhou', 'city_version', 'hz-v1', 'game_version', 'backend-smoke',
  'final_state', jsonb_build_object(
    'experiment_key', variant.experiment_key,
    'playtest_metrics', jsonb_build_object(
      'duration_seconds', 420 + 30 * variant.ordinality,
      'primary_action_count', 70 + 5 * variant.ordinality,
      'checkpoint_net_worth', jsonb_build_object('5', -1000, '10', 1000 * variant.ordinality, '15', 5000),
      'profitable_sale_count', variant.ordinality,
      'max_single_trade_profit', 2000 * variant.ordinality
    )
  )
))
from unnest(array[
  'control_current', 'clue_balanced', 'small_goods_comeback',
  'high_risk_black_horse', 'news_story_storm'
]) with ordinality as variant(experiment_key, ordinality);

select public.submit_playtest_feedback(jsonb_build_object(
  'client_feedback_id', 'feedback-' || variant.ordinality,
  'session_id', 'session-' || variant.ordinality,
  'client_run_id', 'run-' || variant.ordinality,
  'experiment_key', variant.experiment_key,
  'city_key', 'hangzhou', 'city_version', 'hz-v1', 'game_version', 'backend-smoke',
  'score', 100000 * variant.ordinality, 'days_used', 45,
  'surprise', least(5, 2 + variant.ordinality),
  'satisfaction', least(5, 2 + variant.ordinality),
  'agency', 4, 'fairness', 4, 'replay_intent', 4, 'share_intent', 4,
  'memorable_moment', '匿名试玩反馈 ' || variant.ordinality
))
from unnest(array[
  'control_current', 'clue_balanced', 'small_goods_comeback',
  'high_risk_black_horse', 'news_story_storm'
]) with ordinality as variant(experiment_key, ordinality);

do $$
begin
  begin
    perform count(*) from public.guest_runs;
    raise exception 'anonymous direct guest-run access unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.playtest_feedback;
    raise exception 'anonymous direct feedback access unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
SQL

echo "[5/6] Checking admin aggregation and non-admin isolation"
"${PSQL[@]}" <<'SQL'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;

create temp table gameplay_results as
select * from public.admin_gameplay_experiment_results();
create temp table feedback_results as
select * from public.admin_playtest_feedback_results();

do $$
declare
  v_variants integer;
  v_runs bigint;
  v_metric_runs bigint;
  v_feedback_groups integer;
  v_feedback bigint;
begin
  select count(*), sum(run_count), sum(metrics_run_count)
    into v_variants, v_runs, v_metric_runs from gameplay_results;
  select count(*), sum(feedback_count)
    into v_feedback_groups, v_feedback from feedback_results;
  if v_variants <> 5 or v_runs <> 5 or v_metric_runs <> 5 then
    raise exception 'gameplay aggregate failed: variants %, runs %, metric runs %',
      v_variants, v_runs, v_metric_runs;
  end if;
  if v_feedback_groups <> 5 or v_feedback <> 5 then
    raise exception 'feedback aggregate failed: groups %, feedback %',
      v_feedback_groups, v_feedback;
  end if;
end;
$$;

select experiment_key, run_count, avg_score, completion_rate,
       avg_duration_seconds, avg_primary_actions, day10_break_even_rate,
       profitable_sale_rate
from gameplay_results order by experiment_key;
select experiment_key, feedback_count, avg_surprise, avg_satisfaction,
       avg_replay_intent, avg_share_intent
from feedback_results order by experiment_key;

reset role;
reset request.jwt.claim.sub;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
set role authenticated;

do $$
declare
  v_count integer;
begin
  if public.is_admin() then raise exception 'regular account was treated as admin'; end if;
  select count(*) into v_count from public.admin_gameplay_experiments();
  if v_count <> 0 then raise exception 'regular account could read experiment admin data'; end if;
  select count(*) into v_count from public.admin_gameplay_experiment_results();
  if v_count <> 0 then raise exception 'regular account could read gameplay aggregates'; end if;
  select count(*) into v_count from public.admin_playtest_feedback_results();
  if v_count <> 0 then raise exception 'regular account could read feedback aggregates'; end if;
  begin
    perform public.admin_set_gameplay_experiment_status('control_current', 'paused', 100);
    raise exception 'regular account unexpectedly changed an experiment';
  exception when raise_exception then
    if sqlerrm <> 'admin_required' then raise; end if;
  end;
end;
$$;
reset role;
reset request.jwt.claim.sub;
SQL

echo "[6/6] Checking the disclosed campaign placement loop"
"${PSQL[@]}" <<'SQL'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
select public.admin_upsert_native_campaign(
  null, 'hangzhou', 'sponsor_product', 'active',
  '合作商品测试', '仅用于验证后台接口，不进入正式内容。',
  '了解合作', 'https://example.com/campaign', 100, 1,
  null, null, 'product', 'goods', '景区文创冰箱贴', '合作内容',
  '{"accent":"cyan"}'::jsonb, '{}'::jsonb, '{"test":true}'::jsonb
) as campaign_id \gset
reset role;
reset request.jwt.claim.sub;

set role anon;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.active_campaigns
    where disclosure_label = '合作内容'
      and placement_key = 'product'
      and target_entity_key = '景区文创冰箱贴';
  if v_count <> 1 then raise exception 'disclosed campaign was not publicly resolvable'; end if;
  begin
    perform count(*) from public.campaigns;
    raise exception 'anonymous direct campaign access unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select public.record_campaign_event(
  :'campaign_id'::uuid, 'impression', 'hangzhou',
  'campaign-session', 'campaign-run', 'campaign-guest', '{"placement":"product"}'::jsonb
);
reset role;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.admin_campaign_events();
  if v_count <> 1 then raise exception 'campaign impression was not aggregated'; end if;
end;
$$;
reset role;
reset request.jwt.claim.sub;
SQL

echo "Backend smoke passed: migrations, five-way allocation, feedback, metrics, permissions, and campaigns."
