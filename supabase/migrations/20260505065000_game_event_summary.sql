create index if not exists game_events_run_index_idx
  on public.game_events (run_id, event_index);

create index if not exists game_events_type_created_idx
  on public.game_events (event_type, created_at desc);

create index if not exists game_events_user_created_idx
  on public.game_events (user_id, created_at desc);

create or replace function public.admin_event_summary()
returns table (
  event_type text,
  event_count bigint,
  player_count bigint,
  run_count bigint,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ge.event_type,
    count(*) as event_count,
    count(distinct ge.user_id) as player_count,
    count(distinct ge.run_id) as run_count,
    max(ge.created_at) as last_seen_at
  from public.game_events ge
  where public.is_admin()
  group by ge.event_type
  order by event_count desc, ge.event_type asc
  limit 80;
$$;

grant execute on function public.admin_event_summary() to authenticated;
