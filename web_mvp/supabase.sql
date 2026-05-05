create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  score integer not null,
  cash integer not null,
  bank integer not null,
  debt integer not null,
  health integer not null,
  fame integer not null,
  coat integer not null,
  days_used integer not null,
  ended_reason text not null default 'completed',
  final_state jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.game_runs enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select on public.game_runs to authenticated;
grant insert on public.game_runs to authenticated;

create policy "Profiles are publicly readable"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can insert their own runs"
  on public.game_runs for insert
  with check (auth.uid() = user_id);

create policy "Users can view their own runs"
  on public.game_runs for select
  using (auth.uid() = user_id);

create or replace view public.leaderboard as
select distinct on (gr.user_id)
  gr.user_id,
  coalesce(p.display_name, '匿名玩家') as display_name,
  p.avatar_url,
  gr.id as run_id,
  gr.score,
  gr.cash,
  gr.bank,
  gr.debt,
  gr.health,
  gr.days_used,
  gr.created_at
from public.game_runs gr
left join public.profiles p on p.id = gr.user_id
order by gr.user_id, gr.score desc, gr.created_at asc;

grant select on public.leaderboard to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end;
$$;
create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_index integer not null,
  event_type text not null default 'log',
  day integer not null,
  message text not null,
  state jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, event_index)
);

alter table public.game_events enable row level security;

grant insert, select on public.game_events to authenticated;

create policy "Users can insert their own game events"
  on public.game_events for insert
  with check (auth.uid() = user_id);

create policy "Users can view their own game events"
  on public.game_events for select
  using (auth.uid() = user_id);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and lower(u.email) in ('qiankeyl@gmail.com')
  );
$$;

create or replace function public.admin_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_admin() then
      jsonb_build_object('error', 'forbidden')
    else
      jsonb_build_object(
        'users', (select count(*) from auth.users),
        'profiles', (select count(*) from public.profiles),
        'game_runs', (select count(*) from public.game_runs),
        'players_with_runs', (select count(distinct user_id) from public.game_runs),
        'events', (select count(*) from public.game_events),
        'best_score', (select coalesce(max(score), 0) from public.game_runs),
        'avg_score', (select coalesce(round(avg(score))::integer, 0) from public.game_runs),
        'runs_today', (
          select count(*)
          from public.game_runs
          where created_at >= date_trunc('day', now())
        )
      )
  end;
$$;

create or replace function public.admin_users()
returns table (
  id uuid,
  email text,
  provider text,
  display_name text,
  avatar_url text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  run_count bigint,
  best_score integer,
  last_run_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    u.email,
    u.raw_app_meta_data->>'provider' as provider,
    p.display_name,
    p.avatar_url,
    u.created_at,
    u.last_sign_in_at,
    count(gr.id) as run_count,
    coalesce(max(gr.score), 0) as best_score,
    max(gr.created_at) as last_run_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.game_runs gr on gr.user_id = u.id
  where public.is_admin()
  group by u.id, p.display_name, p.avatar_url
  order by u.created_at desc
  limit 200;
$$;

create or replace function public.admin_runs()
returns table (
  id uuid,
  user_id uuid,
  email text,
  display_name text,
  score integer,
  cash integer,
  bank integer,
  debt integer,
  health integer,
  fame integer,
  days_used integer,
  ended_reason text,
  event_count bigint,
  final_state jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    gr.id,
    gr.user_id,
    u.email,
    coalesce(p.display_name, '匿名玩家') as display_name,
    gr.score,
    gr.cash,
    gr.bank,
    gr.debt,
    gr.health,
    gr.fame,
    gr.days_used,
    gr.ended_reason,
    count(ge.id) as event_count,
    gr.final_state,
    gr.created_at
  from public.game_runs gr
  join auth.users u on u.id = gr.user_id
  left join public.profiles p on p.id = gr.user_id
  left join public.game_events ge on ge.run_id = gr.id
  where public.is_admin()
  group by gr.id, u.email, p.display_name
  order by gr.created_at desc
  limit 200;
$$;

create or replace function public.admin_events(p_run_id uuid default null)
returns table (
  id uuid,
  run_id uuid,
  user_id uuid,
  event_index integer,
  event_type text,
  day integer,
  message text,
  state jsonb,
  payload jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ge.id,
    ge.run_id,
    ge.user_id,
    ge.event_index,
    ge.event_type,
    ge.day,
    ge.message,
    ge.state,
    ge.payload,
    ge.created_at
  from public.game_events ge
  where public.is_admin()
    and (p_run_id is null or ge.run_id = p_run_id)
  order by ge.created_at desc, ge.event_index desc
  limit 1000;
$$;

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

grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_users() to authenticated;
grant execute on function public.admin_runs() to authenticated;
grant execute on function public.admin_events(uuid) to authenticated;
grant execute on function public.admin_event_summary() to authenticated;
