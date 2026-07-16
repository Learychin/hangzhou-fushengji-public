-- Hidden gameplay experiments and clearly disclosed native campaign placements.

create table if not exists public.gameplay_experiments (
  id uuid primary key default gen_random_uuid(),
  experiment_key text not null unique,
  city_key text not null references public.cities(city_key) on delete cascade,
  internal_name text not null,
  hypothesis text not null default '',
  status text not null default 'draft',
  allocation_weight integer not null default 100,
  config_version text not null default 'v1',
  config jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gameplay_experiments_key_format check (experiment_key ~ '^[a-z0-9][a-z0-9_-]{1,47}$'),
  constraint gameplay_experiments_status_check check (status in ('draft', 'active', 'paused', 'archived')),
  constraint gameplay_experiments_weight_check check (allocation_weight between 1 and 10000)
);

create index if not exists gameplay_experiments_delivery_idx
  on public.gameplay_experiments (city_key, status, starts_at, ends_at);

insert into public.gameplay_experiments (
  experiment_key, city_key, internal_name, hypothesis, status, allocation_weight, config_version, config
)
values
  (
    'control_current', 'hangzhou', '现行对照组',
    '保留当前规则，用于判断其他方案是否真正改善前期手感。',
    'draft', 100, 'gameplay-experiments-v1',
    '{"experimentId":"control_current","collectFeedback":true}'::jsonb
  ),
  (
    'clue_balanced', 'hangzhou', '线索友好型',
    '稍密的新闻和温和的早期反转，让新手更容易看懂机会，但不直接送钱。',
    'draft', 100, 'gameplay-experiments-v1',
    '{"experimentId":"clue_balanced","collectFeedback":true,"priceSpanScale":1.05,"lowGoodsPriceSpanScale":1.18,"highValuePriceSpanScale":0.82,"locationSpreadScale":0.95,"lowGoodsLocationSpreadScale":1.15,"highValueLocationSpreadScale":0.8,"locationRareChance":10,"newsSpawnRate":30,"newsMinGapDays":2,"newsForceAfterDays":4,"newsEffectScale":1.15,"smallGoodsStartDay":2,"smallGoodsSwingRate":20,"smallGoodsUpRate":72,"smallGoodsUpMin":55,"smallGoodsUpMax":135,"smallGoodsDownMin":22,"smallGoodsDownMax":52,"jackpotStartDay":21,"jackpotChanceFloor":5,"jackpotChanceCap":20,"jackpotQuotaDistribution":[18,57,21,4],"debtGraceRate":0.028,"debtLateRate":0.052}'::jsonb
  ),
  (
    'small_goods_comeback', 'hangzhou', '小商品翻盘型',
    '让低本金玩家也能靠低价商品形成可讲述的翻盘局。',
    'draft', 100, 'gameplay-experiments-v1',
    '{"experimentId":"small_goods_comeback","collectFeedback":true,"priceSpanScale":1.08,"lowGoodsPriceSpanScale":1.48,"highValuePriceSpanScale":0.62,"locationSpreadScale":1.05,"lowGoodsLocationSpreadScale":1.42,"highValueLocationSpreadScale":0.62,"locationRareChance":12,"newsSpawnRate":27,"newsMinGapDays":2,"newsForceAfterDays":4,"newsEffectScale":1.18,"smallGoodsStartDay":2,"smallGoodsSwingRate":32,"smallGoodsUpRate":74,"smallGoodsUpMin":75,"smallGoodsUpMax":190,"smallGoodsDownMin":28,"smallGoodsDownMax":68,"jackpotStartDay":18,"jackpotChanceFloor":6,"jackpotChanceCap":24,"jackpotRegularMin":160,"jackpotRegularMax":360,"jackpotQuotaDistribution":[12,55,27,6],"debtGraceRate":0.027,"debtLateRate":0.052}'::jsonb
  ),
  (
    'high_risk_black_horse', 'hangzhou', '高风险黑马型',
    '扩大振幅制造极端战绩，同时验证通胀和破产边界。',
    'draft', 100, 'gameplay-experiments-v1',
    '{"experimentId":"high_risk_black_horse","collectFeedback":true,"priceSpanScale":1.35,"lowGoodsPriceSpanScale":1.55,"highValuePriceSpanScale":1.1,"locationSpreadScale":1.38,"lowGoodsLocationSpreadScale":1.55,"highValueLocationSpreadScale":1.05,"locationRareChance":16,"newsSpawnRate":26,"newsMinGapDays":2,"newsForceAfterDays":4,"newsEffectScale":1.35,"smallGoodsStartDay":2,"smallGoodsSwingRate":26,"smallGoodsUpRate":58,"smallGoodsUpMin":90,"smallGoodsUpMax":280,"smallGoodsDownMin":38,"smallGoodsDownMax":82,"jackpotStartDay":20,"jackpotChanceFloor":5,"jackpotChanceCap":22,"jackpotRegularMin":240,"jackpotRegularMax":620,"jackpotSuperRate":18,"jackpotSuperMin":800,"jackpotSuperMax":1200,"jackpotQuotaDistribution":[20,48,25,7],"debtGraceRate":0.035,"debtLateRate":0.065}'::jsonb
  ),
  (
    'news_story_storm', 'hangzhou', '新闻故事型',
    '用高频因果新闻驱动交易，验证故事密度与信息疲劳的边界。',
    'draft', 100, 'gameplay-experiments-v1',
    '{"experimentId":"news_story_storm","collectFeedback":true,"priceSpanScale":0.95,"lowGoodsPriceSpanScale":1.15,"highValuePriceSpanScale":0.7,"locationSpreadScale":0.82,"lowGoodsLocationSpreadScale":1.1,"highValueLocationSpreadScale":0.68,"locationRareChance":7,"newsSpawnRate":42,"newsMinGapDays":1,"newsForceAfterDays":3,"newsEffectScale":1.28,"smallGoodsStartDay":2,"smallGoodsSwingRate":24,"smallGoodsUpRate":68,"smallGoodsUpMin":55,"smallGoodsUpMax":145,"smallGoodsDownMin":25,"smallGoodsDownMax":62,"jackpotStartDay":22,"jackpotChanceFloor":5,"jackpotChanceCap":20,"jackpotRegularMin":170,"jackpotRegularMax":380,"jackpotQuotaDistribution":[15,58,23,4],"debtGraceRate":0.03,"debtLateRate":0.055}'::jsonb
  )
