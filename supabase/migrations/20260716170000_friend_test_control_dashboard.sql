-- Decision-ready controls and metrics for the first hidden five-way friend test.

update public.gameplay_experiments
set starts_at = timestamptz '2026-07-16 07:48:19+00',
    ends_at = null,
    updated_at = now()
where city_key = 'hangzhou'
  and starts_at is null
  and experiment_key in (
    'control_current',
    'clue_balanced',
    'small_goods_comeback',
    'high_risk_black_horse',
    'news_story_storm'
  );

create or replace function public.admin_set_friend_test_state(p_state text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_active integer := 0;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_state not in ('active', 'paused') then raise exception 'invalid_friend_test_state'; end if;

  if p_state = 'active' then
    update public.gameplay_experiments
    set status = 'paused', updated_at = now()
    where city_key = 'hangzhou'
      and status = 'active'
      and experiment_key not in (
        'control_current', 'clue_balanced', 'small_goods_comeback',
        'high_risk_black_horse', 'news_story_storm'
      );

    update public.gameplay_experiments
    set status = 'active',
        allocation_weight = 100,
        starts_at = coalesce(starts_at, now()),
        ends_at = null,
        updated_at = now()
    where city_key = 'hangzhou'
      and experiment_key in (
        'control_current', 'clue_balanced', 'small_goods_comeback',
        'high_risk_black_horse', 'news_story_storm'
      );
    get diagnostics v_updated = row_count;

    -- Keep commercial content out of the gameplay test so it cannot bias results.
    update public.campaigns
    set status = 'draft', updated_at = now()
    where status = 'active';
  else
    update public.gameplay_experiments
    set status = 'paused', updated_at = now()
    where city_key = 'hangzhou'
      and experiment_key in (
        'control_current', 'clue_balanced', 'small_goods_comeback',
        'high_risk_black_horse', 'news_story_storm'
      );
    get diagnostics v_updated = row_count;
  end if;

  select count(*)::integer into v_active
  from public.gameplay_experiments
  where city_key = 'hangzhou'
    and status = 'active'
    and experiment_key in (
      'control_current', 'clue_balanced', 'small_goods_comeback',
      'high_risk_black_horse', 'news_story_storm'
    );

  return jsonb_build_object(
    'state', p_state,
    'updated_count', v_updated,
    'active_count', v_active,
    'updated_at', now()
  );
end;
$$;

grant execute on function public.admin_set_friend_test_state(text) to authenticated;

drop function if exists public.admin_gameplay_experiment_results();
create function public.admin_gameplay_experiment_results()
returns table (
  experiment_key text,
  run_count bigint,
  player_count bigint,
  completed_player_count bigint,
  avg_score integer,
  best_score integer,
  score_median integer,
  score_p90 integer,
  completion_rate numeric,
  replay_player_rate numeric,
  negative_asset_rate numeric,
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
  with raw_runs as (
    select
      coalesce(nullif(gr.experiment_key, ''), 'control') as experiment_key,
      'account:' || gr.user_id::text as player_key,
      gr.score,
      gr.days_used,
      gr.final_state,
      gr.created_at
    from public.game_runs gr
    union all
    select
      coalesce(nullif(g.experiment_key, ''), 'control') as experiment_key,
      'guest:' || coalesce(nullif(g.guest_id, ''), nullif(g.session_id, ''), g.id::text) as player_key,
      g.score,
      g.days_used,
      g.final_state,
      g.created_at
    from public.guest_runs g
  ), test_runs as (
    select rr.*
    from raw_runs rr
    join public.gameplay_experiments ge on ge.experiment_key = rr.experiment_key
    where rr.created_at >= coalesce(ge.starts_at, '-infinity'::timestamptz)
      and rr.created_at < coalesce(ge.ends_at, 'infinity'::timestamptz)
  ), experiment_totals as (
    select
      tr.experiment_key,
      count(*)::bigint as run_count,
      count(distinct tr.player_key)::bigint as player_count,
      count(distinct tr.player_key) filter (where tr.days_used >= 45)::bigint as completed_player_count,
      round(avg(tr.score))::integer as avg_score,
      max(tr.score)::integer as best_score,
      percentile_disc(0.5) within group (order by tr.score)::integer as score_median,
      percentile_disc(0.9) within group (order by tr.score)::integer as score_p90,
      round(100.0 * count(*) filter (where tr.days_used >= 45) / nullif(count(*), 0), 1) as completion_rate,
      round(100.0 * count(*) filter (where tr.score < 0) / nullif(count(*), 0), 1) as negative_asset_rate,
      count(*) filter (where tr.final_state ? 'playtest_metrics')::bigint as metrics_run_count,
      round(avg(nullif(tr.final_state->'playtest_metrics'->>'duration_seconds', '')::numeric))::integer as avg_duration_seconds,
      round(avg(nullif(tr.final_state->'playtest_metrics'->>'primary_action_count', '')::numeric), 1) as avg_primary_actions,
      round(
        100.0 * count(*) filter (
          where nullif(tr.final_state->'playtest_metrics'->'checkpoint_net_worth'->>'10', '')::numeric >= 0
        ) / nullif(count(*) filter (where tr.final_state ? 'playtest_metrics'), 0),
        1
      ) as day10_break_even_rate,
      round(
        100.0 * count(*) filter (
          where nullif(tr.final_state->'playtest_metrics'->>'profitable_sale_count', '')::integer > 0
        ) / nullif(count(*) filter (where tr.final_state ? 'playtest_metrics'), 0),
        1
      ) as profitable_sale_rate
    from test_runs tr
    group by tr.experiment_key
  ), player_totals as (
    select
      grouped.experiment_key,
      round(100.0 * count(*) filter (where grouped.runs >= 2) / nullif(count(*), 0), 1) as replay_player_rate
    from (
      select tr.experiment_key, tr.player_key, count(*) as runs
      from test_runs tr
      group by tr.experiment_key, tr.player_key
    ) grouped
    group by grouped.experiment_key
  )
  select
    ge.experiment_key,
    coalesce(et.run_count, 0),
    coalesce(et.player_count, 0),
    coalesce(et.completed_player_count, 0),
    coalesce(et.avg_score, 0),
    coalesce(et.best_score, 0),
    coalesce(et.score_median, 0),
    coalesce(et.score_p90, 0),
    coalesce(et.completion_rate, 0),
    coalesce(pt.replay_player_rate, 0),
    coalesce(et.negative_asset_rate, 0),
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

drop function if exists public.admin_playtest_feedback_results();
create function public.admin_playtest_feedback_results()
returns table (
  experiment_key text,
  feedback_count bigint,
  avg_surprise numeric,
  avg_satisfaction numeric,
  avg_agency numeric,
  avg_fairness numeric,
  avg_replay_intent numeric,
  avg_share_intent numeric,
  median_surprise numeric,
  median_satisfaction numeric,
  story_share_rate numeric,
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
    percentile_disc(0.5) within group (order by pf.surprise)::numeric,
    percentile_disc(0.5) within group (order by pf.satisfaction)::numeric,
    round(
      100.0 * count(*) filter (
        where pf.share_intent >= 4 or length(trim(pf.memorable_moment)) >= 8
      ) / nullif(count(*), 0),
      1
    ),
    count(*) filter (where length(trim(pf.memorable_moment)) > 0)::bigint
  from public.playtest_feedback pf
  join public.gameplay_experiments ge on ge.experiment_key = pf.experiment_key
  where public.is_admin()
    and pf.created_at >= coalesce(ge.starts_at, '-infinity'::timestamptz)
    and pf.created_at < coalesce(ge.ends_at, 'infinity'::timestamptz)
  group by pf.experiment_key
  order by pf.experiment_key;
$$;

grant execute on function public.admin_playtest_feedback_results() to authenticated;