on conflict (experiment_key) do update set
  internal_name = excluded.internal_name,
  hypothesis = excluded.hypothesis,
  config_version = excluded.config_version,
  config = excluded.config,
  updated_at = now();

alter table public.gameplay_experiments enable row level security;
revoke all on public.gameplay_experiments from anon, authenticated;

create or replace function public.resolve_gameplay_experiment(
  p_city_key text,
  p_session_id text
)
returns table (
  experiment_key text,
  config_version text,
  config jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select
      ge.experiment_key,
      ge.config_version,
      ge.config,
      ge.allocation_weight,
      sum(ge.allocation_weight) over (order by ge.experiment_key) as upper_bound,
      sum(ge.allocation_weight) over () as total_weight
    from public.gameplay_experiments ge
    where ge.city_key = coalesce(nullif(p_city_key, ''), 'hangzhou')
      and ge.status = 'active'
      and (ge.starts_at is null or ge.starts_at <= now())
      and (ge.ends_at is null or ge.ends_at > now())
  ), draw as (
    select mod(
      hashtext(coalesce(nullif(p_session_id, ''), 'anonymous'))::bigint + 2147483648,
      greatest(1, coalesce(max(total_weight), 1))
    ) as value
    from eligible
  )
  select e.experiment_key, e.config_version, e.config
  from eligible e cross join draw d
  where d.value < e.upper_bound
    and d.value >= e.upper_bound - e.allocation_weight
  order by e.experiment_key
  limit 1;
$$;

grant execute on function public.resolve_gameplay_experiment(text, text) to anon, authenticated;

create or replace function public.admin_gameplay_experiments()
returns setof public.gameplay_experiments
language sql
stable
security definer
set search_path = public
as $$
  select ge.*
  from public.gameplay_experiments ge
  where public.is_admin()
  order by ge.created_at desc;
$$;

grant execute on function public.admin_gameplay_experiments() to authenticated;

create or replace function public.admin_upsert_gameplay_experiment(
  p_experiment_key text,
  p_city_key text,
  p_internal_name text,
  p_hypothesis text,
  p_status text,
  p_allocation_weight integer,
  p_config_version text,
  p_config jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_status not in ('draft', 'active', 'paused', 'archived') then raise exception 'invalid_status'; end if;
  insert into public.gameplay_experiments (
    experiment_key, city_key, internal_name, hypothesis, status,
    allocation_weight, config_version, config, updated_at
  ) values (
    lower(trim(p_experiment_key)), coalesce(nullif(p_city_key, ''), 'hangzhou'),
    trim(p_internal_name), coalesce(p_hypothesis, ''), p_status,
    greatest(1, least(10000, coalesce(p_allocation_weight, 100))),
    coalesce(nullif(p_config_version, ''), 'v1'), coalesce(p_config, '{}'::jsonb), now()
  )
  on conflict (experiment_key) do update set
    city_key = excluded.city_key,
    internal_name = excluded.internal_name,
    hypothesis = excluded.hypothesis,
    status = excluded.status,
    allocation_weight = excluded.allocation_weight,
    config_version = excluded.config_version,
    config = excluded.config,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_set_gameplay_experiment_status(
  p_experiment_key text,
  p_status text,
  p_allocation_weight integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_status not in ('draft', 'active', 'paused', 'archived') then raise exception 'invalid_status'; end if;
  update public.gameplay_experiments
  set status = p_status,
      allocation_weight = case
        when p_allocation_weight is null then allocation_weight
        else greatest(1, least(10000, p_allocation_weight))
      end,
      updated_at = now()
  where experiment_key = p_experiment_key
  returning id into v_id;
  if v_id is null then raise exception 'experiment_not_found'; end if;
  return v_id;
end;
$$;

grant execute on function public.admin_upsert_gameplay_experiment(text, text, text, text, text, integer, text, jsonb) to authenticated;
grant execute on function public.admin_set_gameplay_experiment_status(text, text, integer) to authenticated;

alter table public.game_runs add column if not exists experiment_key text;
alter table public.guest_runs add column if not exists experiment_key text;

create or replace function public.fill_run_experiment_key()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.experiment_key := coalesce(
    nullif(new.experiment_key, ''),
    nullif(new.final_state->>'experiment_key', ''),
    nullif(new.final_state->'platform'->>'experiment_key', ''),
    'control'
  );
  return new;
end;
$$;

drop trigger if exists game_runs_fill_experiment_key on public.game_runs;
create trigger game_runs_fill_experiment_key
before insert or update of experiment_key, final_state on public.game_runs
for each row execute function public.fill_run_experiment_key();

drop trigger if exists guest_runs_fill_experiment_key on public.guest_runs;
create trigger guest_runs_fill_experiment_key
before insert or update of experiment_key, final_state on public.guest_runs
for each row execute function public.fill_run_experiment_key();

update public.game_runs
set experiment_key = coalesce(nullif(final_state->>'experiment_key', ''), 'control')
where experiment_key is null;
update public.guest_runs
set experiment_key = coalesce(nullif(final_state->>'experiment_key', ''), 'control')
where experiment_key is null;

create index if not exists game_runs_experiment_created_idx on public.game_runs (experiment_key, created_at desc);
create index if not exists guest_runs_experiment_created_idx on public.guest_runs (experiment_key, created_at desc);

drop function if exists public.admin_gameplay_experiment_results();
create or replace function public.admin_gameplay_experiment_results()
returns table (
  experiment_key text,
  run_count bigint,
  player_count bigint,
  avg_score integer,
  best_score integer,
  completion_rate numeric,
  replay_player_rate numeric,
  metrics_run_count bigint,
  avg_duration_seconds integer,
  avg_primary_actions numeric,
  day10_break_even_rate numeric,
  profitable_sale_rate numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with all_runs as (
    select
      coalesce(nullif(gr.experiment_key, ''), 'control') as experiment_key,
      'account:' || gr.user_id::text as player_key,
      gr.score,
      gr.days_used,
      gr.final_state
    from public.game_runs gr
    union all
    select
      coalesce(nullif(g.experiment_key, ''), 'control') as experiment_key,
      'guest:' || g.guest_id::text as player_key,
      g.score,
      g.days_used,
      g.final_state
    from public.guest_runs g
  ), experiment_totals as (
    select
      ar.experiment_key,
      count(*)::bigint as run_count,
      count(distinct ar.player_key)::bigint as player_count,
      round(avg(ar.score))::integer as avg_score,
      max(ar.score)::integer as best_score,
      round(100.0 * count(*) filter (where ar.days_used >= 45) / nullif(count(*), 0), 1) as completion_rate,
      count(*) filter (where ar.final_state ? 'playtest_metrics')::bigint as metrics_run_count,
      round(avg(nullif(ar.final_state->'playtest_metrics'->>'duration_seconds', '')::numeric))::integer as avg_duration_seconds,
      round(avg(nullif(ar.final_state->'playtest_metrics'->>'primary_action_count', '')::numeric), 1) as avg_primary_actions,
      round(
        100.0 * count(*) filter (
          where nullif(ar.final_state->'playtest_metrics'->'checkpoint_net_worth'->>'10', '')::numeric >= 0
        ) / nullif(count(*) filter (where ar.final_state ? 'playtest_metrics'), 0),
        1
      ) as day10_break_even_rate,
      round(
        100.0 * count(*) filter (
          where nullif(ar.final_state->'playtest_metrics'->>'profitable_sale_count', '')::integer > 0
        ) / nullif(count(*) filter (where ar.final_state ? 'playtest_metrics'), 0),
        1
      ) as profitable_sale_rate
    from all_runs ar
    group by ar.experiment_key
  ), player_totals as (
    select
      grouped.experiment_key,
      round(100.0 * count(*) filter (where grouped.runs >= 2) / nullif(count(*), 0), 1) as replay_player_rate
    from (
      select ar.experiment_key, ar.player_key, count(*) as runs
      from all_runs ar
      group by ar.experiment_key, ar.player_key
    ) grouped
    group by grouped.experiment_key
  )
  select
    ge.experiment_key,
    coalesce(et.run_count, 0),
    coalesce(et.player_count, 0),
    coalesce(et.avg_score, 0),
    coalesce(et.best_score, 0),
    coalesce(et.completion_rate, 0),
    coalesce(pt.replay_player_rate, 0),
    coalesce(et.metrics_run_count, 0),
    coalesce(et.avg_duration_seconds, 0),
    coalesce(et.avg_primary_actions, 0),
    coalesce(et.day10_break_even_rate, 0),
    coalesce(et.profitable_sale_rate, 0)
  from public.gameplay_experiments ge
  left join experiment_totals et on et.experiment_key = ge.experiment_key
  left join player_totals pt on pt.experiment_key = ge.experiment_key
  where public.is_admin()
  order by ge.created_at;
$$;

grant execute on function public.admin_gameplay_experiment_results() to authenticated;

create table if not exists public.playtest_feedback (
  id uuid primary key default gen_random_uuid(),
  client_feedback_id text not null unique,
  session_id text not null,
  client_run_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  experiment_key text not null default 'control',
  city_key text not null default 'hangzhou',
  city_version text,
  game_version text,
  score integer not null default 0,
  days_used integer not null default 0,
  surprise smallint not null,
  satisfaction smallint not null,
  agency smallint not null,
  fairness smallint not null,
  replay_intent smallint not null,
  share_intent smallint not null,
  quit_day smallint,
  memorable_moment text not null default '',
  created_at timestamptz not null default now(),
  constraint playtest_feedback_rating_check check (
    surprise between 1 and 5
    and satisfaction between 1 and 5
    and agency between 1 and 5
    and fairness between 1 and 5
    and replay_intent between 1 and 5
    and share_intent between 1 and 5
  ),
  constraint playtest_feedback_quit_day_check check (quit_day is null or quit_day between 0 and 45)
);

create index if not exists playtest_feedback_experiment_created_idx
  on public.playtest_feedback (experiment_key, created_at desc);

alter table public.playtest_feedback enable row level security;
revoke all on public.playtest_feedback from anon, authenticated;

create or replace function public.submit_playtest_feedback(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_feedback_id text := left(trim(coalesce(p_payload->>'client_feedback_id', '')), 96);
begin
  if v_feedback_id = '' then raise exception 'feedback_id_required'; end if;
  insert into public.playtest_feedback (
    client_feedback_id, session_id, client_run_id, user_id,
    experiment_key, city_key, city_version, game_version,
    score, days_used, surprise, satisfaction, agency, fairness,
    replay_intent, share_intent, quit_day, memorable_moment
  ) values (
    v_feedback_id,
    left(trim(coalesce(p_payload->>'session_id', 'anonymous')), 128),
    left(trim(coalesce(p_payload->>'client_run_id', 'unknown')), 128),
    auth.uid(),
    left(trim(coalesce(p_payload->>'experiment_key', 'control')), 48),
    left(trim(coalesce(p_payload->>'city_key', 'hangzhou')), 48),
    nullif(left(trim(coalesce(p_payload->>'city_version', '')), 80), ''),
    nullif(left(trim(coalesce(p_payload->>'game_version', '')), 80), ''),
    coalesce((p_payload->>'score')::integer, 0),
    greatest(0, least(45, coalesce((p_payload->>'days_used')::integer, 0))),
    (p_payload->>'surprise')::smallint,
    (p_payload->>'satisfaction')::smallint,
    (p_payload->>'agency')::smallint,
    (p_payload->>'fairness')::smallint,
    (p_payload->>'replay_intent')::smallint,
    (p_payload->>'share_intent')::smallint,
    case when nullif(p_payload->>'quit_day', '') is null then null
      else greatest(0, least(45, (p_payload->>'quit_day')::smallint)) end,
    left(trim(coalesce(p_payload->>'memorable_moment', '')), 500)
  )
  on conflict (client_feedback_id) do update set
    surprise = excluded.surprise,
    satisfaction = excluded.satisfaction,
    agency = excluded.agency,
    fairness = excluded.fairness,
    replay_intent = excluded.replay_intent,
    share_intent = excluded.share_intent,
    quit_day = excluded.quit_day,
    memorable_moment = excluded.memorable_moment
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.submit_playtest_feedback(jsonb) to anon, authenticated;

create or replace function public.admin_playtest_feedback_results()
returns table (
  experiment_key text,
  feedback_count bigint,
  avg_surprise numeric,
  avg_satisfaction numeric,
  avg_agency numeric,
  avg_fairness numeric,
  avg_replay_intent numeric,
  avg_share_intent numeric,
  memorable_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pf.experiment_key,
    count(*)::bigint,
    round(avg(pf.surprise), 2),
    round(avg(pf.satisfaction), 2),
    round(avg(pf.agency), 2),
    round(avg(pf.fairness), 2),
    round(avg(pf.replay_intent), 2),
    round(avg(pf.share_intent), 2),
    count(*) filter (where length(pf.memorable_moment) > 0)::bigint
  from public.playtest_feedback pf
  where public.is_admin()
  group by pf.experiment_key
  order by pf.experiment_key;
$$;

grant execute on function public.admin_playtest_feedback_results() to authenticated;

create or replace function public.admin_recent_playtest_feedback(p_limit integer default 100)
returns table (
  created_at timestamptz,
  experiment_key text,
  score integer,
  surprise smallint,
  satisfaction smallint,
  agency smallint,
  fairness smallint,
  replay_intent smallint,
  share_intent smallint,
  quit_day smallint,
  memorable_moment text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pf.created_at, pf.experiment_key, pf.score, pf.surprise,
    pf.satisfaction, pf.agency, pf.fairness, pf.replay_intent,
    pf.share_intent, pf.quit_day, pf.memorable_moment
  from public.playtest_feedback pf
  where public.is_admin()
  order by pf.created_at desc
  limit greatest(1, least(500, coalesce(p_limit, 100)));
$$;

grant execute on function public.admin_recent_playtest_feedback(integer) to authenticated;

alter table public.campaigns drop constraint if exists campaigns_type_check;
alter table public.campaigns
  add constraint campaigns_type_check check (
    campaign_type in (
      'coupon', 'event', 'sponsor_news', 'sponsor_product', 'sponsor_location', 'settlement_offer'
    )
  );
alter table public.campaigns add column if not exists placement_key text not null default 'news';
alter table public.campaigns add column if not exists target_entity_type text;
alter table public.campaigns add column if not exists target_entity_key text;
alter table public.campaigns add column if not exists disclosure_label text not null default '合作内容';
alter table public.campaigns add column if not exists creative jsonb not null default '{}'::jsonb;
alter table public.campaigns add column if not exists economy_effect jsonb not null default '{}'::jsonb;
alter table public.campaigns drop constraint if exists campaigns_placement_check;
alter table public.campaigns
  add constraint campaigns_placement_check check (
    placement_key in ('news', 'product', 'location', 'settlement')
  );
alter table public.campaigns drop constraint if exists campaigns_target_type_check;
alter table public.campaigns
  add constraint campaigns_target_type_check check (
    target_entity_type is null or target_entity_type in ('goods', 'location')
  );

create index if not exists campaigns_target_idx
  on public.campaigns (placement_key, target_entity_type, target_entity_key, status);

create or replace view public.active_campaigns
with (security_barrier = true)
as
select
  id,
  city_key,
  campaign_type,
  title,
  body,
  action_label,
  action_url,
  weight,
  frequency_cap,
  payload,
  starts_at,
  ends_at,
  placement_key,
  target_entity_type,
  target_entity_key,
  disclosure_label,
  creative,
  economy_effect
from public.campaigns
where status = 'active'
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now());

grant select on public.active_campaigns to anon, authenticated;

create or replace function public.admin_upsert_native_campaign(
  p_id uuid,
  p_city_key text,
  p_campaign_type text,
  p_status text,
  p_title text,
  p_body text,
  p_action_label text,
  p_action_url text,
  p_weight integer,
  p_frequency_cap integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_placement_key text,
  p_target_entity_type text,
  p_target_entity_key text,
  p_disclosure_label text,
  p_creative jsonb,
  p_economy_effect jsonb,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_target_type text := nullif(trim(coalesce(p_target_entity_type, '')), '');
  v_target_key text := nullif(trim(coalesce(p_target_entity_key, '')), '');
  v_action_url text := nullif(trim(coalesce(p_action_url, '')), '');
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_placement_key not in ('news', 'product', 'location', 'settlement') then
    raise exception 'invalid_placement';
  end if;
  if v_target_type is not null and v_target_type not in ('goods', 'location') then
    raise exception 'invalid_target_type';
  end if;
  if v_target_type is null then v_target_key := null; end if;
  if v_action_url is not null and v_action_url !~* '^https?://' then
    raise exception 'invalid_action_url';
  end if;
  if jsonb_typeof(coalesce(p_creative, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_economy_effect, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'campaign_json_must_be_object';
  end if;

  insert into public.campaigns (
    id, city_key, campaign_type, status, title, body, action_label, action_url,
    weight, frequency_cap, starts_at, ends_at, payload, placement_key,
    target_entity_type, target_entity_key, disclosure_label, creative,
    economy_effect, updated_at
  ) values (
    v_id,
    nullif(trim(coalesce(p_city_key, '')), ''),
    p_campaign_type,
    p_status,
    left(trim(p_title), 120),
    left(trim(p_body), 1200),
    nullif(left(trim(coalesce(p_action_label, '')), 80), ''),
    v_action_url,
    greatest(1, least(10000, coalesce(p_weight, 100))),
    greatest(1, least(50, coalesce(p_frequency_cap, 1))),
    p_starts_at,
    p_ends_at,
    coalesce(p_payload, '{}'::jsonb),
    p_placement_key,
    v_target_type,
    v_target_key,
    left(coalesce(nullif(trim(p_disclosure_label), ''), '合作内容'), 24),
    coalesce(p_creative, '{}'::jsonb),
    coalesce(p_economy_effect, '{}'::jsonb),
    now()
  )
  on conflict (id) do update set
    city_key = excluded.city_key,
    campaign_type = excluded.campaign_type,
    status = excluded.status,
    title = excluded.title,
    body = excluded.body,
    action_label = excluded.action_label,
    action_url = excluded.action_url,
    weight = excluded.weight,
    frequency_cap = excluded.frequency_cap,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    payload = excluded.payload,
    placement_key = excluded.placement_key,
    target_entity_type = excluded.target_entity_type,
    target_entity_key = excluded.target_entity_key,
    disclosure_label = excluded.disclosure_label,
    creative = excluded.creative,
    economy_effect = excluded.economy_effect,
    updated_at = now();
  return v_id;
end;
$$;

grant execute on function public.admin_upsert_native_campaign(
  uuid, text, text, text, text, text, text, text, integer, integer,
  timestamptz, timestamptz, text, text, text, text, jsonb, jsonb, jsonb
) to authenticated;
